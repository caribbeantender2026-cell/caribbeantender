import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { createUser, runAs, service, setSupplierAccess, user } from '../harness.ts';
import { assertNothingReachable, assertSucceeded, scalar, type FixSuite } from '../suite.ts';

async function supplierHasAccess(database: PGlite, supplierId: string): Promise<boolean> {
  return scalar<boolean>(database, `select private.supplier_has_access($1) as value`, [supplierId]);
}

export const subscriptionsSuite: FixSuite = {
  migration: '20261005040200_subscriptions.sql',
  title: 'Subscriptions: service-role-only table, one trial per person',
  cases: [
    {
      name: 'Deleting and recreating a supplier profile does not start a new trial',
      run: async (database) => {
        const supplierId = await createUser(database, { accountType: 'supplier' });
        await setSupplierAccess(database, supplierId, 'expired');
        assert.equal(await supplierHasAccess(database, supplierId), false, 'expired before the reset attempt');

        // The profile is removed by someone with the rights to do so, then recreated by the supplier.
        await database.query(`delete from public.supplier_profiles where user_id = $1`, [supplierId]);
        assertSucceeded(
          await runAs(database, user(supplierId), `insert into public.supplier_profiles (user_id, company_name) values ($1, 'Fresh Start Ltd')`, [supplierId]),
          'supplier recreates its profile',
        );
        assert.equal(await supplierHasAccess(database, supplierId), false, 'access after recreating the profile');
      },
    },
    {
      name: 'A supplier cannot give itself access through any of its own writes',
      alreadyHeldBefore: true,
      run: async (database) => {
        const supplierId = await createUser(database, { accountType: 'supplier' });
        await setSupplierAccess(database, supplierId, 'expired');
        const attempts = [
          `update public.supplier_profiles set subscription_status = 'active', subscription_ends_at = now() + interval '1 year' where user_id = $1`,
          `update public.supplier_profiles set trial_ends_at = now() + interval '1 year' where user_id = $1`,
          `update public.subscriptions set status = 'active', current_period_ends_at = now() + interval '1 year' where supplier_id = $1`,
          `update public.subscriptions set trial_ends_at = now() + interval '1 year' where supplier_id = $1`,
          `insert into public.subscriptions (supplier_id, status, trial_ends_at) values ($1, 'trialing', now() + interval '1 year')`,
        ];
        for (const attempt of attempts) {
          await runAs(database, user(supplierId), attempt, [supplierId]);
        }
        assert.equal(await supplierHasAccess(database, supplierId), false);
      },
    },
    {
      name: 'Subscription state lives in a table only the service role can write',
      run: async (database) => {
        for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) {
          for (const roleName of ['anon', 'authenticated']) {
            const allowed = await scalar<boolean>(database, `select has_table_privilege($1, 'public.subscriptions', $2) as value`, [roleName, privilege]);
            assert.equal(allowed, false, `${roleName} ${privilege} on subscriptions`);
          }
          const serviceAllowed = await scalar<boolean>(database, `select has_table_privilege('service_role', 'public.subscriptions', $1) as value`, [privilege]);
          assert.equal(serviceAllowed, true, `service_role ${privilege} on subscriptions`);
        }
        const leftoverColumns = await database.query(
          `select column_name from information_schema.columns
           where table_schema = 'public' and table_name = 'supplier_profiles'
             and column_name in ('trial_started_at', 'trial_ends_at', 'subscription_status', 'subscription_plan',
                                 'subscription_started_at', 'subscription_ends_at', 'payment_customer_id', 'payment_subscription_id')`,
        );
        assert.deepEqual(leftoverColumns.rows, [], 'subscription columns left on supplier_profiles');
      },
    },
    {
      name: 'The service role can activate a subscription',
      run: async (database) => {
        const supplierId = await createUser(database, { accountType: 'supplier' });
        await setSupplierAccess(database, supplierId, 'expired');
        assertSucceeded(
          await runAs(database, service, `update public.subscriptions set status = 'active', current_period_ends_at = now() + interval '1 month' where supplier_id = $1`, [supplierId]),
          'service role activates',
        );
        assert.equal(await supplierHasAccess(database, supplierId), true);
      },
    },
    {
      name: 'A new supplier starts a 14-day trial',
      run: async (database) => {
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const days = await scalar<number>(
          database,
          `select round(extract(epoch from trial_ends_at - now()) / 86400)::integer as value from public.subscriptions where supplier_id = $1 and status = 'trialing'`,
          [supplierId],
        );
        assert.equal(days, 14);
        assert.equal(await supplierHasAccess(database, supplierId), true);
      },
    },
    {
      name: 'A supplier reads only its own subscription',
      run: async (database) => {
        const firstSupplierId = await createUser(database, { accountType: 'supplier' });
        const secondSupplierId = await createUser(database, { accountType: 'supplier' });
        const ownRows = assertSucceeded(
          await runAs(database, user(firstSupplierId), `select status from public.subscriptions where supplier_id = $1`, [firstSupplierId]),
          'own subscription',
        );
        assert.equal(ownRows.length, 1);
        assertNothingReachable(
          await runAs(database, user(firstSupplierId), `select status from public.subscriptions where supplier_id = $1`, [secondSupplierId]),
          "another supplier's subscription",
        );
      },
    },
    {
      name: 'An active subscription without a paid-up period gives no access',
      run: async (database) => {
        const supplierId = await createUser(database, { accountType: 'supplier' });
        await database.query(`update public.subscriptions set status = 'active', current_period_ends_at = null where supplier_id = $1`, [supplierId]);
        assert.equal(await supplierHasAccess(database, supplierId), false);
      },
    },
  ],
};
