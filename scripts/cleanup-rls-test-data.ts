/**
 * Removes everything one RLS run created on the linked project: the rls-test-<run id> accounts and their
 * tenders, bids, documents, forms, files, audit entries and email log entries (OPEN_QUESTIONS.md, decision D1). Real data is
 * never touched: every row is selected through the run's test accounts.
 *
 * Bids and documents are write-once and the audit log is append-only, so their protecting triggers are
 * disabled for these deletes only, inside one transaction that re-enables them before it commits.
 *
 * Usage: node --env-file=.env.production.local scripts/cleanup-rls-test-data.ts <run id>
 */
import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { queryLinked } from './supabase-cli.ts';

const runIdentifier = process.argv[2] ?? '';
if (!/^\d{14}$/.test(runIdentifier)) {
  throw new Error('Give the 14-digit run id the RLS run printed, for example 20261113221500.');
}
const supabaseUrl = process.env.PRODUCTION_SUPABASE_URL ?? '';
const secretKey = process.env.PRODUCTION_SUPABASE_SECRET_KEY ?? '';
if (!supabaseUrl || !secretKey) {
  throw new Error('Set PRODUCTION_SUPABASE_URL and PRODUCTION_SUPABASE_SECRET_KEY (.env.production.local).');
}
// The lookups and deletes go through the CLI link, so it must be the project the test accounts were
// made in; another linked project would find none and report a clean run.
const linkFile = 'supabase/.temp/project-ref';
const linkedProjectRef = existsSync(linkFile) ? readFileSync(linkFile, 'utf8').trim() : '';
if (!linkedProjectRef || new URL(supabaseUrl).hostname.split('.')[0] !== linkedProjectRef) {
  throw new Error(`The Supabase CLI is linked to "${linkedProjectRef || 'no project'}", not the project in PRODUCTION_SUPABASE_URL. Run supabase link --project-ref <ref> first.`);
}
const adminClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A SQL uuid[] literal from ids that are checked to be UUIDs, so nothing else can reach the SQL. */
function uuidArray(ids: string[]): string {
  for (const id of ids) {
    if (!uuidPattern.test(id)) throw new Error(`Not a UUID: ${id}`);
  }
  return `array[${ids.map((id) => `'${id}'`).join(', ')}]::uuid[]`;
}

const emailPattern = `rls-test-${runIdentifier}-%@example.com`;
const testUsers = queryLinked<{ id: string; email: string }>(`select id, email from auth.users where email like '${emailPattern}'`);
if (testUsers.some((testUser) => !testUser.email.startsWith(`rls-test-${runIdentifier}-`))) {
  throw new Error('An account outside this run matched; stopping without deleting anything.');
}
const userIds = testUsers.map((testUser) => testUser.id);
console.log(`test accounts in run ${runIdentifier}: ${userIds.length}`);
if (userIds.length === 0) {
  process.exit(0);
}
const users = uuidArray(userIds);

const tenderIds = queryLinked<{ id: string }>(`select id from public.tenders where business_id = any(${users})`).map((row) => row.id);
const tenders = uuidArray(tenderIds);
const bidRows = queryLinked<{ id: string; supplier_id: string; tender_id: string }>(
  `select id, supplier_id, tender_id from public.bids where supplier_id = any(${users}) or tender_id = any(${tenders})`,
);
// A real supplier's bid on a test tender would be real data. It can't happen (test tenders are only
// visible during the run), but if it does, stop rather than delete it.
if (bidRows.some((bid) => !userIds.includes(bid.supplier_id))) {
  throw new Error('A bid from a non-test supplier is on a test tender; stopping without deleting anything.');
}
const bids = uuidArray(bidRows.map((bid) => bid.id));
const documentIds = queryLinked<{ id: string }>(
  `select id from public.tender_documents where tender_id = any(${tenders})
   union all select id from public.bid_documents where bid_id = any(${bids})`,
).map((row) => row.id);
const entities = uuidArray([...userIds, ...tenderIds, ...bidRows.map((bid) => bid.id), ...documentIds]);

