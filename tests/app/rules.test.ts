import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeNextPath, supplierHasAccess, tenderPhase } from '../../src/lib/rules.ts';

const now = new Date('2026-10-10T12:00:00Z');
const later = '2026-10-11T12:00:00Z';
const earlier = '2026-10-09T12:00:00Z';

test('An open tender accepts bids until closes_at, then waits for its opening', () => {
  assert.equal(tenderPhase({ status: 'open', closes_at: later }, now), 'accepting-bids');
  assert.equal(tenderPhase({ status: 'open', closes_at: earlier }, now), 'awaiting-opening');
  assert.equal(tenderPhase({ status: 'open', closes_at: now.toISOString() }, now), 'awaiting-opening', 'the closing moment itself is too late');
});

test('Other statuses map directly to their phase', () => {
  assert.equal(tenderPhase({ status: 'draft', closes_at: earlier }, now), 'draft');
  assert.equal(tenderPhase({ status: 'closed', closes_at: earlier }, now), 'opened');
  assert.equal(tenderPhase({ status: 'awarded', closes_at: earlier }, now), 'awarded');
  assert.equal(tenderPhase({ status: 'cancelled', closes_at: later }, now), 'cancelled');
});

test('Supplier access follows the same rule as the database', () => {
  assert.equal(supplierHasAccess({ status: 'trial', trial_ends_at: later, current_period_end: null }, now), true);
  assert.equal(supplierHasAccess({ status: 'trial', trial_ends_at: earlier, current_period_end: null }, now), false);
  assert.equal(supplierHasAccess({ status: 'trial', trial_ends_at: null, current_period_end: null }, now), false, 'trial with no end date');
  assert.equal(supplierHasAccess({ status: 'active', trial_ends_at: null, current_period_end: later }, now), true);
  assert.equal(supplierHasAccess({ status: 'active', trial_ends_at: null, current_period_end: earlier }, now), false, 'paid period over');
  assert.equal(supplierHasAccess({ status: 'active', trial_ends_at: null, current_period_end: null }, now), true, 'active with no end date counts as active');
  assert.equal(supplierHasAccess({ status: 'expired', trial_ends_at: later, current_period_end: later }, now), false);
  assert.equal(supplierHasAccess({ status: 'cancelled', trial_ends_at: later, current_period_end: later }, now), false);
  assert.equal(supplierHasAccess(null, now), false);
});

test('Only same-site paths are accepted after login', () => {
  assert.equal(safeNextPath('/business/tenders/new'), '/business/tenders/new');
  const rejected = [null, '', 'business', 'https://evil.example', '//evil.example/path', '/\\evil.example', 'javascript:alert(1)'];
  for (const requestedPath of rejected) {
    assert.equal(safeNextPath(requestedPath), null, `should reject ${String(requestedPath)}`);
  }
});
