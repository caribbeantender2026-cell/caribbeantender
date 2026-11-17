/** Storage (A4, A5, M3, M4, M5, Q11, downloads) and sign-up (A7, P1-01, Q23). */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  anonymous,
  createBid,
  createTender,
  createTenderDocument,
  createUser,
  runAs,
  setSupplierAccess,
  user,
} from '../harness.ts';
import { assertNothingReachable, assertRefused, assertSucceeded, auditActions, scalar, submitBidAs, uploadAs, type FixSuite } from '../suite.ts';

const excelTypes = ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
const maximumDailyUploads = 20;
const tenMegabytes = 10_485_760;

function readObjectAs(database: Parameters<typeof runAs>[0], actorUserId: string | null, bucket: string, objectName: string) {
  return runAs(database, actorUserId ? user(actorUserId) : anonymous, `select id from storage.objects where bucket_id = $1 and name = $2`, [bucket, objectName]);
}

export const storagePoliciesSuite: FixSuite = {
  migration: '20261005040900_storage_policies.sql',
  title: 'Storage: namespaced, write-once, quota-limited, downloads checked and logged',
  cases: [
    {
      name: 'A4: a supplier cannot delete or overwrite the files of a submitted bid',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const { documentPath } = await createBid(database, await createTender(database, businessId, 'accepting-bids'), supplierId);
        assertNothingReachable(
          await runAs(database, user(supplierId), `delete from storage.objects where bucket_id = 'bid-documents' and name = $1 returning id`, [documentPath]),
          'delete the proposal',
        );
        assertNothingReachable(
          await runAs(database, user(supplierId), `update storage.objects set metadata = '{"replaced": true}' where name = $1 returning id`, [documentPath]),
          'overwrite the proposal',
        );
        assert.equal(await scalar<number>(database, `select count(*)::integer as value from storage.objects where name = $1`, [documentPath]), 1);
      },
    },
    {
      name: "Q11: uploads go only into an open tender's folder for a bid not yet submitted, and never again once it is",
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const bidId = randomUUID();
        assertSucceeded(await uploadAs(database, supplierId, 'bid-documents', `${tenderId}/${bidId}/proposal/proposal.pdf`), 'upload before submitting');
        assertSucceeded(await submitBidAs(database, supplierId, tenderId, { bidId, proposal: 'none' }), 'submit with the uploaded proposal');
        assertRefused(await uploadAs(database, supplierId, 'bid-documents', `${tenderId}/${bidId}/late-addition.pdf`), 'upload after submitting');
        const closedTenderId = await createTender(database, businessId, 'past-deadline');
        assertRefused(await uploadAs(database, supplierId, 'bid-documents', `${closedTenderId}/${randomUUID()}/proposal/late.pdf`), 'upload after the deadline');
        assertRefused(await uploadAs(database, supplierId, 'bid-documents', `${supplierId}/legacy-style.pdf`), 'upload outside the scheme');
      },
    },
    {
      name: 'B2: the bidding rules live in one function, so changing it changes both the upload policy and submit_bid',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const bidId = randomUUID();
        // Both are allowed under the real rules.
        assertSucceeded(await uploadAs(database, supplierId, 'bid-documents', `${tenderId}/${randomUUID()}/proposal/check.pdf`), 'upload under the real rules');

        const outcomes = await database.transaction(async (transaction) => {
          // Change the rule once, as a later migration would, then try both paths as the supplier.
          await transaction.exec(
            `create or replace function private.bid_refusal_reason(tender_id uuid, bid_id uuid) returns text
             language sql stable security definer set search_path = '' as $$ select 'Bidding is paused for this test.'::text $$`,
          );
          // The supplier's proposal, placed as the database owner as an earlier upload would have.
          await transaction.query(
            `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('bid-documents', $1, $2, $3, '{"size": 2048, "mimetype": "application/pdf"}')`,
            [`${tenderId}/${bidId}/proposal/proposal.pdf`, supplierId, supplierId],
          );
          await transaction.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: supplierId, role: 'authenticated', aal: 'aal1' })]);
          await transaction.exec(`set local role authenticated`);
          const attempt = async (statement: string, parameters: unknown[]): Promise<string> => {
            await transaction.exec(`savepoint attempt`);
            try {
              await transaction.query(statement, parameters);
              await transaction.exec(`release savepoint attempt`);
              return 'allowed';
            } catch (error) {
              await transaction.exec(`rollback to savepoint attempt`);
              return (error as Error).message;
            }
          };
          const upload = await attempt(
            `insert into storage.objects (bucket_id, name, owner, owner_id) values ('bid-documents', $1, $2, $3)`,
            [`${tenderId}/${randomUUID()}/proposal/other.pdf`, supplierId, supplierId],
          );
          const submission = await attempt(`select public.submit_bid($1, $2, 1000, null)`, [tenderId, bidId]);
          await transaction.rollback();
          return { upload, submission };
        });
        assert.match(outcomes.upload, /row-level security/, 'the upload policy follows the changed rule');
        assert.match(outcomes.submission, /paused for this test/, 'submit_bid follows the changed rule');
        // The rollback restored the real rule.
        assertSucceeded(await uploadAs(database, supplierId, 'bid-documents', `${tenderId}/${randomUUID()}/proposal/after.pdf`), 'upload after the rollback');
      },
    },
    {
      name: 'A5: both document buckets accept PDF, Word and Excel (.xls and .xlsx), up to 10 MB',
      run: async (database) => {
        const buckets = await database.query<{ id: string; allowed_mime_types: string[]; file_size_limit: number }>(
          `select id, allowed_mime_types, file_size_limit from storage.buckets where id in ('bid-documents', 'tender-documents') order by id`,
        );
        assert.equal(buckets.rows.length, 2);
        for (const bucket of buckets.rows) {
          for (const excelType of excelTypes) {
            assert.ok(bucket.allowed_mime_types.includes(excelType), `${bucket.id} allows ${excelType}`);
          }
          assert.equal(Number(bucket.file_size_limit), tenMegabytes);
        }
      },
    },
    {
      name: 'M3/8.5: nobody reads a published tender file or a submitted bid file directly; visitors read no files at all',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const { documentPath } = await createTenderDocument(database, tenderId, businessId);
        const bid = await createBid(database, tenderId, supplierId);
        assertNothingReachable(await readObjectAs(database, null, 'tender-documents', documentPath), 'visitor reads a tender file');
        assertNothingReachable(await readObjectAs(database, supplierId, 'tender-documents', documentPath), 'supplier reads a tender file directly');
        assertNothingReachable(await readObjectAs(database, supplierId, 'bid-documents', bid.documentPath), 'supplier reads its own submitted file directly');
      },
    },
    {
      name: 'P1-05/P1-14: request_document_download lets signed-in users have published tender files, and logs each request',
      run: async (database, lastMigration) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const { documentId, documentPath } = await createTenderDocument(database, await createTender(database, businessId, 'accepting-bids'), businessId);
        assert.ok(documentId);
        const location = assertSucceeded(
          await runAs<{ location: { bucket: string; path: string } }>(database, user(supplierId), `select public.request_document_download($1) as location`, [documentId]),
          'request',
        )[0]?.location;
        assert.deepEqual(location && { bucket: location.bucket, path: location.path }, { bucket: 'tender-documents', path: documentPath });
        assert.deepEqual(await auditActions(database, documentId), [lastMigration >= '20261117060100' ? 'document_download_authorized' : 'document_download_url_issued']);
      },
    },
    {
      name: 'A2/8.5: bid files are downloadable by their supplier always, by the business only from closes_at (which counts as the opening), and by nobody else',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const otherSupplierId = await createUser(database, { accountType: 'supplier' });
        const sealedBid = await createBid(database, await createTender(database, businessId, 'accepting-bids'), supplierId);
        const request = `select public.request_document_download($1) as location`;
        assertSucceeded(await runAs(database, user(supplierId), request, [sealedBid.documentId]), 'own file');
        assertRefused(await runAs(database, user(businessId), request, [sealedBid.documentId]), 'business before closing', /not found/i);
        assertRefused(await runAs(database, user(otherSupplierId), request, [sealedBid.documentId]), 'another supplier', /not found/i);

        const openedTenderId = await createTender(database, businessId, 'past-deadline');
        const openedBid = await createBid(database, openedTenderId, supplierId);
        assertSucceeded(await runAs(database, user(businessId), request, [openedBid.documentId]), 'business after closing');
        assert.deepEqual(await auditActions(database, openedTenderId), ['bids_opened']);
      },
    },
    {
      // Bid files got their own, higher limit later (20261117040000, tested in 10-security-review.ts).
      name: 'M4: bid uploads need an active trial, tender uploads need your own draft, and tender files allow 20 uploads per person per day',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const otherBusinessId = await createUser(database, { accountType: 'business' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const draftId = await createTender(database, businessId, 'draft');
        assertRefused(await uploadAs(database, otherBusinessId, 'tender-documents', `${draftId}/planted.pdf`), "upload into someone else's draft");
        assertSucceeded(await uploadAs(database, businessId, 'tender-documents', `${draftId}/specification.pdf`), 'upload into own draft');
        for (let uploadNumber = 1; uploadNumber < maximumDailyUploads; uploadNumber += 1) {
          assertSucceeded(await uploadAs(database, businessId, 'tender-documents', `${draftId}/file-${uploadNumber}.pdf`), 'upload within quota');
        }
        assertRefused(await uploadAs(database, businessId, 'tender-documents', `${draftId}/one-too-many.pdf`), 'upload number 21');
        const expiredSupplierId = await createUser(database, { accountType: 'supplier' });
        await setSupplierAccess(database, expiredSupplierId, 'expired');
        assertRefused(await uploadAs(database, expiredSupplierId, 'bid-documents', `${tenderId}/${randomUUID()}/proposal/proposal.pdf`), 'upload without access');
      },
    },
    {
      name: 'P1-06: a business manages files in its own draft, and publishing records them as the tender documents',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const draftId = await createTender(database, businessId, 'draft');
        assertSucceeded(await uploadAs(database, businessId, 'tender-documents', `${draftId}/requirements-form/requirements.pdf`), 'upload the requirements form');
        assertSucceeded(await uploadAs(database, businessId, 'tender-documents', `${draftId}/drawings.pdf`), 'upload a supporting document');
        assert.equal(assertSucceeded(await readObjectAs(database, businessId, 'tender-documents', `${draftId}/drawings.pdf`), 'list own draft file').length, 1);
        assertSucceeded(await runAs(database, user(businessId), `select public.publish_tender($1)`, [draftId]), 'publish with an uploaded requirements form');
        const documents = await database.query<{ document_role: string }>(`select document_role::text as document_role from public.tender_documents where tender_id = $1 order by document_role`, [draftId]);
        assert.deepEqual(documents.rows.map((row) => row.document_role), ['requirements_form', 'supporting']);
        assertNothingReachable(
          await runAs(database, user(businessId), `delete from storage.objects where name = $1 returning id`, [`${draftId}/drawings.pdf`]),
          'remove a file after publishing',
        );
      },
    },
  ],
};

