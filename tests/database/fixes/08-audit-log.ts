import assert from 'node:assert/strict';
import { createBid, createTender, createUser, runAs, service, user } from '../harness.ts';
import { assertNothingReachable, assertRefused, assertSucceeded, scalar, submitBidAs, type FixSuite } from '../suite.ts';

export const auditLogSuite: FixSuite = {
  migration: '20261005040800_audit_log.sql',
  title: 'Audit log: bid submissions, bid openings and downloads, append-only',
  cases: [
    {
      name: 'A bid submission is logged with its exact submission time',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const bidRows = assertSucceeded(await submitBidAs(database, supplierId, tenderId), 'submit');
        const bid = bidRows[0];
        assert.ok(bid);
        const logged = await database.query<{ actor_id: string; occurred_at: Date; matches_bid_time: boolean }>(
          `select log.actor_id, log.occurred_at, log.occurred_at = bid.created_at as matches_bid_time
           from public.audit_log log join public.bids bid on bid.id = log.bid_id
           where log.event_type = 'bid_submitted' and log.bid_id = $1`,
          [bid.id],
        );
        assert.equal(logged.rows.length, 1);
        assert.equal(logged.rows[0]?.actor_id, supplierId);
        assert.equal(logged.rows[0]?.matches_bid_time, true);
      },
    },
    {
      name: 'Closing a tender logs the bid opening with the number of bids',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'past-deadline');
        await createBid(database, tenderId, supplierId);
        await database.query(`select private.close_expired_tenders()`);
        const logged = await database.query<{ bid_count: number }>(
          `select (details ->> 'bid_count')::integer as bid_count from public.audit_log where event_type = 'bids_opened' and tender_id = $1`,
          [tenderId],
        );
        assert.deepEqual(logged.rows, [{ bid_count: 1 }]);
      },
    },
    {
      name: 'Nobody can change or delete audit entries, not even the service role',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        assertSucceeded(await submitBidAs(database, supplierId, tenderId), 'submit');
        const entryId = (await database.query<{ id: number }>(`select id from public.audit_log where actor_id = $1`, [supplierId])).rows[0]?.id;
        assert.ok(entryId, 'an audit entry to tamper with');
        assertRefused(await runAs(database, service, `update public.audit_log set actor_id = null where id = $1`, [entryId]), 'service role edits an entry');
        assertRefused(await runAs(database, service, `delete from public.audit_log where id = $1`, [entryId]), 'service role deletes an entry');
        await assert.rejects(database.query(`delete from public.audit_log where id = $1`, [entryId]), /append-only/);
      },
    },
    {
      name: "A business cannot read suppliers' submission entries on its tender",
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        assertSucceeded(await submitBidAs(database, supplierId, tenderId), 'submit');
        assertNothingReachable(
          await runAs(database, user(businessId), `select id from public.audit_log where tender_id = $1`, [tenderId]),
          'business reads submission entries',
        );
        const ownRows = assertSucceeded(
          await runAs(database, user(supplierId), `select id from public.audit_log where tender_id = $1`, [tenderId]),
          'supplier reads its own receipt',
        );
        assert.equal(ownRows.length, 1);
      },
    },
    {
      name: 'A download can be recorded only for a bid the person can see',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const otherSupplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const { bidId, documentPath } = await createBid(database, tenderId, supplierId);
        const recordDownload = `insert into public.audit_log (event_type, actor_id, tender_id, bid_id, details)
                                values ('bid_document_download', $1, $2, $3, jsonb_build_object('document_path', $4::text))`;
        assertRefused(await runAs(database, user(otherSupplierId), recordDownload, [otherSupplierId, tenderId, bidId, documentPath]), 'other supplier');
        assertRefused(await runAs(database, user(businessId), recordDownload, [businessId, tenderId, bidId, documentPath]), 'business before the deadline');
        assertSucceeded(await runAs(database, user(supplierId), recordDownload, [supplierId, tenderId, bidId, documentPath]), 'the bidder itself');
      },
    },
    {
      name: 'People cannot write submission or opening entries themselves',
      run: async (database) => {
        // Without this, the case would "pass" before the migration only because the table is missing.
        assert.equal(await scalar<boolean>(database, `select to_regclass('public.audit_log') is not null as value`), true, 'audit_log exists');
        const supplierId = await createUser(database, { accountType: 'supplier' });
        assertRefused(
          await runAs(database, user(supplierId), `insert into public.audit_log (event_type, actor_id) values ('bid_submitted', $1)`, [supplierId]),
          'forge a submission receipt',
        );
      },
    },
  ],
};
