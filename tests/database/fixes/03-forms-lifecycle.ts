/** P1-11 (forms as data) and P1-06/P1-07/M2 (tender lifecycle). */
import assert from 'node:assert/strict';
import {
  anonymous,
  completeRequirementsForm,
  createBid,
  createTender,
  createUser,
  runAs,
  service,
  setTenderState,
  user,
  writeFixture,
} from '../harness.ts';
import { assertNothingReachable, assertRefused, assertSucceeded, assertTableExists, auditActions, publishTenderAs, scalar, type FixSuite } from '../suite.ts';

const hourInMilliseconds = 3_600_000;

export const formsSuite: FixSuite = {
  migration: '20261005040420_forms.sql',
  title: 'P1-11: standard forms as data, frozen once attached',
  cases: [
    {
      name: 'P1-11: the two draft definitions are seeded, marked as drafts, and readable by signed-in users',
      run: async (database) => {
        const userId = await createUser(database, { accountType: 'supplier' });
        const rows = assertSucceeded(
          await runAs<{ key: string; is_draft: boolean; audience: string }>(database, user(userId), `select key, is_draft, audience from public.form_definitions where version = 1 and key in ('business-requirements', 'supplier-proposal') order by key`),
          'read definitions',
        );
        assert.deepEqual(rows, [
          { key: 'business-requirements', is_draft: true, audience: 'business' },
          { key: 'supplier-proposal', is_draft: true, audience: 'supplier' },
        ]);
      },
    },
    {
      name: 'P1-11: a new definition appears and is fillable with no code change',
      run: async (database) => {
        await database.query(
          `insert into public.form_definitions (key, version, title, audience, schema)
           values ('site-visit', 1, 'Site visit request', 'supplier', '{"fields": [{"name": "preferred_date", "label": "Preferred date", "type": "date", "required": true}]}')`,
        );
        const supplierId = await createUser(database, { accountType: 'supplier' });
        assertSucceeded(
          await runAs(database, user(supplierId), `insert into public.form_submissions (form_key, form_version, owner_id, data) values ('site-visit', 1, $1, '{"preferred_date": "2026-12-01"}')`, [supplierId]),
          'fill in the new form',
        );
      },
    },
    {
      name: 'P1-11: data that does not fit the definition is refused (wrong type, unknown field, too long, bad date)',
      run: async (database) => {
        await assertTableExists(database, 'public.form_submissions');
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const badData = [
          { deliverables: 42 },
          { not_a_field: 'x' },
          { delivery_timeline: 'x'.repeat(301) },
          { cost_breakdown: [{ item: 'Chair', quantity: 'twenty' }] },
          { cost_breakdown: 'not a table' },
        ];
        for (const data of badData) {
          assertRefused(
            await runAs(database, user(supplierId), `insert into public.form_submissions (form_key, form_version, owner_id, data) values ('supplier-proposal', 1, $1, $2)`, [supplierId, JSON.stringify(data)]),
            `refuse ${JSON.stringify(data)}`,
          );
        }
      },
    },
    {
      name: "P1-11: users fill in only their own audience's forms, and cannot attach anything to a bid themselves",
      run: async (database) => {
        await assertTableExists(database, 'public.form_submissions');
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        assertRefused(
          await runAs(database, user(businessId), `insert into public.form_submissions (form_key, form_version, owner_id, data) values ('supplier-proposal', 1, $1, '{}')`, [businessId]),
          'business fills in a supplier form',
        );
        assertRefused(
          await runAs(
            database,
            user(supplierId),
            `insert into public.form_submissions (form_key, form_version, owner_id, data, attached_to_type, attached_to_id) values ('supplier-proposal', 1, $1, '{}', 'bid', gen_random_uuid())`,
            [supplierId],
          ),
          'attach to a bid directly',
        );
      },
    },
    {
      name: 'P1-11: a requirements form attached to a draft is editable, and frozen once the tender is published',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const tenderId = await createTender(database, businessId, 'draft');
        const submissionId = assertSucceeded(
          await runAs<{ id: string }>(
            database,
            user(businessId),
            `insert into public.form_submissions (form_key, form_version, owner_id, data, attached_to_type, attached_to_id)
             values ('business-requirements', 1, $1, $2, 'tender', $3) returning id`,
            [businessId, JSON.stringify(completeRequirementsForm), tenderId],
          ),
          'attach to the draft',
        )[0]?.id;
        assert.ok(submissionId);
        assertSucceeded(
          await runAs(database, user(businessId), `update public.form_submissions set data = data || '{"contact_person": "Someone Else"}' where id = $1`, [submissionId]),
          'edit while draft',
        );
        await writeFixture(database, `update public.tenders set status = 'open' where id = $1`, [tenderId]);
        assertRefused(
          await runAs(database, user(businessId), `update public.form_submissions set data = '{}' where id = $1`, [submissionId]),
          'edit after publishing',
          /cannot be changed/,
        );
        assertRefused(await runAs(database, user(businessId), `delete from public.form_submissions where id = $1`, [submissionId]), 'delete after publishing', /cannot be changed/);
      },
    },
  ],
};

