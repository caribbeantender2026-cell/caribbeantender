/// <reference lib="dom" />
/** The SDK verifies an email link asynchronously before notifying the mounted reset form. */
import { expect, test } from '@playwright/test';

test('A verified recovery link opens the form without showing an invalid-link notice', async ({ page }) => {
  const userId = '00000000-0000-4000-a000-000000000024';
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = [encode({ alg: 'HS256' }), encode({ sub: userId, session_id: userId, exp: expires }), 'Zml4dHVyZQ'].join('.');
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.body?.innerText.includes('This password-reset link is invalid')) document.documentElement.dataset.invalidResetSeen = 'true';
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  await page.route('http://127.0.0.1:54392/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/auth/v1/user') return route.fulfill({ json: { id: userId, email: 'test@example.test', user_metadata: {} } });
    return route.fulfill({ json: [] });
  });
  const link = new URLSearchParams({ access_token: token, refresh_token: 'fixture', token_type: 'bearer',
    expires_in: '3600', expires_at: String(expires), type: 'recovery' });
  await page.goto('/reset-password#' + link.toString());
  await expect(page.getByLabel('New Password', { exact: true })).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-invalid-reset-seen', 'true');
  await page.goto('/reset-password#error=access_denied&error_code=otp_expired');
  await expect(page.getByText(/This password-reset link is invalid/)).toBeVisible();
});
