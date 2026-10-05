import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { createStoredFile, runAs, user, type QueryOutcome } from './harness.ts';

export type FixCase = {
  name: string;
  // True when the baseline already behaved correctly: the case guards against a regression
  // rather than proving the fix, so it is expected to pass before the migration too.
  alreadyHeldBefore?: boolean;
  run: (database: PGlite) => Promise<void>;
};

export type FixSuite = {
  migration: string;
  title: string;
  cases: FixCase[];
};

export function assertSucceeded<Row>(outcome: QueryOutcome<Row>, description: string): Row[] {
  if (outcome.error) {
    assert.fail(`${description}: expected success, got "${outcome.error.message}"`);
  }
  return outcome.rows;
}

export function assertRefused<Row>(outcome: QueryOutcome<Row>, description: string, messagePattern?: RegExp): void {
  if (!outcome.error) {
    assert.fail(`${description}: expected the database to refuse, but it succeeded`);
  }
  if (messagePattern) {
    assert.match(outcome.error.message, messagePattern, description);
  }
}

// Row-level security answers a forbidden SELECT, UPDATE or DELETE with "no rows" rather than an
// error, while a missing grant raises one. Either way, nothing was read or changed.
export function assertNothingReachable<Row>(outcome: QueryOutcome<Row>, description: string): void {
  if (outcome.error) {
    return;
  }
  assert.equal(outcome.rows.length + outcome.affectedRows, 0, `${description}: expected no rows, got ${outcome.rows.length + outcome.affectedRows}`);
}

export async function submitBidAs(
  database: PGlite,
  supplierId: string,
  tenderId: string,
  options: { documentPath?: string; amount?: number; createdAt?: string } = {},
): Promise<QueryOutcome<{ id: string; created_at: string }>> {
  const documentPath = options.documentPath ?? (await createStoredFile(database, 'bid-documents', supplierId));
  const columns = ['tender_id', 'supplier_id', 'amount', 'document_path', 'document_name'];
  const values: unknown[] = [tenderId, supplierId, options.amount ?? 1000, documentPath, 'proposal.pdf'];
  if (options.createdAt) {
    columns.push('created_at');
    values.push(options.createdAt);
  }
  const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
  return runAs(database, user(supplierId), `insert into public.bids (${columns.join(', ')}) values (${placeholders}) returning id, created_at`, values);
}

export async function scalar<Value>(database: PGlite, statement: string, parameters: unknown[] = []): Promise<Value> {
  const result = await database.query<{ value: Value }>(statement, parameters);
  const firstRow = result.rows[0];
  assert.ok(firstRow, `expected a row from: ${statement}`);
  return firstRow.value;
}

export function newIdentifier(): string {
  return randomUUID();
}
