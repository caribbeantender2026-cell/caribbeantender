/** Notifications (P1-13), basic admin (P1-14, P1-15, 8.6, Q19) and least-privilege grants (M6, M7, 8.2, 8.4). */
import assert from 'node:assert/strict';
import {
  createBid,
  createTender,
  createUser,
  makeStaff,
  runAs,
  user,
} from '../harness.ts';
import {
  assertNothingReachable,
  assertRefused,
  assertSucceeded,
  assertTableExists,
  auditActions,
  publishTenderAs,
  scalar,
  submitBidAs,
  uploadAs,
  type FixSuite,
} from '../suite.ts';

export const notificationsSuite: FixSuite = {
  migration: '20261005041050_notifications.sql',
  title: 'P1-13: email log for the service role only; alert preferences per user',
  cases: [
    {
      name: 'P1-13/8.4: users can neither read nor write the email log',
      run: async (database) => {
        await assertTableExists(database, 'public.email_log');
        const userId = await createUser(database, { accountType: 'supplier' });
        await database.query(`insert into public.email_log (type, recipient, entity_id) values ('bid_receipt', 'someone@example.test', gen_random_uuid())`);
        assertNothingReachable(await runAs(database, user(userId), `select id from public.email_log`), 'read');
        assertRefused(await runAs(database, user(userId), `insert into public.email_log (type, recipient, entity_id) values ('bid_receipt', 'x@example.test', gen_random_uuid())`), 'write');
      },
    },
    {
      name: 'P1-13: the email log refuses a second email of the same type to the same recipient about the same thing',
      run: async (database) => {
        const insert = `insert into public.email_log (type, recipient, entity_id) values ('bids_opened', 'owner@example.test', '00000000-0000-0000-0000-000000000001')`;
        await database.query(insert);
        await assert.rejects(database.query(insert), /email_log_one_per_type_recipient_entity/);
      },
    },
    {
      name: "P1-13: a user turns their own tender alerts off and on, and can't touch anyone else's",
      run: async (database) => {
        const userId = await createUser(database, { accountType: 'supplier' });
        const otherUserId = await createUser(database, { accountType: 'supplier' });
        assertSucceeded(await runAs(database, user(userId), `insert into public.notification_preferences (user_id, tender_alerts) values ($1, false)`, [userId]), 'turn off');
        assertSucceeded(await runAs(database, user(userId), `update public.notification_preferences set tender_alerts = true where user_id = $1`, [userId]), 'turn on');
        assertRefused(await runAs(database, user(userId), `insert into public.notification_preferences (user_id, tender_alerts) values ($1, false)`, [otherUserId]), "someone else's");
        assertNothingReachable(await runAs(database, user(otherUserId), `select user_id from public.notification_preferences where user_id = $1`, [userId]), 'read another');
      },
    },
  ],
};

