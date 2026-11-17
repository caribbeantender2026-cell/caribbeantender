// The home page's live example tender: its countdown ticks, nothing in it can be used, and reduced motion stops it.
import { expect, test, type Page } from '@playwright/test';

const pauseLongerThanOneTickMilliseconds = 2000;

function countdown(page: Page) {
  return page.getByText(/^\d+ minutes \d+ seconds?$/);
}

test('The example tender counts down and is a picture, not something to click', async ({ page }) => {
  await page.goto('/');
  await expect(countdown(page)).toBeVisible();
  const firstReading = await countdown(page).textContent();
  await expect(countdown(page)).not.toHaveText(firstReading ?? '');
  await expect(page.getByRole('img', { name: /An example tender on CaribbeanTender/ })).toBeVisible();
  // Inside an inert area the button can't be clicked or focused.
  await expect(page.locator('[inert]').getByText('Submit a bid')).toBeVisible();
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('The example tender stays still', async ({ page }) => {
    await page.goto('/');
    await expect(countdown(page)).toBeVisible();
    const firstReading = await countdown(page).textContent();
    await page.waitForTimeout(pauseLongerThanOneTickMilliseconds);
    await expect(countdown(page)).toHaveText(firstReading ?? '');
  });
});
