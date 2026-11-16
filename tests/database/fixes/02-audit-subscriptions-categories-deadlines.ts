/** The audit log table (P1-14), A1 (trial reset), categories (P1-04) and A6/M1 (deadlines). */
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { anonymous, createUser, runAs, service, setSupplierAccess, user } from '../harness.ts';
import { assertNothingReachable, assertRefused, assertSucceeded, assertTableExists, scalar, type FixSuite } from '../suite.ts';

async function supplierHasAccess(database: PGlite, supplierId: string): Promise<boolean> {
  return scalar<boolean>(database, `select private.supplier_has_access($1) as value`, [supplierId]);
}

export const auditLogSuite: FixSuite = {
  migration: '20261005040050_audit_log.sql',
  title: 'P1-14: an append-only audit log',
  cases: [
    {
      name: 'P1-14: no role can change or delete an audit row, not even the service role or the table owner',
      run: async (database) => {
        await database.query(`select private.write_audit_log('tender_published', 'tender', gen_random_uuid())`);
        const entryId = await scalar<number>(database, `select max(id) as value from public.audit_log`);
        assertRefused(await runAs(database, service, `update public.audit_log set action = 'tender_closed' where id = $1`, [entryId]), 'service role edits');
        assertRefused(await runAs(database, service, `delete from public.audit_log where id = $1`, [entryId]), 'service role deletes');
        await assert.rejects(database.query(`delete from public.audit_log where id = $1`, [entryId]), /append-only/);
        await assert.rejects(database.query(`truncate public.audit_log`), /append-only/);
      },
    },
    {
      name: 'P1-14: users cannot write audit rows directly, and nobody but admins reads them',
      run: async (database) => {
        await assertTableExists(database, 'public.audit_log');
        const userId = await createUser(database, { accountType: 'supplier' });
        assertRefused(
          await runAs(database, user(userId), `insert into public.audit_log (action, entity_type, entity_id) values ('bid_submitted', 'bid', gen_random_uuid())`),
          'forge an entry',
        );
        await database.query(`select private.write_audit_log('tender_published', 'tender', gen_random_uuid())`);
        assertNothingReachable(await runAs(database, user(userId), `select id from public.audit_log`), 'a user reads the log');
      },
    },
  ],
};

export const subscriptionsSuite: FixSuite = {
  migration: '20261005040200_subscriptions.sql',
  title: 'A1: one trial per person, in a table no user can write',
  cases: [
    {
      name: 'A1: deleting and recreating a supplier profile does not start a new trial',
      run: async (database) => {
        const supplierId = await createUser(database, { accountType: 'supplier' });
        await setSupplierAccess(database, supplierId, 'expired');
        assert.equal(await supplierHasAccess(database, supplierId), false, 'expired before the attempt');
        // However the profile is removed (C1 allowed it through the views), recreating it is the attack.
        await database.query(`delete from public.supplier_profiles where user_id = $1`, [supplierId]);
        assertSucceeded(
          await runAs(database, user(supplierId), `insert into public.supplier_profiles (user_id, company_name) values ($1, 'Fresh Start Ltd')`, [supplierId]),
          'recreate the profile',
        );
        assert.equal(await supplierHasAccess(database, supplierId), false, 'access after recreating the profile');
      },
    },
    {
      name: 'A1: a supplier cannot give itself access through any write of its own',
      alreadyHeldBefore: true,
      run: async (database) => {
        const supplierId = await createUser(database, { accountType: 'supplier' });
        await setSupplierAccess(database, supplierId, 'expired');
        const attempts = [
          `update public.supplier_profiles set subscription_status = 'active', subscription_ends_at = now() + interval '1 year' where user_id = $1`,
          `update public.supplier_profiles set trial_ends_at = now() + interval '1 year' where user_id = $1`,
          `update public.subscriptions set status = 'active', current_period_end = now() + interval '1 year' where supplier_id = $1`,
          `update public.subscriptions set trial_ends_at = now() + interval '1 year' where supplier_id = $1`,
          `insert into public.subscriptions (supplier_id, status, trial_ends_at) values ($1, 'trial', now() + interval '1 year')`,
        ];
        for (const attempt of attempts) {
          await runAs(database, user(supplierId), attempt, [supplierId]);
        }
        assert.equal(await supplierHasAccess(database, supplierId), false);
      },
    },
    {
      name: 'A1: trial state lives in subscriptions, keyed to the auth user, writable only by the service role; supplier_profiles has none of it',
      run: async (database) => {
        for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) {
          for (const roleName of ['anon', 'authenticated']) {
            const allowed = await scalar<boolean>(database, `select has_table_privilege($1, 'public.subscriptions', $2) as value`, [roleName, privilege]);
            assert.equal(allowed, false, `${roleName} ${privilege}`);
          }
          assert.equal(await scalar<boolean>(database, `select has_table_privilege('service_role', 'public.subscriptions', $1) as value`, [privilege]), true);
        }
        const foreignKeyTarget = await scalar<string>(
          database,
          `select confrelid::regclass::text as value from pg_constraint where conrelid = 'public.subscriptions'::regclass and contype = 'f'`,
        );
        assert.equal(foreignKeyTarget, 'auth.users');
        const leftover = await database.query(
          `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'supplier_profiles'
             and column_name in ('trial_started_at', 'trial_ends_at', 'subscription_status', 'subscription_plan', 'subscription_started_at', 'subscription_ends_at', 'payment_customer_id', 'payment_subscription_id')`,
        );
        assert.deepEqual(leftover.rows, []);
      },
    },
    {
      name: 'A1: a new supplier starts a 14-day trial with status trial',
      run: async (database) => {
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const days = await scalar<number>(
          database,
          `select round(extract(epoch from trial_ends_at - now()) / 86400)::integer as value from public.subscriptions where supplier_id = $1 and status = 'trial'`,
          [supplierId],
        );
        assert.equal(days, 14);
        assert.equal(await supplierHasAccess(database, supplierId), true);
      },
    },
    {
      name: 'A1: a supplier reads only its own subscription',
      run: async (database) => {
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const otherSupplierId = await createUser(database, { accountType: 'supplier' });
        const ownRows = assertSucceeded(await runAs(database, user(supplierId), `select status from public.subscriptions where supplier_id = $1`, [supplierId]), 'own');
        assert.equal(ownRows.length, 1);
        assertNothingReachable(await runAs(database, user(supplierId), `select status from public.subscriptions where supplier_id = $1`, [otherSupplierId]), 'other');
      },
    },
    {
      name: 'Q7: the Phase 3 payment function is gone',
      run: async (database) => {
        const remaining = await database.query(`select 1 from pg_proc where proname = 'process_subscription_payment'`);
        assert.deepEqual(remaining.rows, []);
      },
    },
  ],
};

