/** C1: the name views let anyone rename or delete any profile (AUDIT.md C1). Two migrations fix it. */
import assert from 'node:assert/strict';
import { anonymous, createTender, createUser, runAs, user } from '../harness.ts';
import { assertNothingReachable, assertRefused, assertSucceeded, type FixSuite } from '../suite.ts';

const nameViews = ['business_names_public', 'supplier_names_public'];
const nonSelectPrivileges = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];

export const nameViewWritesSuite: FixSuite = {
  migration: '20261005031017_revoke_writes_on_public_name_views.sql',
  title: 'C1 (first fix): no writes through the name views',
  cases: [
    {
      name: 'C1: a visitor cannot rename a company through the name views',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business', companyName: 'Original Name Ltd' });
        await runAs(database, anonymous, `update public.business_names_public set company_name = 'Hijacked' where user_id = $1`, [businessId]);
        const name = await database.query<{ company_name: string }>(`select company_name from public.business_profiles where user_id = $1`, [businessId]);
        assert.equal(name.rows[0]?.company_name, 'Original Name Ltd');
      },
    },
    {
      name: 'C1: a visitor cannot delete a company (and with it every tender and bid) through the name views',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        await createTender(database, businessId, 'accepting-bids');
        await runAs(database, anonymous, `delete from public.business_names_public where user_id = $1`, [businessId]);
        const remaining = await database.query(`select 1 from public.business_profiles where user_id = $1`, [businessId]);
        assert.equal(remaining.rows.length, 1);
      },
    },
  ],
};

export const companyNamesSuite: FixSuite = {
  migration: '20261005040100_company_names.sql',
  title: 'C1 (permanent fix): company names for signed-in users only, without bypassing row-level security',
  cases: [
    {
      name: 'C1: a visitor who is not signed in cannot read any company name',
      run: async (database) => {
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const businessId = await createUser(database, { accountType: 'business' });
        assertNothingReachable(await runAs(database, anonymous, `select user_id from public.supplier_names_public where user_id = $1`, [supplierId]), 'supplier name');
        assertNothingReachable(await runAs(database, anonymous, `select user_id from public.business_names_public where user_id = $1`, [businessId]), 'business name');
      },
    },
    {
      name: 'C1: the name views run as the caller (security_invoker), so row-level security applies',
      run: async (database) => {
        const result = await database.query<{ relname: string; reloptions: string[] | null }>(
          `select relname, reloptions from pg_class where relname = any($1) order by relname`,
          [nameViews],
        );
        assert.equal(result.rows.length, 2);
        for (const view of result.rows) {
          assert.ok(view.reloptions?.includes('security_invoker=true'), `${view.relname} should be security_invoker`);
        }
      },
    },
    {
      name: 'C1: the name views grant nothing but SELECT, to signed-in users only (no TRUNCATE, REFERENCES, TRIGGER or MAINTAIN)',
      run: async (database) => {
        const granted: string[] = [];
        for (const viewName of nameViews) {
          for (const roleName of ['anon', 'authenticated']) {
            for (const privilege of [...nonSelectPrivileges, ...(roleName === 'anon' ? ['SELECT'] : [])]) {
              const result = await database.query<{ allowed: boolean }>(`select has_table_privilege($1, $2, $3) as allowed`, [roleName, `public.${viewName}`, privilege]);
              if (result.rows[0]?.allowed) {
                granted.push(`${roleName} ${privilege} on ${viewName}`);
              }
            }
          }
        }
        assert.deepEqual(granted, []);
      },
    },
    {
      name: "C1: a signed-in user can read another company's name, and only the name",
      alreadyHeldBefore: true,
      run: async (database) => {
        const supplierId = await createUser(database, { accountType: 'supplier', companyName: 'Visible Supplies' });
        const otherSupplierId = await createUser(database, { accountType: 'supplier' });
        const rows = assertSucceeded(
          await runAs<Record<string, unknown>>(database, user(otherSupplierId), `select * from public.supplier_names_public where user_id = $1`, [supplierId]),
          'read a name',
        );
        assert.deepEqual(rows, [{ user_id: supplierId, company_name: 'Visible Supplies' }]);
      },
    },
    {
      name: "C1: a company's own rename shows in the name views",
      alreadyHeldBefore: true,
      run: async (database) => {
        const supplierId = await createUser(database, { accountType: 'supplier' });
        assertSucceeded(
          await runAs(database, user(supplierId), `update public.supplier_profiles set company_name = 'Renamed Supplies' where user_id = $1`, [supplierId]),
          'rename',
        );
        const rows = assertSucceeded(
          await runAs<{ company_name: string }>(database, user(supplierId), `select company_name from public.supplier_names_public where user_id = $1`, [supplierId]),
          'read own name',
        );
        assert.deepEqual(rows.map((row) => row.company_name), ['Renamed Supplies']);
      },
    },
    {
      name: 'C1: writes through the name views are refused, also for signed-in users',
      alreadyHeldBefore: true,
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        assertRefused(await runAs(database, user(businessId), `update public.business_names_public set company_name = 'X' where user_id = $1`, [businessId]), 'rename');
        assertRefused(await runAs(database, user(businessId), `delete from public.business_names_public where user_id = $1`, [businessId]), 'delete');
      },
    },
  ],
};
