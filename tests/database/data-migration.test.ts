// Production has real rows. This seeds data in the baseline schema, applies every Stage 1
// migration, and checks that each row is carried over as intended.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { applyMigration, createDatabase, listMigrations, runAs, user } from './harness.ts';

const baselineMigrations = ['20261005025300_remote_schema.sql', '20261005031017_revoke_writes_on_public_name_views.sql'];

let database: PGlite;
const businessId = randomUUID();
const trialSupplierId = randomUUID();
const paidSupplierId = randomUUID();
const futureTenderId = randomUUID();
const pastTenderId = randomUUID();
const cancelledTenderId = randomUUID();
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

before(async () => {
  database = await createDatabase(baselineMigrations);

  await signUp(businessId, 'business', 'Existing Business Ltd');
  await signUp(trialSupplierId, 'supplier', 'Trial Supplier Ltd');
  await signUp(paidSupplierId, 'supplier', 'Paid Supplier Ltd');
  await database.query(
    `update public.supplier_profiles
     set subscription_status = 'active', subscription_ends_at = '2027-01-31T00:00:00Z', subscription_plan = 'retired-plan'
     where user_id = $1`,
    [paidSupplierId],
  );

  // Rows written while the old CHECK held can have dates that have since passed; the CHECK only
  // runs on writes, so it is set aside to create one.
  await database.exec(`alter table public.tenders drop constraint tenders_closing_date_check`);
  await database.query(
    `insert into public.tenders (id, business_id, title, description, closing_date, status, updated_at) values
       ($1, $4, 'Future tender', 'x', '2099-10-10', 'open', now()),
       ($2, $4, 'Past tender', 'x', '2026-09-01', 'open', now()),
       ($3, $4, 'Cancelled tender', 'x', '2026-09-15', 'cancelled', '2026-09-10T12:00:00Z')`,
    [futureTenderId, pastTenderId, cancelledTenderId, businessId],
  );
  await database.exec(`alter table public.tenders add constraint tenders_closing_date_check check (closing_date >= current_date) not valid`);

  for (const [tenderId, documentPath] of [
    [futureTenderId, futureBidPath],
    [pastTenderId, pastBidPath],
  ] as const) {
    await database.query(`insert into storage.objects (bucket_id, name, owner, owner_id) values ('bid-documents', $1, $2, $3)`, [
      documentPath,
      trialSupplierId,
      trialSupplierId,
    ]);
    await database.query(
      `insert into public.bids (tender_id, supplier_id, amount, document_path, document_name) values ($1, $2, 500, $3, 'proposal.pdf')`,
      [tenderId, trialSupplierId, documentPath],
    );
  }

  for (const migration of listMigrations().filter((fileName) => !baselineMigrations.includes(fileName))) {
    await applyMigration(database, migration);
  }
});

test('A closing date becomes midnight Jamaica time at the end of that day', async () => {
  const result = await database.query<{ closes_at: Date }>(`select closes_at from public.tenders where id = $1`, [futureTenderId]);
  assert.equal(result.rows[0]?.closes_at.toISOString(), '2099-10-11T05:00:00.000Z');
});

test('An open tender whose deadline has passed is closed by the migration', async () => {
  const result = await database.query<{ status: string; closes_at: Date; closed_at: Date }>(
    `select status, closes_at, closed_at from public.tenders where id = $1`,
    [pastTenderId],
  );
  const row = result.rows[0];
  assert.equal(row?.status, 'closed');
  assert.equal(row?.closed_at.toISOString(), row?.closes_at.toISOString());
});

test('Existing tenders count as published, and cancelled ones keep a cancellation time', async () => {
  const result = await database.query<{ id: string; published_at: Date | null; cancelled_at: Date | null; closed_at: Date | null }>(
    `select id, published_at, cancelled_at, closed_at from public.tenders where business_id = $1`,
    [businessId],
  );
  for (const row of result.rows) {
    assert.ok(row.published_at, `${row.id} published_at`);
  }
  // The cancellation time is the last update before the migration, not the migration itself.
  assert.equal(result.rows.find((row) => row.id === cancelledTenderId)?.cancelled_at?.toISOString(), '2026-09-10T12:00:00.000Z');
  // Cancelled before its deadline, so its bids were never opened and stay sealed.
  assert.equal(result.rows.find((row) => row.id === cancelledTenderId)?.closed_at, null);
});

test('A running trial is carried over unchanged', async () => {
  const result = await database.query<{ status: string; trial_ends_at: Date }>(
    `select subscription.status, subscription.trial_ends_at from public.subscriptions subscription where supplier_id = $1`,
    [trialSupplierId],
  );
  assert.equal(result.rows[0]?.status, 'trialing');
  const daysLeft = ((result.rows[0]?.trial_ends_at.getTime() ?? 0) - Date.now()) / 86_400_000;
  assert.ok(daysLeft > 13 && daysLeft <= 14, `trial days left: ${daysLeft}`);
});

test('An active subscription is carried over; an unknown plan code is dropped rather than failing', async () => {
  const result = await database.query<{ status: string; current_period_ends_at: Date; plan_code: string | null }>(
    `select status, current_period_ends_at, plan_code from public.subscriptions where supplier_id = $1`,
    [paidSupplierId],
  );
  assert.equal(result.rows[0]?.status, 'active');
  assert.equal(result.rows[0]?.current_period_ends_at.toISOString(), '2027-01-31T00:00:00.000Z');
  assert.equal(result.rows[0]?.plan_code, null);
});

test('Company names are carried over for every business and supplier', async () => {
  const result = await database.query<{ company_name: string }>(`select company_name from public.company_names order by company_name`);
  assert.deepEqual(
    result.rows.map((row) => row.company_name),
    ['Existing Business Ltd', 'Paid Supplier Ltd', 'Trial Supplier Ltd'],
  );
});

test('Existing bids survive: sealed on the running tender, readable on the closed one', async () => {
  const totalBids = await database.query<{ bid_count: number }>(`select count(*)::integer as bid_count from public.bids`);
  assert.equal(totalBids.rows[0]?.bid_count, 2);
  const visibleToBusiness = await runAs<{ tender_id: string }>(database, user(businessId), `select tender_id from public.bids`);
  assert.equal(visibleToBusiness.error, null);
  assert.deepEqual(visibleToBusiness.rows.map((row) => row.tender_id), [pastTenderId]);
});