export const signupSuite: FixSuite = {
  migration: '20261005041000_signup_names.sql',
  title: 'A7/P1-01: sign-up works for any name from 1 to 120 characters, and records the Terms acceptance',
  cases: [
    {
      name: 'A7: sign-up with a one-letter name succeeds',
      run: async (database) => {
        const userId = await createUser(database, { accountType: 'supplier', fullName: 'Q' });
        assert.equal(await scalar<string>(database, `select full_name as value from public.profiles where id = $1`, [userId]), 'Q');
      },
    },
    {
      name: 'A7: a blank or missing name falls back to the part of the email before the @',
      run: async (database) => {
        const userId = randomUUID();
        await database.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'jane.brown@example.test', '{"full_name": "   "}')`, [userId]);
        assert.equal(await scalar<string>(database, `select full_name as value from public.profiles where id = $1`, [userId]), 'jane.brown');
        const dashboardUserId = randomUUID();
        await database.query(`insert into auth.users (id, email) values ($1, 'created.in.dashboard@example.test')`, [dashboardUserId]);
        assert.equal(await scalar<string>(database, `select full_name as value from public.profiles where id = $1`, [dashboardUserId]), 'created.in.dashboard');
      },
    },
    {
      name: 'Q23: a name over 120 characters is refused, never shortened',
      alreadyHeldBefore: true,
      run: async (database) => {
        await assert.rejects(createUser(database, { accountType: 'business', fullName: 'N'.repeat(121) }), /profiles_full_name_check/);
        const userId = await createUser(database, { accountType: 'business', fullName: 'N'.repeat(120) });
        assert.equal(await scalar<number>(database, `select char_length(full_name) as value from public.profiles where id = $1`, [userId]), 120);
      },
    },
    {
      name: "P1-01: sign-up records the Terms acceptance with the database's own time, and the account type",
      run: async (database) => {
        const before = new Date();
        const userId = await createUser(database, { accountType: 'supplier' });
        const profile = await database.query<{ account_type: string; accepted_terms_at: Date }>(
          `select account_type::text as account_type, accepted_terms_at from public.profiles where id = $1`,
          [userId],
        );
        assert.equal(profile.rows[0]?.account_type, 'supplier');
        assert.ok(profile.rows[0]?.accepted_terms_at && profile.rows[0].accepted_terms_at.getTime() >= before.getTime() - 1000);
      },
    },
  ],
};
