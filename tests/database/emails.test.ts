// Which emails are due (PRD P1-13): public.due_emails decides the recipients and timing; the
// send-notifications Edge Function only sends what it returns, through the allowlist and email_log.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import type { PGlite } from '@electric-sql/pglite';
import { createBid, createDatabase, createTender, createUser, runAs, service, user, writeFixture } from './harness.ts';

type DueEmail = { type: string; recipient: string; entity_id: string };

let database: PGlite;
let otherCategoryId: number;
const ids: Record<string, string> = {};

async function emailOf(userId: string): Promise<string> {
  return (await database.query<{ email: string }>(`select email from auth.users where id = $1`, [userId])).rows[0]?.email ?? '';
}

async function dueEmails(): Promise<DueEmail[]> {
  return (await database.query<DueEmail>(`select type, recipient, entity_id from public.due_emails(500)`)).rows;
}

function has(due: DueEmail[], type: string, recipient: string, entityId: string): boolean {
  return due.some((email) => email.type === type && email.recipient === recipient && email.entity_id === entityId);
}

before(async () => {
  database = await createDatabase();
  otherCategoryId = (await database.query<{ id: number }>(`select id from public.categories order by sort_order offset 1 limit 1`)).rows[0]?.id ?? 0;
  ids.business = await createUser(database, { accountType: 'business' });
  for (const label of ['matching', 'alertsOff', 'otherCategory', 'deactivated', 'bidder']) {
    ids[label] = await createUser(database, { accountType: 'supplier' });
  }
  // createTender files every tender under the first category; suppliers follow it unless told otherwise.
  await writeFixture(database, `update public.supplier_profiles set category_id = (select id from public.categories order by sort_order limit 1)`);
  await writeFixture(database, `update public.supplier_profiles set category_id = $2 where user_id = $1`, [ids.otherCategory, otherCategoryId]);
  await writeFixture(database, `insert into public.notification_preferences (user_id, tender_alerts) values ($1, false)`, [ids.alertsOff]);
  await writeFixture(database, `update public.profiles set is_active = false where id = $1`, [ids.deactivated]);

  ids.newTender = await createTender(database, ids.business, 'accepting-bids');
  await writeFixture(database, `update public.tenders set published_at = now() - interval '5 minutes' where id = $1`, [ids.newTender]);
  ids.oldTender = await createTender(database, ids.business, 'accepting-bids');
  await writeFixture(database, `update public.tenders set published_at = now() - interval '3 days' where id = $1`, [ids.oldTender]);

  ids.closingTender = await createTender(database, ids.business, 'accepting-bids');
  await writeFixture(database, `update public.tenders set published_at = now() - interval '3 days', closes_at = now() + interval '12 hours' where id = $1`, [ids.closingTender]);
  ids.shortTender = await createTender(database, ids.business, 'accepting-bids');
  await writeFixture(database, `update public.tenders set published_at = now() - interval '1 hour', closes_at = now() + interval '12 hours' where id = $1`, [ids.shortTender]);

  ids.freshBid = (await createBid(database, ids.closingTender ?? '', ids.bidder ?? '')).bidId;
  await writeFixture(database, `update public.bids set submitted_at = now() - interval '2 minutes' where id = $1`, [ids.freshBid]);
  ids.oldBid = (await createBid(database, ids.oldTender ?? '', ids.bidder ?? '')).bidId;
  await writeFixture(database, `update public.bids set submitted_at = now() - interval '2 days' where id = $1`, [ids.oldBid]);

  ids.justClosed = await createTender(database, ids.business, 'closed');
  ids.longClosed = await createTender(database, ids.business, 'closed');
  await writeFixture(database, `update public.tenders set closed_at = now() - interval '3 days' where id = $1`, [ids.longClosed]);
});

test('Bid receipt: the supplier, within the hour after submitting; older bids never get one', async () => {
  const due = await dueEmails();
  const bidder = await emailOf(ids.bidder ?? '');
  assert.ok(has(due, 'bid_receipt', bidder, ids.freshBid ?? ''));
  assert.ok(!has(due, 'bid_receipt', bidder, ids.oldBid ?? ''), 'a bid from before the sender existed');
});

test('New tender alert: matching, active suppliers who keep alerts on; never the old tenders', async () => {
  const due = await dueEmails();
  assert.ok(has(due, 'new_tender_alert', await emailOf(ids.matching ?? ''), ids.newTender ?? ''));
  for (const label of ['alertsOff', 'otherCategory', 'deactivated']) {
    assert.ok(!has(due, 'new_tender_alert', await emailOf(ids[label] ?? ''), ids.newTender ?? ''), label);
  }
  assert.ok(!has(due, 'new_tender_alert', await emailOf(ids.business ?? ''), ids.newTender ?? ''), 'not the business');
  assert.ok(!due.some((email) => email.type === 'new_tender_alert' && email.entity_id === ids.oldTender), 'published three days ago');
});

test('Deadline reminder: 24 hours before closing, to matching suppliers who have not bid', async () => {
  const due = await dueEmails();
  assert.ok(has(due, 'deadline_reminder', await emailOf(ids.matching ?? ''), ids.closingTender ?? ''));
  assert.ok(!has(due, 'deadline_reminder', await emailOf(ids.bidder ?? ''), ids.closingTender ?? ''), 'already bid');
  assert.ok(!has(due, 'deadline_reminder', await emailOf(ids.alertsOff ?? ''), ids.closingTender ?? ''), 'alerts off (item 33)');
  assert.ok(!due.some((email) => email.type === 'deadline_reminder' && email.entity_id === ids.newTender), 'closes in a week');
  assert.ok(!due.some((email) => email.type === 'deadline_reminder' && email.entity_id === ids.shortTender), 'published less than a day before closing');
});

test('Bids opened: the business, within a day of the tender closing', async () => {
  const due = await dueEmails();
  const business = await emailOf(ids.business ?? '');
  assert.ok(has(due, 'bids_opened', business, ids.justClosed ?? ''));
  assert.ok(!has(due, 'bids_opened', business, ids.longClosed ?? ''));
});

test('An email in email_log, sent or suppressed, is never due again', async () => {
  const matching = await emailOf(ids.matching ?? '');
  await database.query(`insert into public.email_log (type, recipient, entity_id, status) values ('new_tender_alert', $1, $2, 'suppressed')`, [matching, ids.newTender]);
  assert.ok(!has(await dueEmails(), 'new_tender_alert', matching, ids.newTender ?? ''));
});

test('Only the service role can list due emails, because the list holds email addresses', async () => {
  assert.match((await runAs(database, user(ids.business ?? ''), `select * from public.due_emails(10)`)).error?.message ?? '', /permission denied/);
  assert.equal((await runAs(database, service, `select * from public.due_emails(10)`)).error, null);
});
