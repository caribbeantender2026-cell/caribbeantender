// The home page's demo: a pointer clicks through the business and supplier scenarios, the tabs switch
// between them, nothing inside the demo can be used, and reduced motion holds each scenario still.
import { expect, test, type Page } from '@playwright/test';

const pauseLongerThanOneTickMilliseconds = 2000;
const oneWholeScenarioMilliseconds = 30_000;

function demo(page: Page) {
  return page.locator('[inert]');
}

function countdown(page: Page) {
  return demo(page).getByText(/^\d+ minutes? \d+ seconds?$/);
}

test('The business scenario posts, publishes and awards a tender', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'For Businesses' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('img', { name: /a business posts a tender/ })).toBeVisible();
  await expect(demo(page).getByText('Supply of 40 ergonomic office chairs')).toBeVisible({ timeout: oneWholeScenarioMilliseconds });
  await expect(demo(page).getByText('Bids are sealed until the closing time', { exact: false })).toBeVisible({ timeout: oneWholeScenarioMilliseconds });
  await expect(demo(page).getByText('Unsuccessful').first()).toBeVisible({ timeout: oneWholeScenarioMilliseconds });
});

test('The supplier tab plays the supplier scenario, with a live countdown and a receipt', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'For Suppliers' }).click();
  await expect(page.getByRole('img', { name: /a supplier finds a tender/ })).toBeVisible();
  // The open tenders list is on screen longest, so its countdown is where the ticking is checked.
  const listedTimeLeft = demo(page).getByText(/^\d+ minutes? \d+ seconds? left$/);
  await expect(listedTimeLeft).toBeVisible();
  const firstReading = await listedTimeLeft.textContent();
  await expect(listedTimeLeft).not.toHaveText(firstReading ?? '');
  await expect(countdown(page)).toBeVisible();
  // Inside an inert area the button can't be clicked or focused.
  await expect(demo(page).getByText('Submit a bid')).toBeVisible();
  await expect(demo(page).getByText(/^Bid received:/)).toBeVisible({ timeout: oneWholeScenarioMilliseconds });
  await expect(demo(page).getByText('Awarded')).toBeVisible({ timeout: oneWholeScenarioMilliseconds });
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('Each tab shows one still screen', async ({ page }) => {
    await page.goto('/');
    await expect(demo(page).getByText('Unsuccessful').first()).toBeVisible();
    await page.getByRole('button', { name: 'For Suppliers' }).click();
    await expect(countdown(page)).toBeVisible();
    const firstReading = await countdown(page).textContent();
    await page.waitForTimeout(pauseLongerThanOneTickMilliseconds);
    await expect(countdown(page)).toHaveText(firstReading ?? '');
  });
});
