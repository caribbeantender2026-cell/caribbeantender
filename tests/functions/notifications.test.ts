// The email wording and the pg_cron secret check of the send-notifications Edge Function.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeEmail, secretMatches, type DueEmail } from '../../supabase/functions/send-notifications/notifications.ts';

const tenderId = '00000000-0000-4000-8000-000000000002';

function due(type: DueEmail['type'], details: Record<string, unknown>): DueEmail {
  return { type, recipient: 'supplier@example.com', entity_id: tenderId, details: { tender_id: tenderId, ...details } };
}

test('A bid receipt states the exact submission time in Jamaica time', () => {
  const email = composeEmail(due('bid_receipt', { tender_title: 'Office chairs', submitted_at: '2026-11-20T17:30:15Z', amount: 1500.5, currency: 'JMD' }), 'https://caribbeantender.com');
  assert.equal(email.subject, 'Bid received: Office chairs');
  assert.match(email.html, /20 Nov 2026, 12:30:15/);
  // The same amount format as the app's receipt.
  assert.match(email.html, /Amount: \$1,500\.50 \(JMD\)/);
  assert.match(email.html, new RegExp(`https://caribbeantender.com/tenders/${tenderId}`));
});

test('Every email carries the brand frame: the logo from the site, a heading, one button and the footer', () => {
  for (const type of ['bid_receipt', 'new_tender_alert', 'deadline_reminder', 'bids_opened'] as const) {
    const email = composeEmail(due(type, { tender_title: 'Office chairs', closes_at: '2026-11-25T04:59:59Z' }), 'https://caribbeantender.com/');
    assert.match(email.html, /<img src="https:\/\/caribbeantender.com\/email\/logo.png"/, `${type}: logo`);
    assert.match(email.html, /<h1 /, `${type}: heading`);
    assert.equal(email.html.match(/background:#D99E04;padding:12px 22px;"><a /g)?.length, 1, `${type}: one gold button`);
    assert.match(email.html, /info@caribbeantender.com/, `${type}: footer`);
  }
});

test('Every type has its own subject', () => {
  const subjects = (['bid_receipt', 'new_tender_alert', 'deadline_reminder', 'bids_opened'] as const).map(
    (type) => composeEmail(due(type, { tender_title: 'X' }), 'https://caribbeantender.com').subject,
  );
  assert.equal(new Set(subjects).size, 4);
});

test('A tender title cannot inject HTML, links or extra subject lines', () => {
  const hostile = '<script>alert(1)</script><a href="https://evil.example">win</a>\r\nBcc: victim@example.com';
  const email = composeEmail(due('new_tender_alert', { tender_title: hostile, closes_at: '2026-11-25T04:59:59Z' }), 'https://caribbeantender.com/');
  assert.ok(!email.html.includes('<script>'));
  assert.ok(!email.html.includes('href="https://evil.example"'));
  assert.ok(!/[\r\n]/.test(email.subject));
  assert.match(email.html, /href="https:\/\/caribbeantender.com\/tenders\//, 'the only link goes to the site');
});

test('A tender id cannot change where the link points', () => {
  const email = composeEmail({ ...due('bids_opened', { tender_title: 'X' }), details: { tender_id: '../../evil?x="y' } }, 'https://caribbeantender.com');
  assert.match(email.html, /href="https:\/\/caribbeantender.com\/tenders\/..%2F..%2Fevil%3Fx%3D%22y"/);
});

test('Only the exact shared secret starts a send; an unset secret matches nothing', () => {
  const secret = 'a'.repeat(64);
  assert.equal(secretMatches(secret, secret), true);
  for (const given of [null, '', 'a'.repeat(63), `${'a'.repeat(63)}b`, `${secret}a`, secret.toUpperCase()]) {
    assert.equal(secretMatches(given, secret), false, String(given).slice(0, 10));
  }
  for (const expected of [undefined, '']) {
    assert.equal(secretMatches('', expected), false);
    assert.equal(secretMatches('anything', expected), false);
  }
});

test('The bids-opened email says how many bids came in, and a tender with none is not told to read them', () => {
  const none = composeEmail(due('bids_opened', { tender_title: 'Office chairs', bid_count: 0 }), 'https://caribbeantender.com');
  assert.equal(none.subject, 'Tender closed: Office chairs');
  assert.match(none.html, /No bids were submitted/);
  assert.ok(!none.html.includes('read every bid'));
  const three = composeEmail(due('bids_opened', { tender_title: 'Office chairs', bid_count: 3 }), 'https://caribbeantender.com');
  assert.equal(three.subject, 'Bids are open: Office chairs');
  assert.match(three.html, /3 bids came in/);
  assert.match(composeEmail(due('bids_opened', { tender_title: 'X', bid_count: 1 }), 'https://caribbeantender.com').html, /1 bid came in/);
});

test('The frame holds its width and hides the preview line in desktop Outlook, which ignores max-width', () => {
  const email = composeEmail(due('new_tender_alert', { tender_title: 'X', closes_at: '2026-11-25T04:59:59Z' }), 'https://caribbeantender.com');
  assert.match(email.html, /<table role="presentation" width="560" [^>]*style="width:100%;max-width:560px;/);
  assert.match(email.html, /<div style="display:none;[^"]*mso-hide:all;/);
  // The button's padding sits on its cell, which Outlook keeps; it drops padding on links.
  assert.match(email.html, /<td style="border-radius:10px;background:#D99E04;padding:12px 22px;"><a /);
});
