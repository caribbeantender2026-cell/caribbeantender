import assert from 'node:assert/strict';
import { createTender, createUser, runAs, user } from '../harness.ts';
import { assertSucceeded, type FixSuite } from '../suite.ts';

export const closesAtSuite: FixSuite = {
  migration: '20261005040300_tender_closes_at.sql',
  title: 'Deadlines: closes_at timestamptz instead of a date',
  cases: [
    {
      name: 'A deadline is an exact moment: closes_at is a timestamptz and closing_date is gone',
      run: async (database) => {
        const result = await database.query<{ column_name: string; data_type: string }>(
          `select column_name, data_type from information_schema.columns
           where table_schema = 'public' and table_name = 'tenders' and column_name in ('closes_at', 'closing_date')`,
        );
        assert.deepEqual(result.rows, [{ column_name: 'closes_at', data_type: 'timestamp with time zone' }]);
      },
    },
    {
      name: 'No constraint compares a tender with the current date, so old tenders stay editable (M1)',
      run: async (database) => {
        const result = await database.query<{ conname: string }>(
          `select conname from pg_constraint
           where conrelid = 'public.tenders'::regclass and pg_get_constraintdef(oid) ilike '%current_date%'`,
        );
        assert.deepEqual(result.rows, []);
      },
    },
    {
      name: 'A business can still cancel its tender after the deadline has passed',
      alreadyHeldBefore: true,
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const tenderId = await createTender(database, businessId, 'past-deadline');
        const rows = assertSucceeded(
          await runAs(database, user(businessId), `update public.tenders set status = 'cancelled' where id = $1 returning id`, [tenderId]),
          'cancel after the deadline',
        );
        assert.equal(rows.length, 1);
      },
    },
  ],
};
