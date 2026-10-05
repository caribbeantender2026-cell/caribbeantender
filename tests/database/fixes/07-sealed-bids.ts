import assert from 'node:assert/strict';
import { createBid, createTender, createUser, runAs, setTenderState, user } from '../harness.ts';
import { assertNothingReachable, assertSucceeded, type FixSuite } from '../suite.ts';

export const sealedBidsSuite: FixSuite = {
  migration: '20261005040700_sealed_bids.sql',
  title: 'Sealed bids: no business access before closes_at; suppliers see only their own',
  cases: [
    {
      name: 'A business cannot read bids on its tender before the deadline',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        await createBid(database, tenderId, supplierId);
        assertNothingReachable(
          await runAs(database, user(businessId), `select id, amount from public.bids where tender_id = $1`, [tenderId]),
          'business reads sealed bids',
        );
      },
    },
    {
      name: 'A business cannot even count the bids before the deadline',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        await createBid(database, tenderId, supplierId);
        const rows = assertSucceeded(
          await runAs<{ bid_count: number }>(database, user(businessId), `select count(*)::integer as bid_count from public.bids where tender_id = $1`, [tenderId]),
          'count sealed bids',
        );
        assert.equal(rows[0]?.bid_count, 0);
      },
    },
    {
      name: 'A business reads bids once the deadline has passed',
      alreadyHeldBefore: true,
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'past-deadline');
        await createBid(database, tenderId, supplierId, 4321);
        const rows = assertSucceeded(
          await runAs<{ amount: string }>(database, user(businessId), `select amount from public.bids where tender_id = $1`, [tenderId]),
          'business reads opened bids',
        );
        assert.deepEqual(rows.map((row) => Number(row.amount)), [4321]);
      },
    },
    {
      name: 'Bids on a tender cancelled before its deadline are never opened',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'past-deadline');
        await createBid(database, tenderId, supplierId);
        await setTenderState(database, tenderId, { status: 'cancelled', cancelledBeforeDeadline: true });
        assertNothingReachable(
          await runAs(database, user(businessId), `select id from public.bids where tender_id = $1`, [tenderId]),
          'business reads bids of a tender cancelled before closing',
        );
      },
    },
    {
      name: 'Suppliers see only their own bids, before and after the deadline',
      alreadyHeldBefore: true,
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const firstSupplierId = await createUser(database, { accountType: 'supplier' });
        const secondSupplierId = await createUser(database, { accountType: 'supplier' });
        for (const phase of ['accepting-bids', 'past-deadline'] as const) {
          const tenderId = await createTender(database, businessId, phase);
          await createBid(database, tenderId, firstSupplierId);
          await createBid(database, tenderId, secondSupplierId);
          const rows = assertSucceeded(
            await runAs<{ supplier_id: string }>(database, user(secondSupplierId), `select supplier_id from public.bids where tender_id = $1`, [tenderId]),
            `second supplier reads bids (${phase})`,
          );
          assert.deepEqual(rows.map((row) => row.supplier_id), [secondSupplierId]);
        }
      },
    },
    {
      // The storage read policies find the bid under the caller's row-level security, so sealing the
      // bid rows seals their files too. The storage migration keeps this as a regression guard.
      name: 'A business cannot read a bid file before the deadline',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const { documentPath } = await createBid(database, tenderId, supplierId);
        assertNothingReachable(
          await runAs(database, user(businessId), `select id from storage.objects where bucket_id = 'bid-documents' and name = $1`, [documentPath]),
          'business reads a sealed proposal file',
        );
      },
    },
    {
      name: "Bidders' names stay hidden from the business while bids are sealed",
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        await createBid(database, tenderId, supplierId);
        assertNothingReachable(
          await runAs(database, user(businessId), `select user_id from public.supplier_names_public where user_id = $1`, [supplierId]),
          "sealed bidder's name",
        );
      },
    },
  ],
};
