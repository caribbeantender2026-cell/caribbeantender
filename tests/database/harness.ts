// A local stand-in for a Supabase database, so policy rules can be tested in seconds.
// It reproduces what the policies depend on: the anon, authenticated and service_role roles,
// auth.uid() reading the request's JWT claims (Supabase's own definition), and the storage
// tables and helpers. It does not reproduce PostgREST, the Storage API or real pg_cron; the
// real-stack suite in tests/rls covers those, against the local Supabase stack and staging.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { requiredAnswers, type FormField } from '../formAnswers.ts';

const migrationsDirectory = new URL('../../supabase/migrations/', import.meta.url);

export function listMigrations(): string[] {
  return readdirSync(migrationsDirectory).filter((fileName) => fileName.endsWith('.sql')).sort();
}

const supabaseEmulation = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema extensions;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}',
    raw_app_meta_data jsonb not null default '{}',
    created_at timestamptz not null default now(),
    banned_until timestamptz,
    last_sign_in_at timestamptz
  );
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
    )::text
  $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  grant usage on schema auth to anon, authenticated, service_role;

  create schema storage;
  create table storage.buckets (
    id text primary key,
    name text not null,
    owner uuid,
    owner_id text,
    public boolean default false,
    avif_autodetection boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[],
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text,
    owner uuid,
    owner_id text,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    last_accessed_at timestamptz default now(),
    metadata jsonb,
    path_tokens text[] generated always as (string_to_array(name, '/')) stored,
    version text,
    user_metadata jsonb,
    unique (bucket_id, name)
  );
  alter table storage.buckets enable row level security;
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
  declare
    parts text[];
  begin
    select string_to_array(name, '/') into parts;
    return parts[1:array_length(parts, 1) - 1];
  end
  $$;
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on storage.buckets, storage.objects to anon, authenticated, service_role;

  -- Supabase's default privileges, as read from the live project: every new table, function and
  -- sequence that postgres creates in public is granted to the API roles.
  alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;

  -- pg_cron is not available here; this keeps cron.schedule() callable and records the jobs.
  create schema cron;
  create table cron.job (
    jobid bigint generated always as identity primary key,
    jobname text unique,
    schedule text not null,
    command text not null,
    active boolean not null default true
  );
  create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
    insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
    on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
    returning jobid
  $$;
`;

export async function applyMigration(database: PGlite, fileName: string): Promise<void> {
  const migrationSql = readFileSync(new URL(fileName, migrationsDirectory), 'utf8')
    // The emulation above stands in for pg_cron; pg_net is only called inside cron job text. PGlite can load neither.
    .replace(/create extension if not exists (pg_cron|pg_net)[^;]*;/gi, '');
  await database.exec(migrationSql);
}

export async function createDatabase(migrations: string[] = listMigrations()): Promise<PGlite> {
  const database = await PGlite.create();
  await database.exec(supabaseEmulation);
  for (const migration of migrations) {
    await applyMigration(database, migration);
  }
  return database;
}

/** Who a statement runs as: a visitor, a signed-in user (optionally with two-factor sign-in), or the service role. */
export type Actor =
  | { kind: 'anonymous' }
  | { kind: 'user'; userId: string; assuranceLevel: 'aal1' | 'aal2' }
  | { kind: 'service' };

export const anonymous: Actor = { kind: 'anonymous' };
export const service: Actor = { kind: 'service' };

/** A signed-in user. Pass 'aal2' for a session verified with an authenticator app (admins need it). */
export function user(userId: string, assuranceLevel: 'aal1' | 'aal2' = 'aal1'): Actor {
  return { kind: 'user', userId, assuranceLevel };
}

export type QueryOutcome<Row> = { rows: Row[]; affectedRows: number; error: null } | { rows: []; affectedRows: 0; error: Error };

/**
 * Runs one statement exactly as an API request would: as the request's database role, with its
 * JWT claims set for the transaction only. Errors are returned, not thrown, so tests can assert on them.
 */
export async function runAs<Row = Record<string, unknown>>(
  database: PGlite,
  actor: Actor,
  statement: string,
  parameters: unknown[] = [],
): Promise<QueryOutcome<Row>> {
  const roleName = actor.kind === 'anonymous' ? 'anon' : actor.kind === 'service' ? 'service_role' : 'authenticated';
  const claims = actor.kind === 'user' ? { sub: actor.userId, role: roleName, aal: actor.assuranceLevel } : { role: roleName };
  try {
    return await database.transaction(async (transaction) => {
      await transaction.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
      await transaction.exec(`set local role ${roleName}`);
      const result = await transaction.query<Row>(statement, parameters);
      return { rows: result.rows, affectedRows: result.affectedRows ?? 0, error: null };
    });
  } catch (error) {
    return { rows: [], affectedRows: 0, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/**
 * Writes a fixture as the database owner. "Replica" mode skips triggers, so a fixture can describe
 * states the rules would never let a user create directly, such as a bid on a tender that has closed.
 */
export async function writeFixture(database: PGlite, statement: string, parameters: unknown[] = []): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.exec(`set local session_replication_role = replica`);
    await transaction.query(statement, parameters);
  });
}

/** Whether a column exists, so fixtures work on the schema before and after each migration. */
export async function columnExists(database: PGlite, tableName: string, columnName: string): Promise<boolean> {
  const result = await database.query(
    `select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [tableName, columnName],
  );
  return result.rows.length > 0;
}

