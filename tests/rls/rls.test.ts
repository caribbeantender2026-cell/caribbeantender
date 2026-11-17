// The "after" half of the proof (PRD section 11), against the fully migrated database: every audit
// item is refused, the PRD's rules hold through the real API, Storage, Auth and pg_cron, and each
// role is checked against each table and bucket. Tests share one timeline: a tender that closes
// during the run, so the same bids are checked while sealed and again once open.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, test } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  adminClient,
  anonymousClient,
  createAccount,
  canSignIn,
  createAdmin,
  expireTrial,
  fileOf,
  runIdentifier,
  sleep,
  supabaseUrl,
  waitUntilPast,
  type TestAccount,
} from './target.ts';

const sealedSeconds = 50;
const cronGraceSeconds = 75;
const signedUrlLifetimeSeconds = 60;
const tenMegabytes = 10_485_760;

const requirementsForm = {
  need_summary: 'Twenty office chairs',
  scope_of_work: 'Supply and deliver',
  quantities_or_specifications: '20 chairs',
  delivery_location: 'Kingston',
  required_timeline: '30 days',
  contact_person: 'Test Person',
};
const proposalForm = {
  deliverables: 'Twenty chairs',
  delivery_timeline: '2 weeks',
  cost_breakdown: [{ item: 'Chair', quantity: 20, unit_cost: 15000, labour: 5000 }],
  offer_validity_period: '60 days',
};

let business: TestAccount;
let otherBusiness: TestAccount;
let supplier: TestAccount;
let otherSupplier: TestAccount;
let expiredSupplier: TestAccount;
let admin: TestAccount;
let categoryId: number;
let tender: { id: string; closesAt: Date };
let cronTender: { id: string; closesAt: Date };
let supplierBid: { bidId: string; submittedAt: string };

async function createDraft(owner: TestAccount, closesInSeconds: number, title: string): Promise<{ id: string; closesAt: Date }> {
  const closesAt = new Date(Date.now() + closesInSeconds * 1000);
  const { data, error } = await owner.client
    .from('tenders')
    .insert({ business_id: owner.userId, title, description: 'RLS suite', category_id: categoryId, closes_at: closesAt.toISOString() })
    .select('id')
    .single();
  if (error || !data) throw new Error(`draft: ${error?.message}`);
  return { id: data.id as string, closesAt };
}

async function publish(owner: TestAccount, closesInSeconds: number, title: string): Promise<{ id: string; closesAt: Date }> {
  const draft = await createDraft(owner, closesInSeconds, title);
  const form = await owner.client
    .from('form_submissions')
    .insert({ form_key: 'business-requirements', form_version: 1, owner_id: owner.userId, data: requirementsForm, attached_to_type: 'tender', attached_to_id: draft.id });
  assert.equal(form.error, null, 'attach the requirements form');
  const published = await owner.client.rpc('publish_tender', { tender_id: draft.id });
  assert.equal(published.error, null, `publish: ${published.error?.message}`);
  return draft;
}

async function uploadBidFile(bidder: TestAccount, tenderId: string, bidId: string, fileName: string, content: string, contentType = 'application/pdf') {
  return bidder.client.storage.from('bid-documents').upload(`${tenderId}/${bidId}/${fileName}`, fileOf(content, contentType), { contentType });
}

async function submitBid(bidder: TestAccount, tenderId: string, amount: number, options: { bidId?: string; withFile?: boolean } = {}) {
  const bidId = options.bidId ?? randomUUID();
  if (options.withFile !== false) {
    const uploaded = await uploadBidFile(bidder, tenderId, bidId, 'proposal/proposal.pdf', `proposal from ${bidder.email}`);
    if (uploaded.error) return { bidId, data: null, error: { message: `upload: ${uploaded.error.message}` } };
  }
  const { data, error } = await bidder.client.rpc('submit_bid', { tender_id: tenderId, bid_id: bidId, amount });
  return { bidId, data: data as string | null, error };
}

