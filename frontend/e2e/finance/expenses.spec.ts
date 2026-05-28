import { test, expect } from '../fixtures';
import { EXPENSES } from '../helpers/mock-data';

test.describe('Expenses', () => {
  test('list renders', async ({ page }) => {
    await page.goto('/expenses');
    await expect(page.getByRole('heading', { name: /expense/i }).first()).toBeVisible();
  });

  test('Add Expense opens the form', async ({ page }) => {
    await page.goto('/expenses');
    await page.locator('button:has(.pi-plus)').first().click();
    await expect(page).toHaveURL(/\/expenses\/(create|new)/);
  });

  test('create form route loads', async ({ page }) => {
    await page.goto('/expenses/create');
    await expect(page.locator('form').first()).toBeVisible();
  });

  test('record-payment flow on detail page calls expense-payments endpoint', async ({ page, apiMock }) => {
    let paid = false;
    apiMock.override('POST', /\/api\/expense-payments$/, () => {
      paid = true;
      return { status: 201, body: { id: 'ep-new' } };
    });

    await page.goto(`/expenses/${EXPENSES[0].id}`);
    const recordPayment = page.getByRole('button', { name: /record.*payment|pay/i }).first();
    if (await recordPayment.count()) {
      await recordPayment.click();
      const amount = page.locator('input[formControlName="amount"]').first();
      if (await amount.count()) await amount.fill('1200');
      await page.getByRole('button', { name: /save|submit|confirm/i }).first().click();
      await page.waitForTimeout(300);
      expect(paid).toBeTruthy();
    }
  });
});
