// Helpers for the staging suite. It drives the real Supabase stack (Auth, PostgREST, Storage,
// pg_cron), so it covers what the local database suite cannot.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const productionProjectRef = 'ijlcjthgwppllhlqocep';

function requireSetting(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name} in .env.staging.local (see .env.example).`);
  }
  return value;
}

export const supabaseUrl = requireSetting('STAGING_SUPABASE_URL');
const publishableKey = requireSetting('STAGING_SUPABASE_PUBLISHABLE_KEY');
const secretKey = requireSetting('STAGING_SUPABASE_SECRET_KEY');

// The suite creates users and data. It must never touch production.
if (supabaseUrl.includes(productionProjectRef) || requireSetting('STAGING_PROJECT_REF') === productionProjectRef) {
  throw new Error('Refusing to run: these settings point at the production project.');
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

export const adminClient = createClient(supabaseUrl, secretKey, clientOptions);

export function anonymousClient(): SupabaseClient {
  return createClient(supabaseUrl, publishableKey, clientOptions);
}

export type TestAccount = { client: SupabaseClient; userId: string; email: string };

const runIdentifier = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const testPassword = `Staging-${randomUUID()}`;

// Confirmed users created through the admin API, so staging's "Confirm email" setting can stay
// identical to production's. The signup trigger runs exactly as it does for a real sign-up.
export async function createAccount(label: string, accountType: 'business' | 'supplier', fullName = `Test ${label}`): Promise<TestAccount> {
  const email = `ct-test-${runIdentifier}-${label}@example.com`;
  const created = await adminClient.auth.admin.createUser({
    email,
    password: testPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName, account_type: accountType },
  });
  if (created.error) {
    throw new Error(`Could not create ${label}: ${created.error.message}`);
  }
  const client = createClient(supabaseUrl, publishableKey, clientOptions);
  const signedIn = await client.auth.signInWithPassword({ email, password: testPassword });
  if (signedIn.error || !signedIn.data.user) {
    throw new Error(`Could not sign in ${label}: ${signedIn.error?.message ?? 'no user'}`);
  }
  const profileTable = accountType === 'business' ? 'business_profiles' : 'supplier_profiles';
  const named = await client.from(profileTable).update({ company_name: `${label} Company` }).eq('user_id', signedIn.data.user.id);
  assert.equal(named.error, null, `naming ${label}`);
  return { client, userId: signedIn.data.user.id, email };
}

export async function expireTrial(supplier: TestAccount): Promise<void> {
  const { error } = await adminClient
    .from('subscriptions')
    .update({ trial_ends_at: new Date(Date.now() - 86_400_000).toISOString() })
    .eq('supplier_id', supplier.userId);
  assert.equal(error, null, 'expire trial');
}

export async function publishTender(business: TestAccount, closesInSeconds: number, title = 'Staging test tender'): Promise<{ id: string; closesAt: Date }> {
  const closesAt = new Date(Date.now() + closesInSeconds * 1000);
  const { data, error } = await business.client
    .from('tenders')
    .insert({ business_id: business.userId, title, description: 'Created by the staging RLS suite', closes_at: closesAt.toISOString(), status: 'open' })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`Could not publish tender: ${error?.message ?? 'no row'}`);
  }
  return { id: data.id as string, closesAt };
}

export async function uploadProposal(
  supplier: TestAccount,
  content: string,
  contentType = 'application/pdf',
  extension = 'pdf',
): Promise<{ path: string; error: string | null }> {
  const path = `${supplier.userId}/${randomUUID()}-proposal.${extension}`;
  const { error } = await supplier.client.storage.from('bid-documents').upload(path, new Blob([content], { type: contentType }), { contentType });
  return { path, error: error?.message ?? null };
}

export async function submitBid(
  supplier: TestAccount,
  tenderId: string,
  amount = 1000,
): Promise<{ bidId: string | null; documentPath: string; error: string | null }> {
  const upload = await uploadProposal(supplier, `proposal from ${supplier.email}`);
  if (upload.error) {
    return { bidId: null, documentPath: upload.path, error: `upload: ${upload.error}` };
  }
  const { data, error } = await supplier.client
    .from('bids')
    .insert({ tender_id: tenderId, supplier_id: supplier.userId, amount, document_path: upload.path, document_name: 'proposal.pdf' })
    .select('id')
    .single();
  return { bidId: (data?.id as string | undefined) ?? null, documentPath: upload.path, error: error?.message ?? null };
}

export async function waitUntilPast(moment: Date, extraSeconds = 2): Promise<void> {
  const remaining = moment.getTime() - Date.now() + extraSeconds * 1000;
  if (remaining > 0) {
    await sleep(remaining);
  }
}

export { sleep };