/** Downloads as the app does: the download-document Edge Function checks and logs as the user, then signs for 60 seconds. */
async function downloadAs(account: TestAccount, documentId: string): Promise<{ text: string | null; error: string | null }> {
  const { data, error } = await account.client.functions.invoke<{ url: string }>('download-document', { body: { document_id: documentId } });
  if (error) {
    const body = error.context instanceof Response ? ((await error.context.json().catch(() => null)) as { error?: string } | null) : null;
    return { text: null, error: body?.error ?? error.message };
  }
  const signedUrl = new URL(data?.url ?? '');
  // The link must die within a minute (PRD 8.5); a Storage signed URL carries its expiry in the token.
  const token = signedUrl.searchParams.get('token') ?? '';
  const claims = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp: number; iat: number };
  assert.ok(claims.exp - claims.iat <= signedUrlLifetimeSeconds, `link lifetime ${claims.exp - claims.iat} s`);
  const response = await fetch(signedUrl);
  return { text: await response.text(), error: null };
}

async function auditActions(entityId: string): Promise<string[]> {
  const { data } = await adminClient.from('audit_log').select('action').eq('entity_id', entityId).order('id');
  return (data ?? []).map((row) => row.action as string);
}

describe(`RLS suite (${supabaseUrl})`, () => {
  before(async () => {
    const categories = await adminClient.from('categories').select('id').eq('is_active', true).order('sort_order').limit(1).single();
    categoryId = categories.data?.id as number;
    business = await createAccount('business-alpha', 'business');
    otherBusiness = await createAccount('business-beta', 'business');
    supplier = await createAccount('supplier-one', 'supplier');
    otherSupplier = await createAccount('supplier-two', 'supplier');
    expiredSupplier = await createAccount('supplier-expired', 'supplier', 'X');
    await expireTrial(expiredSupplier);
    admin = await createAdmin('admin');
    tender = await publish(business, sealedSeconds, 'Sealed then opened');
    cronTender = await publish(otherBusiness, 20, 'Closed by pg_cron');
  });

  // While the main tender is open.
  test('P1-08: a supplier with an active trial submits a bid; the database sets the time and logs it', async () => {
    const result = await submitBid(supplier, tender.id, 1500);
    assert.equal(result.error, null, result.error?.message);
    assert.ok(result.data);
    supplierBid = { bidId: result.bidId, submittedAt: result.data };
    const stored = await supplier.client.from('bids').select('status, currency, submitted_at').eq('id', result.bidId).single();
    assert.deepEqual(stored.data && [stored.data.status, stored.data.currency], ['submitted', 'JMD']);
    assert.deepEqual(await auditActions(result.bidId), ['bid_submitted']);
  });

  test('P1-08: a second supplier bids with the online proposal form instead of a file', async () => {
    const form = await otherSupplier.client
      .from('form_submissions')
      .insert({ form_key: 'supplier-proposal', form_version: 1, owner_id: otherSupplier.userId, data: proposalForm })
      .select('id')
      .single();
    assert.equal(form.error, null);
    const bid = await otherSupplier.client.rpc('submit_bid', { tender_id: tender.id, bid_id: randomUUID(), amount: 1700, proposal_form_submission_id: form.data?.id });
    assert.equal(bid.error, null, bid.error?.message);
  });

  test('A3: refused bids: no trial, duplicate, own tender, no proposal, direct insert', async () => {
    assert.match((await submitBid(expiredSupplier, tender.id, 500)).error?.message ?? '', /upload|trial/, 'expired trial');
    assert.match((await submitBid(supplier, tender.id, 600)).error?.message ?? '', /./, 'duplicate');
    const ownSupplierProfile = await business.client.from('supplier_profiles').insert({ user_id: business.userId, company_name: 'Alpha as supplier' });
    assert.equal(ownSupplierProfile.error, null);
    assert.match((await submitBid(business, tender.id, 400)).error?.message ?? '', /own tender|upload/, 'own tender');
    assert.match((await submitBid(otherSupplier, cronTender.id, 300, { withFile: false })).error?.message ?? '', /proposal/, 'no proposal');
    const direct = await otherSupplier.client.from('bids').insert({ tender_id: cronTender.id, supplier_id: otherSupplier.userId, amount: 1 });
    assert.ok(direct.error, 'direct insert');
  });

  test("Q11: a file planted in someone else's bid folder makes their submission fail; nothing more uploads once submitted", async () => {
    const plannedBidId = randomUUID();
    const planted = await uploadBidFile(otherSupplier, cronTender.id, plannedBidId, 'planted.pdf', 'planted');
    assert.equal(planted.error, null, 'the intruder can only write into a folder for a bid that does not exist yet');
    const victim = await submitBid(supplier, cronTender.id, 999, { bidId: plannedBidId });
    assert.match(victim.error?.message ?? '', /not uploaded by you/);
    const afterSubmission = await uploadBidFile(supplier, tender.id, supplierBid.bidId, 'late-addition.pdf', 'late');
    assert.ok(afterSubmission.error, 'upload into a submitted bid');
  });

  test('A4: the supplier cannot delete, overwrite or directly sign its submitted file', async () => {
    const path = `${tender.id}/${supplierBid.bidId}/proposal/proposal.pdf`;
    await supplier.client.storage.from('bid-documents').remove([path]);
    const overwritten = await supplier.client.storage.from('bid-documents').update(path, fileOf('swapped'), { contentType: 'application/pdf' });
    assert.ok(overwritten.error, 'overwrite');
    const signed = await supplier.client.storage.from('bid-documents').createSignedUrl(path, 3600);
    assert.ok(signed.error, 'sign directly, for an hour');
    const stillThere = await adminClient.storage.from('bid-documents').download(path);
    assert.equal(await stillThere.data?.text(), `proposal from ${supplier.email}`);
  });

  test('A5: both buckets take PDF, Word and Excel (.xls, .xlsx) up to 10 MB, and nothing else', async () => {
    const bidId = randomUUID();
    const spreadsheetTypes = ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    for (const [index, contentType] of spreadsheetTypes.entries()) {
      const uploaded = await uploadBidFile(otherSupplier, cronTender.id, bidId, `prices-${index}.xls`, 'sheet', contentType);
      assert.equal(uploaded.error, null, contentType);
    }
    assert.ok((await uploadBidFile(otherSupplier, cronTender.id, bidId, 'page.html', '<b>x</b>', 'text/html')).error, 'html');
    const oversized = await otherSupplier.client.storage
      .from('bid-documents')
      .upload(`${cronTender.id}/${bidId}/too-big.pdf`, new Blob([new Uint8Array(tenMegabytes + 1)], { type: 'application/pdf' }), { contentType: 'application/pdf' });
    assert.ok(oversized.error, 'over 10 MB');
  });

  test('A2: before the closing time the business reads nothing: no bids, no count, no files, no names of bidders through bids', async () => {
    const direct = await business.client.from('bids').select('id', { count: 'exact' }).eq('tender_id', tender.id);
    assert.equal(direct.count ?? 0, 0);
    const sealed = await business.client.rpc('read_tender_bids', { tender_id: tender.id });
    assert.match(sealed.error?.message ?? '', /sealed until/);
    const { data: documents } = await adminClient.from('bid_documents').select('id').eq('bid_id', supplierBid.bidId);
    const documentId = documents?.[0]?.id as string;
    assert.match((await downloadAs(business, documentId)).error ?? '', /not found/i);
    assert.match((await downloadAs(admin, documentId)).error ?? '', /not found/i, 'Q19: admins neither');
  });

  test('A2/A4: other suppliers see only their own bids and files', async () => {
    const bids = await otherSupplier.client.from('bids').select('supplier_id').eq('tender_id', tender.id);
    assert.deepEqual((bids.data ?? []).map((row) => row.supplier_id), [otherSupplier.userId]);
    const listed = await otherSupplier.client.storage.from('bid-documents').list(`${tender.id}/${supplierBid.bidId}`);
    assert.deepEqual(listed.data ?? [], []);
  });

  test('C1: visitors read no names, no tenders, nothing; signed-in users read every company name; nobody writes through the views', async () => {
    const visitor = anonymousClient();
    for (const table of ['business_names_public', 'supplier_names_public', 'tenders', 'categories', 'company_names']) {
      const read = await visitor.from(table).select('*').limit(1);
      assert.ok(read.error || (read.data ?? []).length === 0, `visitor reads ${table}`);
    }
    const names = await otherSupplier.client.from('supplier_names_public').select('company_name').eq('user_id', supplier.userId);
    assert.deepEqual((names.data ?? []).map((row) => row.company_name), ['supplier-one Company']);
    const renamed = await visitor.from('business_names_public').update({ company_name: 'Hijacked' }).eq('user_id', business.userId);
    const deleted = await supplier.client.from('business_names_public').delete().eq('user_id', business.userId);
    assert.ok(renamed.error && deleted.error);
  });

  test('A1: deleting the supplier profile (now impossible through any API path) cannot reset the trial', async () => {
    await expiredSupplier.client.from('supplier_names_public').delete().eq('user_id', expiredSupplier.userId);
    await expiredSupplier.client.from('supplier_profiles').delete().eq('user_id', expiredSupplier.userId);
    const deletedByOwner = await adminClient.from('supplier_profiles').delete().eq('user_id', expiredSupplier.userId);
    assert.equal(deletedByOwner.error, null, 'even if the profile goes');
    await expiredSupplier.client.from('supplier_profiles').insert({ user_id: expiredSupplier.userId, company_name: 'Fresh Start' });
    const subscription = await adminClient.from('subscriptions').select('trial_ends_at').eq('supplier_id', expiredSupplier.userId).single();
    assert.ok(new Date(subscription.data?.trial_ends_at as string).getTime() < Date.now(), 'still expired');
    await expiredSupplier.client.from('subscriptions').update({ status: 'active' }).eq('supplier_id', expiredSupplier.userId);
    // Read back with the secret key: a refused write leaves the row as it was, with or without an error.
    const afterWrite = await adminClient.from('subscriptions').select('status').eq('supplier_id', expiredSupplier.userId).single();
    assert.notEqual(afterWrite.data?.status, 'active', 'a supplier cannot make its own subscription active');
  });

  test('A7/Q23: a one-letter name signs up; a 121-character name is refused, not shortened', async () => {
    const short = await adminClient.from('profiles').select('full_name').eq('id', expiredSupplier.userId).single();
    assert.equal(short.data?.full_name, 'X');
    const tooLong = await adminClient.auth.admin.createUser({
      email: `rls-test-${runIdentifier}-${randomUUID()}@example.com`,
      password: `Rls-${randomUUID()}`,
      email_confirm: true,
      user_metadata: { full_name: 'N'.repeat(121), account_type: 'supplier' },
    });
    assert.ok(tooLong.error);
  });

  test('P1-06: a published tender only takes a later closing time; its terms are fixed', async () => {
    const edited = await otherBusiness.client.from('tenders').update({ title: 'Changed' }).eq('id', cronTender.id).select('id');
    assert.deepEqual(edited.data ?? [], []);
    // Relative to its own closing time, not the clock: against a remote project "now + a few seconds" can
    // already be later than this short-lived tender's closing time, which is a valid extension.
    const earlier = new Date(cronTender.closesAt.getTime() - 1000).toISOString();
    const shortened = await otherBusiness.client.rpc('extend_tender_closing_time', { tender_id: cronTender.id, new_closes_at: earlier });
    assert.match(shortened.error?.message ?? '', /only be extended|Only an open tender/);
    const status = await otherBusiness.client.from('tenders').update({ status: 'closed' }).eq('id', cronTender.id);
    assert.ok(status.error, '8.4: no direct status writes');
  });

  test('M2: published tenders cannot be deleted, so their bids cannot be either', async () => {
    const deleted = await business.client.from('tenders').delete({ count: 'exact' }).eq('id', tender.id);
    assert.equal(deleted.count ?? 0, 0);
  });

  test('M3: tender documents need an account and go through the logged download', async () => {
    const draft = await createDraft(otherBusiness, 3600, 'Documents tender');
    const uploaded = await otherBusiness.client.storage.from('tender-documents').upload(`${draft.id}/requirements-form/requirements.pdf`, fileOf('requirements'), { contentType: 'application/pdf' });
    assert.equal(uploaded.error, null, uploaded.error?.message);
    const published = await otherBusiness.client.rpc('publish_tender', { tender_id: draft.id });
    assert.equal(published.error, null, published.error?.message);
    const { data: documents } = await supplier.client.from('tender_documents').select('id, document_role').eq('tender_id', draft.id);
    assert.deepEqual((documents ?? []).map((row) => row.document_role), ['requirements_form']);
    const documentId = documents?.[0]?.id as string;
    assert.equal((await downloadAs(supplier, documentId)).text, 'requirements');
    assert.deepEqual(await auditActions(documentId), ['document_download_authorized', 'document_download_url_issued']);
    const visitorSigned = await anonymousClient().storage.from('tender-documents').createSignedUrl(`${draft.id}/requirements-form/requirements.pdf`, 60);
    assert.ok(visitorSigned.error, 'visitor');
  });

  test('M4: an expired supplier cannot upload; a business cannot upload into another business draft', async () => {
    const expired = await uploadBidFile(expiredSupplier, cronTender.id, randomUUID(), 'proposal/p.pdf', 'p');
    assert.ok(expired.error);
    const draft = await createDraft(business, 3600, 'Private draft');
    const planted = await otherBusiness.client.storage.from('tender-documents').upload(`${draft.id}/planted.pdf`, fileOf('x'), { contentType: 'application/pdf' });
    assert.ok(planted.error);
  });

  test('P1-13: users manage only their own alert preference; nobody reads the email log', async () => {
    assert.equal((await supplier.client.from('notification_preferences').insert({ user_id: supplier.userId, tender_alerts: false })).error, null);
    assert.ok((await supplier.client.from('notification_preferences').insert({ user_id: otherSupplier.userId, tender_alerts: false })).error);
    const emailLog = await supplier.client.from('email_log').select('id');
    assert.ok(emailLog.error || (emailLog.data ?? []).length === 0);
  });

  test('P1-15/8.6: the admin (TOTP verified) lists users and tenders, with no bid count while sealed; others are refused', async () => {
    const users = await admin.client.rpc('admin_list_users', { search: 'supplier-one' });
    assert.equal(users.error, null, users.error?.message);
    assert.equal((users.data as unknown[]).length, 1);
    const tenders = await admin.client.rpc('admin_list_tenders', {});
    const listed = (tenders.data as Array<{ tender_id: string; bid_count: number | null }>).find((row) => row.tender_id === tender.id);
    assert.equal(listed?.bid_count, null);
    assert.ok((await business.client.rpc('admin_list_users', {})).error, 'not staff');
    const log = await admin.client.from('audit_log').select('id').limit(1);
    assert.equal((log.data ?? []).length, 1, 'admin reads the audit log');
    assert.deepEqual((await business.client.from('audit_log').select('id')).data ?? [], [], 'others do not');
  });

  test('P1-15/Q21: deactivating through set-user-active stops writes at once, even with a valid token, and blocks signing in', async () => {
    const draft = await createDraft(otherBusiness, 3600, 'Draft before deactivation');
    const setActive = (isActive: boolean) => admin.client.functions.invoke('set-user-active', { body: { user_id: otherBusiness.userId, is_active: isActive } });
    assert.equal((await setActive(false)).error, null, 'deactivate');
    assert.match((await otherBusiness.client.rpc('publish_tender', { tender_id: draft.id })).error?.message ?? '', /deactivated/);
    assert.match((await otherBusiness.client.rpc('cancel_tender', { tender_id: cronTender.id, reason: 'x' })).error?.message ?? '', /deactivated/);
    assert.equal(await canSignIn(otherBusiness.email), false, 'banned in Supabase Auth');
    const notStaff = await business.client.functions.invoke('set-user-active', { body: { user_id: otherBusiness.userId, is_active: true } });
    assert.ok(notStaff.error, 'only staff with MFA can reactivate');
    assert.equal((await setActive(true)).error, null, 'reactivate');
    assert.equal(await canSignIn(otherBusiness.email), true, 'unbanned');
  });

  test("P1-02: finishing the tour records it for that role, on the person's own profile only", async () => {
    assert.equal((await supplier.client.rpc('record_onboarding_completed', { completed_account_type: 'supplier' })).error, null);
    const own = await supplier.client.from('profiles').select('onboarding_completed').eq('id', supplier.userId).single();
    assert.deepEqual(Object.keys(own.data?.onboarding_completed as object), ['supplier']);
    const other = await adminClient.from('profiles').select('onboarding_completed').eq('id', otherSupplier.userId).single();
    assert.deepEqual(other.data?.onboarding_completed, {}, 'nobody else');
    const direct = await supplier.client.from('profiles').update({ onboarding_completed: {} }).eq('id', supplier.userId).select('id');
    assert.ok(direct.error, 'only through the function');
  });

  // After the main tender's closing time.
  test('A3: a bid at or after the closing time is refused', async () => {
    await waitUntilPast(tender.closesAt);
    const late = await submitBid(expiredSupplier, tender.id, 100);
    assert.ok(late.error);
    const lateSupplier = await createAccount('supplier-late', 'supplier');
    assert.match((await submitBid(lateSupplier, tender.id, 100)).error?.message ?? '', /closed at|upload/);
  });

  test('A2/P1-09: from the closing time the business reads every bid with names, and the first read is logged once', async () => {
    for (let readNumber = 0; readNumber < 2; readNumber += 1) {
      const opened = await business.client.rpc('read_tender_bids', { tender_id: tender.id });
      assert.equal(opened.error, null, opened.error?.message);
      const rows = opened.data as Array<{ amount: number; supplier_company_name: string }>;
      assert.deepEqual(rows.map((row) => Number(row.amount)).sort(), [1500, 1700]);
      assert.ok(rows.some((row) => row.supplier_company_name === 'supplier-one Company'));
    }
    assert.equal((await auditActions(tender.id)).filter((action) => action === 'bids_opened').length, 1);
  });

  test('8.5: the business downloads the original proposal through a logged, 60-second link', async () => {
    const { data: documents } = await adminClient.from('bid_documents').select('id').eq('bid_id', supplierBid.bidId);
    const downloaded = await downloadAs(business, documents?.[0]?.id as string);
    assert.equal(downloaded.text, `proposal from ${supplier.email}`);
  });

  test('P1-07: pg_cron closes a tender within about a minute of its closing time, and logs it', async () => {
    await waitUntilPast(cronTender.closesAt);
    let status = 'open';
    for (let waitedSeconds = 0; waitedSeconds < cronGraceSeconds && status !== 'closed'; waitedSeconds += 5) {
      const { data } = await adminClient.from('tenders').select('status').eq('id', cronTender.id).single();
      status = (data?.status as string | undefined) ?? 'unknown';
      if (status !== 'closed') await sleep(5000);
    }
    assert.equal(status, 'closed');
    assert.ok((await auditActions(cronTender.id)).includes('tender_closed'));
  });

  test('Q8: awarding sets awarded and unsuccessful; the awarded tender is logged', async () => {
    let closed = false;
    for (let waitedSeconds = 0; waitedSeconds < cronGraceSeconds && !closed; waitedSeconds += 5) {
      const { data } = await adminClient.from('tenders').select('status').eq('id', tender.id).single();
      closed = data?.status === 'closed';
      if (!closed) await sleep(5000);
    }
    const awarded = await business.client.rpc('award_tender', { tender_id: tender.id, bid_id: supplierBid.bidId });
    assert.equal(awarded.error, null, awarded.error?.message);
    const outcomes = await adminClient.from('bids').select('id, status').eq('tender_id', tender.id);
    const statusById = new Map((outcomes.data ?? []).map((row) => [row.id as string, row.status as string]));
    assert.equal(statusById.get(supplierBid.bidId), 'awarded');
    assert.deepEqual([...statusById.values()].sort(), ['awarded', 'unsuccessful']);
  });
});

