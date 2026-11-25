// The PRD section 11 end-to-end list, as one flow through the real app against the client's project.
// Sign-up with email confirmation is not here: it needs a real inbox (OPEN_QUESTIONS.md, item 34).
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { utcToJamaicaLocal } from '../../src/lib/time.ts';
import { createAccount, createAdmin, currentTotpCode, expireTrial, runIdentifier, type TestAccount } from '../rls/target.ts';
import { signIn, skipTour } from './session.ts';

test.describe.configure({ mode: 'serial' });

const closingDelayMilliseconds = 5 * 60 * 1000;
const closeJobGraceMilliseconds = 80 * 1000;
const tenderTitle = `rls-test-${runIdentifier} office chairs`;
const documentBytes = Buffer.from('%PDF-1.4\nrls-test specification\n%%EOF');

let business: TestAccount;
let supplier: TestAccount;
let lateSupplier: TestAccount;
let expiredSupplier: TestAccount;
let admin: TestAccount & { totpSecret: string };
let tenderId = '';
let closesAt = new Date();

test.beforeAll(async () => {
  business = await createAccount('e2e-business', 'business');
  supplier = await createAccount('e2e-supplier', 'supplier');
  lateSupplier = await createAccount('e2e-late', 'supplier');
  expiredSupplier = await createAccount('e2e-expired', 'supplier');
  await expireTrial(expiredSupplier);
  admin = await createAdmin('e2e-admin');
});

test('Sign-up asks for the Terms before creating anything', async ({ page }) => {
  await page.goto('/register');
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page.getByText('Agree to the Terms of Service and Privacy Policy to create an account.')).toBeVisible();
});

