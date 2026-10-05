import assert from 'node:assert/strict';
import { addSupplierProfile, createBid, createStoredFile, createTender, createUser, runAs, service, setSupplierAccess, setTenderState } from '../harness.ts';
import { assertRefused, assertSucceeded, submitBidAs, type FixSuite } from '../suite.ts';

export const bidRulesSuite: FixSuite = {
  migration: '20261005040600_bid_rules.sql',
  title: 'Bids: accepted only while open, by suppliers with access, and immutable afterwards',
  cases: [
    {
      name: 'A valid bid from a supplier with an active trial is accepted',
      alreadyHeldBefore: true,
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        assertSucceeded(await submitBidAs(database, supplierId, tenderId), 'valid bid');
      },
    },
    {
      name: 'A bid after the deadline is refused',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'past-deadline');
        assertRefused(await submitBidAs(database, supplierId, tenderId), 'late bid', /closed at/);
      },
    },
    {
      name: 'A bid on a tender that is not open is refused (closed, cancelled or draft)',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        for (const status of ['closed', 'cancelled'] as const) {
          const tenderId = await createTender(database, businessId, 'accepting-bids');
          await setTenderState(database, tenderId, { status });
          assertRefused(await submitBidAs(database, supplierId, tenderId), `bid on a ${status} tender`, /not open for bids/);
        }
        const draftTenderId = await createTender(database, businessId, 'draft');
        assertRefused(await submitBidAs(database, supplierId, draftTenderId), 'bid on a draft');
      },
    },
    {
      name: 'A bid without an active trial or subscription is refused',
      alreadyHeldBefore: true,
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        await setSupplierAccess(database, supplierId, 'expired');
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        assertRefused(await submitBidAs(database, supplierId, tenderId), 'bid without access');
      },
    },
    {
      name: 'A business cannot bid on its own tender',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        await addSupplierProfile(database, businessId);
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        assertRefused(await submitBidAs(database, businessId, tenderId), 'bid on own tender', /own tender/);
      },
    },
    {
      name: "A bid must point at the supplier's own, already uploaded proposal (M5)",
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const otherSupplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const othersFile = await createStoredFile(database, 'bid-documents', otherSupplierId);
        assertRefused(await submitBidAs(database, supplierId, tenderId, { documentPath: othersFile }), "bid using another supplier's file", /Upload the proposal/);
        assertRefused(
          await submitBidAs(database, supplierId, tenderId, { documentPath: `${supplierId}/not-uploaded-yet.pdf` }),
          'bid using a file that does not exist yet',
          /Upload the proposal/,
        );
      },
    },
    {
      name: 'The same uploaded file cannot back two bids',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const firstTenderId = await createTender(database, businessId, 'accepting-bids');
        const secondTenderId = await createTender(database, businessId, 'accepting-bids');
        const documentPath = await createStoredFile(database, 'bid-documents', supplierId);
        assertSucceeded(await submitBidAs(database, supplierId, firstTenderId, { documentPath }), 'first bid');
        assertRefused(await submitBidAs(database, supplierId, secondTenderId, { documentPath }), 'second bid reusing the file');
      },
    },
    {
      name: 'The submission time is set by the database, not by the browser',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const outcome = await submitBidAs(database, supplierId, tenderId, { createdAt: '2000-01-01T00:00:00Z' });
        if (outcome.error) {
          // From the grants migration on, the column cannot even be sent.
          assert.match(outcome.error.message, /permission denied/);
          return;
        }
        const storedBid = outcome.rows[0];
        assert.ok(storedBid);
        const secondsFromNow = Math.abs(Date.now() - new Date(storedBid.created_at).getTime()) / 1000;
        assert.ok(secondsFromNow < 60, `created_at was ${storedBid.created_at}`);
      },
    },
    {
      name: 'A submitted bid cannot be changed or deleted, even by the service role',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const { bidId } = await createBid(database, tenderId, supplierId);
        assertRefused(await runAs(database, service, `update public.bids set amount = 1 where id = $1`, [bidId]), 'service role changes the amount');
        assertRefused(await runAs(database, service, `delete from public.bids where id = $1`, [bidId]), 'service role deletes the bid');
        await assert.rejects(database.query(`update public.bids set amount = 1 where id = $1`, [bidId]), /cannot be changed/);
      },
    },
  ],
};
