import assert from 'node:assert/strict';
import { anonymous, createBid, createTender, createUser, runAs, setTenderState, user } from '../harness.ts';
import { assertNothingReachable, assertRefused, assertSucceeded, scalar, type FixSuite } from '../suite.ts';

export const tenderLifecycleSuite: FixSuite = {
  migration: '20261005040500_tender_lifecycle.sql',
  title: 'Tender lifecycle: draft, open, closed, awarded, cancelled',
  cases: [
    {
      name: 'A draft is visible only to its own business',
      run: async (database) => {
        const ownerId = await createUser(database, { accountType: 'business' });
        const otherBusinessId = await createUser(database, { accountType: 'business' });
        const tenderId = await createTender(database, ownerId, 'draft');
        assertNothingReachable(await runAs(database, anonymous, `select id from public.tenders where id = $1`, [tenderId]), 'visitor reads a draft');
        assertNothingReachable(await runAs(database, user(otherBusinessId), `select id from public.tenders where id = $1`, [tenderId]), 'another business reads a draft');
        const ownRows = assertSucceeded(await runAs(database, user(ownerId), `select id from public.tenders where id = $1`, [tenderId]), 'owner reads its draft');
        assert.equal(ownRows.length, 1);
      },
    },
    {
      name: "A published tender's terms cannot be edited",
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        assertRefused(
          await runAs(database, user(businessId), `update public.tenders set title = 'Changed after publishing' where id = $1`, [tenderId]),
          'edit title of an open tender',
          /cannot be edited/,
        );
        assertRefused(
          await runAs(database, user(businessId), `update public.tenders set closes_at = closes_at - interval '6 days' where id = $1`, [tenderId]),
          'move the deadline of an open tender',
          /cannot be edited/,
        );
      },
    },
    {
      name: 'A tender cannot be closed before its deadline',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        assertRefused(
          await runAs(database, user(businessId), `update public.tenders set status = 'closed' where id = $1`, [tenderId]),
          'close early',
          /closes automatically/,
        );
      },
    },
    {
      name: 'A tender cannot be published with a deadline in the past',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        assertRefused(
          await runAs(
            database,
            user(businessId),
            `insert into public.tenders (business_id, title, description, closes_at, status) values ($1, 'Backdated', 'x', now() - interval '1 minute', 'open')`,
            [businessId],
          ),
          'publish with a past deadline',
          /must be in the future/,
        );
      },
    },
    {
      name: 'A business can create a draft and publish it',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const insertedRows = assertSucceeded(
          await runAs<{ id: string; status: string }>(
            database,
            user(businessId),
            `insert into public.tenders (business_id, title, description, closes_at) values ($1, 'Office chairs', 'Twenty chairs', now() + interval '3 days') returning id, status`,
            [businessId],
          ),
          'create a draft',
        );
        const draft = insertedRows[0];
        assert.ok(draft);
        assert.equal(draft.status, 'draft');
        assertSucceeded(await runAs(database, user(businessId), `update public.tenders set title = 'Office chairs (ergonomic)' where id = $1`, [draft.id]), 'edit a draft');
        assertSucceeded(await runAs(database, user(businessId), `update public.tenders set status = 'open' where id = $1`, [draft.id]), 'publish');
        const publishedAtIsSet = await scalar<boolean>(database, `select published_at is not null as value from public.tenders where id = $1`, [draft.id]);
        assert.equal(publishedAtIsSet, true);
      },
    },
    {
      name: 'Only drafts can be deleted',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const openTenderId = await createTender(database, businessId, 'accepting-bids');
        const draftTenderId = await createTender(database, businessId, 'draft');
        assertNothingReachable(await runAs(database, user(businessId), `delete from public.tenders where id = $1 returning id`, [openTenderId]), 'delete an open tender');
        const deletedRows = assertSucceeded(await runAs(database, user(businessId), `delete from public.tenders where id = $1 returning id`, [draftTenderId]), 'delete a draft');
        assert.equal(deletedRows.length, 1);
      },
    },
    {
      name: 'A cancelled tender cannot be reopened',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        await setTenderState(database, tenderId, { status: 'cancelled' });
        assertRefused(
          await runAs(database, user(businessId), `update public.tenders set status = 'open' where id = $1`, [tenderId]),
          'reopen a cancelled tender',
          /cannot move from cancelled to open/,
        );
      },
    },
    {
      name: 'The scheduled job closes tenders whose deadline has passed, and only those',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const expiredTenderId = await createTender(database, businessId, 'past-deadline');
        const runningTenderId = await createTender(database, businessId, 'accepting-bids');
        await database.query(`select private.close_expired_tenders()`);
        const statuses = await database.query<{ id: string; status: string; closed_at: string | null }>(
          `select id, status, closed_at from public.tenders where id = any($1)`,
          [[expiredTenderId, runningTenderId]],
        );
        const statusById = new Map(statuses.rows.map((row) => [row.id, row]));
        assert.equal(statusById.get(expiredTenderId)?.status, 'closed');
        assert.ok(statusById.get(expiredTenderId)?.closed_at);
        assert.equal(statusById.get(runningTenderId)?.status, 'open');
      },
    },
    {
      name: 'The closing job is scheduled to run every minute',
      run: async (database) => {
        const schedule = await scalar<string>(database, `select schedule as value from cron.job where jobname = 'close-expired-tenders'`);
        assert.equal(schedule, '* * * * *');
      },
    },
    {
      name: 'An award must name a bid on the same tender',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'past-deadline');
        const otherTenderId = await createTender(database, businessId, 'past-deadline');
        const ownBid = await createBid(database, tenderId, supplierId);
        const foreignBid = await createBid(database, otherTenderId, supplierId);
        await setTenderState(database, tenderId, { status: 'closed' });
        assertRefused(
          await runAs(database, user(businessId), `update public.tenders set status = 'awarded', awarded_bid_id = $2 where id = $1`, [tenderId, foreignBid.bidId]),
          'award a bid from another tender',
        );
        assertRefused(
          await runAs(database, user(businessId), `update public.tenders set status = 'awarded' where id = $1`, [tenderId]),
          'award without naming a bid',
        );
        assertSucceeded(
          await runAs(database, user(businessId), `update public.tenders set status = 'awarded', awarded_bid_id = $2 where id = $1`, [tenderId, ownBid.bidId]),
          'award a bid on this tender',
        );
      },
    },
    {
      name: 'Deleting a tender never deletes its bids',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        await createBid(database, tenderId, supplierId);
        await assert.rejects(database.query(`delete from public.tenders where id = $1`, [tenderId]), /foreign key|violates/);
      },
    },
  ],
};
