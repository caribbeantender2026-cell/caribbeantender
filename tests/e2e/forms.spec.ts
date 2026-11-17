// The client's forms download as Word files from the Forms page (Rockell, 17 Nov 2026).
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createAccount } from '../rls/target.ts';
import { signIn, skipTour } from './session.ts';

test('A supplier downloads the Bid Submission Form as a Word file', async ({ browser }) => {
  const supplier = await createAccount('e2e-forms', 'supplier');
  const page = await signIn(browser, supplier);
  await skipTour(page);
  await page.goto('/forms');
  const bidForm = page.getByRole('listitem').filter({ hasText: 'Bid Submission Form' });
  const download = page.waitForEvent('download');
  await bidForm.getByRole('button', { name: 'Download (Word)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('caribbeantender-bid-submission-form.docx');
  // A .docx is a zip archive, which starts with "PK".
  expect(readFileSync(await file.path()).subarray(0, 2).toString()).toBe('PK');
});
