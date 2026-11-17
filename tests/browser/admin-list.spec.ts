import { expect, test } from '@playwright/test';

// This fixture exercises the UI's choice of action after the backend reports an
// unfinished ban. PostgreSQL tests independently cover the admin authorization.
test('An admin reaches the 51st tender and retries the original account action', async ({ page }) => {
  const id = '00000000-0000-4000-a000-000000000010';
  const expiry = Math.floor(Date.now() / 1000) + 3600;
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = [encode({ alg: 'HS256' }), encode({ sub: id, aal: 'aal2', exp: expiry }), 'Zml4dHVyZQ'].join('.');
  await page.addInitScript(({ id, token, expiry }) => {
    localStorage.setItem('sb-127-auth-token', JSON.stringify({
      access_token: token, refresh_token: 'fixture', expires_at: expiry, user: { id, user_metadata: {}, factors: [] },
    }));
  }, { id, token, expiry });
  let pending = true;
  let requested: boolean | null = null;
  await page.route('http://127.0.0.1:54392/**', async (route) => {
    const resource = new URL(route.request().url()).pathname.split('/').pop();
    if (resource === 'set-user-active') {
      requested = route.request().postDataJSON().is_active;
      pending = false;
      return route.fulfill({ json: { result: 'deactivated' } });
    }
    if (resource === 'admin_list_tenders') {
      const offset = Number(route.request().postDataJSON().page_offset);
      const rows = Array.from({ length: offset ? 1 : 51 }, (_, index) => ({
        tender_id: String(index + offset), title: 'Tender ' + (index + offset + 1), status: 'closed', closes_at: '2026-01-01T00:00:00Z',
      }));
      return route.fulfill({ json: rows });
    }
    const lists: Record<string, object[]> = {
      profiles: [{ id, is_active: true }], staff_members: [{ role: 'admin' }],
      admin_list_users: [{ user_id: 'fixture-user', full_name: 'Test supplier', is_active: false, auth_sync_pending: pending }],
    };
    return route.fulfill({ json: lists[resource ?? ''] ?? [] });
  });
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('cell', { name: 'Tender 51', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Retry deactivation' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Deactivate', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reactivate', exact: true })).toBeVisible();
  expect(requested).toBe(false);
});
