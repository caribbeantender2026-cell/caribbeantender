import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatJamaicaDateTime, jamaicaLocalToUtc, utcToJamaicaLocal } from '../../src/lib/time.ts';

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