export const categoriesSuite: FixSuite = {
  migration: '20261005040250_categories.sql',
  title: 'P1-04: seeded categories for tenders and suppliers',
  cases: [
    {
      name: 'P1-04: the six draft categories are seeded, and signed-in users can read them',
      run: async (database) => {
        const userId = await createUser(database, { accountType: 'supplier' });
        // The draft slugs only: the client's list (20261116200000) adds more rows after these.
        const rows = assertSucceeded(
          await runAs<{ name: string }>(database, user(userId), `select name from public.categories where slug in ('goods-and-supplies', 'works', 'professional-services', 'technology-services', 'security-services', 'cleaning-and-janitorial') order by sort_order`),
          'read',
        );
        assert.deepEqual(rows.map((row) => row.name), [
          'Goods and Supplies', 'Works', 'Professional Services', 'Technology Services', 'Security Services', 'Cleaning and Janitorial',
        ]);
      },
    },
    {
      name: 'P1-04: visitors cannot read categories, and nobody but the owner changes them',
      run: async (database) => {
        await assertTableExists(database, 'public.categories');
        const userId = await createUser(database, { accountType: 'business' });
        assertNothingReachable(await runAs(database, anonymous, `select id from public.categories`), 'visitor');
        assertRefused(await runAs(database, user(userId), `insert into public.categories (name, slug) values ('Fake', 'fake')`), 'insert');
      },
    },
  ],
};

export const clientCategoriesSuite: FixSuite = {
  migration: '20261116200000_client_categories.sql',
  title: "The client's 66 categories replace the draft six",
  cases: [
    {
      name: "Client list: 15 Works, 30 Services and 21 Goods & Supplies are offered, each with a code, and the draft six are retired",
      run: async (database) => {
        const userId = await createUser(database, { accountType: 'supplier' });
        const counts = assertSucceeded(
          await runAs<{ procurement_type: string; total: number }>(database, user(userId), `select procurement_type, count(*)::integer as total from public.categories where is_active group by 1 order by 1`),
          'read',
        );
        assert.deepEqual(counts, [
          { procurement_type: 'Goods & Supplies', total: 21 },
          { procurement_type: 'Services', total: 30 },
          { procurement_type: 'Works', total: 15 },
        ]);
        assert.equal(await scalar<string>(database, `select name as value from public.categories where code = 'SRV-011'`), 'Cleaning & Janitorial Services');
        assert.equal(await scalar<number>(database, `select count(*)::integer as value from public.categories where is_active and slug = 'works'`), 0);
      },
    },
    {
      name: 'Client list: a category without a valid code, or with a code already used, cannot be offered',
      run: async (database) => {
        await assert.rejects(database.query(`insert into public.categories (name, slug) values ('Uncoded', 'uncoded')`), /categories_active_have_code|code/);
        await assert.rejects(database.query(`insert into public.categories (name, slug, code, procurement_type) values ('Bad code', 'bad-code', 'XYZ-001', 'Works')`), /categories_code_format|code/);
        await assert.rejects(database.query(`insert into public.categories (name, slug, code, procurement_type) values ('Copy', 'copy', 'WRK-001', 'Works')`), /categories_code_key|duplicate/);
      },
    },
  ],
};

export const closesAtSuite: FixSuite = {
  migration: '20261005040300_tender_closes_at.sql',
  title: 'A6/M1: deadlines are exact moments, not UTC dates',
  cases: [
    {
      name: 'A6: a deadline is a timestamptz (closes_at) and closing_date is gone',
      run: async (database) => {
        const columns = await database.query<{ column_name: string; data_type: string }>(
          `select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = 'tenders' and column_name in ('closes_at', 'closing_date')`,
        );
        assert.deepEqual(columns.rows, [{ column_name: 'closes_at', data_type: 'timestamp with time zone' }]);
      },
    },
    {
      name: 'M1: no constraint compares a tender with the current date, so an old tender stays changeable',
      run: async (database) => {
        const checks = await database.query<{ definition: string }>(
          `select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = 'public.tenders'::regclass and contype = 'c'`,
        );
        assert.deepEqual(checks.rows.filter((row) => /CURRENT_DATE|now\(\)/i.test(row.definition)), []);
      },
    },
  ],
};
