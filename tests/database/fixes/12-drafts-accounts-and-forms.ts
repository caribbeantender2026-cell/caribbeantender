/** Regression checks for draft integrity, account state and supplier forms. */
import assert from 'node:assert/strict';
import type { PGlite } from '@electric-sql/pglite';
import { formProblems, type FormData, type FormRow, type FormSchema } from '../../../src/lib/forms.ts';
import { createUser, createTender, makeStaff, runAs, user } from '../harness.ts';
import { auditActions, assertSucceeded, completeAnswers, uploadAs, type FixSuite } from '../suite.ts';

const supplierForms = [
  { key: 'supplier-proposal', version: 2, references: 'bid_references', label: 'References (at least one; two recommended)' },
  { key: 'supplier-registration', version: 1, references: 'business_references', label: 'Business references (at least one; two recommended)' },
] as const;

async function readForm(database: PGlite, form: typeof supplierForms[number]): Promise<FormSchema> {
  const result = await database.query<{ schema: FormSchema }>('select schema from public.form_definitions where key=$1 and version=$2', [form.key, form.version]);
  assert.equal(result.rows.length, 1);
  return result.rows[0]!.schema;
}

/** Cases for migration 20261117060000. */
export const draftAccountSuite: FixSuite = {
  migration: '20261117060000_drafts_accounts_and_proposals.sql',
  title: 'Draft integrity, account state and supplier forms',
  cases: [
    {
      name: 'Tender pages get the database time for checking deadlines and subscription expiry',
      run: async (database) => {
        const supplier = await createUser(database, { accountType: 'supplier' });
        const result = await runAs<{ current: boolean }>(database, user(supplier), 'select public.server_time() = statement_timestamp() as current');
        assert.equal(assertSucceeded(result, 'read the current database time')[0]?.current, true);
      },
    },
    {
      name: 'Every user-facing delete policy on drafts, forms and files requires an active account',
      run: async (database) => {
        const policies = await database.query<{ policyname: string; qual: string }>(
          "select policyname, qual from pg_policies where cmd = 'DELETE' and tablename in ('tenders','form_submissions','objects') and 'authenticated' = any(roles)");
        assert.ok(policies.rows.length >= 5);
        for (const policy of policies.rows) assert.match(policy.qual, /caller_is_active/, policy.policyname);
      },
    },
    {
      name: 'Admin lists show which account actions still need to be applied in Auth',
      run: async (database) => {
        const admin = await createUser(database, { accountType: 'business' });
        await makeStaff(database, admin);
        const supplier = await createUser(database, { accountType: 'supplier' });
        assertSucceeded(await runAs(database, user(admin,'aal2'), 'select public.admin_set_user_active($1,false)', [supplier]), 'deactivate');
        const users = assertSucceeded(await runAs<{ user_id: string; auth_sync_pending?: boolean }>(database, user(admin,'aal2'), 'select * from public.admin_list_users()'), 'list accounts');
        assert.equal(users.find(row => row.user_id === supplier)?.auth_sync_pending, true);
        const reversed = await runAs(database, user(admin,'aal2'), 'select public.admin_set_user_active($1,true)', [supplier]);
        assert.match(reversed.error?.message ?? '', /pending/i);
        assertSucceeded(await runAs(database, user(admin,'aal2'), 'select public.admin_set_user_active($1,false)', [supplier]), 'retry original action');
        assert.deepEqual(await auditActions(database, supplier), ['admin_user_deactivated']);
      },
    },
    {
      name: 'Deleting a draft transactionally removes its form and queues its files',
      run: async (database) => {
        const buyer = await createUser(database, { accountType: 'business' });
        const draft = await createTender(database,buyer,'draft');
        assertSucceeded(await uploadAs(database,buyer,'tender-documents',draft+'/terms.pdf'), 'upload');
        assertSucceeded(await runAs(database,user(buyer),"insert into public.form_submissions (form_key,form_version,owner_id,data,attached_to_type,attached_to_id) values ('business-requirements',2,$1,'{}','tender',$2)",[buyer,draft]),'attach');
        assertSucceeded(await runAs(database,user(buyer),'delete from public.tenders where id=$1',[draft]),'delete');
        assert.equal((await database.query('select id from public.form_submissions where attached_to_id=$1',[draft])).rows.length,0);
        assert.equal((await database.query('select path from public.draft_file_cleanup where path=$1',[draft+'/terms.pdf'])).rows.length,1);
      },
    },
    {
      name: 'A removed upload still counts against the daily allowance',
      run: async (database) => {
        const buyer = await createUser(database, { accountType: 'business' });
        const draft = await createTender(database,buyer,'draft');
        assertSucceeded(await uploadAs(database,buyer,'tender-documents',draft+'/terms.pdf'), 'upload');
        assertSucceeded(await runAs(database,user(buyer),'delete from storage.objects where name=$1',[draft+'/terms.pdf']),'remove');
        const count = assertSucceeded(await runAs<{ used: number }>(database,user(buyer),"select private.uploads_in_last_day('tender-documents') as used"),'quota');
        assert.equal(count[0]?.used,1);
      },
    },
    {
      name: 'The current online reference labels say one is required and two are recommended',
      run: async (database) => {
        for (const form of supplierForms) {
          const schema = await readForm(database, form);
          const field = schema.fields.find((field) => field.name === form.references);
          assert.equal(field?.label, form.label);
        }
      },
    },
    {
      name: 'Both validators accept one reference and a manual discounted total, and refuse zero on completion',
      alreadyHeldBefore: true,
      run: async (database) => {
        for (const form of supplierForms) {
          const schema = await readForm(database, form);
          assert.equal(schema.fields.find((field) => field.name === form.references)?.required, true);
          const answers = await completeAnswers(database,form.key) as FormData;
          if (form.key === 'supplier-proposal') {
            answers.pricing_schedule = [{ item: 'Chair', quantity: 10, unit_price: 100 }];
            answers.total_bid_value = 700;
          }
          const validateDatabase = async () => {
            const result = await database.query<{ problems: string[] }>('select private.form_data_problems($1,$2,true) problems', [JSON.stringify(schema), JSON.stringify(answers)]);
            return result.rows[0]!.problems;
          };
          assert.equal((answers[form.references] as FormRow[]).length, 1);
          assert.deepEqual(formProblems(schema, answers, true), []);
          assert.deepEqual(await validateDatabase(), []);
          const reference = (answers[form.references] as FormRow[])[0]!;
          answers[form.references] = [reference, { ...reference, phone: '456' }];
          assert.deepEqual(formProblems(schema, answers, true), []);
          assert.deepEqual(await validateDatabase(), []);
          answers[form.references] = [];
          assert.match(formProblems(schema, answers, true).join(' '), /reference.*required/i);
          assert.match((await validateDatabase()).join(' '), /reference.*required/i);
        }
      },
    },
  ],
};
