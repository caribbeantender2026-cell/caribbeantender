import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { anonymous, attachTenderDocument, createBid, createStoredFile, createTender, createUser, runAs, setSupplierAccess, user } from '../harness.ts';
import { assertNothingReachable, assertRefused, assertSucceeded, scalar, type FixSuite } from '../suite.ts';

const spreadsheetType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// What the Storage API does on upload: insert the object row as the signed-in user.
function uploadAs(database: PGlite, userId: string, bucket: string, objectName: string) {
  return runAs(database, user(userId), `insert into storage.objects (bucket_id, name, owner, owner_id) values ($1, $2, $3, $4)`, [bucket, objectName, userId, userId]);
}

// What the Storage API does before signing a download URL: select the object row as the caller.
function readObjectAs(database: PGlite, actorUserId: string | null, bucket: string, objectName: string) {
  return runAs(database, actorUserId ? user(actorUserId) : anonymous, `select id from storage.objects where bucket_id = $1 and name = $2`, [bucket, objectName]);
}

export const storagePoliciesSuite: FixSuite = {
  migration: '20261005040900_storage_policies.sql',
  title: 'Storage: immutable bid files, sealed and logged downloads, signed-in tender files',
  cases: [
    {
      name: 'A supplier cannot delete the file behind a submitted bid (no file swap, H1)',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const { documentPath } = await createBid(database, tenderId, supplierId);
        assertNothingReachable(
          await runAs(database, user(supplierId), `delete from storage.objects where bucket_id = 'bid-documents' and name = $1 returning id`, [documentPath]),
          'supplier deletes its submitted proposal',
        );
        const stillThere = await scalar<number>(database, `select count(*)::integer as value from storage.objects where name = $1`, [documentPath]);
        assert.equal(stillThere, 1);
      },
    },
    {
      name: 'A supplier cannot overwrite a stored bid file',
      alreadyHeldBefore: true,
      run: async (database) => {
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const documentPath = await createStoredFile(database, 'bid-documents', supplierId);
        assertNothingReachable(
          await runAs(database, user(supplierId), `update storage.objects set metadata = '{"replaced": true}' where name = $1 returning id`, [documentPath]),
          'supplier overwrites its proposal',
        );
      },
    },
    {
      name: 'A business cannot read a bid file before the deadline',
      // Already true once bids are sealed (see the sealed-bids suite); this guards the new policies.
      alreadyHeldBefore: true,
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const { documentPath } = await createBid(database, tenderId, supplierId);
        assertNothingReachable(await readObjectAs(database, businessId, 'bid-documents', documentPath), 'business reads a sealed proposal');
      },
    },
    {
      name: 'After the deadline, reading a bid file requires recording the download first',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'past-deadline');
        const { bidId, documentPath } = await createBid(database, tenderId, supplierId);
        assertNothingReachable(await readObjectAs(database, businessId, 'bid-documents', documentPath), 'read without a recorded download');

        const returnedPath = assertSucceeded(
          await runAs<{ path: string }>(database, user(businessId), `select public.request_bid_document_download($1) as path`, [bidId]),
          'record the download',
        )[0]?.path;
        assert.equal(returnedPath, documentPath);
        const readable = assertSucceeded(await readObjectAs(database, businessId, 'bid-documents', documentPath), 'read after recording');
        assert.equal(readable.length, 1);
        const recorded = await scalar<number>(
          database,
          `select count(*)::integer as value from public.audit_log where event_type = 'bid_document_download' and actor_id = $1 and bid_id = $2`,
          [businessId, bidId],
        );
        assert.equal(recorded, 1);
      },
    },
    {
      name: 'A download cannot be requested for a sealed bid or for someone else’s bid',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const otherSupplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const { bidId } = await createBid(database, tenderId, supplierId);
        assertRefused(await runAs(database, user(businessId), `select public.request_bid_document_download($1)`, [bidId]), 'business before the deadline');
        assertRefused(await runAs(database, user(otherSupplierId), `select public.request_bid_document_download($1)`, [bidId]), 'another supplier');
        assertSucceeded(await runAs(database, user(supplierId), `select public.request_bid_document_download($1)`, [bidId]), 'the bidder');
      },
    },
    {
      name: 'A supplier without an active trial or subscription cannot upload bid files (M4)',
      run: async (database) => {
        const supplierId = await createUser(database, { accountType: 'supplier' });
        await setSupplierAccess(database, supplierId, 'expired');
        assertRefused(await uploadAs(database, supplierId, 'bid-documents', `${supplierId}/proposal.pdf`), 'upload without access');
      },
    },
    {
      name: "Nobody can upload into someone else's folder",
      alreadyHeldBefore: true,
      run: async (database) => {
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const otherSupplierId = await createUser(database, { accountType: 'supplier' });
        assertRefused(await uploadAs(database, supplierId, 'bid-documents', `${otherSupplierId}/planted.pdf`), "upload into another supplier's folder");
      },
    },
    {
      name: 'Uploads are limited to 20 per person per day (M4)',
      run: async (database) => {
        const supplierId = await createUser(database, { accountType: 'supplier' });
        for (let fileNumber = 0; fileNumber < 20; fileNumber += 1) {
          await createStoredFile(database, 'bid-documents', supplierId);
        }
        assertRefused(await uploadAs(database, supplierId, 'bid-documents', `${supplierId}/twenty-first.pdf`), '21st upload today');
      },
    },
    {
      name: 'Visitors who are not signed in cannot read tender documents (M3)',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const documentPath = await createStoredFile(database, 'tender-documents', businessId, 'specification.pdf');
        await attachTenderDocument(database, tenderId, documentPath);
        assertNothingReachable(await readObjectAs(database, null, 'tender-documents', documentPath), 'visitor reads a tender document');
      },
    },
    {
      name: "Another business cannot read the document of someone else's draft",
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const otherBusinessId = await createUser(database, { accountType: 'business' });
        const documentPath = await createStoredFile(database, 'tender-documents', businessId, 'draft-specification.pdf');
        assertNothingReachable(await readObjectAs(database, otherBusinessId, 'tender-documents', documentPath), "another business reads a draft's document");
      },
    },
    {
      name: 'Signed-in users can read the documents of published tenders',
      alreadyHeldBefore: true,
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const documentPath = await createStoredFile(database, 'tender-documents', businessId, 'specification.pdf');
        await attachTenderDocument(database, tenderId, documentPath);
        const rows = assertSucceeded(await readObjectAs(database, supplierId, 'tender-documents', documentPath), 'supplier reads a published document');
        assert.equal(rows.length, 1);
      },
    },
    {
      name: 'Bid documents accept .xlsx spreadsheets but not legacy .xls',
      run: async (database) => {
        const allowedTypes = await scalar<string[]>(database, `select allowed_mime_types as value from storage.buckets where id = 'bid-documents'`);
        assert.ok(allowedTypes.includes(spreadsheetType), '.xlsx allowed');
        assert.ok(!allowedTypes.includes('application/vnd.ms-excel'), '.xls not allowed');
      },
    },
  ],
};