// Files first, through the Storage API, so the stored objects go too.
const storedFiles = queryLinked<{ bucket_id: string; name: string }>(
  `select bucket_id, name from storage.objects where owner_id = any(${users}::text[])`,
);
for (const bucket of [...new Set(storedFiles.map((file) => file.bucket_id))]) {
  const paths = storedFiles.filter((file) => file.bucket_id === bucket).map((file) => file.name);
  const removed = await adminClient.storage.from(bucket).remove(paths);
  if (removed.error) throw new Error(`Could not remove files from ${bucket}: ${removed.error.message}`);
}
console.log(`files removed: ${storedFiles.length}`);

const protectedTriggers: Array<[string, string]> = [
  ['audit_log', 'audit_log_is_append_only'],
  ['bids', 'bids_are_immutable'],
  ['bid_documents', 'bid_documents_are_write_once'],
  ['tender_documents', 'tender_documents_are_write_once'],
  ['form_submissions', 'guard_form_submission'],
  ['form_submissions', 'check_form_tender'],
  ['tenders', 'enforce_tender_lifecycle'],
  ['tenders', 'log_tender_change'],
];
const disableTriggers = protectedTriggers.map(([table, trigger]) => `alter table public.${table} disable trigger ${trigger};`).join('\n');
const enableTriggers = protectedTriggers.map(([table, trigger]) => `alter table public.${table} enable trigger ${trigger};`).join('\n');
queryLinked(`
begin;
${disableTriggers}
delete from public.audit_log where actor_id = any(${users}) or entity_id = any(${entities});
-- Emails about test bids and tenders, including suppressed alerts to real suppliers in the category.
delete from public.email_log where recipient like '${emailPattern}' or entity_id = any(${entities});
delete from private.upload_history where owner_id = any(${users}::text[]);
delete from public.bid_documents where bid_id = any(${bids});
delete from public.tender_documents where tender_id = any(${tenders});
delete from public.form_submissions where owner_id = any(${users});
update public.tenders set status = 'cancelled', awarded_bid_id = null, cancelled_reason = 'Removed test data'
  where id = any(${tenders}) and awarded_bid_id is not null;
delete from public.bids where id = any(${bids});
delete from public.tenders where id = any(${tenders});
${enableTriggers}
commit;
`);
console.log(`rows removed: ${tenderIds.length} tenders, ${bidRows.length} bids, ${documentIds.length} documents, and their forms and audit entries`);

// Deleting the accounts removes their profiles, names, subscriptions, preferences, staff rows and MFA factors.
for (const userId of userIds) {
  const deleted = await adminClient.auth.admin.deleteUser(userId);
  if (deleted.error) throw new Error(`Could not delete test account ${userId}: ${deleted.error.message}`);
}

const leftovers = queryLinked<{ what: string; remaining: number }>(`
  select 'accounts' as what, count(*)::integer as remaining from auth.users where email like '${emailPattern}'
  union all select 'files', count(*)::integer from storage.objects where owner_id = any(${users}::text[])
  union all select 'tenders', count(*)::integer from public.tenders where id = any(${tenders})
  union all select 'bids', count(*)::integer from public.bids where id = any(${bids})
  union all select 'audit entries', count(*)::integer from public.audit_log where actor_id = any(${users}) or entity_id = any(${entities})
  union all select 'email log entries', count(*)::integer from public.email_log where recipient like '${emailPattern}' or entity_id = any(${entities})
  union all select 'protecting triggers disabled', count(*)::integer from pg_trigger where tgenabled = 'D' and tgname in (${protectedTriggers.map(([, trigger]) => `'${trigger}'`).join(', ')})
`);
console.log(`accounts deleted: ${userIds.length}`);
console.log(JSON.stringify(leftovers));
if (leftovers.some((row) => row.remaining !== 0)) {
  process.exitCode = 1;
}
