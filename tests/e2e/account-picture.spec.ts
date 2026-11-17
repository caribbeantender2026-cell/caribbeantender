// A person adds a picture to their account on the Company profile page, sees it load in the header,
// and removes it again. Who else may see it is covered by the database tests (07-account-pictures).
import { expect, test } from '@playwright/test';
import { createAccount, testPassword } from '../rls/target.ts';

// A 1×1 PNG: the smallest picture the browser can open and shrink.
const pictureBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('A business adds a picture, sees it in the header, and removes it', async ({ page }) => {
  const business = await createAccount('e2e-picture', 'business');
  await page.goto('/login');
  await page.getByLabel('Email Address').fill(business.email);
  await page.getByLabel('Password').fill(testPassword);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
  await page.getByRole('button', { name: 'Skip the tour' }).click();
  // The tour closes once the skip is saved; leaving the page sooner would cancel that and bring it back.
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('/business/profile');
  const fileChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload a picture' }).click();
  await (await fileChooser).setFiles({ name: 'logo.png', mimeType: 'image/png', buffer: pictureBytes });
  const accountButton = page.getByRole('button', { name: /^Account menu/ });
  const headerPicture = accountButton.locator('img[src*="/account-pictures/"]');
  await expect(headerPicture).toBeVisible();
  // Visible isn't enough: the security headers or a wrong link would leave an image that never loads.
  await expect(headerPicture).not.toHaveJSProperty('naturalWidth', 0);

  await page.getByRole('button', { name: 'Remove picture' }).click();
  await expect(headerPicture).toHaveCount(0);
});