/** Whether a function exists in the public schema (the new remote procedures). */
export async function functionExists(database: PGlite, functionName: string): Promise<boolean> {
  const result = await database.query(
    `select 1 from pg_proc function_row join pg_namespace namespace on namespace.oid = function_row.pronamespace
     where namespace.nspname = 'public' and function_row.proname = $1`,
    [functionName],
  );
  return result.rows.length > 0;
}

export type AccountType = 'business' | 'supplier';

/** Creates a user the way sign-up does: an auth.users row whose metadata the signup trigger reads. */
export async function createUser(
  database: PGlite,
  // A business is registered unless isRegistered is false: posting tenders needs it (Rockell, 22 Nov 2026).
  options: { accountType: AccountType; fullName?: string; companyName?: string; isRegistered?: boolean },
): Promise<string> {
  const userId = randomUUID();
  await database.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    userId,
    `${userId}@example.test`,
    JSON.stringify({ full_name: options.fullName ?? 'Test Person', account_type: options.accountType, accepted_terms: true }),
  ]);
  const profileTable = options.accountType === 'business' ? 'business_profiles' : 'supplier_profiles';
  await database.query(`update public.${profileTable} set company_name = $2 where user_id = $1`, [
    userId,
    options.companyName ?? `Company ${userId.slice(0, 8)}`,
  ]);
  if (options.accountType === 'business' && options.isRegistered !== false) {
    await registerBusiness(database, userId);
  }
  return userId;
}

/** Saves a complete Business Registration Form for a business. Schemas from before the client's forms have none to fill. */
export async function registerBusiness(database: PGlite, businessId: string): Promise<void> {
  const hasForms = await database.query<{ present: boolean }>(`select to_regclass('public.form_definitions') is not null as present`);
  if (!hasForms.rows[0]?.present) {
    return;
  }
  const definition = await database.query<{ version: number; schema: { fields: FormField[] } }>(
    `select version, schema from public.form_definitions where key = 'business-registration' order by version desc limit 1`,
  );
  const registrationForm = definition.rows[0];
  if (!registrationForm) {
    return;
  }
  await writeFixture(
    database,
    `insert into public.form_submissions (owner_id, form_key, form_version, data) values ($1, 'business-registration', $2, $3)`,
    [businessId, registrationForm.version, JSON.stringify(requiredAnswers(registrationForm.schema.fields))],
  );
}

/** Gives an existing user a second account type, as the "Create Supplier Account" button does. */
export async function addSupplierProfile(database: PGlite, userId: string): Promise<void> {
  await database.query(`insert into public.supplier_profiles (user_id, company_name) values ($1, $2)`, [userId, `Supplier ${userId.slice(0, 8)}`]);
}

/** Makes a user platform staff (an admin by default). */
export async function makeStaff(database: PGlite, userId: string, role: 'owner' | 'admin' | 'support' = 'admin'): Promise<void> {
  await database.query(`insert into public.staff_members (user_id, role) values ($1, $2)`, [userId, role]);
}

/** Sets a supplier's trial state, in whichever schema is present. */
export async function setSupplierAccess(database: PGlite, supplierId: string, access: 'active-trial' | 'expired'): Promise<void> {
  const trialEnd = access === 'active-trial' ? `now() + interval '7 days'` : `now() - interval '1 day'`;
  if (await columnExists(database, 'subscriptions', 'supplier_id')) {
    await writeFixture(database, `update public.subscriptions set status = 'trial', trial_ends_at = ${trialEnd} where supplier_id = $1`, [supplierId]);
  } else {
    await writeFixture(database, `update public.supplier_profiles set subscription_status = 'trial', trial_ends_at = ${trialEnd} where user_id = $1`, [supplierId]);
  }
}

