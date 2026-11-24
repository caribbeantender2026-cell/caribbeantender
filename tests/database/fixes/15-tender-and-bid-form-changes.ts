/** Rockell's changes to the Tender Creation and Bid Submission forms (her corrected review document, 24 Nov 2026). */
import type { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { requiredAnswers, type FormField } from '../../formAnswers.ts';
import type { FixSuite } from '../suite.ts';

/** Version 3 of a form; fails before the migration, when there is no version 3. */
async function versionThree(database: PGlite, formKey: string): Promise<{ schema: { fields: FormField[] }; title: string; download_path: string | null }> {
  const result = await database.query<{ schema: { fields: FormField[] }; title: string; download_path: string | null }>(
    `select schema, title, download_path from public.form_definitions where key = $1 and version = 3`,
    [formKey],
  );
  const definition = result.rows[0];
  assert.ok(definition, `${formKey} version 3 should exist`);
  return definition;
}

/** What the database says is wrong with complete-form answers, as it checks them when a tender is published or a bid submitted. */
async function problemsWith(database: PGlite, formKey: string, answers: Record<string, unknown>): Promise<string[]> {
  const result = await database.query<{ problems: string[] }>(
    `select private.form_data_problems(schema, $2::jsonb, true) as problems from public.form_definitions where key = $1 and version = 3`,
    [formKey, JSON.stringify(answers)],
  );
  return result.rows[0]?.problems ?? ['no version 3'];
}

export const tenderAndBidFormChangesSuite: FixSuite = {
  migration: '20261124010000_tender_and_bid_form_changes.sql',
  title: "Forms: Rockell's Tender Creation and Bid Submission form changes",
  cases: [
    {
      name: 'Budget amounts are required only for the budget type that uses them, and a leftover amount is ignored',
      run: async (database) => {
        const answers = requiredAnswers((await versionThree(database, 'business-requirements')).schema.fields);
        const { fixed_budget: _fixed, budget_minimum: _minimum, budget_maximum: _maximum, ...withoutAmounts } = answers;
        assert.deepEqual(await problemsWith(database, 'business-requirements', { ...withoutAmounts, budget_type: 'Open Competitive Bidding' }), []);
        assert.deepEqual(await problemsWith(database, 'business-requirements', { ...withoutAmounts, budget_type: 'Fixed Budget' }), ['Fixed budget (JMD) is required.']);
        assert.deepEqual(await problemsWith(database, 'business-requirements', { ...withoutAmounts, budget_type: 'Budget Range', budget_minimum: 1000 }), [
          'Estimated budget: maximum (JMD) is required.',
        ]);
        assert.deepEqual(
          await problemsWith(database, 'business-requirements', { ...withoutAmounts, budget_type: 'Budget Range', budget_minimum: 1000, budget_maximum: 5000, fixed_budget: -1 }),
          [],
          'an amount left from Fixed Budget neither counts nor blocks publishing',
        );
      },
    },
    {
      name: 'A tender needs a clarification email and every one of the five terms ticked',
      run: async (database) => {
        const answers = requiredAnswers((await versionThree(database, 'business-requirements')).schema.fields);
        const { clarification_email: _email, terms_contract_award: _award, ...missing } = answers;
        assert.deepEqual(await problemsWith(database, 'business-requirements', missing), [
          'Clarification email address: bidders may use this address to request clarification about the tender is required.',
          'Contract Award is required.',
        ]);
        assert.deepEqual(await problemsWith(database, 'business-requirements', answers), []);
      },
    },
    {
      name: 'The Evaluation criteria table is gone from the Tender Creation Form',
      run: async (database) => {
        const fields = (await versionThree(database, 'business-requirements')).schema.fields.map((field) => field.name);
        assert.equal(fields.includes('evaluation_criteria'), false);
      },
    },
    {
      name: 'A bid needs its dates and a milestone, and a milestone target date must be a real date',
      run: async (database) => {
        const answers = requiredAnswers((await versionThree(database, 'supplier-proposal')).schema.fields);
        const { proposed_start_date: _start, milestones: _milestones, ...missing } = answers;
        assert.deepEqual(await problemsWith(database, 'supplier-proposal', missing), ['Proposed start date is required.', 'Key milestones is required.']);
        assert.deepEqual(await problemsWith(database, 'supplier-proposal', { ...answers, milestones: [{ milestone: 'Delivery', target_date: 'mid-December' }] }), [
          'Row 1 of Key milestones: Target date must be a date like 2026-11-30.',
        ]);
        assert.deepEqual(await problemsWith(database, 'supplier-proposal', answers), []);
      },
    },
    {
      name: "The new versions keep their titles and version 2's Word downloads",
      run: async (database) => {
        for (const [formKey, title] of [['business-requirements', 'Tender Creation Form'], ['supplier-proposal', 'Bid Submission Form']] as const) {
          const current = await versionThree(database, formKey);
          const previous = await database.query<{ download_path: string | null }>(`select download_path from public.form_definitions where key = $1 and version = 2`, [formKey]);
          assert.equal(current.title, title);
          // Live, that is the uploaded Word file; a clean database has none, so both are blank there.
          assert.equal(current.download_path, previous.rows[0]?.download_path);
        }
      },
    },
  ],
};
