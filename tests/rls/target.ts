/**
 * The real Supabase stack the RLS suite runs against (the local stack or the client project), and the test
 * accounts it uses. This drives the real API, Storage, Auth and pg_cron, which the PGlite pre-check
 * in tests/database cannot. Against the client's project it runs only when the runner says so, and only
 * the after-state suite (OPEN_QUESTIONS.md, decision D1): every account it creates is named
 * rls-test-<run id>-..., created already confirmed (no email), and removed by scripts/cleanup-rls-test-data.ts.
 */
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const productionProjectRef = 'ijlcjthgwppllhlqocep';

function requireSetting(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Run the suite through scripts/run-rls.ts, which sets it.`);
  }
  return value;
}

export const targetName = requireSetting('RLS_TARGET');
export const supabaseUrl = requireSetting('RLS_SUPABASE_URL');
const publishableKey = requireSetting('RLS_PUBLISHABLE_KEY');
const secretKey = requireSetting('RLS_SECRET_KEY');

/** True when running against the client's project (only the after-state suite may do that). */
export const isClientProject = supabaseUrl.includes(productionProjectRef);
if (isClientProject && process.env.RLS_LIVE_PROJECT !== 'after-state-only') {
  throw new Error('Refusing to run against the client project unless scripts/run-rls.ts live sets RLS_LIVE_PROJECT=after-state-only.');
}

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };

/** Service-role client: test setup only (OPEN_QUESTIONS.md, item 4). Never used for the checks themselves. */
export const adminClient = createClient(supabaseUrl, secretKey, clientOptions);

/** A visitor who is not signed in. */
export function anonymousClient(): SupabaseClient {
  return createClient(supabaseUrl, publishableKey, clientOptions);
}

export type TestAccount = { client: SupabaseClient; userId: string; email: string };

/** Ties every account in a run together, so cleanup removes exactly what this run created. */
export const runIdentifier = process.env.RLS_RUN_ID ?? new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const testPassword = `Rls-${randomUUID()}`;

/**
 * A confirmed user, created through the admin API so the project's "Confirm email" setting can stay
 * as in production. The signup trigger runs exactly as for a real sign-up.
 */
export async function createAccount(label: string, accountType: 'business' | 'supplier', fullName = `Test ${label}`): Promise<TestAccount> {
  const email = `rls-test-${runIdentifier}-${label}@example.com`;
  const created = await adminClient.auth.admin.createUser({
    email,
    password: testPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName, account_type: accountType, accepted_terms: true },
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
  const named = await adminClient.from(profileTable).update({ company_name: `${label} Company` }).eq('user_id', signedIn.data.user.id);
  assert.equal(named.error, null, `naming ${label}`);
  return { client, userId: signedIn.data.user.id, email };
}

/** Whether a test account can start a new session (a banned account can't). */
export async function canSignIn(email: string): Promise<boolean> {
  const signedIn = await createClient(supabaseUrl, publishableKey, clientOptions).auth.signInWithPassword({ email, password: testPassword });
  return signedIn.error === null;
}

const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const totpStepSeconds = 30;
const totpDigits = 6;

function decodeBase32(encoded: string): Buffer {
  let bits = '';
  for (const character of encoded.replace(/=+$/, '').toUpperCase()) {
    const value = base32Alphabet.indexOf(character);
    if (value < 0) {
      throw new Error(`"${character}" is not a base32 character in the TOTP secret.`);
    }
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let position = 0; position + 8 <= bits.length; position += 8) {
    bytes.push(Number.parseInt(bits.slice(position, position + 8), 2));
  }
  return Buffer.from(bytes);
}

/** The current authenticator-app code for a TOTP secret (RFC 6238, as Supabase Auth uses). */
function currentTotpCode(base32Secret: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / totpStepSeconds)));
  const digest = createHmac('sha1', decodeBase32(base32Secret)).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const truncated = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** totpDigits;
  return truncated.toString().padStart(totpDigits, '0');
}

/** An admin: staff row added as the owner would in the SQL Editor, then a TOTP factor enrolled and verified (aal2). */
export async function createAdmin(label: string): Promise<TestAccount> {
  const account = await createAccount(label, 'business');
  const staff = await adminClient.from('staff_members').insert({ user_id: account.userId, role: 'admin' });
  assert.equal(staff.error, null, 'add the staff row');
  const enrolled = await account.client.auth.mfa.enroll({ factorType: 'totp', friendlyName: `rls-${runIdentifier}` });
  if (enrolled.error) {
    throw new Error(`Could not enrol TOTP for ${label}: ${enrolled.error.message}. Is TOTP MFA enabled on this project?`);
  }
  const verified = await account.client.auth.mfa.challengeAndVerify({
    factorId: enrolled.data.id,
    code: currentTotpCode(enrolled.data.totp.secret),
  });
  if (verified.error) {
    throw new Error(`Could not verify TOTP for ${label}: ${verified.error.message}`);
  }
  return account;
}

export async function expireTrial(supplier: TestAccount): Promise<void> {
  const { error } = await adminClient
    .from('subscriptions')
    .update({ trial_ends_at: new Date(Date.now() - 86_400_000).toISOString() })
    .eq('supplier_id', supplier.userId);
  assert.equal(error, null, 'expire trial');
}

export function fileOf(content: string, contentType = 'application/pdf'): Blob {
  return new Blob([content], { type: contentType });
}

export async function waitUntilPast(moment: Date, extraSeconds = 2): Promise<void> {
  const remaining = moment.getTime() - Date.now() + extraSeconds * 1000;
  if (remaining > 0) {
    await sleep(remaining);
  }
}

export { sleep };
