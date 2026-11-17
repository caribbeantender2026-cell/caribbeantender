import { expect, test } from '@playwright/test';

test('Changing the signed-in person in another tab clears the open form and its unsaved answers', async ({ page, context }) => {
  const first = '00000000-0000-4000-a000-000000000011';
  const second = '00000000-0000-4000-a000-000000000012';
  const expires = Math.floor(Date.now() / 1000) + 3600;
  function session(id: string) {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return {
      access_token: [encode({ alg: 'HS256' }), encode({ sub: id, session_id: id, exp: expires }), 'Zml4dHVyZQ'].join('.'),
      refresh_token: 'fixture-' + id, token_type: 'bearer', expires_in: 3600, expires_at: expires,
      user: { id, email: id + '@example.test', user_metadata: {}, app_metadata: {} },
    };
  }
  await page.addInitScript((initial) => localStorage.setItem('sb-127-auth-token', JSON.stringify(initial)), session(first));
  await context.route('http://127.0.0.1:54392/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/auth/v1/token') return route.fulfill({ json: session(second) });
    const resource = url.pathname.split('/').pop();
    let rows: object[] = [];
    if (resource === 'profiles') rows = [{ id: url.searchParams.get('id')?.slice(3), is_active: true, onboarding_completed: { supplier: true } }];
    if (resource === 'supplier_profiles') rows = [{ user_id: url.searchParams.get('user_id')?.slice(3), company_name: 'Test supplier' }];
    if (resource === 'form_definitions') rows = [{ key: 'supplier-registration', version: 1, title: 'Supplier Registration', schema: { fields: [{ name: 'company', label: 'Company', type: 'text', required: true }] } }];
    if (resource === 'form_submissions' && url.searchParams.get('owner_id') === 'eq.' + first) {
      rows = [{ id: 'saved-form', form_version: 1, data: { company: 'First company' }, attached_to_type: null }];
    }
    return route.fulfill({ json: rows });
  });
  await page.goto('/forms/supplier-registration?submission=saved-form');
  await expect(page.getByLabel('Company', { exact: true })).toHaveValue('First company');
  await page.getByLabel('Company', { exact: true }).fill('Unsubmitted change');
  const login = await context.newPage();
  await login.goto('/login');
  await login.getByLabel('Email Address').fill('second@example.test');
  await login.getByLabel('Password', { exact: true }).fill('local-fixture');
  await login.getByRole('button', { name: 'Log in' }).click();
  await expect(login).toHaveURL(/\/supplier$/);
  await expect(page.getByLabel('Company', { exact: true })).toHaveValue('');
});
