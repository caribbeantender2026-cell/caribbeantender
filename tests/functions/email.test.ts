// Email safety until go-live (OPEN_QUESTIONS.md, decision D3): an address outside EMAIL_ALLOWLIST is
// logged as suppressed and never handed to Resend.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAllowlist, sendEmail, type EmailServices, type OutgoingEmail } from '../../supabase/functions/_shared/email.ts';

const allowedAddress = 'tester@example.com';

function emailTo(recipient: string): OutgoingEmail {
  return { type: 'new_tender_alert', recipient, entityId: '00000000-0000-4000-8000-000000000001', subject: 'New tender', html: '<p>New tender</p>' };
}

/** An in-memory email_log and a Resend stand-in that records every delivery attempt. */
function fakeServices(): EmailServices & { log: Map<string, string>; delivered: string[] } {
  const log = new Map<string, string>();
  const delivered: string[] = [];
  const key = (email: OutgoingEmail): string => `${email.type}|${email.recipient}|${email.entityId}`;
  return {
    log,
    delivered,
    claimLogRow: async (email, status) => {
      if (log.has(key(email))) return false;
      log.set(key(email), status);
      return true;
    },
    finishLogRow: async (email, status) => {
      log.set(key(email), status);
    },
    deliver: async (email) => {
      delivered.push(email.recipient);
      return 'provider-message-id';
    },
  };
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
    assert.equal(parseAllowlist(setting)('anyone@example.com'), false, JSON.stringify(setting));
  }
  assert.equal(parseAllowlist('*')('anyone@example.com'), true);
  assert.equal(parseAllowlist(`${allowedAddress}, *`)('anyone@example.com'), true);
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
