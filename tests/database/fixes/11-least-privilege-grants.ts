import assert from 'node:assert/strict';
import { createStoredFile, createUser, runAs, user } from '../harness.ts';
import { assertSucceeded, submitBidAs, type FixSuite } from '../suite.ts';

const writePrivileges = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'];

export const leastPrivilegeGrantsSuite: FixSuite = {
  migration: '20261005041100_least_privilege_grants.sql',
  title: 'M6/M7: least-privilege grants and no default grants',
  cases: [
    {
      name: 'Visitors who are not signed in hold no write privilege on any table or view',
      run: async (database) => {
        const result = await database.query<{ object_name: string; privilege: string }>(
          `select relation.relname as object_name, privilege
           from pg_class relation
           join pg_namespace namespace on namespace.oid = relation.relnamespace
           cross join unnest($1::text[]) as privilege
           where namespace.nspname = 'public' and relation.relkind in ('r', 'p', 'v')
             and has_table_privilege('anon', relation.oid, privilege)
           order by 1, 2`,
          [writePrivileges],
        );
        assert.deepEqual(result.rows, []);
      },
    },
    {
      name: 'Signed-in users hold no TRUNCATE, REFERENCES or TRIGGER on any table',
      run: async (database) => {
        const result = await database.query<{ object_name: string; privilege: string }>(
          `select relation.relname as object_name, privilege
           from pg_class relation
           join pg_namespace namespace on namespace.oid = relation.relnamespace
           cross join unnest(array['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as privilege
           where namespace.nspname = 'public' and relation.relkind in ('r', 'p', 'v')
             and has_table_privilege('authenticated', relation.oid, privilege)
           order by 1, 2`,
        );
        assert.deepEqual(result.rows, []);
      },
    },
    {
      name: 'Signed-in users cannot write ownership, lifecycle or timestamp columns',
      run: async (database) => {
        const forbidden: Array<[string, string, string]> = [
          ['tenders', 'business_id', 'UPDATE'],
          ['tenders', 'published_at', 'UPDATE'],
          ['tenders', 'closed_at', 'UPDATE'],
          ['tenders', 'created_at', 'INSERT'],
          ['bids', 'created_at', 'INSERT'],
          ['bids', 'amount', 'UPDATE'],
          ['profiles', 'account_type', 'UPDATE'],
          ['profiles', 'id', 'UPDATE'],
          ['supplier_profiles', 'user_id', 'UPDATE'],
          ['audit_log', 'occurred_at', 'INSERT'],
        ];
        const allowed: string[] = [];
        for (const [tableName, columnName, privilege] of forbidden) {
          const result = await database.query<{ allowed: boolean }>(`select has_column_privilege('authenticated', $1, $2, $3) as allowed`, [
            `public.${tableName}`,
            columnName,
            privilege,
          ]);
          if (result.rows[0]?.allowed) {
            allowed.push(`${privilege} ${tableName}.${columnName}`);
          }
        }
        assert.deepEqual(allowed, []);
      },
    },
    {
      name: 'A new table grants nothing to anon or authenticated until a migration says so',
      run: async (database) => {
        await database.exec(`create table public.default_privilege_probe (id integer)`);
        try {
          const result = await database.query<{ role_name: string }>(
            `select role_name from unnest(array['anon', 'authenticated']) as role_name
             where has_table_privilege(role_name, 'public.default_privilege_probe', 'SELECT')
                or has_table_privilege(role_name, 'public.default_privilege_probe', 'INSERT')`,
          );
          assert.deepEqual(result.rows, []);
        } finally {
          await database.exec(`drop table public.default_privilege_probe`);
        }
      },
    },
    {
      name: 'Only the intended functions can be called: none by visitors, three by signed-in users',
      run: async (database) => {
        const result = await database.query<{ role_name: string; function_name: string }>(
          `select role_name, namespace.nspname || '.' || function_row.proname as function_name
           from pg_proc function_row
           join pg_namespace namespace on namespace.oid = function_row.pronamespace
           cross join unnest(array['anon', 'authenticated']) as role_name
           where namespace.nspname in ('public', 'private')
             and has_function_privilege(role_name, function_row.oid, 'EXECUTE')
           order by 1, 2`,
        );
        assert.deepEqual(result.rows, [
          { role_name: 'authenticated', function_name: 'private.supplier_has_access' },
          { role_name: 'authenticated', function_name: 'private.uploads_in_last_day' },
          { role_name: 'authenticated', function_name: 'public.request_bid_document_download' },
        ]);
      },
    },
    {
      name: "The app's main signed-in flows still work with the narrower grants",
      alreadyHeldBefore: true,
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        assertSucceeded(
          await runAs(database, user(businessId), `update public.business_profiles set company_name = 'Updated Business', phone = '876-555-0100' where user_id = $1`, [businessId]),
          'business edits its profile',
        );
        const tenderRows = assertSucceeded(
          await runAs<{ id: string }>(
            database,
            user(businessId),
            `insert into public.tenders (business_id, title, description, closes_at, status) values ($1, 'Printer paper', 'A4, 50 reams', now() + interval '2 days', 'open') returning id`,
            [businessId],
          ),
          'business publishes a tender',
        );
        const tenderId = tenderRows[0]?.id;
        assert.ok(tenderId);
        const documentPath = await createStoredFile(database, 'bid-documents', supplierId);
        assertSucceeded(await submitBidAs(database, supplierId, tenderId, { documentPath }), 'supplier bids');
        const subscriptionRows = assertSucceeded(
          await runAs(database, user(supplierId), `select status from public.subscriptions where supplier_id = $1`, [supplierId]),
          'supplier reads its subscription',
        );
        assert.equal(subscriptionRows.length, 1);
      },
    },
  ],
};
