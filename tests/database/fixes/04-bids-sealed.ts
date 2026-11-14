/** A3 and P1-08 (bids), Q6, Q8 (outcomes), Q21 (deactivated users), and A2/P1-09 (sealed bids). */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  addSupplierProfile,
  columnExists,
  createBid,
  createStoredFile,
  createTender,
  createUser,
  runAs,
  service,
  setSupplierAccess,
  setTenderState,
  user,
  writeFixture,
} from '../harness.ts';
import { assertNothingReachable, assertRefused, assertSucceeded, auditActions, scalar, submitBidAs, type FixSuite } from '../suite.ts';

export const bidRulesSuite: FixSuite = {
  migration: '20261005040600_bid_rules.sql',
  title: 'A3/P1-08: bids accepted only while open, by suppliers with access, and never changed',
  cases: [
    {
      name: 'P1-08: a valid bid is accepted with a server-set submission time, JMD currency and status submitted, and logged',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const bidId = randomUUID();
        const submittedAt = assertSucceeded(await submitBidAs(database, supplierId, tenderId, { bidId }), 'bid')[0]?.submitted_at;
        assert.ok(submittedAt);
        const stored = await database.query<{ currency: string; status: string; matches: boolean }>(
          `select currency, status::text as status, submitted_at = $2::timestamptz as matches from public.bids where id = $1`,
          [bidId, submittedAt],
        );
        assert.deepEqual(stored.rows, [{ currency: 'JMD', status: 'submitted', matches: true }]);
        assert.deepEqual(await auditActions(database, bidId), ['bid_submitted']);
        const documents = await scalar<number>(database, `select count(*)::integer as value from public.bid_documents where bid_id = $1 and document_role = 'proposal'`, [bidId]);
        assert.equal(documents, 1);
      },
    },
    {
      name: 'A3: a bid at or after closes_at is refused, even while the status still says open',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'past-deadline');
        assertRefused(await submitBidAs(database, supplierId, tenderId), 'late bid', /closed at/);
      },
    },
    {
      name: 'A3: a bid on a closed, cancelled or draft tender is refused',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        for (const status of ['closed', 'cancelled'] as const) {
          const tenderId = await createTender(database, businessId, 'accepting-bids');
          await setTenderState(database, tenderId, { status });
          assertRefused(await submitBidAs(database, supplierId, tenderId), `bid on a ${status} tender`, /not open for bids/);
        }
        assertRefused(await submitBidAs(database, supplierId, await createTender(database, businessId, 'draft')), 'bid on a draft', /not open for bids/);
      },
    },
    {
      name: 'A3: a bid without an active trial or subscription is refused',
      alreadyHeldBefore: true,
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        await setSupplierAccess(database, supplierId, 'expired');
        assertRefused(await submitBidAs(database, supplierId, await createTender(database, businessId, 'accepting-bids')), 'no access');
      },
    },
    {
      name: 'A3: a second bid on the same tender is refused',
      alreadyHeldBefore: true,
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        assertSucceeded(await submitBidAs(database, supplierId, tenderId), 'first bid');
        assertRefused(await submitBidAs(database, supplierId, tenderId), 'second bid');
      },
    },
    {
      name: 'A3/8.3: bids cannot be inserted directly, so a browser cannot choose the submission time',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        // Before submit_bid the app inserted directly; the document columns exist only before the documents migration.
        const directInsert = (await columnExists(database, 'bids', 'document_path'))
          ? await runAs(
              database,
              user(supplierId),
              `insert into public.bids (tender_id, supplier_id, amount, created_at, document_path, document_name) values ($1, $2, 1000, '2000-01-01', $3, 'proposal.pdf')`,
              [tenderId, supplierId, await createStoredFile(database, 'bid-documents', `${supplierId}/${randomUUID()}-proposal.pdf`, supplierId)],
            )
          : await runAs(
              database,
              user(supplierId),
              `insert into public.bids (tender_id, supplier_id, amount, created_at) values ($1, $2, 1000, '2000-01-01')`,
              [tenderId, supplierId],
            );
        assertRefused(directInsert, 'direct insert');
      },
    },
    {
      name: 'Q6: a business cannot bid on its own tender with its supplier account',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        await addSupplierProfile(database, businessId);
        assertRefused(await submitBidAs(database, businessId, await createTender(database, businessId, 'accepting-bids')), 'own tender', /own tender/);
      },
    },
    {
      name: "Q11: a bid is refused when any file in its folder was uploaded by someone else",
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const intruderId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const bidId = randomUUID();
        await createStoredFile(database, 'bid-documents', `${tenderId}/${bidId}/planted.pdf`, intruderId);
        assertRefused(await submitBidAs(database, supplierId, tenderId, { bidId }), 'bid with a planted file', /not uploaded by you/);
      },
    },
    {
      name: 'P1-08: a bid needs a proposal, filled in online or uploaded; an online proposal is attached and frozen',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        assertRefused(await submitBidAs(database, supplierId, await createTender(database, businessId, 'accepting-bids'), { proposal: 'none' }), 'no proposal', /proposal/);
        const bidId = randomUUID();
        assertSucceeded(await submitBidAs(database, supplierId, await createTender(database, businessId, 'accepting-bids'), { bidId, proposal: 'form' }), 'online proposal');
        const submissionId = await scalar<string>(database, `select id::text as value from public.form_submissions where attached_to_type = 'bid' and attached_to_id = $1`, [bidId]);
        await runAs(database, user(supplierId), `update public.form_submissions set data = '{}' where id = $1`, [submissionId]);
        await runAs(database, user(supplierId), `delete from public.form_submissions where id = $1`, [submissionId]);
        const stillComplete = await scalar<string>(database, `select data ->> 'deliverables' as value from public.form_submissions where id = $1`, [submissionId]);
        assert.equal(stillComplete, 'Twenty chairs', 'the attached proposal is unchanged');
      },
    },
    {
      name: 'A4/P1-08: a submitted bid cannot be changed or deleted, even by the service role or the owner',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const { bidId } = await createBid(database, await createTender(database, businessId, 'accepting-bids'), supplierId);
        assertRefused(await runAs(database, service, `update public.bids set amount = 1 where id = $1`, [bidId]), 'service role changes the amount');
        assertRefused(await runAs(database, service, `delete from public.bids where id = $1`, [bidId]), 'service role deletes');
        await assert.rejects(database.query(`update public.bids set amount = 1 where id = $1`, [bidId]), /cannot be changed/);
      },
    },
    {
      name: 'Q8: awarding sets awarded and unsuccessful; cancelling sets tender_cancelled, never unsuccessful',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const firstSupplierId = await createUser(database, { accountType: 'supplier' });
        const secondSupplierId = await createUser(database, { accountType: 'supplier' });
        const awardedTenderId = await createTender(database, businessId, 'closed');
        const winning = await createBid(database, awardedTenderId, firstSupplierId);
        const losing = await createBid(database, awardedTenderId, secondSupplierId);
        assertSucceeded(await runAs(database, user(businessId), `select public.award_tender($1, $2)`, [awardedTenderId, winning.bidId]), 'award');
        const outcomes = await database.query<{ id: string; status: string }>(`select id, status::text as status from public.bids where tender_id = $1`, [awardedTenderId]);
        assert.deepEqual(new Map(outcomes.rows.map((row) => [row.id, row.status])), new Map([[winning.bidId, 'awarded'], [losing.bidId, 'unsuccessful']]));

        const cancelledTenderId = await createTender(database, businessId, 'accepting-bids');
        const cancelledBid = await createBid(database, cancelledTenderId, firstSupplierId);
        assertSucceeded(await runAs(database, user(businessId), `select public.cancel_tender($1, 'Budget withdrawn')`, [cancelledTenderId]), 'cancel');
        assert.equal(await scalar<string>(database, `select status::text as value from public.bids where id = $1`, [cancelledBid.bidId]), 'tender_cancelled');
        assert.deepEqual(await auditActions(database, cancelledTenderId), ['tender_cancelled']);
      },
    },
    {
      name: 'P1-07: awarding needs a closed tender and a bid on it; cancelling needs a reason; drafts are deleted, not cancelled',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const openTenderId = await createTender(database, businessId, 'accepting-bids');
        const openBid = await createBid(database, openTenderId, supplierId);
        assertRefused(await runAs(database, user(businessId), `select public.award_tender($1, $2)`, [openTenderId, openBid.bidId]), 'award while open', /once it has closed/);
        const closedTenderId = await createTender(database, businessId, 'closed');
        assertRefused(await runAs(database, user(businessId), `select public.award_tender($1, $2)`, [closedTenderId, openBid.bidId]), 'award a bid from another tender', /not on this tender/);
        assertRefused(await runAs(database, user(businessId), `select public.cancel_tender($1, '   ')`, [openTenderId]), 'cancel without a reason', /reason/);
        assertRefused(await runAs(database, user(businessId), `select public.cancel_tender($1, 'Changed plans')`, [await createTender(database, businessId, 'draft')]), 'cancel a draft', /deleted/);
      },
    },
    {
      name: "P1-07: a business cannot cancel or award another business's tender",
      run: async (database) => {
        const ownerId = await createUser(database, { accountType: 'business' });
        const otherBusinessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, ownerId, 'closed');
        const bid = await createBid(database, tenderId, supplierId);
        assertRefused(await runAs(database, user(otherBusinessId), `select public.cancel_tender($1, 'Not mine')`, [tenderId]), 'cancel', /not found/i);
        assertRefused(await runAs(database, user(otherBusinessId), `select public.award_tender($1, $2)`, [tenderId, bid.bidId]), 'award', /not found/i);
      },
    },
    {
      name: 'Q21: a deactivated user cannot submit, publish, extend, cancel or award, even with a valid token',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const openTenderId = await createTender(database, businessId, 'accepting-bids');
        const closedTenderId = await createTender(database, businessId, 'closed');
        const draftId = await createTender(database, businessId, 'draft');
        const bid = await createBid(database, closedTenderId, supplierId);
        await writeFixture(database, `update public.profiles set is_active = false where id = any($1)`, [[businessId, supplierId]]);
        const deactivated = /deactivated/;
        assertRefused(await submitBidAs(database, supplierId, openTenderId), 'submit', deactivated);
        assertRefused(await runAs(database, user(businessId), `select public.publish_tender($1)`, [draftId]), 'publish', deactivated);
        assertRefused(await runAs(database, user(businessId), `select public.extend_tender_closing_time($1, now() + interval '30 days')`, [openTenderId]), 'extend', deactivated);
        assertRefused(await runAs(database, user(businessId), `select public.cancel_tender($1, 'Reason')`, [openTenderId]), 'cancel', deactivated);
        assertRefused(await runAs(database, user(businessId), `select public.award_tender($1, $2)`, [closedTenderId, bid.bidId]), 'award', deactivated);
      },
    },
  ],
};

