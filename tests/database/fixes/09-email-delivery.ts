/** Email delivery fixes from the 17 Nov 2026 review: retries, test tenders, the bid count, the cron timeout. */
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { createTender, createUser, runAs, service, user, writeFixture } from '../harness.ts';
import type { FixSuite } from '../suite.ts';

type DueEmail = { type: string; recipient: string; entity_id: string; details: Record<string, unknown> };

async function dueEmails(database: PGlite): Promise<DueEmail[]> {
  return (await database.query<DueEmail>(`select type, recipient, entity_id, details from public.due_emails(500)`)).rows;
}

async function emailOf(database: PGlite, userId: string): Promise<string> {
  return (await database.query<{ email: string }>(`select email from auth.users where id = $1`, [userId])).rows[0]?.email ?? '';
}

/** A supplier in the first category and a tender published five minutes ago there: one new-tender alert is due. */
async function alertScenario(database: PGlite): Promise<{ recipient: string; tenderId: string; businessId: string }> {
  const businessId = await createUser(database, { accountType: 'business' });
  const supplierId = await createUser(database, { accountType: 'supplier' });
  await writeFixture(database, `update public.supplier_profiles set category_id = (select id from public.categories order by is_active desc, sort_order limit 1) where user_id = $1`, [supplierId]);
  const tenderId = await createTender(database, businessId, 'accepting-bids');
  await writeFixture(database, `update public.tenders set published_at = now() - interval '5 minutes' where id = $1`, [tenderId]);
  return { recipient: await emailOf(database, supplierId), tenderId, businessId };
}

function isDue(due: DueEmail[], recipient: string, tenderId: string): boolean {
  return due.some((email) => email.type === 'new_tender_alert' && email.recipient === recipient && email.entity_id === tenderId);
}

export const emailDeliverySuite: FixSuite = {
  migration: '20261117030000_email_retries_and_test_tenders.sql',
  title: 'Email delivery: failed emails retried, no alerts for test tenders, bid counts, a longer cron timeout',
  cases: [
    {
      name: 'A failed email is due again after a wait that grows with each try, at most five tries',
      run: async (database) => {
        const { recipient, tenderId } = await alertScenario(database);
        await writeFixture(database, `insert into public.email_log (type, recipient, entity_id, status) values ('new_tender_alert', $1, $2, 'failed')`, [recipient, tenderId]);
        assert.equal(isDue(await dueEmails(database), recipient, tenderId), false, 'just failed: wait first');
        await writeFixture(database, `update public.email_log set last_attempt_at = now() - interval '6 minutes' where entity_id = $1`, [tenderId]);
        assert.equal(isDue(await dueEmails(database), recipient, tenderId), true, 'failed once, six minutes ago');
        await writeFixture(database, `update public.email_log set attempts = 2 where entity_id = $1`, [tenderId]);
        assert.equal(isDue(await dueEmails(database), recipient, tenderId), false, 'failed twice: wait ten minutes');
        await writeFixture(database, `update public.email_log set attempts = 5, last_attempt_at = now() - interval '1 day' where entity_id = $1`, [tenderId]);
        assert.equal(isDue(await dueEmails(database), recipient, tenderId), false, 'five tries: given up');
      },
    },
    {
      name: 'An email left pending by a run that stopped halfway is due again; sent and suppressed ones never are',
      run: async (database) => {
        const { recipient, tenderId } = await alertScenario(database);
        await writeFixture(database, `insert into public.email_log (type, recipient, entity_id, status) values ('new_tender_alert', $1, $2, 'pending')`, [recipient, tenderId]);
        assert.equal(isDue(await dueEmails(database), recipient, tenderId), false, 'pending now: a run is sending it');
        await writeFixture(database, `update public.email_log set last_attempt_at = now() - interval '6 minutes' where entity_id = $1`, [tenderId]);
        assert.equal(isDue(await dueEmails(database), recipient, tenderId), true, 'pending for six minutes');
        for (const status of ['sent', 'suppressed']) {
          await writeFixture(database, `update public.email_log set status = $2 where entity_id = $1`, [tenderId, status]);
          assert.equal(isDue(await dueEmails(database), recipient, tenderId), false, status);
        }
      },
    },
    {
      name: 'reclaim_email takes a due retry back exactly once, and only for the service role',
      run: async (database) => {
        const { recipient, tenderId, businessId } = await alertScenario(database);
        await writeFixture(
          database,
          `insert into public.email_log (type, recipient, entity_id, status, last_attempt_at) values ('new_tender_alert', $1, $2, 'failed', now() - interval '6 minutes')`,
          [recipient, tenderId],
        );
        const reclaim = `select public.reclaim_email('new_tender_alert', '${recipient}', '${tenderId}') as reclaimed`;
        assert.match((await runAs(database, user(businessId), reclaim)).error?.message ?? '', /permission denied/);
        assert.deepEqual((await runAs<{ reclaimed: boolean }>(database, service, reclaim)).rows, [{ reclaimed: true }]);
        assert.deepEqual((await runAs<{ reclaimed: boolean }>(database, service, reclaim)).rows, [{ reclaimed: false }], 'a second run must not send it too');
        const row = (await database.query<{ status: string; attempts: number }>(`select status, attempts from public.email_log where entity_id = $1`, [tenderId])).rows;
        assert.deepEqual(row, [{ status: 'pending', attempts: 2 }]);
      },
    },
    {
      name: 'A tender posted by a live test account (rls-test-...@example.com) alerts and reminds no supplier',
      run: async (database) => {
        const { recipient, tenderId, businessId } = await alertScenario(database);
        assert.equal(isDue(await dueEmails(database), recipient, tenderId), true, 'an ordinary business: alert due');
        await writeFixture(database, `update auth.users set email = 'rls-test-20261117000000-business@example.com' where id = $1`, [businessId]);
        assert.equal(isDue(await dueEmails(database), recipient, tenderId), false, 'a live test business: no alert');
        await writeFixture(database, `update public.tenders set published_at = now() - interval '3 days', closes_at = now() + interval '12 hours' where id = $1`, [tenderId]);
        const reminders = (await dueEmails(database)).filter((email) => email.type === 'deadline_reminder' && email.entity_id === tenderId);
        assert.deepEqual(reminders, [], 'and no reminder');
      },
    },
    {
      name: 'The bids-opened email says how many bids came in',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const tenderId = await createTender(database, businessId, 'closed');
        const opened = (await dueEmails(database)).find((email) => email.type === 'bids_opened' && email.entity_id === tenderId);
        assert.equal(opened?.details.bid_count, 0);
      },
    },
    {
      name: 'pg_cron gives send-notifications 30 seconds a call, not pg_net\'s default 5',
      run: async (database) => {
        const job = (await database.query<{ command: string }>(`select command from cron.job where jobname = 'send-notifications'`)).rows[0];
        assert.match(job?.command ?? '', /timeout_milliseconds := 30000/);
      },
    },
    {
      name: 'The tender description check holds for every row, so one legacy row can never stop tenders closing',
      run: async (database) => {
        const constraint = (await database.query<{ convalidated: boolean }>(`select convalidated from pg_constraint where conname = 'tenders_description_length'`)).rows;
        assert.deepEqual(constraint, [{ convalidated: true }]);
      },
    },
  ],
};
