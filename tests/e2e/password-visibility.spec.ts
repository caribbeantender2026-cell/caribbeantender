// The eye button on password fields shows what was typed and hides it again; every password field has one.
import { expect, test } from '@playwright/test';

test('The eye button shows and hides a typed password', async ({ page }) => {
  await page.goto('/login');
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('typed-secret');
  await expect(password).toHaveAttribute('type', 'password');

  const eye = page.getByRole('button', { name: 'Show password' });
  await eye.click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('typed-secret');
  await expect(eye).toHaveAttribute('aria-pressed', 'true');

  await eye.click();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(eye).toHaveAttribute('aria-pressed', 'false');

  await page.goto('/register');
  await expect(page.getByRole('button', { name: 'Show password' })).toHaveCount(2);
});
