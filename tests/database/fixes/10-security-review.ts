/** Security fixes from the 17 Nov 2026 review: sealed log entries, deactivated profiles, the bid upload limit, form keys. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { createBid, createTender, createUser, makeStaff, runAs, setTenderState, user, writeFixture } from '../harness.ts';
import { assertRefused, assertSucceeded, completeAnswers, uploadAs, type FixSuite } from '../suite.ts';

const maximumDailyBidUploads = 50;

async function adminReadsLogFor(database: PGlite, adminId: string, action: string, entityId: string): Promise<number> {
  const outcome = await runAs(database, user(adminId, 'aal2'), `select id from public.audit_log where action = $1 and entity_id = $2`, [action, entityId]);
  return assertSucceeded(outcome, `admin reads ${action}`).length;
}

export const securityReviewSuite: FixSuite = {
  migration: '20261117040000_security_review_fixes.sql',
  title: 'Security review: bid log entries sealed from admins, deactivated profiles frozen, 50 bid files a day, the right forms',
  cases: [
    {
      name: 'P1-09: admins see no bid submitted or bid file download in the log before the closing time, and see both once bids open',
      run: async (database, lastMigration) => {
        const adminId = await createUser(database, { accountType: 'business' });
        await makeStaff(database, adminId);
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const bid = await createBid(database, tenderId, supplierId);
        await writeFixture(database, `select private.write_audit_log('bid_submitted', 'bid', $1, jsonb_build_object('tender_id', $2::text))`, [bid.bidId, tenderId]);
        // The supplier downloading their own bid file is logged with the file's path, which names the tender and bid.
        assertSucceeded(await runAs(database, user(supplierId), `select public.request_document_download($1)`, [bid.documentId]), 'supplier downloads own bid file');
        const action = lastMigration >= '20261117060100' ? 'document_download_authorized' : 'document_download_url_issued';
        assert.equal(await adminReadsLogFor(database, adminId, 'bid_submitted', bid.bidId), 0, 'bid submitted, while sealed');
        assert.equal(await adminReadsLogFor(database, adminId, action, bid.documentId ?? ''), 0, 'bid file download, while sealed');

        await writeFixture(database, `update public.tenders set closes_at = now() - interval '1 minute' where id = $1`, [tenderId]);
        assert.equal(await adminReadsLogFor(database, adminId, 'bid_submitted', bid.bidId), 1, 'bid submitted, once bids are open');
        assert.equal(await adminReadsLogFor(database, adminId, action, bid.documentId ?? ''), 1, 'bid file download, once bids are open');
      },
    },
    {
      name: 'P1-09: bid log entries of a tender cancelled before its closing time stay hidden from admins',
      run: async (database) => {
        const adminId = await createUser(database, { accountType: 'business' });
        await makeStaff(database, adminId);
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const bid = await createBid(database, tenderId, supplierId);
        await writeFixture(database, `select private.write_audit_log('bid_submitted', 'bid', $1, jsonb_build_object('tender_id', $2::text))`, [bid.bidId, tenderId]);
        await setTenderState(database, tenderId, { status: 'cancelled', cancelledBeforeDeadline: true });
        await writeFixture(database, `update public.tenders set closes_at = now() - interval '1 minute', cancelled_at = now() - interval '2 minutes' where id = $1`, [tenderId]);
        assert.equal(await adminReadsLogFor(database, adminId, 'bid_submitted', bid.bidId), 0);
      },
    },
    {
      name: 'Q21: a deactivated user can no longer change their profile, company details or tender alerts',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        await writeFixture(database, `update public.profiles set is_active = false where id in ($1, $2)`, [businessId, supplierId]);
        assertRefused(await runAs(database, user(businessId), `update public.business_profiles set company_name = 'Renamed' where user_id = $1`, [businessId]), 'rename the company');
        assertRefused(await runAs(database, user(supplierId), `update public.supplier_profiles set company_name = 'Renamed' where user_id = $1`, [supplierId]), 'rename the supplier');
        assertRefused(await runAs(database, user(businessId), `update public.profiles set full_name = 'Renamed' where id = $1`, [businessId]), 'rename the person');
        assertRefused(await runAs(database, user(businessId), `insert into public.supplier_profiles (user_id) values ($1)`, [businessId]), 'add the other account type');
        assertRefused(
          await runAs(database, user(supplierId), `insert into public.notification_preferences (user_id, tender_alerts) values ($1, false) on conflict (user_id) do update set tender_alerts = false`, [supplierId]),
          'change tender alerts',
        );
        const names = await database.query<{ company_name: string | null }>(`select company_name from public.business_profiles where user_id = $1`, [businessId]);
        assert.notEqual(names.rows[0]?.company_name, 'Renamed');
      },
    },
    {
      name: 'Q21: an active user still edits their own profile and alerts',
      alreadyHeldBefore: true,
      run: async (database) => {
        const supplierId = await createUser(database, { accountType: 'supplier' });
        assertSucceeded(await runAs(database, user(supplierId), `update public.supplier_profiles set company_name = 'Renamed' where user_id = $1`, [supplierId]), 'rename');
        assertSucceeded(
          await runAs(database, user(supplierId), `insert into public.notification_preferences (user_id, tender_alerts) values ($1, false) on conflict (user_id) do update set tender_alerts = false`, [supplierId]),
          'change tender alerts',
        );
      },
    },
    {
      name: 'Bid files allow 50 uploads per person per day (Tevin, 2026-11-17); the 51st is refused',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const bidId = randomUUID();
        for (let uploadNumber = 1; uploadNumber < maximumDailyBidUploads; uploadNumber += 1) {
          assertSucceeded(await uploadAs(database, supplierId, 'bid-documents', `${tenderId}/${bidId}/file-${uploadNumber}.pdf`), 'upload within quota');
        }
        assertSucceeded(await uploadAs(database, supplierId, 'bid-documents', `${tenderId}/${bidId}/file-50.pdf`), 'upload number 50');
        assertRefused(await uploadAs(database, supplierId, 'bid-documents', `${tenderId}/${bidId}/file-51.pdf`), 'upload number 51');
      },
    },
    {
      name: "A bid's online proposal must be the supplier proposal form, not another supplier form",
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        const answers = await completeAnswers(database, 'supplier-registration');
        const inserted = await runAs<{ id: string }>(
          database,
          user(supplierId),
          `insert into public.form_submissions (form_key, form_version, owner_id, data)
           select key, version, $1, $2 from public.form_definitions where key = 'supplier-registration' order by version desc limit 1 returning id`,
          [supplierId, JSON.stringify(answers)],
        );
        const registrationFormId = assertSucceeded(inserted, 'fill in the registration form')[0]?.id;
        assertRefused(
          await runAs(database, user(supplierId), `select public.submit_bid($1, $2, 1000, $3)`, [tenderId, randomUUID(), registrationFormId]),
          'bid with the registration form as the proposal',
          /Proposal form not found/,
        );
      },
    },
    {
      name: "A tender's attached form must be the requirements form, not another business form",
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const draftId = await createTender(database, businessId, 'draft');
        assertRefused(
          await runAs(
            database,
            user(businessId),
            `insert into public.form_submissions (form_key, form_version, owner_id, data, attached_to_type, attached_to_id)
             select key, version, $1, '{}', 'tender', $2 from public.form_definitions where key = 'business-registration' order by version desc limit 1`,
            [businessId, draftId],
          ),
          'attach the registration form to a draft',
        );
        assertSucceeded(
          await runAs(
            database,
            user(businessId),
            `insert into public.form_submissions (form_key, form_version, owner_id, data, attached_to_type, attached_to_id)
             select key, version, $1, '{}', 'tender', $2 from public.form_definitions where key = 'business-requirements' order by version desc limit 1`,
            [businessId, draftId],
          ),
          'attach the requirements form',
        );
      },
    },
  ],
};
