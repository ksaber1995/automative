import { test, expect } from '../fixtures';

test.describe('Refunds', () => {
  test('list renders', async ({ page }) => {
    await page.goto('/refunds');
    await expect(page.getByRole('heading', { name: /refunds/i })).toBeVisible();
  });
});

test.describe('Dues', () => {
  test('list renders', async ({ page }) => {
    await page.goto('/dues');
    await expect(page.getByRole('heading', { name: /dues/i })).toBeVisible();
  });
});

test.describe('Debts', () => {
  test('list renders', async ({ page }) => {
    await page.goto('/debts');
    await expect(page.getByRole('heading', { name: /debts/i })).toBeVisible();
  });
});

test.describe('Cash', () => {
  test('list renders', async ({ page }) => {
    await page.goto('/cash');
    await expect(page.getByRole('heading', { name: /cash/i })).toBeVisible();
  });

  test('handles empty state', async ({ page, apiMock }) => {
    apiMock.override('GET', /\/api\/cash\/?.*/, () => ({ body: { balance: 0, ledger: [] } }));
    await page.goto('/cash');
    await expect(page.getByRole('heading', { name: /cash/i })).toBeVisible();
  });
});
