import { expect, test } from '@playwright/test';

// The business pages remember "not registered" from the redirect; saving the form must replace that
// answer, or the business is sent straight back to the form (Rockell's review, 22 Nov 2026).
test('Saving the required Business Registration Form takes the business on to My tenders', async ({ page, context }) => {
  const businessId = '00000000-0000-4000-a000-000000000021';
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const session = {
    access_token: [encode({ alg: 'HS256' }), encode({ sub: businessId, session_id: businessId, exp: expires }), 'Zml4dHVyZQ'].join('.'),
    refresh_token: 'fixture-' + businessId, token_type: 'bearer', expires_in: 3600, expires_at: expires,
    user: { id: businessId, email: businessId + '@example.test', user_metadata: {}, app_metadata: {} },
  };
  let isRegistered = false;
  await page.addInitScript((initial) => localStorage.setItem('sb-127-auth-token', JSON.stringify(initial)), session);
  await context.route('http://127.0.0.1:54392/**', async (route) => {
    const url = new URL(route.request().url());
    const resource = url.pathname.split('/').pop();
    if (resource === 'business_registration_complete') return route.fulfill({ json: isRegistered });
    if (resource === 'form_submissions' && route.request().method() === 'POST') {
      isRegistered = true;
      return route.fulfill({ json: { id: 'saved-registration' } });
    }
    let rows: object[] = [];
    if (resource === 'profiles') rows = [{ id: businessId, is_active: true, onboarding_completed: { business: true } }];
    if (resource === 'business_profiles') rows = [{ user_id: businessId, company_name: 'Test business' }];
    if (resource === 'form_definitions') {
      rows = [{ key: 'business-registration', version: 1, title: 'Business Registration', schema: { fields: [{ name: 'company', label: 'Company', type: 'text', required: true }] } }];
    }
    return route.fulfill({ json: rows });
  });

  await page.goto('/business');
  await expect(page).toHaveURL(/\/forms\/business-registration\?required=1$/);
  await page.getByLabel('Company', { exact: true }).fill('Registered business');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My tenders' })).toBeVisible();
  await expect(page).toHaveURL(/\/business$/);
});