export const adminSuite: FixSuite = {
  migration: '20261005041060_staff_and_admin.sql',
  title: 'P1-15/8.6: basic admin, through role-checked functions that need two-factor sign-in',
  cases: [
    {
      name: 'P1-15: an admin signed in with two factors lists users (with trial end) and tenders (bid count hidden while sealed)',
      run: async (database) => {
        const adminId = await createUser(database, { accountType: 'business' });
        await makeStaff(database, adminId);
        const supplierId = await createUser(database, { accountType: 'supplier', companyName: 'Listed Supplies' });
        const businessId = await createUser(database, { accountType: 'business' });
        const sealedTenderId = await createTender(database, businessId, 'accepting-bids');
        const openedTenderId = await createTender(database, businessId, 'closed');
        await createBid(database, sealedTenderId, supplierId);
        await createBid(database, openedTenderId, supplierId);

        const users = assertSucceeded(
          await runAs<{ user_id: string; supplier_name: string; trial_ends_at: Date | null }>(database, user(adminId, 'aal2'), `select * from public.admin_list_users('Listed')`),
          'list users',
        );
        assert.equal(users.length, 1);
        assert.equal(users[0]?.user_id, supplierId);
        assert.ok(users[0]?.trial_ends_at);

        const tenders = assertSucceeded(
          await runAs<{ tender_id: string; bid_count: number | null }>(database, user(adminId, 'aal2'), `select tender_id, bid_count from public.admin_list_tenders()`),
          'list tenders',
        );
        const countById = new Map(tenders.map((row) => [row.tender_id, row.bid_count === null ? null : Number(row.bid_count)]));
        assert.equal(countById.get(sealedTenderId), null);
        assert.equal(countById.get(openedTenderId), 1);
      },
    },
    {
      name: 'P1-15/8.6: admin functions refuse a session without two-factor sign-in, and anyone who is not staff',
      run: async (database) => {
        const adminId = await createUser(database, { accountType: 'business' });
        await makeStaff(database, adminId);
        const ordinaryUserId = await createUser(database, { accountType: 'business' });
        assertRefused(await runAs(database, user(adminId, 'aal1'), `select * from public.admin_list_users()`), 'admin without two factors', /two-step/);
        assertRefused(await runAs(database, user(ordinaryUserId, 'aal2'), `select * from public.admin_list_users()`), 'not staff', /admin account/);
        const supportId = await createUser(database, { accountType: 'business' });
        await makeStaff(database, supportId, 'support');
        assertRefused(await runAs(database, user(supportId, 'aal2'), `select * from public.admin_list_tenders()`), 'support role in Phase 1', /admin account/);
      },
    },
    {
      name: 'P1-15: deactivating a user stops their write functions; reactivating restores them; both are logged',
      run: async (database) => {
        const adminId = await createUser(database, { accountType: 'business' });
        await makeStaff(database, adminId);
        const businessId = await createUser(database, { accountType: 'business' });
        const draftId = await createTender(database, businessId, 'draft');
        await uploadAs(database, businessId, 'tender-documents', `${draftId}/requirements-form/requirements.pdf`);
        assertSucceeded(await runAs(database, user(adminId, 'aal2'), `select public.admin_set_user_active($1, false)`, [businessId]), 'deactivate');
        assertRefused(await runAs(database, user(businessId), `select public.publish_tender($1)`, [draftId]), 'publish while deactivated', /deactivated/);
        assertRefused(
          await runAs(database, user(businessId), `insert into public.tenders (business_id, title, description, closes_at) values ($1, 'New draft', 'x', now() + interval '7 days')`, [businessId]),
          'create a draft while deactivated',
        );
        // The Edge Function applied the requested ban in Auth.
        await database.query("update auth.users set banned_until=now() + interval '1 year' where id=$1", [businessId]);
        assertSucceeded(await runAs(database, user(adminId, 'aal2'), `select public.admin_set_user_active($1, true)`, [businessId]), 'reactivate');
        assertSucceeded(await runAs(database, user(businessId), `select public.publish_tender($1)`, [draftId]), 'publish after reactivation');
        assert.deepEqual(await auditActions(database, businessId), ['admin_user_deactivated', 'admin_user_reactivated']);
        assertRefused(await runAs(database, user(adminId, 'aal2'), `select public.admin_set_user_active($1, false)`, [adminId]), 'deactivate yourself', /own account/);
      },
    },
    {
      name: 'P1-15: an admin cancels a tender with a reason, logged as both a cancellation and an admin action',
      run: async (database) => {
        const adminId = await createUser(database, { accountType: 'business' });
        await makeStaff(database, adminId);
        const businessId = await createUser(database, { accountType: 'business' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        assertSucceeded(await runAs(database, user(adminId, 'aal2'), `select public.admin_cancel_tender($1, 'Reported as fraudulent')`, [tenderId]), 'cancel');
        assert.deepEqual(await auditActions(database, tenderId), ['tender_cancelled', 'admin_tender_cancelled']);
      },
    },
    {
      name: 'P1-14: only an admin with two-factor sign-in reads the audit log',
      run: async (database) => {
        const adminId = await createUser(database, { accountType: 'business' });
        await makeStaff(database, adminId);
        const businessId = await createUser(database, { accountType: 'business' });
        assertSucceeded((await publishTenderAs(database, businessId)).outcome, 'publish');
        assert.ok(assertSucceeded(await runAs(database, user(adminId, 'aal2'), `select id from public.audit_log`), 'admin reads').length > 0);
        assertNothingReachable(await runAs(database, user(adminId, 'aal1'), `select id from public.audit_log`), 'admin without two factors');
        assertNothingReachable(await runAs(database, user(businessId), `select id from public.audit_log`), 'business reads its own events');
      },
    },
    {
      name: 'Q19: admins cannot read bid contents or download bid files in Phase 1',
      run: async (database) => {
        const adminId = await createUser(database, { accountType: 'business' });
        await makeStaff(database, adminId);
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'closed');
        const bid = await createBid(database, tenderId, supplierId);
        assertNothingReachable(await runAs(database, user(adminId, 'aal2'), `select amount from public.bids where tender_id = $1`, [tenderId]), 'read bids');
        assertRefused(await runAs(database, user(adminId, 'aal2'), `select * from public.read_tender_bids($1)`, [tenderId]), 'read through the function');
        assertRefused(await runAs(database, user(adminId, 'aal2'), `select public.request_document_download($1)`, [bid.documentId]), 'download a bid file');
      },
    },
  ],
};

const writePrivileges = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'];
const ownerOnlyPrivileges = ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];

