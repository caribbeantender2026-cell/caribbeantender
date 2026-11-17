import { expect, test } from '@playwright/test';

test('An open tender accepts a bid on a fast device and recovers the receipt after a lost response', async ({ page }) => {
  const supplier = '00000000-0000-4000-a000-000000000001';
  const tender = '00000000-0000-4000-a000-000000000002';
  const serverTime = Date.now();
  await page.clock.install({ time: new Date(serverTime + 300_000) });
  await page.addInitScript(({ supplier, serverTime }) => {
    // Only the isolated browser configuration uses this loopback Auth fixture.
    localStorage.setItem('sb-127-auth-token', JSON.stringify({
      access_token: 'browser-fixture', refresh_token: 'browser-fixture',
      expires_at: Math.floor(serverTime / 1000) + 3600,
      user: { id: supplier, email: 'supplier@example.test', user_metadata: {} },
    }));
  }, { supplier, serverTime });
  let tenderReads = 0;
  let committed = false;
  let checkedServerDeadline = false;
  await page.route('http://127.0.0.1:54392/**', async (route) => {
    const url = new URL(route.request().url());
    const resource = url.pathname.split('/').pop();
    if (resource === 'submit_bid') {
      committed = true;
      return route.fulfill({ status: 504, json: { message: 'Response timed out' } });
    }
    if (url.pathname.startsWith('/storage/')) return route.fulfill({ json: { Key: 'proposal.pdf' } });
    let rows: object[] = [];
    if (resource === 'profiles') rows = [{ id: supplier, is_active: true, onboarding_completed: { supplier: true } }];
    if (resource === 'supplier_profiles') rows = [{ user_id: supplier, company_name: 'Local supplier' }];
    if (resource === 'server_time') {
      checkedServerDeadline = true;
      return route.fulfill({ json: new Date(serverTime).toISOString() });
    }
    if (resource === 'subscriptions') rows = [{ status: 'trial', trial_ends_at: new Date(serverTime + 60_000).toISOString() }];
    if (resource === 'tenders') {
      tenderReads++;
      rows = [{ id: tender, title: 'Local tender', status: 'open', closes_at: new Date(serverTime + 60_000).toISOString() }];
    }
    if (resource === 'bids' && committed) rows = [{ amount: 1000, currency: 'JMD', submitted_at: new Date(serverTime).toISOString() }];
    return route.fulfill({ json: rows });
  });

  await page.goto('/tenders/' + tender + '/bid');
  await page.getByLabel('Amount (Jamaican dollars, JMD)').fill('1000');
  const initialReads = tenderReads;
  await page.clock.fastForward(15_000);
  expect(tenderReads).toBe(initialReads);
  await page.getByLabel('Proposal file').setInputFiles({ name: 'proposal.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fixture') });
  await page.getByRole('button', { name: 'Submit sealed bid' }).click();
  await page.getByRole('button', { name: 'Submit my bid' }).click();
  await expect(page.getByText(/Bid received:/)).toBeVisible();
  expect(checkedServerDeadline).toBe(true);
});