/** The id of the first category on offer (the client's list once it exists), or null before categories exist. */
export async function firstCategoryId(database: PGlite): Promise<number | null> {
  const exists = await database.query<{ present: boolean }>(`select to_regclass('public.categories') is not null as present`);
  if (!exists.rows[0]?.present) {
    return null;
  }
  const result = await database.query<{ id: number }>(`select id from public.categories order by is_active desc, sort_order limit 1`);
  return result.rows[0]?.id ?? null;
}

/**
 * Where a tender stands:
 *   'draft'           not published
 *   'accepting-bids'  open, closing in a week
 *   'past-deadline'   still open, but its closing time has passed (the scheduled job hasn't run)
 *   'closed'          closed after its closing time
 */
export type TenderPhase = 'draft' | 'accepting-bids' | 'past-deadline' | 'closed';

const millisecondsPerHour = 3_600_000;
const millisecondsPerDay = 86_400_000;

/** Creates a tender in the requested phase, in whichever schema is present. */
export async function createTender(database: PGlite, businessId: string, phase: TenderPhase): Promise<string> {
  const tenderId = randomUUID();
  const deadlinePassed = phase === 'past-deadline' || phase === 'closed';
  if (!(await columnExists(database, 'tenders', 'closes_at'))) {
    // The old closing_date CHECK forbids past dates, so before closes_at exists a "past deadline"
    // tender can only be one that closes today.
    await writeFixture(
      database,
      `insert into public.tenders (id, business_id, title, description, closing_date, status)
       values ($1, $2, 'Test tender', 'Test description', current_date + ${deadlinePassed ? 0 : 7}, $3)`,
      [tenderId, businessId, phase === 'closed' ? 'closed' : 'open'],
    );
    return tenderId;
  }
  const hasLifecycle = await columnExists(database, 'tenders', 'published_at');
  const draftStatus = await database.query(
    `select 1 from pg_enum value join pg_type type on type.oid = value.enumtypid where type.typname = 'tender_status' and value.enumlabel = 'draft'`,
  );
  const categoryId = await firstCategoryId(database);
  const status = phase === 'draft' && draftStatus.rows.length > 0 ? 'draft' : phase === 'closed' ? 'closed' : 'open';
  const closesAt = deadlinePassed ? new Date(Date.now() - millisecondsPerHour) : new Date(Date.now() + 7 * millisecondsPerDay);
  const columns = ['id', 'business_id', 'title', 'description', 'closes_at', 'status'];
  const values: unknown[] = [tenderId, businessId, 'Test tender', 'Test description', closesAt, status];
  if (categoryId !== null) {
    columns.push('category_id');
    values.push(categoryId);
  }
  if (hasLifecycle && status !== 'draft') {
    columns.push('published_at');
    values.push(new Date(Date.now() - 2 * millisecondsPerDay));
  }
  if (hasLifecycle && status === 'closed') {
    columns.push('closed_at');
    values.push(new Date(Date.now() - millisecondsPerHour / 2));
  }
  const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
  await writeFixture(database, `insert into public.tenders (${columns.join(', ')}) values (${placeholders})`, values);
  return tenderId;
}

/** Puts a tender into a state directly, bypassing the lifecycle rules, to set up a scenario. */
export async function setTenderState(
  database: PGlite,
  tenderId: string,
  state: { status: string; cancelledBeforeDeadline?: boolean },
): Promise<void> {
  const hasLifecycle = await columnExists(database, 'tenders', 'cancelled_at');
  const assignments = [`status = $2`];
  if (hasLifecycle && state.status === 'cancelled') {
    assignments.push(`cancelled_reason = 'Test cancellation'`);
    assignments.push(state.cancelledBeforeDeadline ? `cancelled_at = closes_at - interval '1 hour'` : `cancelled_at = now()`);
  }
  await writeFixture(database, `update public.tenders set ${assignments.join(', ')} where id = $1`, [tenderId, state.status]);
}