export const clientFormsSuite: FixSuite = {
  migration: '20261116210000_client_forms.sql',
  title: "The client's four standard forms, with tick boxes",
  cases: [
    {
      name: "Client forms: the Tender Creation, Bid Submission, Business and Supplier Registration forms are the newest versions on offer",
      run: async (database) => {
        const userId = await createUser(database, { accountType: 'supplier' });
        const rows = assertSucceeded(
          await runAs<{ key: string; title: string; is_draft: boolean }>(
            database,
            user(userId),
            `select distinct on (key) key, title, is_draft from public.form_definitions where key in ('business-requirements', 'supplier-proposal', 'business-registration', 'supplier-registration') order by key, version desc`,
          ),
          'read definitions',
        );
        assert.deepEqual(rows, [
          { key: 'business-registration', title: 'Business Registration Form', is_draft: false },
          { key: 'business-requirements', title: 'Tender Creation Form', is_draft: false },
          { key: 'supplier-proposal', title: 'Bid Submission Form', is_draft: false },
          { key: 'supplier-registration', title: 'Supplier Registration Form', is_draft: false },
        ]);
      },
    },
    {
      name: 'Client forms: pick-one and tick-any answers must be among the listed options',
      run: async (database) => {
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const insert = (data: object) =>
          runAs(database, user(supplierId), `insert into public.form_submissions (form_key, form_version, owner_id, data) values ('supplier-registration', 1, $1, $2)`, [supplierId, JSON.stringify(data)]);
        assertSucceeded(await insert({ parish: 'St. Ann', service_areas: ['Kingston', 'Islandwide'], industry: ['Construction'] }), 'listed options');
        assertRefused(await insert({ parish: 'Nowhere' }), 'unlisted parish');
        assertRefused(await insert({ service_areas: ['Mars'] }), 'unlisted service area');
        assertRefused(await insert({ industry: 'Construction' }), 'tick-any given as plain text');
      },
    },
  ],
};

