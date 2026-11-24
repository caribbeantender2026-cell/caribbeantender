// The home page's demo: a pointer clicks through the business and supplier scenarios, the tabs switch
// between them, nothing inside the demo can be used, and reduced motion holds each scenario still.
import { expect, test, type Page } from '@playwright/test';

const pauseLongerThanOneTickMilliseconds = 2000;
// The business scenario runs about 33 seconds since it was slowed down (Rockell, 22 Nov 2026).
const oneWholeScenarioMilliseconds = 45_000;

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

test('Back, Pause and Next go through the numbered steps at the visitor\'s pace', async ({ page }) => {
  await page.goto('/');
  const steps = page.getByRole('group', { name: 'Demo steps' });
  await expect(page.getByText('Step 1 of 5')).toBeVisible();
  await expect(page.getByText('A business posts a tender', { exact: true })).toBeVisible();
  await expect(steps.getByRole('button', { name: 'Back' })).toBeDisabled();

  await steps.getByRole('button', { name: 'Pause' }).click();
  await steps.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('Step 2 of 5')).toBeVisible();
  await expect(page.getByText('The business publishes it', { exact: true })).toBeVisible();
  await expect(page.getByText(/then select Publish/)).toBeVisible();
  // Paused, the step stays put.
  await page.waitForTimeout(pauseLongerThanOneTickMilliseconds * 2);
  await expect(page.getByText('Step 2 of 5')).toBeVisible();

  await steps.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByText('Step 1 of 5')).toBeVisible();
  // Next after the last step moves on to the supplier's scenario, still paused.
  for (let scene = 1; scene <= 5; scene += 1) await steps.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('button', { name: 'For Suppliers' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Step 1 of 5')).toBeVisible();
  await expect(steps.getByRole('button', { name: 'Play' })).toBeVisible();
});

test('Pause stops the countdown, and Play carries on from where it stopped', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'For Suppliers' }).click();
  const listedTimeLeft = demo(page).getByText(/^\d+ minutes? \d+ seconds? left$/);
  await expect(listedTimeLeft).toBeVisible();
  const secondsLeft = async () => {
    const [minutes = 0, seconds = 0] = ((await listedTimeLeft.textContent()) ?? '').match(/\d+/g)?.map(Number) ?? [];
    return minutes * 60 + seconds;
  };

  await page.getByRole('group', { name: 'Demo steps' }).getByRole('button', { name: 'Pause' }).click();
  const pausedReading = await listedTimeLeft.textContent();
  await page.waitForTimeout(pauseLongerThanOneTickMilliseconds * 2);
  await expect(listedTimeLeft).toHaveText(pausedReading ?? '');

  const pausedSeconds = await secondsLeft();
  await page.getByRole('group', { name: 'Demo steps' }).getByRole('button', { name: 'Play' }).click();
  await expect(listedTimeLeft).not.toHaveText(pausedReading ?? '');
  // Counting on from the paused reading, not jumping ahead by the time spent paused.
  expect(await secondsLeft()).toBeGreaterThanOrEqual(pausedSeconds - 2);
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('Next shows each step finished, with no Pause button since nothing moves', async ({ page }) => {
    await page.goto('/');
    const steps = page.getByRole('group', { name: 'Demo steps' });
    await expect(steps.getByRole('button', { name: 'Pause' })).toHaveCount(0);
    // Without motion the supplier tab opens on its still screen, step 2.
    await page.getByRole('button', { name: 'For Suppliers' }).click();
    await expect(page.getByText('Step 2 of 5')).toBeVisible();
    await steps.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('The supplier enters a sealed bid', { exact: true })).toBeVisible();
    // The amount the supplier types is already in the field.
    await expect(demo(page).getByText('980000', { exact: true })).toBeVisible();
  });

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
