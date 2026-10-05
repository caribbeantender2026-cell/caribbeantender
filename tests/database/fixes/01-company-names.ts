import assert from 'node:assert/strict';
import { anonymous, createBid, createTender, createUser, runAs, user } from '../harness.ts';
import { assertNothingReachable, assertRefused, assertSucceeded, type FixSuite } from '../suite.ts';

const nameViews = ['business_names_public', 'supplier_names_public'];
const nonSelectPrivileges = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];

export const companyNamesSuite: FixSuite = {
  migration: '20261005040100_company_names.sql',
  title: 'C1/P1: company names without bypassing row-level security',
  cases: [
    {
      name: 'A visitor who is not signed in cannot list supplier names',
      run: async (database) => {
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const outcome = await runAs(database, anonymous, `select user_id from public.supplier_names_public where user_id = $1`, [supplierId]);
        assertNothingReachable(outcome, 'anonymous read of a supplier name');
      },
    },
    {
      name: "A supplier cannot see another supplier's name without seeing one of their bids",
      run: async (database) => {
        const firstSupplierId = await createUser(database, { accountType: 'supplier' });
        const secondSupplierId = await createUser(database, { accountType: 'supplier' });
        const outcome = await runAs(database, user(secondSupplierId), `select user_id from public.supplier_names_public where user_id = $1`, [firstSupplierId]);
        assertNothingReachable(outcome, "another supplier's name");
      },
    },
    {
      name: 'A business name is visible to visitors only once that business has a visible tender',
      run: async (database) => {
        const businessWithoutTenderId = await createUser(database, { accountType: 'business' });
        const hiddenOutcome = await runAs(database, anonymous, `select user_id from public.business_names_public where user_id = $1`, [businessWithoutTenderId]);
        assertNothingReachable(hiddenOutcome, 'name of a business with no tenders');

        const businessWithTenderId = await createUser(database, { accountType: 'business', companyName: 'Visible Traders' });
        await createTender(database, businessWithTenderId, 'accepting-bids');
        const visibleRows = assertSucceeded(
          await runAs<{ company_name: string }>(database, anonymous, `select company_name from public.business_names_public where user_id = $1`, [businessWithTenderId]),
          'name of a business with a published tender',
        );
        assert.deepEqual(visibleRows.map((row) => row.company_name), ['Visible Traders']);
      },
    },
    {
      name: 'A business sees the names of suppliers whose bids it can read',
      alreadyHeldBefore: true,
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier', companyName: 'Bidder Limited' });
        const tenderId = await createTender(database, businessId, 'past-deadline');
        await createBid(database, tenderId, supplierId);
        const rows = assertSucceeded(
          await runAs<{ company_name: string }>(database, user(businessId), `select company_name from public.supplier_names_public where user_id = $1`, [supplierId]),
          "bidder's name for the tender owner",
        );
        assert.deepEqual(rows.map((row) => row.company_name), ['Bidder Limited']);
      },
    },
    {
      name: "A company's own name change shows up in the name views",
      alreadyHeldBefore: true,
      run: async (database) => {
        const supplierId = await createUser(database, { accountType: 'supplier' });
        assertSucceeded(
          await runAs(database, user(supplierId), `update public.supplier_profiles set company_name = 'Renamed Supplies' where user_id = $1`, [supplierId]),
          'supplier renames itself',
        );
        const rows = assertSucceeded(
          await runAs<{ company_name: string }>(database, user(supplierId), `select company_name from public.supplier_names_public where user_id = $1`, [supplierId]),
          'own name',
        );
        assert.deepEqual(rows.map((row) => row.company_name), ['Renamed Supplies']);
      },
    },
    {
      name: 'Writes through the name views are refused',
      alreadyHeldBefore: true,
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        await createTender(database, businessId, 'accepting-bids');
        assertRefused(
          await runAs(database, anonymous, `update public.business_names_public set company_name = 'Hijacked' where user_id = $1`, [businessId]),
          'anonymous rename through the view',
        );
        assertRefused(
          await runAs(database, user(businessId), `delete from public.business_names_public where user_id = $1`, [businessId]),
          'delete through the view',
        );
      },
    },
    {
      name: 'The name views grant nothing but SELECT (no TRUNCATE, REFERENCES, TRIGGER or MAINTAIN)',
      run: async (database) => {
        const granted: string[] = [];
        for (const viewName of nameViews) {
          for (const roleName of ['anon', 'authenticated']) {
            for (const privilege of nonSelectPrivileges) {
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
      name: 'The name views run as the caller (security_invoker), so row-level security applies',
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
  ],
};