test('The onboarding tour shows once, steps through, and stays finished', async ({ browser }) => {
  const page = await signIn(browser, business);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Post a tender' })).toBeVisible();
  for (let step = 0; step < 4; step += 1) await dialog.getByRole('button', { name: 'Next' }).click();
  await dialog.getByRole('button', { name: 'Finish' }).click();
  // The dialog closes only once the finish is recorded; reloading earlier would cancel that request.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'My tenders' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('A business posts a tender with the Tender Creation Form filled in online and a document', async ({ browser }) => {
  const page = await signIn(browser, business);
  await page.goto('/business/tenders/new');
  closesAt = new Date(Date.now() + closingDelayMilliseconds);
  await page.getByLabel('Title').fill(tenderTitle);
  await page.getByLabel('Category').selectOption({ index: 1 });
  await page.getByLabel('Description').fill('Forty ergonomic office chairs for the head office.');
  await page.getByLabel('Closing date and time (Jamaica time)').fill(utcToJamaicaLocal(closesAt.toISOString()));
  await page.getByRole('button', { name: 'Save draft and add documents' }).click();
  await expect(page).toHaveURL(/\/business\/tenders\/[0-9a-f-]+\/edit/);
  tenderId = page.url().split('/').at(-2) ?? '';
  // A datetime-local has no seconds, so the real closing time is the start of that minute.
  closesAt.setSeconds(0, 0);
  // A saved draft says plainly that it isn't live, and Publish waits for the form (Rockell, 24 Nov 2026).
  const publishButton = page.getByRole('button', { name: 'Publish', exact: true });
  await expect(page.getByRole('heading', { name: 'Not published yet' })).toBeVisible();
  await expect(page.getByText(/^Not filled in yet\./)).toBeVisible();
  await expect(publishButton).toBeDisabled();

  // A half-finished Tender Creation Form saves, and the draft says how much is left.
  await page.getByRole('link', { name: 'Fill in online' }).click();
  await page.getByLabel('Company name', { exact: true }).fill('rls-test Hotels');
  await page.getByRole('button', { name: 'Save and attach to the draft' }).click();
  await expect(page.getByText(/^Started: \d+ answers still to complete\./)).toBeVisible();
  await expect(publishButton).toBeDisabled();

  await page.getByRole('link', { name: 'Continue the form' }).click();
  await expect(page.getByLabel('Company name', { exact: true })).toHaveValue('rls-test Hotels');
  // The client's Tender Creation Form (version 3, Rockell's 24 Nov 2026 changes): only the required answers.
  await page.getByLabel('Goods', { exact: true }).check();
  for (const [label, answer] of [
    ['Tax Registration Number (TRN)', '123-456-789'],
    ['Contact person', 'rls-test contact'],
    ['Position/job title', 'Purchasing manager'],
    ['Email address', 'rls-test@example.com'],
    ['Telephone number', '876-555-0100'],
    ['Company address', '1 Test Road, Kingston'],
    ['Project summary: the goods and/or services required', '40 office chairs'],
    ['Detailed scope of work: deliverables, quantities, standards, locations and special requirements', 'Supply and deliver 40 adjustable chairs'],
    ['Project location(s)', 'Head office'],
    ['Contract duration', 'One delivery'],
    ['Expected/Estimated start date', '2026-12-01'],
    ['Expected/Estimated completion date', '2026-12-15'],
    ['Supplier question deadline', '2026-11-28'],
    ['Evaluation start date', '2026-11-30'],
    ['Evaluation end date', '2026-11-30'],
    ['Expected award date', '2026-11-30'],
    ['Contract commencement date', '2026-12-01'],
    ['Clarification email address: bidders may use this address to request clarification about the tender', 'rls-test-questions@example.com'],
    ['Authorized representative name', 'rls-test representative'],
    ['Position', 'Manager'],
    ['Date', '2026-11-16'],
  ] as const) {
    await page.getByLabel(label, { exact: true }).fill(answer);
  }
  await page.getByLabel('Kingston', { exact: true }).check();
  await page.getByLabel('One-Time Project').check();
  // Each budget amount appears only for its own budget type.
  await expect(page.getByLabel('Fixed budget (JMD)', { exact: true })).toHaveCount(0);
  await page.getByLabel('Budget Range', { exact: true }).check();
  await expect(page.getByLabel('Estimated budget: minimum (JMD)', { exact: true })).toBeVisible();
  await page.getByLabel('Fixed Budget', { exact: true }).check();
  await expect(page.getByLabel('Estimated budget: minimum (JMD)', { exact: true })).toHaveCount(0);
  await page.getByLabel('Fixed budget (JMD)', { exact: true }).fill('250000');
  await page.getByRole('group', { name: 'Suppliers must submit' }).getByRole('checkbox').first().check();
  for (const term of ['Bid Confidentiality', 'Bid Evaluation', 'Contract Award', 'Tender Cancellation', 'Platform Responsibility']) {
    await page.getByRole('group', { name: term }).getByRole('checkbox').check();
  }
  await page.getByLabel(/^I certify that I am authorized/).check();
  await page.getByRole('button', { name: 'Save and attach to the draft' }).click();
  await expect(page.getByText(/^Complete\./)).toBeVisible();
  // Opened again straight away, the saved answers are there (the draft page once cached an empty copy under the same key).
  await page.getByRole('link', { name: 'Edit the form' }).click();
  await expect(page.getByLabel('Company name', { exact: true })).toHaveValue('rls-test Hotels');
  await page.getByRole('link', { name: 'Back to your draft' }).click();
  await page.getByLabel('Add supporting documents').setInputFiles({ name: 'rls-test-spec.pdf', mimeType: 'application/pdf', buffer: documentBytes });
  await expect(page.getByText('rls-test-spec.pdf')).toBeVisible();

  // Published straight from the draft, where the checklist ends.
  await publishButton.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Publish' }).click();
  await expect(page).toHaveURL(new RegExp(`/business/tenders/${tenderId}$`));
  await expect(page.getByText('Open', { exact: true })).toBeVisible();
  // Opening bids early must fail: nothing about the bids shows before the closing time.
  await expect(page.getByText('Bids are sealed until the closing time')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bids' })).toHaveCount(0);
});

test('A supplier browses, filters by category, downloads the document and the form PDF', async ({ browser }) => {
  const page = await signIn(browser, supplier);
  await skipTour(page);
  await page.goto('/tenders');
  await expect(page.getByRole('link', { name: tenderTitle })).toBeVisible();
  const category = page.getByLabel('Category');
  await category.selectOption({ index: 1 });
  await expect(page.getByRole('link', { name: tenderTitle })).toBeVisible();
  await category.selectOption({ index: 2 });
  await expect(page.getByRole('link', { name: tenderTitle })).toHaveCount(0);

  await page.goto(`/tenders/${tenderId}`);
  const documentDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'rls-test-spec.pdf' }).click();
  expect(readFileSync(await (await documentDownload).path())).toEqual(documentBytes);
  const formDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download as PDF' }).click();
  expect(readFileSync(await (await formDownload).path()).subarray(0, 5).toString()).toBe('%PDF-');
});

test('A supplier whose trial has ended sees the contact message instead of the bid form', async ({ browser }) => {
  const page = await signIn(browser, expiredSupplier);
  await skipTour(page);
  await page.goto(`/tenders/${tenderId}/bid`);
  await expect(page.getByText('Your free trial has ended')).toBeVisible();
  await expect(page.getByText('US$79 a month, or US$805.80 a year (save 15%)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit sealed bid' })).toHaveCount(0);
});