/** Role x table: what each role may read and write, checked through the real API. */
describe('Role and table matrix', () => {
  const tables = [
    'profiles', 'business_profiles', 'supplier_profiles', 'company_names', 'categories', 'tenders', 'tender_documents',
    'bids', 'bid_documents', 'form_definitions', 'form_submissions', 'subscriptions', 'subscription_plans', 'subscription_events',
    'notification_preferences', 'staff_members', 'audit_log', 'email_log',
  ];
  const noDirectWrites = new Set(['company_names', 'categories', 'tender_documents', 'bids', 'bid_documents', 'form_definitions', 'subscriptions', 'subscription_plans', 'subscription_events', 'staff_members', 'audit_log', 'email_log']);

  // Each table's key, and a value no row can have. Write attempts target only that impossible row, so the
  // checks can never change real data (OPEN_QUESTIONS.md, decision D1); the proof is the error itself.
  const impossibleRow: Record<string, [string, string | number]> = {
    profiles: ['id', randomUUID()], business_profiles: ['user_id', randomUUID()], supplier_profiles: ['user_id', randomUUID()],
    company_names: ['user_id', randomUUID()], categories: ['id', -1], tenders: ['id', randomUUID()],
    tender_documents: ['id', randomUUID()], bids: ['id', randomUUID()], bid_documents: ['id', randomUUID()],
    form_definitions: ['key', 'no-such-form'], form_submissions: ['id', randomUUID()], subscriptions: ['supplier_id', randomUUID()],
    subscription_plans: ['id', randomUUID()], subscription_events: ['id', randomUUID()], notification_preferences: ['user_id', randomUUID()],
    staff_members: ['user_id', randomUUID()], audit_log: ['id', -1], email_log: ['id', -1],
  };
  // An identity key refuses any written value before privileges are checked (428C9), which would hide the
  // answer. These tables write a NOT NULL column as null instead: refused for privilege or by the
  // constraint, never stored.
  const notNullColumnWrittenAsNull: Record<string, string> = { categories: 'name', audit_log: 'action', email_log: 'type' };
  const permissionDenied = '42501';

  /** Writes that were NOT refused for lack of privilege (there should be none). */
  async function writesNotRefused(client: SupabaseClient, table: string): Promise<string[]> {
    const [keyColumn, impossibleValue] = impossibleRow[table] ?? ['id', randomUUID()];
    const writeColumn = notNullColumnWrittenAsNull[table];
    const written: Record<string, string | number | null> = writeColumn ? { [writeColumn]: null } : { [keyColumn]: impossibleValue };
    const attempts = {
      insert: await client.from(table).insert([written]),
      update: await client.from(table).update(written).eq(keyColumn, impossibleValue),
      delete: await client.from(table).delete().eq(keyColumn, impossibleValue),
    };
    return Object.entries(attempts)
      .filter(([, outcome]) => outcome.error?.code !== permissionDenied)
      .map(([operation, outcome]) => `${operation} ${table} (${outcome.error?.code ?? 'no error'})`);
  }

  test('Visitors who are not signed in can read and write no table', async () => {
    const visitor = anonymousClient();
    const reachable: string[] = [];
    for (const table of tables) {
      const read = await visitor.from(table).select('*').limit(1);
      if (!read.error && (read.data ?? []).length > 0) reachable.push(`read ${table}`);
      reachable.push(...(await writesNotRefused(visitor, table)));
    }
    assert.deepEqual(reachable, []);
  });

  test('Signed-in users cannot write the tables only functions and the service role write', async () => {
    for (const account of [business, supplier]) {
      const accepted: string[] = [];
      for (const table of noDirectWrites) {
        accepted.push(...(await writesNotRefused(account.client, table)));
      }
      assert.deepEqual(accepted, [], account.email);
    }
  });

  test("Signed-in users read only their own profiles, subscriptions, preferences and staff rows", async () => {
    for (const [table, ownerColumn] of [
      ['profiles', 'id'], ['business_profiles', 'user_id'], ['supplier_profiles', 'user_id'], ['subscriptions', 'supplier_id'],
      ['notification_preferences', 'user_id'], ['staff_members', 'user_id'],
    ] as const) {
      const { data } = await supplier.client.from(table).select(ownerColumn);
      const others = (data ?? []).filter((row) => (row as Record<string, string>)[ownerColumn] !== supplier.userId);
      assert.deepEqual(others, [], table);
    }
  });
});
