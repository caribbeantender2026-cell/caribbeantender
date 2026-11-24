/** A business completes the Business Registration Form before it can post tenders (Rockell's review, 22 Nov 2026). */
import type { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { completeRequirementsForm, createTender, createUser, firstCategoryId, registerBusiness, runAs, user, writeFixture } from '../harness.ts';
import { assertRefused, assertSucceeded, publishTenderAs, type FixSuite } from '../suite.ts';

const registrationRefusal = /Business Registration Form/;

/** The business creates a draft tender itself, as the app's new-tender page does. */
async function createDraftAs(database: PGlite, businessId: string) {
  return runAs(
    database,
    user(businessId),
    `insert into public.tenders (business_id, title, description, category_id, closes_at) values ($1, 'Office chairs', 'Twenty chairs', $2, now() + interval '7 days')`,
    [businessId, await firstCategoryId(database)],
  );
}

export const businessRegistrationSuite: FixSuite = {
  migration: '20261124000000_business_registration_required.sql',
  title: 'Businesses: the Business Registration Form comes before posting tenders',
  cases: [
    {
      name: 'A business without a completed Business Registration Form cannot create a tender',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business', isRegistered: false });
        assertRefused(await createDraftAs(database, businessId), 'create a draft unregistered', registrationRefusal);
      },
    },
    {
      name: 'Nor can it publish a draft it already had',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business', isRegistered: false });
        const tenderId = await createTender(database, businessId, 'draft');
        await writeFixture(
          database,
          `insert into public.form_submissions (form_key, form_version, owner_id, data, attached_to_type, attached_to_id) values ('business-requirements', 1, $1, $2, 'tender', $3)`,
          [businessId, JSON.stringify(completeRequirementsForm), tenderId],
        );
        assertRefused(await runAs(database, user(businessId), `select public.publish_tender($1)`, [tenderId]), 'publish a draft unregistered', registrationRefusal);
      },
    },
    {
      name: 'A partly filled Business Registration Form does not count',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business', isRegistered: false });
        await writeFixture(
          database,
          `insert into public.form_submissions (form_key, form_version, owner_id, data) values ('business-registration', 1, $1, $2)`,
          [businessId, JSON.stringify({ company_name: 'Half-registered Ltd' })],
        );
        assertRefused(await createDraftAs(database, businessId), 'create a draft with a partly filled form', registrationRefusal);
      },
    },
    {
      name: 'A registered business creates and publishes tenders as before (regression guard)',
      alreadyHeldBefore: true,
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const { outcome } = await publishTenderAs(database, businessId);
        assertSucceeded(outcome, 'publish as a registered business');
      },
    },
    {
      name: 'The app can ask whether the signed-in business is registered',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business', isRegistered: false });
        const isRegistered = async () =>
          assertSucceeded(await runAs<{ registered: boolean }>(database, user(businessId), `select public.business_registration_complete() as registered`), 'ask')[0]?.registered;
        assert.equal(await isRegistered(), false, 'before filling in the form');
        await registerBusiness(database, businessId);
        assert.equal(await isRegistered(), true, 'after filling in the form');
      },
    },
  ],
};
