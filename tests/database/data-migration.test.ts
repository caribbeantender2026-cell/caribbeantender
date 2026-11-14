// Production has real rows. This seeds data shaped like production's in the baseline schema,
// applies every migration after it, and checks each row is carried over by the PRD's rules
// (section 7, "Rules for migrating existing data").
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { applyMigration, createDatabase, listMigrations, runAs, user } from './harness.ts';

const baselineMigrations = ['20261005025300_remote_schema.sql', '20261005031017_revoke_writes_on_public_name_views.sql'];
const millisecondsPerDay = 86_400_000;

let database: PGlite;
const businessId = randomUUID();
const trialSupplierId = randomUUID();
const paidSupplierId = randomUUID();
const futureTenderId = randomUUID();
const pastTenderId = randomUUID();
const cancelledTenderId = randomUUID();
const tenderDocumentPath = `${businessId}/old-specification.pdf`;
const futureBidPath = `${trialSupplierId}/future-proposal.pdf`;
const pastBidPath = `${trialSupplierId}/past-proposal.pdf`;

async function signUp(userId: string, accountType: string, companyName: string): Promise<void> {
  await database.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    userId,
    `${userId}@example.test`,
    JSON.stringify({ full_name: 'Existing Person', account_type: accountType }),
  ]);
  const profileTable = accountType === 'business' ? 'business_profiles' : 'supplier_profiles';
  await database.query(`update public.${profileTable} set company_name = $2 where user_id = $1`, [userId, companyName]);
}

async function storeLegacyFile(bucket: string, name: string, ownerId: string): Promise<void> {
  await database.query(`insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3, $4, $5)`, [
    bucket,
    name,
    ownerId,
    ownerId,
    JSON.stringify({ size: 4096, mimetype: 'application/pdf' }),
  ]);
}

before(async () => {
  database = await createDatabase(baselineMigrations);

  await signUp(businessId, 'business', 'Existing Business Ltd');
  await signUp(trialSupplierId, 'supplier', 'Trial Supplier Ltd');
  await signUp(paidSupplierId, 'supplier', 'Paid Supplier Ltd');
  await database.query(`update public.supplier_profiles set industry_category = 'Works' where user_id = $1`, [trialSupplierId]);
  await database.query(
    `update public.supplier_profiles
     set subscription_status = 'active', subscription_ends_at = '2027-01-31T00:00:00Z', subscription_plan = 'retired-plan',
         payment_customer_id = 'customer-123'
     where user_id = $1`,
    [paidSupplierId],
  );

  // Rows written while the old CHECK held can have dates that have since passed; the CHECK only
  // runs on writes, so it is set aside to create them.
  await database.exec(`alter table public.tenders drop constraint tenders_closing_date_check`);
  await storeLegacyFile('tender-documents', tenderDocumentPath, businessId);
  await database.query(
    `insert into public.tenders (id, business_id, title, description, closing_date, status, updated_at, document_path, document_name) values
       ($1, $4, 'Future tender', 'x', '2099-10-10', 'open', now(), $5, 'Specification.pdf'),
       ($2, $4, 'Past tender', 'x', '2026-09-01', 'open', now(), null, null),
       ($3, $4, 'Cancelled tender', 'x', '2026-09-15', 'cancelled', '2026-09-10T12:00:00Z', null, null)`,
    [futureTenderId, pastTenderId, cancelledTenderId, businessId, tenderDocumentPath],
  );
  await database.exec(`alter table public.tenders add constraint tenders_closing_date_check check (closing_date >= current_date) not valid`);

  for (const [tenderId, documentPath] of [
    [futureTenderId, futureBidPath],
    [pastTenderId, pastBidPath],
  ] as const) {
    await storeLegacyFile('bid-documents', documentPath, trialSupplierId);
    await database.query(
      `insert into public.bids (tender_id, supplier_id, amount, document_path, document_name) values ($1, $2, 500, $3, 'proposal.pdf')`,
      [tenderId, trialSupplierId, documentPath],
    );
  }

  for (const migration of listMigrations().filter((fileName) => !baselineMigrations.includes(fileName))) {
    await applyMigration(database, migration);
  }
});

test('A6: a closing date becomes 23:59:59 Jamaica time on that date', async () => {
  const result = await database.query<{ closes_at: Date }>(`select closes_at from public.tenders where id = $1`, [futureTenderId]);
  assert.equal(result.rows[0]?.closes_at.toISOString(), '2099-10-11T04:59:59.000Z');
});

test('An open tender whose closing time has passed gets the status closed', async () => {
  const result = await database.query<{ status: string; closes_at: Date; closed_at: Date }>(
    `select status::text as status, closes_at, closed_at from public.tenders where id = $1`,
    [pastTenderId],
  );
  assert.equal(result.rows[0]?.status, 'closed');
  assert.equal(result.rows[0]?.closed_at.toISOString(), result.rows[0]?.closes_at.toISOString());
});

