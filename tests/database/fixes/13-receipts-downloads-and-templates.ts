/** Regression checks for receipt delivery, document audit and Word templates. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createUser, createTender, createTenderDocument, runAs, user, writeFixture } from '../harness.ts';
import { auditActions, assertSucceeded, submitBidAs, type FixSuite } from '../suite.ts';

/** Cases for migration 20261117060100. */
export const receiptDownloadSuite: FixSuite = {
  migration: '20261117060100_receipts_downloads_and_templates.sql',
  title: 'Receipt delivery, document audit and Word templates',
  cases: [
    {
      name: 'A clean database offers only provisioned Word templates',
      run: async (database) => {
        const missing = await database.query("select key from public.form_definitions as definition where download_path is not null and not exists (select 1 from storage.objects as stored_file where stored_file.bucket_id='form-templates' and stored_file.name=definition.download_path)");
        assert.deepEqual(missing.rows, []);
      },
    },
    {
      name: 'Submitting queues a receipt that survives a worker outage',
      run: async (database) => {
        const buyer = await createUser(database, { accountType: 'business' });
        const supplier = await createUser(database, { accountType: 'supplier' });
        const tender = await createTender(database, buyer, 'accepting-bids');
        const bid = randomUUID();
        assertSucceeded(await submitBidAs(database, supplier, tender, { bidId: bid }), 'submit');
        await writeFixture(database, "update public.bids set submitted_at = now() - interval '3 hours' where id=$1", [bid]);
        const due = await database.query("select entity_id from public.due_emails(500) where type='bid_receipt' and entity_id=$1", [bid]);
        assert.equal(due.rows.length, 1);
      },
    },
    {
      name: 'Download authorization, failed signing and issuance have separate audit records',
      run: async (database) => {
        const buyer = await createUser(database, { accountType: 'business' });
        const tender = await createTender(database, buyer, 'accepting-bids');
        const { documentId } = await createTenderDocument(database,tender,buyer);
        assert.ok(documentId);
        for (const signed of [false,true]) {
          const { rows } = await runAs<{ authorized: { authorization_id: number } }>(database,user(buyer),
            'select public.request_document_download($1) authorized',[documentId]);
          const id = rows[0]?.authorized.authorization_id;
          assert.ok(id);
          assertSucceeded(await runAs(database,{ kind: 'service' },'select public.finish_document_download($1,$2)',[id,signed]),'signing outcome');
        }
        assert.deepEqual(await auditActions(database,documentId),[
          'document_download_authorized','document_download_signing_failed','document_download_authorized','document_download_url_issued',
        ]);
      },
    },
  ],
};
