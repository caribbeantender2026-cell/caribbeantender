// Email safety until go-live (OPEN_QUESTIONS.md, decision D3): an address outside EMAIL_ALLOWLIST is
// logged as suppressed and never handed to Resend.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { idempotencyKey, parseAllowlist, sendEmail, type EmailServices, type OutgoingEmail } from '../../supabase/functions/_shared/email.ts';

const allowedAddress = 'tester@caribbeantender.com';

function emailTo(recipient: string): OutgoingEmail {
  return { type: 'new_tender_alert', recipient, entityId: '00000000-0000-4000-8000-000000000001', subject: 'New tender', html: '<p>New tender</p>' };
}

/** An in-memory email_log and a Resend stand-in that records every delivery attempt. */
function fakeServices(): EmailServices & { log: Map<string, string>; delivered: string[]; isRetryDue: boolean } {
  const log = new Map<string, string>();
  const delivered: string[] = [];
  const key = (email: OutgoingEmail): string => `${email.type}|${email.recipient}|${email.entityId}`;
  const services = {
    log,
    delivered,
    // Whether due_emails' wait before another try has passed (public.reclaim_email decides this for real).
    isRetryDue: false,
    reclaimLogRow: async (email: OutgoingEmail) => {
      if (!services.isRetryDue || log.get(key(email)) !== 'failed') return false;
      log.set(key(email), 'pending');
      return true;
    },
    claimLogRow: async (email: OutgoingEmail, status: 'pending' | 'suppressed') => {
      if (log.has(key(email))) return false;
      log.set(key(email), status);
      return true;
    },
    finishLogRow: async (email: OutgoingEmail, status: 'sent' | 'failed') => {
      log.set(key(email), status);
    },
    deliver: async (email: OutgoingEmail) => {
      delivered.push(email.recipient);
      return 'provider-message-id';
    },
  };
  return services;
}

test('An email to an address outside the allowlist is logged as suppressed and never sent', async () => {
  const services = fakeServices();
  const outcome = await sendEmail(emailTo('real.supplier@company.example'), parseAllowlist(allowedAddress), services);
  assert.equal(outcome, 'suppressed');
  assert.deepEqual(services.delivered, []);
  assert.deepEqual([...services.log.values()], ['suppressed']);
});

test('A suppressed email stays suppressed when the same event runs again', async () => {
  const services = fakeServices();
  const isAllowed = parseAllowlist(allowedAddress);
  await sendEmail(emailTo('real.supplier@company.example'), isAllowed, services);
  assert.equal(await sendEmail(emailTo('real.supplier@company.example'), isAllowed, services), 'already_handled');
  assert.deepEqual(services.delivered, []);
});

test('An allowed address is sent once and logged as sent', async () => {
  const services = fakeServices();
  const isAllowed = parseAllowlist(` ${allowedAddress.toUpperCase()} , other@example.com`);
  assert.equal(await sendEmail(emailTo(allowedAddress), isAllowed, services), 'sent');
  assert.equal(await sendEmail(emailTo(allowedAddress), isAllowed, services), 'already_handled');
  assert.deepEqual(services.delivered, [allowedAddress]);
  assert.deepEqual([...services.log.values()], ['sent']);
});

test('An unset or empty allowlist sends nothing; only "*" (go-live) sends to everyone', () => {
  for (const setting of [undefined, '', ' ', ',', ' , ']) {
    assert.equal(parseAllowlist(setting)('anyone@caribbeantender.com'), false, JSON.stringify(setting));
  }
  assert.equal(parseAllowlist('*')('anyone@caribbeantender.com'), true);
  assert.equal(parseAllowlist(`${allowedAddress}, *`)('anyone@caribbeantender.com'), true);
});

test('Only whole addresses match: look-alikes, lists and padding tricks are suppressed', () => {
  const isAllowed = parseAllowlist(allowedAddress);
  for (const recipient of [
    'tester@example.com.attacker.net',
    'attacker-tester@example.com',
    'ester@example.com',
    `${allowedAddress}, real.supplier@company.example`,
    `real.supplier@company.example,${allowedAddress}`,
    `Tester <${allowedAddress}>`,
    '*',
    '',
    'x'.repeat(10_000),
  ]) {
    assert.equal(isAllowed(recipient), false, recipient.slice(0, 60));
  }
});

test('A failed delivery is logged as failed and not retried by the same event', async () => {
  const services = fakeServices();
  services.deliver = async () => {
    throw new Error('Resend is down');
  };
  assert.equal(await sendEmail(emailTo(allowedAddress), parseAllowlist(allowedAddress), services), 'failed');
  assert.equal(await sendEmail(emailTo(allowedAddress), parseAllowlist(allowedAddress), services), 'already_handled');
  assert.deepEqual([...services.log.values()], ['failed']);
});

test('A failed email is sent by a later run once its retry is due, and only then', async () => {
  const services = fakeServices();
  const isAllowed = parseAllowlist(allowedAddress);
  const working = services.deliver;
  services.deliver = async () => {
    throw new Error('Resend is down');
  };
  assert.equal(await sendEmail(emailTo(allowedAddress), isAllowed, services), 'failed');
  services.deliver = working;
  assert.equal(await sendEmail(emailTo(allowedAddress), isAllowed, services), 'already_handled', 'not before the wait');
  services.isRetryDue = true;
  assert.equal(await sendEmail(emailTo(allowedAddress), isAllowed, services), 'sent');
  assert.deepEqual(services.delivered, [allowedAddress]);
  assert.deepEqual([...services.log.values()], ['sent']);
});

test('Reserved test domains are never emailed, even with "*" at go-live: mail to them only bounces', () => {
  for (const setting of ['*', 'rls-test-20261117000000-supplier@example.com']) {
    const isAllowed = parseAllowlist(setting);
    for (const recipient of ['rls-test-20261117000000-supplier@example.com', 'x@EXAMPLE.ORG', 'x@sub.example.net', 'x@company.test', 'x@site.example', 'x@nowhere.invalid']) {
      assert.equal(isAllowed(recipient), false, `${setting}: ${recipient}`);
    }
  }
  assert.equal(parseAllowlist('*')('buyer@example-company.com'), true, 'only the reserved names themselves');
});

test("Resend's idempotency key is the same for the same email and differs for any other", async () => {
  const first = await idempotencyKey(emailTo(allowedAddress));
  assert.equal(first, await idempotencyKey(emailTo(allowedAddress)));
  assert.notEqual(first, await idempotencyKey(emailTo('other@caribbeantender.com')));
  assert.notEqual(first, await idempotencyKey({ ...emailTo(allowedAddress), type: 'deadline_reminder' }));
  assert.ok(first.length <= 256, 'Resend accepts keys up to 256 characters');
});
