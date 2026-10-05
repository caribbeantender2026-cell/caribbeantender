// A local stand-in for a Supabase database, so policy rules can be tested in seconds.
// It reproduces what the policies depend on: the anon, authenticated and service_role roles,
// auth.uid() reading the request's JWT claims (Supabase's own definition), and the storage
// tables and helpers. It does not reproduce PostgREST or the Storage API; the staging suite
// in tests/staging covers those.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

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
    created_at timestamptz not null default now()
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
    // The emulation above stands in for pg_cron, which PGlite cannot load.
    .replace(/create extension if not exists pg_cron[^;]*;/i, '');
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

export type Actor =
  | { kind: 'anonymous' }
  | { kind: 'user'; userId: string }
  | { kind: 'service' };

export const anonymous: Actor = { kind: 'anonymous' };
export const service: Actor = { kind: 'service' };
export function user(userId: string): Actor {
  return { kind: 'user', userId };
}

export type QueryOutcome<Row> = { rows: Row[]; affectedRows: number; error: null } | { rows: []; affectedRows: 0; error: Error };

// Runs one statement exactly as an API request would: as the request's database role, with its
// JWT claims set for the transaction only. Errors are returned, not thrown, so tests can assert on them.
export async function runAs<Row = Record<string, unknown>>(
  database: PGlite,
  actor: Actor,
  statement: string,
  parameters: unknown[] = [],
): Promise<QueryOutcome<Row>> {
  const roleName = actor.kind === 'anonymous' ? 'anon' : actor.kind === 'service' ? 'service_role' : 'authenticated';
  const claims = actor.kind === 'user' ? { sub: actor.userId, role: roleName } : { role: roleName };
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

// Fixtures are written as the database owner. "Replica" mode skips triggers, so a fixture can
// describe states the rules would never let a user create directly, such as a bid on a tender
// that has already closed.
async function writeFixture(database: PGlite, statement: string, parameters: unknown[]): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.exec(`set local session_replication_role = replica`);
    await transaction.query(statement, parameters);
  });
}

async function columnExists(database: PGlite, tableName: string, columnName: string): Promise<boolean> {
  const result = await database.query(
    `select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2`,
    [tableName, columnName],
  );
  return result.rows.length > 0;
}

export type AccountType = 'business' | 'supplier';

// Creates a user the way sign-up does: an auth.users row whose metadata the signup trigger reads.
export async function createUser(
  database: PGlite,
  options: { accountType: AccountType; fullName?: string; companyName?: string },
): Promise<string> {
  const userId = randomUUID();
  await database.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    userId,
    `${userId}@example.test`,
    JSON.stringify({ full_name: options.fullName ?? 'Test Person', account_type: options.accountType }),
  ]);
  const profileTable = options.accountType === 'business' ? 'business_profiles' : 'supplier_profiles';
  await database.query(`update public.${profileTable} set company_name = $2 where user_id = $1`, [
    userId,
    options.companyName ?? `Company ${userId.slice(0, 8)}`,
  ]);
  return userId;
}

export type TenderPhase = 'draft' | 'accepting-bids' | 'past-deadline';

// Creates a tender in the requested phase, using whichever deadline column the schema has
// (closing_date before the closes_at migration, closes_at after it).
export async function createTender(database: PGlite, businessId: string, phase: TenderPhase): Promise<string> {
  const tenderId = randomUUID();
  if (await columnExists(database, 'tenders', 'closes_at')) {
    const closesAt = phase === 'past-deadline' ? `now() - interval '1 hour'` : `now() + interval '7 days'`;
    const status = phase === 'draft' ? 'draft' : 'open';
    await writeFixture(
      database,
      `insert into public.tenders (id, business_id, title, description, closes_at, status)
       values ($1, $2, 'Test tender', 'Test description', ${closesAt}, '${status}')`,
      [tenderId, businessId],
    );
  } else {
    // The old closing_date CHECK forbids past dates, so before closes_at exists a "past deadline"
    // tender can only be one that closes today.
    await writeFixture(
      database,
      `insert into public.tenders (id, business_id, title, description, closing_date, status)
       values ($1, $2, 'Test tender', 'Test description', current_date + ${phase === 'past-deadline' ? 0 : 7}, 'open')`,
      [tenderId, businessId],
    );
  }
  return tenderId;
}

export async function createStoredFile(database: PGlite, bucket: string, ownerId: string, fileName = 'proposal.pdf'): Promise<string> {
  const objectName = `${ownerId}/${randomUUID()}-${fileName}`;
  await writeFixture(database, `insert into storage.objects (bucket_id, name, owner, owner_id) values ($1, $2, $3, $4)`, [
    bucket,
    objectName,
    ownerId,
    ownerId,
  ]);
  return objectName;
}

export async function createBid(database: PGlite, tenderId: string, supplierId: string, amount = 1000): Promise<{ bidId: string; documentPath: string }> {
  const bidId = randomUUID();
  const documentPath = await createStoredFile(database, 'bid-documents', supplierId);
  await writeFixture(
    database,
    `insert into public.bids (id, tender_id, supplier_id, amount, document_path, document_name)
     values ($1, $2, $3, $4, $5, 'proposal.pdf')`,
    [bidId, tenderId, supplierId, amount, documentPath],
  );
  return { bidId, documentPath };
}

// Puts a tender into a state directly, bypassing the lifecycle rules, for setting up a scenario.
export async function setTenderState(
  database: PGlite,
  tenderId: string,
  state: { status: string; cancelledBeforeDeadline?: boolean },
): Promise<void> {
  const cancelledAt = state.cancelledBeforeDeadline ? `, cancelled_at = closes_at - interval '1 hour'` : '';
  await writeFixture(database, `update public.tenders set status = $2 ${cancelledAt} where id = $1`, [tenderId, state.status]);
}

export async function attachTenderDocument(database: PGlite, tenderId: string, documentPath: string): Promise<void> {
  await writeFixture(database, `update public.tenders set document_path = $2, document_name = 'specification.pdf' where id = $1`, [tenderId, documentPath]);
}

// Gives an existing user a second account type, as the "Create Supplier Account" button does.
export async function addSupplierProfile(database: PGlite, userId: string): Promise<void> {
  await database.query(`insert into public.supplier_profiles (user_id, company_name) values ($1, $2)`, [userId, `Supplier ${userId.slice(0, 8)}`]);
}

// Sets a supplier's trial or subscription state, in whichever schema is present.
export async function setSupplierAccess(database: PGlite, supplierId: string, access: 'active-trial' | 'expired'): Promise<void> {
  const trialEnd = access === 'active-trial' ? `now() + interval '7 days'` : `now() - interval '1 day'`;
  if (await columnExists(database, 'subscriptions', 'supplier_id')) {
    await writeFixture(database, `update public.subscriptions set status = 'trialing', trial_ends_at = ${trialEnd} where supplier_id = $1`, [supplierId]);
  } else {
    await writeFixture(database, `update public.supplier_profiles set subscription_status = 'trial', trial_ends_at = ${trialEnd} where user_id = $1`, [supplierId]);
  }
}
