import { test, expect } from '../fixtures';

test.describe('Create branch', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/branches/create');
  });

  test('renders empty form', async ({ page }) => {
    await expect(page.locator('#name')).toBeVisible();
    await expect(page.locator('#code')).toBeVisible();
  });

  test('submit is disabled when form is empty', async ({ page }) => {
    // The form's submit p-button is bound to `[disabled]="branchForm.invalid || loading()"`,
    // so on an empty form it must be disabled.
    const submit = page.locator('p-button[type="submit"] button, button[type="submit"]').last();
    await expect(submit).toBeDisabled();
  });

  async function fillBranchForm(page: import('@playwright/test').Page) {
    await page.locator('#name').fill('New Test Branch');
    await page.locator('#code').fill('NTB01');
    await page.locator('#address').fill('123 New St');
    await page.locator('#city').fill('Testville');
    await page.locator('#phone').fill('+201234500000');
    const email = page.locator('#email');
    if (await email.count()) await email.fill('new@acme.test');
    // Opening date is a p-datepicker — type directly into the inner input.
    const openingDate = page.locator('input#openingDate, p-datepicker input').first();
    if (await openingDate.count()) {
      await openingDate.fill('2025-01-01');
      await page.keyboard.press('Escape');
    }
  }

  test('successful create returns to the list', async ({ page, apiMock }) => {
    let received: any = null;
    apiMock.override('POST', /\/api\/branches$/, (_, req) => {
      received = req.postDataJSON();
      return { status: 201, body: { id: 'b-new', ...(received as object) } };
    });

    await fillBranchForm(page);
    await page.locator('button[type="submit"]').click();

    await expect(page).toHaveURL(/\/branches$/);
    expect(received).toMatchObject({ name: 'New Test Branch', code: 'NTB01' });
  });

  test('surfaces a server validation error from the new errorHandler', async ({ page, apiMock }) => {
    apiMock.override('POST', /\/api\/branches$/, () => ({
      status: 400,
      body: { message: 'email: Invalid email' },
    }));

    await fillBranchForm(page);
    await page.locator('button[type="submit"]').click();

    await expect(page.locator('.p-toast, .p-message').filter({ hasText: /email|invalid/i }).first())
      .toBeVisible({ timeout: 7_000 });
  });
});
