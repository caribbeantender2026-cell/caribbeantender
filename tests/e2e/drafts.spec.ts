// A business that left a tender unpublished is taken back to it when it next logs in (Tevin, 24 Nov 2026:
// a business saved a draft, left, and never published it).
import { expect, test } from '@playwright/test';
import { createAccount } from '../rls/target.ts';
import { signIn } from './session.ts';

test('Logging in with an unpublished draft opens that draft, with what is left to do', async ({ browser }) => {
  const business = await createAccount('e2e-draft-business', 'business');
  const created = await business.client
    .from('tenders')
    .insert({ business_id: business.userId, title: 'Office furniture', description: 'Twenty desks', closes_at: new Date(Date.now() + 7 * 86_400_000).toISOString() })
    .select('id')
    .single();
  expect(created.error).toBeNull();

  const page = await signIn(browser, business);
  await expect(page).toHaveURL(new RegExp(`/business/tenders/${created.data?.id}/edit$`));
  await expect(page.getByRole('heading', { name: 'Not published yet' })).toBeVisible();
});

test('Logging in with no unpublished draft opens My tenders as before', async ({ browser }) => {
  const business = await createAccount('e2e-no-draft-business', 'business');
  const page = await signIn(browser, business);
  await expect(page).toHaveURL(/\/business$/);
});
