/** Signing test accounts in through the real login page, shared by the end-to-end specs. */
import { expect, type Browser, type Page } from '@playwright/test';
import { testPassword, type TestAccount } from '../rls/target.ts';

/** Logs an account in from a fresh browser context, as its own device. */
export async function signIn(browser: Browser, account: TestAccount): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.getByLabel('Email Address').fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(testPassword);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  return page;
}

/** Closes the first-visit tour that greets every new account. */
export async function skipTour(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Skip the tour' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