test('Existing tenders count as published; a cancelled one keeps its cancellation time and gets a recorded reason', async () => {
  const result = await database.query<{ id: string; published_at: Date | null; cancelled_at: Date | null; cancelled_reason: string | null }>(
    `select id, published_at, cancelled_at, cancelled_reason from public.tenders where business_id = $1`,
    [businessId],
  );
  for (const row of result.rows) {
    assert.ok(row.published_at, `${row.id} published_at`);
  }
  const cancelled = result.rows.find((row) => row.id === cancelledTenderId);
  // The last update before the migration, not the migration itself.
  assert.equal(cancelled?.cancelled_at?.toISOString(), '2026-09-10T12:00:00.000Z');
  assert.match(cancelled?.cancelled_reason ?? '', /previous version/);
});

test('A1: trial and subscription values are copied unchanged, including plan and payment ids', async () => {
  const trial = await database.query<{ status: string; trial_ends_at: Date }>(`select status::text as status, trial_ends_at from public.subscriptions where supplier_id = $1`, [trialSupplierId]);
  assert.equal(trial.rows[0]?.status, 'trial');
  const daysLeft = ((trial.rows[0]?.trial_ends_at.getTime() ?? 0) - Date.now()) / millisecondsPerDay;
  assert.ok(daysLeft > 13 && daysLeft <= 14, `trial days left: ${daysLeft}`);

  const paid = await database.query<{ status: string; current_period_end: Date; subscription_plan: string; payment_customer_id: string }>(
    `select status::text as status, current_period_end, subscription_plan, payment_customer_id from public.subscriptions where supplier_id = $1`,
    [paidSupplierId],
  );
  assert.equal(paid.rows[0]?.status, 'active');
  assert.equal(paid.rows[0]?.current_period_end.toISOString(), '2027-01-31T00:00:00.000Z');
  assert.equal(paid.rows[0]?.subscription_plan, 'retired-plan');
  assert.equal(paid.rows[0]?.payment_customer_id, 'customer-123');
});

test("Q5: a supplier's free-text category becomes its category id", async () => {
  const category = await database.query<{ name: string }>(
    `select category.name from public.supplier_profiles supplier join public.categories category on category.id = supplier.category_id where supplier.user_id = $1`,
    [trialSupplierId],
  );
  assert.deepEqual(category.rows, [{ name: 'Works' }]);
});

test('Company names are carried over for every business and supplier', async () => {
  const result = await database.query<{ company_name: string }>(`select company_name from public.company_names order by company_name`);
  assert.deepEqual(result.rows.map((row) => row.company_name), ['Existing Business Ltd', 'Paid Supplier Ltd', 'Trial Supplier Ltd']);
});

test('Existing documents become document rows and keep their files and paths', async () => {
  const tenderDocuments = await database.query<{ storage_path: string; file_name: string; size_bytes: string }>(
    `select storage_path, file_name, size_bytes from public.tender_documents where tender_id = $1`,
    [futureTenderId],
  );
  assert.deepEqual(tenderDocuments.rows.map((row) => [row.storage_path, row.file_name, Number(row.size_bytes)]), [[tenderDocumentPath, 'Specification.pdf', 4096]]);
  const bidDocuments = await database.query<{ storage_path: string; document_role: string }>(
    `select storage_path, document_role::text as document_role from public.bid_documents order by storage_path`,
  );
  assert.deepEqual(bidDocuments.rows.map((row) => [row.storage_path, row.document_role]), [
    [futureBidPath, 'proposal'],
    [pastBidPath, 'proposal'],
  ]);
});

test('Existing bids survive with a submission time; the closed tender opens, the running one stays sealed', async () => {
  const bids = await database.query<{ total: number; without_time: number }>(
    `select count(*)::integer as total, count(*) filter (where submitted_at is null)::integer as without_time from public.bids`,
  );
  assert.deepEqual(bids.rows[0], { total: 2, without_time: 0 });
  const opened = await runAs<{ bid_id: string }>(database, user(businessId), `select bid_id from public.read_tender_bids($1)`, [pastTenderId]);
  assert.equal(opened.error, null);
  assert.equal(opened.rows.length, 1);
  const sealed = await runAs(database, user(businessId), `select bid_id from public.read_tender_bids($1)`, [futureTenderId]);
  assert.match(sealed.error?.message ?? '', /sealed until/);
});

test('The migration stops, rather than guessing, when a subscription status is unknown', async () => {
  const strayDatabase = await createDatabase(baselineMigrations);
  const strayUserId = randomUUID();
  await strayDatabase.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, 'stray@example.test', '{"full_name": "Stray", "account_type": "supplier"}')`, [strayUserId]);
  await strayDatabase.query(`update public.supplier_profiles set subscription_status = 'canceled' where user_id = $1`, [strayUserId]);
  const migrationsBeforeSubscriptions = listMigrations().filter((fileName) => !baselineMigrations.includes(fileName) && fileName < '20261005040200');
  for (const migration of migrationsBeforeSubscriptions) {
    await applyMigration(strayDatabase, migration);
  }
  await assert.rejects(applyMigration(strayDatabase, '20261005040200_subscriptions.sql'), /canceled/);
  await strayDatabase.close();
});