export const leastPrivilegeGrantsSuite: FixSuite = {
  migration: '20261005041100_least_privilege_grants.sql',
  title: 'M6/M7/8.2/8.4: least-privilege grants and no default grants',
  cases: [
    {
      name: 'M6: visitors who are not signed in hold no privilege at all on any public table or view',
      run: async (database) => {
        const result = await database.query<{ object_name: string; privilege: string }>(
          `select relation.relname as object_name, privilege
           from pg_class relation
           join pg_namespace namespace on namespace.oid = relation.relnamespace
           cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as privilege
           where namespace.nspname = 'public' and relation.relkind in ('r', 'p', 'v')
             and has_table_privilege('anon', relation.oid, privilege)
           order by 1, 2`,
        );
        assert.deepEqual(result.rows, []);
      },
    },
    {
      name: '8.2: anon and authenticated hold no TRUNCATE, REFERENCES, TRIGGER or MAINTAIN in public, private or storage',
      run: async (database) => {
        const result = await database.query<{ role_name: string; object_name: string; privilege: string }>(
          `select role_name, namespace.nspname || '.' || relation.relname as object_name, privilege
           from pg_class relation
           join pg_namespace namespace on namespace.oid = relation.relnamespace
           cross join unnest(array['anon', 'authenticated']) as role_name
           cross join unnest($1::text[]) as privilege
           where namespace.nspname in ('public', 'private', 'storage') and relation.relkind in ('r', 'p', 'v')
             and has_table_privilege(role_name, relation.oid, privilege)
           order by 1, 2, 3`,
          [ownerOnlyPrivileges],
        );
        assert.deepEqual(result.rows, []);
      },
    },
    {
      name: '8.4: signed-in users cannot write any status, ownership, lifecycle or timestamp column, nor subscriptions, the audit log or the email log',
      run: async (database) => {
        const forbiddenColumns: Array<[string, string, string]> = [
          ['tenders', 'status', 'UPDATE'],
          ['tenders', 'status', 'INSERT'],
          ['tenders', 'business_id', 'UPDATE'],
          ['tenders', 'published_at', 'UPDATE'],
          ['tenders', 'awarded_bid_id', 'UPDATE'],
          ['tenders', 'cancelled_reason', 'UPDATE'],
          ['bids', 'status', 'UPDATE'],
          ['bids', 'submitted_at', 'INSERT'],
          ['profiles', 'is_active', 'UPDATE'],
          ['profiles', 'accepted_terms_at', 'UPDATE'],
          ['profiles', 'account_type', 'UPDATE'],
          ['form_submissions', 'attached_to_type', 'UPDATE'],
        ];
        const allowed: string[] = [];
        for (const [tableName, columnName, privilege] of forbiddenColumns) {
          if (await scalar<boolean>(database, `select has_column_privilege('authenticated', $1, $2, $3) as value`, [`public.${tableName}`, columnName, privilege])) {
            allowed.push(`${privilege} ${tableName}.${columnName}`);
          }
        }
        for (const tableName of ['subscriptions', 'audit_log', 'email_log', 'bids', 'bid_documents', 'tender_documents', 'categories', 'staff_members']) {
          for (const privilege of writePrivileges) {
            if (await scalar<boolean>(database, `select has_table_privilege('authenticated', $1, $2) as value`, [`public.${tableName}`, privilege])) {
              allowed.push(`${privilege} ${tableName}`);
            }
          }
        }
        assert.deepEqual(allowed, []);
      },
    },
    {
      name: 'M7: signed-in users can call exactly the intended functions, and visitors none',
      run: async (database, lastMigration) => {
        const result = await database.query<{ role_name: string; function_name: string }>(
          `select role_name, namespace.nspname || '.' || function_row.proname as function_name
           from pg_proc function_row
           join pg_namespace namespace on namespace.oid = function_row.pronamespace
           cross join unnest(array['anon', 'authenticated']) as role_name
           where namespace.nspname in ('public', 'private')
             and has_function_privilege(role_name, function_row.oid, 'EXECUTE')
           order by 1, 2`,
        );
        const sortedRows = [...result.rows].sort((first, second) => first.function_name.localeCompare(second.function_name));
        assert.deepEqual(sortedRows, [
          'private.bid_refusal_reason',
          'private.caller_is_active',
          'private.caller_is_admin',
          'private.is_own_draft_tender_folder',
          'private.is_own_unsubmitted_bid_folder',
          'private.try_uuid',
          'private.uploads_in_last_day',
          'public.admin_cancel_tender',
          'public.admin_list_tenders',
          'public.admin_list_users',
          'public.admin_set_user_active',
          'public.award_tender',
          'public.cancel_tender',
          'public.extend_tender_closing_time',
          'public.publish_tender',
          'public.read_tender_bids',
          'public.record_onboarding_completed',
          'public.request_document_download',
          ...(lastMigration >= '20261117060000' ? ['public.server_time'] : []),
          'public.submit_bid',
        ].sort((first, second) => first.localeCompare(second)).map((functionName) => ({ role_name: 'authenticated', function_name: functionName })));
      },
    },
    {
      name: 'M6: a new table grants nothing to anon or authenticated until a migration says so',
      run: async (database) => {
        await database.exec(`create table public.default_privilege_probe (id integer)`);
        try {
          const result = await database.query(
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
      name: "The app's main flows still work with the narrower grants",
      alreadyHeldBefore: true,
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        assertSucceeded(
          await runAs(database, user(businessId), `update public.business_profiles set company_name = 'Updated Business', phone = '876-555-0100' where user_id = $1`, [businessId]),
          'edit profile',
        );
        const { tenderId, outcome } = await publishTenderAs(database, businessId);
        assertSucceeded(outcome, 'publish');
        assert.ok(tenderId);
        assertSucceeded(await submitBidAs(database, supplierId, tenderId, { proposal: 'form' }), 'bid');
        assertSucceeded(await runAs(database, user(supplierId), `select id from public.bids where tender_id = $1`, [tenderId]), 'read own bid');
        assertSucceeded(await runAs(database, user(supplierId), `select status from public.subscriptions where supplier_id = $1`, [supplierId]), 'read own trial');
        assertSucceeded(await runAs(database, user(supplierId), `select public.record_onboarding_completed('supplier')`), 'finish onboarding');
      },
    },
  ],
};