export const sealedBidsSuite: FixSuite = {
  migration: '20261005040700_sealed_bids.sql',
  title: 'A2/P1-09: bids sealed until closes_at, then opened through a logged read',
  cases: [
    {
      name: 'A2: before closes_at the business reads no bids, not even a count, and the read function refuses',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        await createBid(database, tenderId, supplierId);
        assertNothingReachable(await runAs(database, user(businessId), `select id from public.bids where tender_id = $1`, [tenderId]), 'direct read');
        const counted = assertSucceeded(await runAs<{ total: number }>(database, user(businessId), `select count(*)::integer as total from public.bids where tender_id = $1`, [tenderId]), 'count');
        assert.equal(counted[0]?.total, 0);
        assertRefused(await runAs(database, user(businessId), `select * from public.read_tender_bids($1)`, [tenderId]), 'read function', /sealed until/);
      },
    },
    {
      name: 'A2: from closes_at the business reads every bid with supplier names, and the first read is logged once as bids opened',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier', companyName: 'Bidder Limited' });
        const tenderId = await createTender(database, businessId, 'past-deadline');
        await createBid(database, tenderId, supplierId, 4321);
        for (let readNumber = 0; readNumber < 2; readNumber += 1) {
          const rows = assertSucceeded(
            await runAs<{ amount: string; supplier_company_name: string; documents: unknown[] }>(database, user(businessId), `select * from public.read_tender_bids($1)`, [tenderId]),
            'read bids',
          );
          assert.deepEqual(rows.map((row) => [Number(row.amount), row.supplier_company_name, row.documents.length]), [[4321, 'Bidder Limited', 1]]);
        }
        assert.deepEqual(await auditActions(database, tenderId), ['bids_opened']);
      },
    },
    {
      name: 'A2: bids on a tender cancelled before its closing time are never opened',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'past-deadline');
        await createBid(database, tenderId, supplierId);
        await setTenderState(database, tenderId, { status: 'cancelled', cancelledBeforeDeadline: true });
        assertRefused(await runAs(database, user(businessId), `select * from public.read_tender_bids($1)`, [tenderId]), 'read', /never opened/);
      },
    },
    {
      name: "A2: another business cannot read the tender's bids, even after closing",
      run: async (database) => {
        const ownerId = await createUser(database, { accountType: 'business' });
        const otherBusinessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, ownerId, 'closed');
        await createBid(database, tenderId, supplierId);
        assertRefused(await runAs(database, user(otherBusinessId), `select * from public.read_tender_bids($1)`, [tenderId]), 'read', /not found/i);
        assertNothingReachable(await runAs(database, user(otherBusinessId), `select id from public.bids where tender_id = $1`, [tenderId]), 'direct read');
      },
    },
    {
      name: 'A2: suppliers see only their own bids, before and after closing',
      alreadyHeldBefore: true,
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const firstSupplierId = await createUser(database, { accountType: 'supplier' });
        const secondSupplierId = await createUser(database, { accountType: 'supplier' });
        for (const phase of ['accepting-bids', 'closed'] as const) {
          const tenderId = await createTender(database, businessId, phase);
          await createBid(database, tenderId, firstSupplierId);
          await createBid(database, tenderId, secondSupplierId);
          const rows = assertSucceeded(
            await runAs<{ supplier_id: string }>(database, user(secondSupplierId), `select supplier_id from public.bids where tender_id = $1`, [tenderId]),
            phase,
          );
          assert.deepEqual(rows.map((row) => row.supplier_id), [secondSupplierId]);
        }
      },
    },
  ],
};