export const tenderLifecycleSuite: FixSuite = {
  migration: '20261005040500_tender_lifecycle.sql',
  title: 'P1-06/P1-07/M2: draft, open, closed, awarded, cancelled',
  cases: [
    {
      name: 'P1-06: a business creates a draft, attaches the requirements form and publishes it',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const { tenderId, outcome } = await publishTenderAs(database, businessId);
        assertSucceeded(outcome, 'publish');
        assert.ok(tenderId);
        const status = await scalar<string>(database, `select status::text as value from public.tenders where id = $1 and published_at is not null`, [tenderId]);
        assert.equal(status, 'open');
        assert.deepEqual(await auditActions(database, tenderId), ['tender_published']);
      },
    },
    {
      name: 'P1-06: publishing with a past closing time fails in the database',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const { outcome } = await publishTenderAs(database, businessId, { closesAt: new Date(Date.now() - hourInMilliseconds) });
        assertRefused(outcome, 'publish in the past', /must be in the future/);
      },
    },
    {
      name: 'P1-06: publishing needs a category and the requirements form (online or uploaded)',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        assertRefused((await publishTenderAs(database, businessId, { withCategory: false })).outcome, 'no category', /category/);
        assertRefused((await publishTenderAs(database, businessId, { withRequirementsForm: false })).outcome, 'no requirements form', /requirements form/);
      },
    },
    {
      name: 'P1-06: after publishing, the only change allowed is extending the closing time, and it is logged',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        assertNothingReachable(
          await runAs(database, user(businessId), `update public.tenders set title = 'Changed after publishing' where id = $1`, [tenderId]),
          'edit the title directly',
        );
        assertRefused(
          await runAs(database, user(businessId), `select public.extend_tender_closing_time($1, now() + interval '1 day')`, [tenderId]),
          'shorten the deadline',
          /only be extended/,
        );
        assertSucceeded(
          await runAs(database, user(businessId), `select public.extend_tender_closing_time($1, now() + interval '30 days')`, [tenderId]),
          'extend the deadline',
        );
        assert.deepEqual(await auditActions(database, tenderId), ['tender_edited']);
        const metadata = await scalar<{ changed_fields: string[] }>(database, `select metadata as value from public.audit_log where entity_id = $1`, [tenderId]);
        assert.deepEqual(metadata.changed_fields, ['closes_at']);
      },
    },
    {
      name: 'P1-06: the closing time cannot be extended once the deadline has passed',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const tenderId = await createTender(database, businessId, 'past-deadline');
        assertRefused(
          await runAs(database, user(businessId), `select public.extend_tender_closing_time($1, now() + interval '7 days')`, [tenderId]),
          'reopen by extending',
          /still open/,
        );
      },
    },
    {
      name: 'P1-07/8.4: a business cannot change a tender status directly',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        await runAs(database, user(businessId), `update public.tenders set status = 'closed' where id = $1`, [tenderId]);
        assert.equal(await scalar<string>(database, `select status::text as value from public.tenders where id = $1`, [tenderId]), 'open');
      },
    },
    {
      name: 'P1-07: transitions outside the lifecycle fail in the database, even for the service role',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        await setTenderState(database, tenderId, { status: 'cancelled' });
        assertRefused(await runAs(database, service, `update public.tenders set status = 'open' where id = $1`, [tenderId]), 'reopen a cancelled tender', /cannot move/);
        const openTenderId = await createTender(database, businessId, 'accepting-bids');
        assertRefused(await runAs(database, service, `update public.tenders set status = 'closed' where id = $1`, [openTenderId]), 'close early', /closes automatically/);
      },
    },
    {
      name: 'P1-07: the scheduled job closes open tenders whose closing time has passed, and only those, and logs it',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const expiredTenderId = await createTender(database, businessId, 'past-deadline');
        const runningTenderId = await createTender(database, businessId, 'accepting-bids');
        await database.query(`select private.close_expired_tenders()`);
        assert.equal(await scalar<string>(database, `select status::text as value from public.tenders where id = $1 and closed_at is not null`, [expiredTenderId]), 'closed');
        assert.equal(await scalar<string>(database, `select status::text as value from public.tenders where id = $1`, [runningTenderId]), 'open');
        assert.deepEqual(await auditActions(database, expiredTenderId), ['tender_closed']);
        const actor = await scalar<string | null>(database, `select actor_id::text as value from public.audit_log where entity_id = $1`, [expiredTenderId]);
        assert.equal(actor, null, 'the system closed it');
      },
    },
    {
      name: 'P1-07: the closing job is scheduled every minute',
      run: async (database) => {
        assert.equal(await scalar<string>(database, `select schedule as value from cron.job where jobname = 'close-expired-tenders'`), '* * * * *');
      },
    },
    {
      name: 'P1-04: drafts are visible only to their business, and visitors see no tenders at all',
      run: async (database) => {
        const ownerId = await createUser(database, { accountType: 'business' });
        const otherBusinessId = await createUser(database, { accountType: 'business' });
        const draftId = await createTender(database, ownerId, 'draft');
        const publishedId = await createTender(database, ownerId, 'accepting-bids');
        assertNothingReachable(await runAs(database, anonymous, `select id from public.tenders where id = $1`, [publishedId]), 'visitor reads a published tender');
        assertNothingReachable(await runAs(database, user(otherBusinessId), `select id from public.tenders where id = $1`, [draftId]), 'another business reads a draft');
        assert.equal(assertSucceeded(await runAs(database, user(ownerId), `select id from public.tenders where id = $1`, [draftId]), 'own draft').length, 1);
      },
    },
    {
      name: 'M2: only drafts can be deleted, and deleting a tender never deletes its bids',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const openTenderId = await createTender(database, businessId, 'accepting-bids');
        const draftId = await createTender(database, businessId, 'draft');
        assertNothingReachable(await runAs(database, user(businessId), `delete from public.tenders where id = $1 returning id`, [openTenderId]), 'delete an open tender');
        assert.equal(assertSucceeded(await runAs(database, user(businessId), `delete from public.tenders where id = $1 returning id`, [draftId]), 'delete a draft').length, 1);
        await createBid(database, openTenderId, supplierId);
        await assert.rejects(database.query(`delete from public.tenders where id = $1`, [openTenderId]), /foreign key|violates/);
      },
    },
  ],
};
