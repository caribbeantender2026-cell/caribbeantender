// A business completes the Business Registration Form before it can post tenders (Rockell, 22 Nov 2026).
import { expect, test } from '@playwright/test';
import { createAccount } from '../rls/target.ts';
import { signIn, skipTour } from './session.ts';

test('A new business is sent to the Business Registration Form and reaches My Tenders once it is complete', async ({ browser }) => {
  const business = await createAccount('e2e-unregistered', 'business', undefined, { isRegistered: false });
  // Logging in takes a business to its tenders, which sends an unregistered one to the form.
  const page = await signIn(browser, business);
  await expect(page).toHaveURL(/\/forms\/business-registration\?required=1$/);
  await expect(page.getByText('Complete your Business Registration Form to start posting tenders.')).toBeVisible();

  // Going straight to a business page doesn't get round it.
  await page.goto('/business/tenders/new');
  await expect(page).toHaveURL(/\/forms\/business-registration\?required=1$/);

  // A partly filled form isn't enough.
  // Exact: "Trading name (if different from company name)" contains these words too.
  await page.getByLabel('Company name', { exact: true }).fill('Registration Test Ltd');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Tax Registration Number (TRN) is required.')).toBeVisible();
  await expect(page).toHaveURL(/\/forms\/business-registration/);

  for (const [label, answer] of [
    ['Tax Registration Number (TRN)', '123-456-789'],
    ['Street address', '1 Test Road'],
    ['Town/City', 'Kingston'],
    ['Contact person', 'Test Person'],
    ['Position/Title', 'Director'],
    ['Email address', 'registration-test@example.com'],
    ['Phone number', '876-555-0100'],
    ['Years in operation', '5'],
    ['Authorized representative name', 'Test Person'],
    ['Position', 'Director'],
    ['Date', '2026-11-24'],
  ] as const) {
    await page.getByLabel(label, { exact: true }).fill(answer);
  }
  await page.getByRole('group', { name: 'Industry' }).getByRole('checkbox').first().check();
  await page.getByRole('group', { name: 'Parish' }).getByRole('radio', { name: 'Kingston' }).check();
  await page.getByRole('group', { name: 'Declaration' }).getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page).toHaveURL(/\/business$/);
  await skipTour(page);
  await expect(page.getByRole('heading', { name: 'My tenders' })).toBeVisible();
});