test('A supplier bids with the proposal form filled in online and gets the receipt', async ({ browser }) => {
  const page = await signIn(browser, supplier);
  await page.goto(`/tenders/${tenderId}/bid`);
  await page.getByLabel('Amount (Jamaican dollars, JMD)').fill('98000');
  await page.getByLabel('Fill in the supplier proposal form online').check();
  // The client's Bid Submission Form (version 3): only the required answers.
  for (const [label, answer] of [
    ['Company name', 'e2e-supplier Company'],
    ['TRN', '123-456-789'],
    ['Company address', 'Kingston'],
    ['Contact person', 'rls-test supplier contact'],
    ['Telephone number', '876-555-0101'],
    ['Email address', 'rls-test-supplier@example.com'],
    ['Proposal summary: why your company is best suited to deliver', '40 chairs within 14 days'],
    ['How you will carry out the work: key activities, processes, equipment, personnel and quality assurance', 'Deliver from stock'],
    ['Total bid value (JMD)', '98,020.00'],
    ['Proposed start date', '2026-12-01'],
    ['Estimated completion date', '2026-12-15'],
    ['Authorized representative name', 'rls-test supplier representative'],
    ['Position', 'Director'],
    ['Date', '2026-11-16'],
  ] as const) {
    await page.getByLabel(label, { exact: true }).fill(answer);
  }
  // The first table is the pricing schedule, the last the references.
  await page.getByRole('button', { name: 'Add a row' }).first().click();
  await page.getByLabel('Item / Service, row 1').fill('Chair');
  await page.getByLabel('Quantity, row 1').fill('40');
  // Typed as people write prices: thousands commas and cents stay on screen and count in the total.
  const unitPrice = page.getByLabel('Unit price (JMD), row 1');
  await unitPrice.pressSequentially('2,450.50');
  await expect(unitPrice).toHaveValue('2,450.50');
  await expect(page.getByLabel('Total bid value (JMD)', { exact: true })).toHaveValue('98,020.00');
  await expect(page.getByRole('cell', { name: '98,020' })).toBeVisible();
  // The second table is the milestones; a target date is picked from a calendar.
  await page.getByRole('button', { name: 'Add a row' }).nth(1).click();
  await page.getByLabel('Milestone, row 1').fill('Delivery');
  await expect(page.getByLabel('Target date, row 1')).toHaveAttribute('type', 'date');
  await page.getByLabel('Target date, row 1').fill('2026-12-15');
  await page.getByRole('button', { name: 'Add a row' }).last().click();
  await page.getByLabel('Reference name, row 1').fill('rls-test reference');
  await page.getByLabel('Telephone, row 1').fill('876-555-0102');
  await page.getByLabel(/^I\/We certify that the information in this bid/).check();
  // The form's total (98,020) differs from the amount typed above (98,000): refused before anything is sent.
  await page.getByRole('button', { name: 'Submit sealed bid' }).click();
  await expect(page.getByText('The total bid value in the proposal form ($98,020.00) must match your bid amount ($98,000.00).')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Amount (Jamaican dollars, JMD)').fill('98020');
  await page.getByRole('button', { name: 'Submit sealed bid' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit my bid' }).click();
  await expect(page.getByText('Bid received')).toBeVisible();
});

test('The tender closes by itself; a late bid is refused; the business opens the bids and awards', async ({ browser }) => {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, closesAt.getTime() - Date.now() + 2000)));
  const late = await signIn(browser, lateSupplier);
  await skipTour(late);
  await late.goto(`/tenders/${tenderId}/bid`);
  await expect(late.getByText('This tender is no longer taking bids.')).toBeVisible();

  const page = await signIn(browser, business);
  await page.goto(`/business/tenders/${tenderId}`);
  // No reload: the page checks for the close job by itself once the closing time has passed.
  await expect(page.getByText('Closed', { exact: true })).toBeVisible({ timeout: closeJobGraceMilliseconds });
  // The bid's heading; the name also shows in the attached proposal form's answers.
  await expect(page.getByRole('heading', { name: 'e2e-supplier Company' })).toBeVisible();
  await page.getByRole('button', { name: 'Award to this bid' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Award the tender' }).click();
  await expect(page.getByText('Awarded', { exact: true }).first()).toBeVisible();
});

test('An admin verifies with an authenticator code, then sees users and tenders', async ({ browser }) => {
  const page = await signIn(browser, admin);
  await skipTour(page);
  await page.goto('/admin');
  await page.getByLabel('6-digit code').fill(currentTotpCode(admin.totpSecret));
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.getByLabel('Search by name, email or company').fill(`rls-test-${runIdentifier}-e2e-supplier`);
  await expect(page.getByRole('cell', { name: supplier.email })).toBeVisible();
  await expect(page.getByRole('cell', { name: tenderTitle })).toBeVisible();
});
