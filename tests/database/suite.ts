/** Shared pieces for the database fix suites: the suite shape, assertions, and the app's main actions. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import {
  columnExists,
  completeProposalForm,
  completeRequirementsForm,
  createStoredFile,
  firstCategoryId,
  functionExists,
  runAs,
  user,
  type QueryOutcome,
} from './harness.ts';

export type FixCase = {
  name: string;
  // True when the schema before the migration already behaved correctly: the case guards against a
  // regression rather than proving the fix, so it is expected to pass before the migration too.
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

/** Fails unless a table exists, so a case about a new table can't pass just because the table is missing. */
export async function assertTableExists(database: PGlite, qualifiedName: string): Promise<void> {
  const result = await database.query<{ present: boolean }>(`select to_regclass($1) is not null as present`, [qualifiedName]);
  assert.equal(result.rows[0]?.present, true, `${qualifiedName} should exist`);
}

export async function scalar<Value>(database: PGlite, statement: string, parameters: unknown[] = []): Promise<Value> {
  const result = await database.query<{ value: Value }>(statement, parameters);
  const firstRow = result.rows[0];
  assert.ok(firstRow, `expected a row from: ${statement}`);
  return firstRow.value;
}

/** Uploads a file as a signed-in user, the way the Storage API inserts the object row. */
export function uploadAs(database: PGlite, userId: string, bucket: string, objectName: string): Promise<QueryOutcome<Record<string, unknown>>> {
  return runAs(
    database,
    user(userId),
    `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3, $4, '{"size": 2048, "mimetype": "application/pdf"}')`,
    [bucket, objectName, userId, userId],
  );
}

export type BidOptions = {
  bidId?: string;
  amount?: number;
  // How the proposal comes: an uploaded file (the default), the online form, or not at all.
  proposal?: 'file' | 'form' | 'none';
};

/**
 * Submits a bid the way the app does. With submit_bid (after the fix) that is the remote procedure;
 * before it, the old app inserted into bids directly, which is what this falls back to.
 */
export async function submitBidAs(
  database: PGlite,
  supplierId: string,
  tenderId: string,
  options: BidOptions = {},
): Promise<QueryOutcome<{ submitted_at: string }>> {
  const amount = options.amount ?? 1000;
  if (!(await functionExists(database, 'submit_bid'))) {
    // Between the documents migration and submit_bid, bids no longer carry a document path.
    if (!(await columnExists(database, 'bids', 'document_path'))) {
      return runAs(
        database,
        user(supplierId),
        `insert into public.bids (tender_id, supplier_id, amount) values ($1, $2, $3) returning created_at as submitted_at`,
        [tenderId, supplierId, amount],
      );
    }
    const documentPath = await createStoredFile(database, 'bid-documents', `${supplierId}/${randomUUID()}-proposal.pdf`, supplierId);
    return runAs(
      database,
      user(supplierId),
      `insert into public.bids (tender_id, supplier_id, amount, document_path, document_name)
       values ($1, $2, $3, $4, 'proposal.pdf') returning created_at as submitted_at`,
      [tenderId, supplierId, amount, documentPath],
    );
  }
  const bidId = options.bidId ?? randomUUID();
  const proposal = options.proposal ?? 'file';
  let formSubmissionId: string | null = null;
  if (proposal === 'file') {
    await createStoredFile(database, 'bid-documents', `${tenderId}/${bidId}/proposal/proposal.pdf`, supplierId);
  }
  if (proposal === 'form') {
    const inserted = await runAs<{ id: string }>(
      database,
      user(supplierId),
      `insert into public.form_submissions (form_key, form_version, owner_id, data) values ('supplier-proposal', 1, $1, $2) returning id`,
      [supplierId, JSON.stringify(completeProposalForm)],
    );
    formSubmissionId = assertSucceeded(inserted, 'fill in the proposal form')[0]?.id ?? null;
  }
  return runAs(database, user(supplierId), `select public.submit_bid($1, $2, $3, $4) as submitted_at`, [
    tenderId,
    bidId,
    amount,
    formSubmissionId,
  ]);
}

export type PublishOptions = {
  closesAt?: Date;
  withCategory?: boolean;
  withRequirementsForm?: boolean;
};

const millisecondsPerDay = 86_400_000;

/**
 * Publishes a tender the way the app does: with the lifecycle (after the fix) a draft, its
 * requirements form, then publish_tender; before it, the old app inserted an open tender directly.
 */
export async function publishTenderAs(
  database: PGlite,
  businessId: string,
  options: PublishOptions = {},
): Promise<{ tenderId: string | null; outcome: QueryOutcome<Record<string, unknown>> }> {
  const closesAt = options.closesAt ?? new Date(Date.now() + 7 * millisecondsPerDay);
  if (!(await functionExists(database, 'publish_tender'))) {
    const hasClosesAt = await columnExists(database, 'tenders', 'closes_at');
    const outcome = await runAs<{ id: string }>(
      database,
      user(businessId),
      hasClosesAt
        ? `insert into public.tenders (business_id, title, description, closes_at, status) values ($1, 'Office chairs', 'Twenty chairs', $2, 'open') returning id`
        : `insert into public.tenders (business_id, title, description, closing_date, status) values ($1, 'Office chairs', 'Twenty chairs', $2::date, 'open') returning id`,
      [businessId, hasClosesAt ? closesAt : closesAt.toISOString().slice(0, 10)],
    );
    return { tenderId: outcome.rows[0]?.id ?? null, outcome };
  }
  const categoryId = options.withCategory === false ? null : await firstCategoryId(database);
  const draft = await runAs<{ id: string }>(
    database,
    user(businessId),
    `insert into public.tenders (business_id, title, description, category_id, closes_at) values ($1, 'Office chairs', 'Twenty chairs', $2, $3) returning id`,
    [businessId, categoryId, closesAt],
  );
  const tenderId = assertSucceeded(draft, 'create the draft')[0]?.id ?? null;
  assert.ok(tenderId);
  if (options.withRequirementsForm !== false) {
    assertSucceeded(
      await runAs(
        database,
        user(businessId),
        `insert into public.form_submissions (form_key, form_version, owner_id, data, attached_to_type, attached_to_id)
         values ('business-requirements', 1, $1, $2, 'tender', $3)`,
        [businessId, JSON.stringify(completeRequirementsForm), tenderId],
      ),
      'attach the requirements form',
    );
  }
  const outcome = await runAs(database, user(businessId), `select public.publish_tender($1) as published_at`, [tenderId]);
  return { tenderId, outcome };
}

/** Audit log actions recorded for one entity, oldest first. */
export async function auditActions(database: PGlite, entityId: string): Promise<string[]> {
  const result = await database.query<{ action: string }>(`select action from public.audit_log where entity_id = $1 order by id`, [entityId]);
  return result.rows.map((row) => row.action);
}
