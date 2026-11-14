// The "before" half of the proof (PRD section 11): against a database with only the production
// baseline applied, every audit item must reproduce through the real API, Storage and Auth.
// scripts/run-rls.ts resets the database to the baseline before this runs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, test } from 'node:test';
import { adminClient, anonymousClient, createAccount, fileOf, supabaseUrl, type TestAccount } from './target.ts';

type OpenApiDocument = { paths: Record<string, unknown>; definitions: Record<string, { properties?: Record<string, { format?: string }> }> };

let business: TestAccount;
let otherBusiness: TestAccount;
let supplier: TestAccount;
let expiredSupplier: TestAccount;
let openTenderId: string;
let proposalPath: string;
let bidId: string;

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

async function postLegacyTender(owner: TestAccount, title: string): Promise<string> {
  const { data, error } = await owner.client
    .from('tenders')
    .insert({ business_id: owner.userId, title, description: 'Baseline suite', closing_date: inDays(7), status: 'open' })
    .select('id')
    .single();
  if (error || !data) throw new Error(`legacy tender: ${error?.message}`);
  return data.id as string;
}

async function uploadLegacyProposal(owner: TestAccount, content: string): Promise<{ path: string; error: string | null }> {
  const path = `${owner.userId}/${randomUUID()}-proposal.pdf`;
  const { error } = await owner.client.storage.from('bid-documents').upload(path, fileOf(content), { contentType: 'application/pdf' });
  return { path, error: error?.message ?? null };
}

async function openApi(): Promise<OpenApiDocument> {
  const response = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: { apikey: process.env.RLS_SECRET_KEY ?? '', Authorization: `Bearer ${process.env.RLS_SECRET_KEY ?? ''}` },
  });
  return (await response.json()) as OpenApiDocument;
}