/** Whether the storage migration (tender and bid folder scheme) has been applied. */
export async function usesNamespacedPaths(database: PGlite): Promise<boolean> {
  const result = await database.query(`select 1 from pg_proc where proname = 'is_own_unsubmitted_bid_folder'`);
  return result.rows.length > 0;
}

/** Puts a file into Storage as if the Storage API had accepted an upload from this owner. */
export async function createStoredFile(database: PGlite, bucket: string, objectName: string, ownerId: string): Promise<string> {
  await writeFixture(
    database,
    `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3, $4, $5)`,
    [bucket, objectName, ownerId, ownerId, JSON.stringify({ size: 2048, mimetype: 'application/pdf' })],
  );
  return objectName;
}

/** Creates a submitted bid directly, in whichever schema is present, with its proposal file. */
export async function createBid(
  database: PGlite,
  tenderId: string,
  supplierId: string,
  amount = 1000,
): Promise<{ bidId: string; documentPath: string; documentId: string | null }> {
  const bidId = randomUUID();
  const hasDocumentTables = await columnExists(database, 'bid_documents', 'bid_id');
  // Until the storage migration, files live in the uploader's own folder, as on the legacy site.
  const documentPath = (await usesNamespacedPaths(database))
    ? `${tenderId}/${bidId}/proposal/proposal.pdf`
    : `${supplierId}/${randomUUID()}-proposal.pdf`;
  await createStoredFile(database, 'bid-documents', documentPath, supplierId);

  const columns = ['id', 'tender_id', 'supplier_id', 'amount'];
  const values: unknown[] = [bidId, tenderId, supplierId, amount];
  if (!hasDocumentTables) {
    columns.push('document_path', 'document_name');
    values.push(documentPath, 'proposal.pdf');
  }
  if (await columnExists(database, 'bids', 'submitted_at')) {
    columns.push('submitted_at');
    values.push(new Date(Date.now() - 2 * millisecondsPerHour));
  }
  const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
  await writeFixture(database, `insert into public.bids (${columns.join(', ')}) values (${placeholders})`, values);

  let documentId: string | null = null;
  if (hasDocumentTables) {
    documentId = randomUUID();
    await writeFixture(
      database,
      `insert into public.bid_documents (id, bid_id, storage_path, file_name, mime_type, size_bytes, document_role, uploaded_at)
       values ($1, $2, $3, 'proposal.pdf', 'application/pdf', 2048, 'proposal', now())`,
      [documentId, bidId, documentPath],
    );
  }
  return { bidId, documentPath, documentId };
}

/** Records a published tender's document directly, in whichever schema is present. */
export async function createTenderDocument(
  database: PGlite,
  tenderId: string,
  businessId: string,
): Promise<{ documentPath: string; documentId: string | null }> {
  if (await columnExists(database, 'tender_documents', 'tender_id')) {
    const objectName = (await usesNamespacedPaths(database)) ? `${tenderId}/specification.pdf` : `${businessId}/${randomUUID()}-specification.pdf`;
    const documentPath = await createStoredFile(database, 'tender-documents', objectName, businessId);
    const documentId = randomUUID();
    await writeFixture(
      database,
      `insert into public.tender_documents (id, tender_id, storage_path, file_name, mime_type, size_bytes, document_role, uploaded_at)
       values ($1, $2, $3, 'specification.pdf', 'application/pdf', 2048, 'supporting', now())`,
      [documentId, tenderId, documentPath],
    );
    return { documentPath, documentId };
  }
  const documentPath = await createStoredFile(database, 'tender-documents', `${businessId}/${randomUUID()}-specification.pdf`, businessId);
  await writeFixture(database, `update public.tenders set document_path = $2, document_name = 'specification.pdf' where id = $1`, [tenderId, documentPath]);
  return { documentPath, documentId: null };
}

/** The complete draft requirements form, as a business would fill it in. */
export const completeRequirementsForm = {
  need_summary: 'Twenty ergonomic office chairs',
  scope_of_work: 'Supply and deliver',
  quantities_or_specifications: '20 chairs, adjustable height',
  delivery_location: 'Kingston',
  required_timeline: 'Within 30 days',
  contact_person: 'Test Person',
};

/** The complete draft proposal form, as a supplier would fill it in. */
export const completeProposalForm = {
  deliverables: 'Twenty chairs',
  delivery_timeline: '2 weeks',
  cost_breakdown: [{ item: 'Chair', quantity: 20, unit_cost: 15000, labour: 5000 }],
  offer_validity_period: '60 days',
};

