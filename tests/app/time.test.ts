import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatJamaicaDateTime, jamaicaLocalToUtc, utcToJamaicaLocal, formatTimeLeft } from '../../src/lib/time.ts';

test('A time typed in Jamaica is stored five hours later in UTC', () => {
  assert.equal(jamaicaLocalToUtc('2026-10-10T17:00'), '2026-10-10T22:00:00.000Z');
});

test('7pm in Jamaica is already the next day in UTC (the bug that hid tenders early)', () => {
  assert.equal(jamaicaLocalToUtc('2026-10-10T19:30'), '2026-10-11T00:30:00.000Z');
});

test('A stored UTC deadline comes back as the same Jamaica clock time for editing', () => {
  assert.equal(utcToJamaicaLocal('2026-10-11T00:30:00.000Z'), '2026-10-10T19:30');
});

test('Display uses Jamaica time, not the browser or server time zone', () => {
  const shown = formatJamaicaDateTime('2026-10-11T00:30:00.000Z');
  assert.match(shown, /10 Oct 2026/);
  assert.match(shown, /7:30/);
});

test('Malformed or impossible times are rejected with a plain message', () => {
  const rejected = ['', '2026-10-10', '2026-10-10 17:00', '10/10/2026 5pm', '2026-06-31T10:00', '2026-10-10T25:00', '2026-10-10T17:60', '<script>'];
  for (const input of rejected) {
    assert.throws(() => jamaicaLocalToUtc(input), /is not a/, `should reject "${input}"`);
  }
});

test('The countdown shows the two largest units, and nothing once the time has passed', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  assert.equal(formatTimeLeft('2026-11-22T15:30:00Z', now), '2 days 3 hours');
  assert.equal(formatTimeLeft('2026-11-21T13:00:00Z', now), '1 day 1 hour');
  assert.equal(formatTimeLeft('2026-11-20T13:01:00Z', now), '1 hour 1 minute');
  assert.equal(formatTimeLeft('2026-11-20T12:04:10Z', now), '4 minutes 10 seconds');
  assert.equal(formatTimeLeft('2026-11-20T12:00:00Z', now), null, 'the closing moment itself');
  assert.equal(formatTimeLeft('2026-11-19T12:00:00Z', now), null);
});
