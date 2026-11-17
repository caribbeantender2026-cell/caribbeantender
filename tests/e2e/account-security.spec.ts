// Sign-in safety fixes from the 17 Nov 2026 review, in a real browser against the client's project.
// No email is sent: reset links come from the admin API, and the one resend is answered in the browser.
import { expect, test } from '@playwright/test';
import { adminClient, anonymousClient, canSignIn, createAccount, currentTotpCode, runIdentifier, testPassword } from '../rls/target.ts';
import { signIn, skipTour } from './session.ts';

const invalidResetLink = 'This password-reset link is invalid or has expired.';
const expiredLinkHash = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired';

test('The reset page shows no form to a signed-in person who did not arrive from a reset link', async ({ browser }) => {
  const account = await createAccount('e2e-signed-in', 'business');
  const page = await signIn(browser, account);
  await page.goto('/reset-password');
  await expect(page.getByText(invalidResetLink)).toBeVisible();
  await expect(page.getByLabel('New Password', { exact: true })).toHaveCount(0);
  // Someone else's expired link opened on this computer: the signed-in session stays, the form must not show.
  await page.goto(`/reset-password${expiredLinkHash}`);
  await expect(page.getByText(invalidResetLink)).toBeVisible();
  await expect(page.getByLabel('New Password', { exact: true })).toHaveCount(0);
});

test("A real reset link opens the form for the link's own account, whoever was signed in", async ({ browser }) => {
  const signedIn = await createAccount('e2e-computer-owner', 'business');
  const resetter = await createAccount('e2e-resetter', 'supplier');
  const page = await signIn(browser, signedIn);
  const link = await adminClient.auth.admin.generateLink({ type: 'recovery', email: resetter.email });
  expect(link.error).toBeNull();
  const verified = await anonymousClient().auth.verifyOtp({ type: 'recovery', token_hash: link.data.properties?.hashed_token ?? '' });
  const session = verified.data.session;
  expect(session).not.toBeNull();
  // The hash Supabase puts on the link's redirect to the site.
  const redirectHash = new URLSearchParams({
    access_token: session?.access_token ?? '',
    refresh_token: session?.refresh_token ?? '',
    expires_in: String(session?.expires_in ?? 0),
    expires_at: String(session?.expires_at ?? 0),
    token_type: 'bearer',
    type: 'recovery',
  });
  await page.goto(`/reset-password#${redirectHash.toString()}`);
  const newPassword = `Reset-${runIdentifier}-password`;
  await page.getByLabel('New Password', { exact: true }).fill(newPassword);
  await page.getByLabel('Confirm New Password').fill(newPassword);
  await page.getByRole('button', { name: 'Update Password' }).click();
  await expect(page).toHaveURL(/\/login\?reset=success/);
  expect(await canSignIn(resetter.email)).toBe(false);
  expect((await anonymousClient().auth.signInWithPassword({ email: resetter.email, password: newPassword })).error).toBeNull();
  expect(await canSignIn(signedIn.email), "the signed-in person's password is untouched").toBe(true);
});

test('Log out signs out this device only', async ({ browser }) => {
  // The account's API client stands for the person's other device.
  const account = await createAccount('e2e-two-devices', 'business');
  const page = await signIn(browser, account);
  await skipTour(page);
  await page.getByRole('button', { name: /^Account menu for/ }).click();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect((await account.client.auth.refreshSession()).error, 'the other device is still signed in').toBeNull();
});

test('An expired confirmation link says so, and logging in unconfirmed offers a new link', async ({ page }) => {
  const email = `rls-test-${runIdentifier}-e2e-unconfirmed@example.com`;
  const created = await adminClient.auth.admin.createUser({
    email,
    password: testPassword,
    email_confirm: false,
    user_metadata: { full_name: 'Test unconfirmed', account_type: 'supplier', accepted_terms: true },
  });
  expect(created.error).toBeNull();
  await page.goto(`/login${expiredLinkHash}`);
  await expect(page.getByText('That email link has expired or was already used.')).toBeVisible();
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(testPassword);
  await page.getByRole('button', { name: 'Log in' }).click();
  // Answered here, so nothing is emailed to the reserved test domain.
  let resendBody: unknown = null;
  await page.route('**/auth/v1/resend**', async (route) => {
    resendBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.getByRole('button', { name: 'Send a new confirmation link' }).click();
  await expect(page.getByText(`A new confirmation link is on its way to ${email}.`)).toBeVisible();
  expect(resendBody).toMatchObject({ type: 'signup', email });
});

test('An admin who left the authenticator set-up halfway can start it again', async ({ browser }) => {
  const account = await createAccount('e2e-new-admin', 'business');
  const staff = await adminClient.from('staff_members').insert({ user_id: account.userId, role: 'admin' });
  expect(staff.error).toBeNull();
  const page = await signIn(browser, account);
  await skipTour(page);
  await page.goto('/admin');
  const qrCode = page.getByRole('img', { name: 'QR code for your authenticator app' });
  await page.getByRole('button', { name: 'Set up an authenticator app' }).click();
  await expect(qrCode).toBeVisible();
  // Left before entering a code, then back the same day.
  await page.reload();
  await page.getByRole('button', { name: 'Set up an authenticator app' }).click();
  await expect(qrCode).toBeVisible();
  const secret = (await page.locator('code').textContent()) ?? '';
  await page.getByLabel('6-digit code').fill(currentTotpCode(secret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByLabel('Search by name, email or company')).toBeVisible();
});