describe('Baseline: every audit item reproduces on the production schema', () => {
  before(async () => {
    business = await createAccount('baseline-business', 'business');
    otherBusiness = await createAccount('baseline-business-two', 'business');
    supplier = await createAccount('baseline-supplier', 'supplier');
    expiredSupplier = await createAccount('baseline-supplier-expired', 'supplier');
    const expired = await adminClient
      .from('supplier_profiles')
      .update({ trial_ends_at: new Date(Date.now() - 86_400_000).toISOString() })
      .eq('user_id', expiredSupplier.userId);
    assert.equal(expired.error, null, 'expire the trial (baseline columns)');

    openTenderId = await postLegacyTender(business, 'Baseline open tender');
    const upload = await uploadLegacyProposal(supplier, 'original proposal');
    assert.equal(upload.error, null, 'upload the proposal');
    proposalPath = upload.path;
    const { data, error } = await supplier.client
      .from('bids')
      .insert({ tender_id: openTenderId, supplier_id: supplier.userId, amount: 1500, document_path: proposalPath, document_name: 'proposal.pdf' })
      .select('id')
      .single();
    assert.equal(error, null, 'submit the bid');
    bidId = data?.id as string;
  });

  test('C1 reproduces: a visitor renames a company through business_names_public', async () => {
    await anonymousClient().from('business_names_public').update({ company_name: 'Renamed without login' }).eq('user_id', otherBusiness.userId);
    const { data } = await adminClient.from('business_profiles').select('company_name').eq('user_id', otherBusiness.userId).single();
    assert.equal(data?.company_name, 'Renamed without login');
  });

  test('A1 reproduces: an expired supplier deletes its profile through the view and gets a fresh trial', async () => {
    const deleted = await expiredSupplier.client.from('supplier_names_public').delete({ count: 'exact' }).eq('user_id', expiredSupplier.userId);
    assert.equal(deleted.count, 1, 'deleted through the view');
    const recreated = await expiredSupplier.client.from('supplier_profiles').insert({ user_id: expiredSupplier.userId, company_name: 'Fresh Start' });
    assert.equal(recreated.error, null);
    const { data } = await adminClient.from('supplier_profiles').select('trial_ends_at').eq('user_id', expiredSupplier.userId).single();
    assert.ok(new Date(data?.trial_ends_at as string).getTime() > Date.now(), 'a new trial');
  });

  test('A2 reproduces: the business reads the bid and signs a URL for its file before the closing date', async () => {
    const bids = await business.client.from('bids').select('amount').eq('tender_id', openTenderId);
    assert.deepEqual((bids.data ?? []).map((row) => Number(row.amount)), [1500]);
    const signed = await business.client.storage.from('bid-documents').createSignedUrl(proposalPath, 600);
    assert.equal(signed.error, null, 'and for longer than 60 seconds');
  });

  test('A3 reproduces: a bid is accepted on a closed tender', async () => {
    const closedTenderId = await postLegacyTender(business, 'Baseline closed tender');
    const closed = await business.client.from('tenders').update({ status: 'closed' }).eq('id', closedTenderId);
    assert.equal(closed.error, null);
    const upload = await uploadLegacyProposal(supplier, 'late proposal');
    const late = await supplier.client
      .from('bids')
      .insert({ tender_id: closedTenderId, supplier_id: supplier.userId, amount: 900, document_path: upload.path, document_name: 'late.pdf' });
    assert.equal(late.error, null);
  });

  test('A4 reproduces: the supplier swaps the file behind its submitted bid, and the business gets the new one', async () => {
    const removed = await supplier.client.storage.from('bid-documents').remove([proposalPath]);
    assert.equal(removed.error, null);
    const replaced = await supplier.client.storage.from('bid-documents').upload(proposalPath, fileOf('swapped proposal'), { contentType: 'application/pdf' });
    assert.equal(replaced.error, null);
    const downloaded = await business.client.storage.from('bid-documents').download(proposalPath);
    assert.equal(await downloaded.data?.text(), 'swapped proposal');
  });

  test('A5 reproduces: the bid bucket rejects an Excel file the form accepts', async () => {
    const path = `${supplier.userId}/${randomUUID()}-prices.xlsx`;
    const spreadsheet = await supplier.client.storage
      .from('bid-documents')
      .upload(path, fileOf('xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    assert.ok(spreadsheet.error, 'rejected');
  });

  test('A6 reproduces: the deadline column is a date with no time', async () => {
    const document = await openApi();
    assert.equal(document.definitions.tenders?.properties?.closing_date?.format, 'date');
  });

  test('A7 reproduces: creating a user with a one-letter name fails', async () => {
    const created = await adminClient.auth.admin.createUser({
      email: `ct-rls-${randomUUID()}@example.com`,
      password: `Rls-${randomUUID()}`,
      email_confirm: true,
      user_metadata: { full_name: 'Q', account_type: 'supplier' },
    });
    assert.ok(created.error, 'the signup trigger fails');
  });

  test('M2 reproduces: the business deletes a tender that has bids, and the bids go with it', async () => {
    const tenderId = await postLegacyTender(business, 'Baseline deletable tender');
    const upload = await uploadLegacyProposal(supplier, 'proposal');
    const bid = await supplier.client
      .from('bids')
      .insert({ tender_id: tenderId, supplier_id: supplier.userId, amount: 700, document_path: upload.path, document_name: 'p.pdf' })
      .select('id')
      .single();
    assert.equal(bid.error, null);
    const deleted = await business.client.from('tenders').delete({ count: 'exact' }).eq('id', tenderId);
    assert.equal(deleted.count, 1);
    const remaining = await adminClient.from('bids').select('id').eq('id', bid.data?.id as string);
    assert.deepEqual(remaining.data, []);
  });

  test('M3 reproduces: a visitor signs a URL for a tender document', async () => {
    const path = `${business.userId}/${randomUUID()}-specification.pdf`;
    const uploaded = await business.client.storage.from('tender-documents').upload(path, fileOf('specification'), { contentType: 'application/pdf' });
    assert.equal(uploaded.error, null);
    const signed = await anonymousClient().storage.from('tender-documents').createSignedUrl(path, 60);
    assert.equal(signed.error, null);
  });

  test('M4 reproduces: a supplier whose trial has ended can still upload files', async () => {
    const lapsed = await createAccount('baseline-supplier-lapsed', 'supplier');
    const expired = await adminClient.from('supplier_profiles').update({ trial_ends_at: new Date(Date.now() - 86_400_000).toISOString() }).eq('user_id', lapsed.userId);
    assert.equal(expired.error, null);
    const upload = await uploadLegacyProposal(lapsed, 'uploaded without access');
    assert.equal(upload.error, null);
  });

  test("M5 reproduces: a bid can point at another supplier's file path", async () => {
    const otherSupplier = await createAccount('baseline-supplier-two', 'supplier');
    const tenderId = await postLegacyTender(business, 'Baseline M5 tender');
    const borrowed = await otherSupplier.client
      .from('bids')
      .insert({ tender_id: tenderId, supplier_id: otherSupplier.userId, amount: 800, document_path: proposalPath, document_name: 'borrowed.pdf' });
    assert.equal(borrowed.error, null);
  });

  test('M7 reproduces: the orphaned security-definer signup function is exposed as an API endpoint', async () => {
    const document = await openApi();
    assert.ok('/rpc/handle_new_user' in document.paths);
  });

  test('C1 reproduces (destructive, last): a visitor deletes a business through the view, and its tenders and bids go too', async () => {
    const deleted = await anonymousClient().from('business_names_public').delete({ count: 'exact' }).eq('user_id', business.userId);
    assert.equal(deleted.count, 1);
    const tenders = await adminClient.from('tenders').select('id').eq('id', openTenderId);
    assert.deepEqual(tenders.data, []);
    const bids = await adminClient.from('bids').select('id').eq('id', bidId);
    assert.deepEqual(bids.data, []);
  });
});

