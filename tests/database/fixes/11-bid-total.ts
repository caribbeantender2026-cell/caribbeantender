/** The online Bid Submission Form's total must be the bid amount (Rockell, 17 Nov 2026). */
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { createTender, createUser, runAs, user } from '../harness.ts';
import { assertRefused, assertSucceeded, completeAnswers, submitBidAs, type FixSuite } from '../suite.ts';

const formTotal = 98_020;

/** Fills in the newest supplier proposal form with this total and bids the given amount with it. */
async function bidWithOnlineForm(database: PGlite, amount: number) {
  const businessId = await createUser(database, { accountType: 'business' });
  const supplierId = await createUser(database, { accountType: 'supplier' });
  const tenderId = await createTender(database, businessId, 'accepting-bids');
  const answers = { ...(await completeAnswers(database, 'supplier-proposal')), total_bid_value: formTotal };
  const inserted = await runAs<{ id: string }>(
    database,
    user(supplierId),
    `insert into public.form_submissions (form_key, form_version, owner_id, data)
     select key, version, $1, $2 from public.form_definitions where key = 'supplier-proposal' order by version desc limit 1 returning id`,
    [supplierId, JSON.stringify(answers)],
  );
  const formId = assertSucceeded(inserted, 'fill in the proposal form')[0]?.id;
  return runAs(database, user(supplierId), `select public.submit_bid($1, $2, $3, $4)`, [tenderId, randomUUID(), amount, formId]);
}

export const bidTotalSuite: FixSuite = {
  migration: '20261117050000_bid_total_matches_form.sql',
  title: "Bids: an online proposal form's total bid value must be the bid amount",
  cases: [
    {
      name: 'A bid whose online form states a different total is refused, naming both amounts',
      run: async (database) => {
        assertRefused(await bidWithOnlineForm(database, 98_000), 'form says 98,020, bid says 98,000', /must match your bid amount/);
      },
    },
    {
      name: 'A bid whose online form states the same total is accepted',
      alreadyHeldBefore: true,
      run: async (database) => {
        assertSucceeded(await bidWithOnlineForm(database, formTotal), 'form and bid both 98,020');
      },
    },
    {
      name: 'A bid with an uploaded proposal file has no form total to check',
      alreadyHeldBefore: true,
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const tenderId = await createTender(database, businessId, 'accepting-bids');
        assertSucceeded(await submitBidAs(database, supplierId, tenderId, { amount: 98_000 }), 'bid with a proposal file');
      },
    },
  ],
};
