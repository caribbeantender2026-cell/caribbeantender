/** The performance advisor's findings: one read policy per table, and an index behind every foreign key. */
import assert from 'node:assert/strict';
import type { FixSuite } from '../suite.ts';

export const performanceAdvisorSuite: FixSuite = {
  migration: '20261117020000_performance_advisor_fixes.sql',
  title: 'Performance advisor: no duplicate read policies, no unindexed foreign keys',
  cases: [
    {
      name: 'tenders and form_submissions each have one read policy for signed-in users',
      run: async (database) => {
        const policies = await database.query<{ tablename: string; policy_count: number }>(
          `select tablename, count(*)::integer as policy_count from pg_policies
           where schemaname = 'public' and tablename in ('tenders', 'form_submissions')
             and cmd in ('SELECT', 'ALL') and 'authenticated' = any(roles)
           group by tablename order by tablename`,
        );
        assert.deepEqual(policies.rows, [
          { tablename: 'form_submissions', policy_count: 1 },
          { tablename: 'tenders', policy_count: 1 },
        ]);
      },
    },
    {
      name: 'The form definition and awarded bid foreign keys have covering indexes',
      run: async (database) => {
        const indexes = await database.query<{ indexname: string }>(
          `select indexname from pg_indexes where schemaname = 'public'
             and indexname in ('form_submissions_form_definition_idx', 'tenders_awarded_bid_idx') order by indexname`,
        );
        assert.deepEqual(indexes.rows.map((row) => row.indexname), ['form_submissions_form_definition_idx', 'tenders_awarded_bid_idx']);
      },
    },
  ],
};
