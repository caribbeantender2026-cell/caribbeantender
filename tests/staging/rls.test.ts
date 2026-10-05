// Staging RLS suite: the AUDIT.md test plan (issues 1-5 and H1) plus the Stage 1 rules, run through
// the real API as real users. Tests run in order and share one scenario: a tender that closes
// during the run, so the same bids are checked while sealed and again once opened.
import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import {
  adminClient,
  anonymousClient,
  createAccount,
  expireTrial,
  publishTender,
  sleep,
  submitBid,
  uploadProposal,
  waitUntilPast,
  type TestAccount,
} from './staging.ts';

const sealedSeconds = 45;

let businessAlpha: TestAccount;
let businessBeta: TestAccount;
let supplierOne: TestAccount;
let supplierTwo: TestAccount;
let supplierExpired: TestAccount;
let tender: { id: string; closesAt: Date };
let cronTender: { id: string; closesAt: Date };
let supplierOneBid: { bidId: string; documentPath: string };

describe('Staging RLS suite', () => {
  before(async () => {
    businessAlpha = await createAccount('business-alpha', 'business');
    businessBeta = await createAccount('business-beta', 'business');
    supplierOne = await createAccount('supplier-one', 'supplier');
    supplierTwo = await createAccount('supplier-two', 'supplier');
    supplierExpired = await createAccount('supplier-expired', 'supplier');
    await expireTrial(supplierExpired);

    tender = await publishTender(businessAlpha, sealedSeconds);
    // Nobody closes this one by hand, so only pg_cron can close it.
    cronTender = await publishTender(businessBeta, 20, 'Closed by pg_cron');
    const bid = await submitBid(supplierOne, tender.id, 1500);
    assert.equal(bid.error, null, 'Supplier One bids');
    assert.ok(bid.bidId);
    supplierOneBid = { bidId: bid.bidId, documentPath: bid.documentPath };
    assert.equal((await submitBid(supplierTwo, tender.id, 1700)).error, null, 'Supplier Two bids');
  });

  // Issue 1: suppliers cannot give themselves a subscription or reset a trial.
  test('1a: a supplier cannot update its own subscription', async () => {
    const { data } = await supplierExpired.client
      .from('subscriptions')
      .update({ status: 'active', current_period_ends_at: '2099-01-01T00:00:00Z' })
      .eq('supplier_id', supplierExpired.userId)
      .select('status');
    assert.deepEqual(data ?? [], []);
  });

  test('1b: the profile upsert can no longer carry subscription fields', async () => {
    const { error } = await supplierExpired.client
      .from('supplier_profiles')
      .upsert({ user_id: supplierExpired.userId, company_name: 'Upsert Ltd', subscription_status: 'active', subscription_ends_at: '2099-01-01T00:00:00Z' }, { onConflict: 'user_id' });
    assert.ok(error, 'upsert with subscription fields must fail');
  });

  test('1c: a supplier cannot create a subscription row', async () => {
    const { error } = await supplierExpired.client.from('subscriptions').insert({ supplier_id: supplierExpired.userId, status: 'active' });
    assert.ok(error);
  });

  test('1d: deleting the supplier profile through the view or the table cannot reset the trial', async () => {
    const throughView = await supplierExpired.client.from('supplier_names_public').delete().eq('user_id', supplierExpired.userId);
    assert.ok(throughView.error, 'delete through the view is refused');
    const throughTable = await supplierExpired.client.from('supplier_profiles').delete().eq('user_id', supplierExpired.userId).select('user_id');
    assert.deepEqual(throughTable.data ?? [], [], 'delete through the table removes nothing');
    const lateBid = await submitBid(supplierExpired, tender.id);
    assert.ok(lateBid.error, 'still no access');
  });

  // Issue 3: bids from suppliers without access, and their uploads, are refused.
  test('3a: a supplier without an active trial cannot upload or bid', async () => {
    const upload = await uploadProposal(supplierExpired, 'no access');
    assert.ok(upload.error, 'upload refused');
  });

  // Issue 2 and sealed bids: nothing about the bids reaches the business before the deadline.
  test('2a: the business reads no bids before the deadline', async () => {
    const { data, error } = await businessAlpha.client.from('bids').select('id, amount').eq('tender_id', tender.id);
    assert.equal(error, null);
    assert.deepEqual(data, []);
  });

  test('2b: the business cannot request or sign a bid document before the deadline', async () => {
    const requested = await businessAlpha.client.rpc('request_bid_document_download', { requested_bid_id: supplierOneBid.bidId });
    assert.ok(requested.error, 'download request refused');
    const signed = await businessAlpha.client.storage.from('bid-documents').createSignedUrl(supplierOneBid.documentPath, 60);
    assert.ok(signed.error, 'signed URL refused');
  });

  test("2c: the business cannot see bidders' names before the deadline", async () => {
    const { data } = await businessAlpha.client.from('supplier_names_public').select('user_id').eq('user_id', supplierOne.userId);
    assert.deepEqual(data ?? [], []);
  });

  // Issue 4: suppliers only ever see their own bids and files.
  test("4a: Supplier Two reads only its own bid on the tender", async () => {
    const { data, error } = await supplierTwo.client.from('bids').select('supplier_id').eq('tender_id', tender.id);
    assert.equal(error, null);
    assert.deepEqual((data ?? []).map((row) => row.supplier_id), [supplierTwo.userId]);
  });

  test("4b: Supplier Two cannot sign or list Supplier One's files", async () => {
    const signed = await supplierTwo.client.storage.from('bid-documents').createSignedUrl(supplierOneBid.documentPath, 60);
    assert.ok(signed.error);
    const listed = await supplierTwo.client.storage.from('bid-documents').list(supplierOne.userId);
    assert.deepEqual(listed.data ?? [], []);
  });

  // Issue 5: nobody changes another user's data.
  test("5a: Business Beta cannot update or delete Business Alpha's tender", async () => {
    const updated = await businessBeta.client.from('tenders').update({ status: 'cancelled' }).eq('id', tender.id).select('id');
    assert.deepEqual(updated.data ?? [], []);
    const deleted = await businessBeta.client.from('tenders').delete().eq('id', tender.id).select('id');
    assert.deepEqual(deleted.data ?? [], []);
  });

  test("5b: Supplier Two cannot read or edit Supplier One's profile", async () => {
    const read = await supplierTwo.client.from('supplier_profiles').select('user_id').eq('user_id', supplierOne.userId);
    assert.deepEqual(read.data ?? [], []);
    const edited = await supplierTwo.client.from('supplier_profiles').update({ company_name: 'Hijacked' }).eq('user_id', supplierOne.userId).select('user_id');
    assert.deepEqual(edited.data ?? [], []);
  });

  test("5c: Supplier Two cannot read Business Alpha's base profile", async () => {
    const { data } = await supplierTwo.client.from('profiles').select('id').eq('id', businessAlpha.userId);
    assert.deepEqual(data ?? [], []);
  });

  test('5d: a visitor with no login cannot rename or delete through the name views', async () => {
    const visitor = anonymousClient();
    const renamed = await visitor.from('business_names_public').update({ company_name: 'Renamed without login' }).eq('user_id', businessAlpha.userId);
    assert.ok(renamed.error, 'rename refused');
    const deleted = await visitor.from('business_names_public').delete().eq('user_id', businessBeta.userId);
    assert.ok(deleted.error, 'delete refused');
    const supplierNames = await visitor.from('supplier_names_public').select('user_id').eq('user_id', supplierOne.userId);
    assert.ok(supplierNames.error || (supplierNames.data ?? []).length === 0, 'visitor cannot list supplier names');
  });

  test('5e: a visitor cannot write to any table', async () => {
    const { error } = await anonymousClient()
      .from('tenders')
      .insert({ business_id: businessAlpha.userId, title: 'Anonymous', description: 'x', closes_at: '2099-01-01T00:00:00Z' });
    assert.ok(error);
  });

  // H1: the file behind a submitted bid cannot be swapped.
  test('H1: Supplier One cannot delete or overwrite its submitted proposal', async () => {
    const removed = await supplierOne.client.storage.from('bid-documents').remove([supplierOneBid.documentPath]);
    assert.deepEqual(removed.data ?? [], [], 'nothing removed');
    const overwritten = await supplierOne.client.storage
      .from('bid-documents')
      .upload(supplierOneBid.documentPath, new Blob(['replaced'], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true });
    assert.ok(overwritten.error, 'overwrite refused');
  });

  // Tender lifecycle.
  test('Lifecycle: the business cannot edit or close its published tender before the deadline', async () => {
    const edited = await businessAlpha.client.from('tenders').update({ title: 'Changed' }).eq('id', tender.id);
    assert.match(edited.error?.message ?? '', /cannot be edited/);
    const closed = await businessAlpha.client.from('tenders').update({ status: 'closed' }).eq('id', tender.id);
    assert.match(closed.error?.message ?? '', /closes automatically/);
  });

  test('Lifecycle: a draft is invisible to visitors', async () => {
    const { data: draft } = await businessBeta.client
      .from('tenders')
      .insert({ business_id: businessBeta.userId, title: 'Draft', description: 'x', closes_at: '2099-01-01T00:00:00Z' })
      .select('id')
      .single();
    assert.ok(draft);
    const { data } = await anonymousClient().from('tenders').select('id').eq('id', draft.id as string);
    assert.deepEqual(data ?? [], []);
  });

  test('Excel: .xlsx proposals upload; legacy .xls is rejected by the bucket', async () => {
    const spreadsheet = await uploadProposal(supplierTwo, 'spreadsheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx');
    assert.equal(spreadsheet.error, null);
    const legacy = await uploadProposal(supplierTwo, 'legacy', 'application/vnd.ms-excel', 'xls');
    assert.ok(legacy.error);
  });

  test('Audit: Supplier One reads its own submission receipt with the exact submission time', async () => {
    const { data: bid } = await supplierOne.client.from('bids').select('created_at').eq('id', supplierOneBid.bidId).single();
    const { data: receipt } = await supplierOne.client.from('audit_log').select('occurred_at').eq('event_type', 'bid_submitted').eq('bid_id', supplierOneBid.bidId).single();
    assert.ok(bid && receipt);
    assert.equal(new Date(receipt.occurred_at as string).getTime(), new Date(bid.created_at as string).getTime());
  });

  test('P2: a user created with a one-letter name and no account type is still created', async () => {
    const { data, error } = await adminClient.auth.admin.createUser({
      email: `ct-test-${Date.now()}-short@example.com`,
      password: `Staging-${Date.now()}-x`,
      email_confirm: true,
      user_metadata: { full_name: 'J' },
    });
    assert.equal(error, null);
    assert.ok(data.user);
  });

  // After the deadline: late bids are refused and the bids open.
  test('3b: a bid after the deadline is refused', async () => {
    await waitUntilPast(tender.closesAt);
    const late = await submitBid(supplierTwo, tender.id);
    assert.match(late.error ?? '', /closed at|not open/);
  });

  test('2d: after the deadline bids stay sealed until the tender is closed; the business closes it, the opening is logged, then it reads', async () => {
    const { data: current } = await adminClient.from('tenders').select('status').eq('id', tender.id).single();
    if (current?.status === 'open') {
      // pg_cron may already have closed it; when it has not, nothing is readable yet.
      const sealed = await businessAlpha.client.from('bids').select('id').eq('tender_id', tender.id);
      assert.deepEqual(sealed.data ?? [], [], 'still sealed before the opening');
      const closed = await businessAlpha.client.from('tenders').update({ status: 'closed' }).eq('id', tender.id);
      assert.equal(closed.error, null, 'business closes its own tender after the deadline');
    }
    const { data: opening } = await adminClient.from('audit_log').select('details').eq('event_type', 'bids_opened').eq('tender_id', tender.id).single();
    assert.equal((opening?.details as { bid_count?: number } | undefined)?.bid_count, 2, 'opening logged with both bids');
    const { data, error } = await businessAlpha.client.from('bids').select('supplier_id, amount').eq('tender_id', tender.id).order('amount');
    assert.equal(error, null);
    assert.deepEqual((data ?? []).map((row) => Number(row.amount)), [1500, 1700]);
    const names = await businessAlpha.client.from('supplier_names_public').select('company_name').eq('user_id', supplierOne.userId);
    assert.deepEqual((names.data ?? []).map((row) => row.company_name), ['supplier-one Company']);
  });

  test('2e: after the deadline a download is recorded, signed, and returns the original file', async () => {
    const unsigned = await businessAlpha.client.storage.from('bid-documents').createSignedUrl(supplierOneBid.documentPath, 60);
    assert.ok(unsigned.error, 'signing without recording the download is refused');
    const requested = await businessAlpha.client.rpc('request_bid_document_download', { requested_bid_id: supplierOneBid.bidId });
    assert.equal(requested.error, null);
    assert.equal(requested.data, supplierOneBid.documentPath);
    const signed = await businessAlpha.client.storage.from('bid-documents').createSignedUrl(supplierOneBid.documentPath, 60);
    assert.equal(signed.error, null);
    assert.ok(signed.data);
    const downloaded = await fetch(signed.data.signedUrl);
    assert.equal(await downloaded.text(), `proposal from ${supplierOne.email}`);
  });

  test('Lifecycle: pg_cron closes a tender within about a minute of its deadline and logs the opening', async () => {
    await waitUntilPast(cronTender.closesAt);
    let status = 'open';
    for (let attempt = 0; attempt < 20 && status !== 'closed'; attempt += 1) {
      const { data } = await adminClient.from('tenders').select('status').eq('id', cronTender.id).single();
      status = (data?.status as string | undefined) ?? 'unknown';
      if (status !== 'closed') {
        await sleep(6000);
      }
    }
    assert.equal(status, 'closed');
    const { data: opening } = await adminClient.from('audit_log').select('details').eq('event_type', 'bids_opened').eq('tender_id', cronTender.id).single();
    assert.equal((opening?.details as { bid_count?: number } | undefined)?.bid_count, 0);
  });
});
