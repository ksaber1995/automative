import { test, expect } from '../fixtures';
import { BRANCHES } from '../helpers/mock-data';

test.describe('Branch detail', () => {
  test('renders headline + stats', async ({ page }) => {
    const b = BRANCHES[0];
    await page.goto(`/branches/${b.id}`);
    await expect(page.getByRole('heading', { name: b.name })).toBeVisible();
    await expect(page.getByText(/total courses/i)).toBeVisible();
    await expect(page.getByText(/total revenue/i)).toBeVisible();
  });

  test('Edit button navigates to the edit form', async ({ page }) => {
    const b = BRANCHES[0];
    await page.goto(`/branches/${b.id}`);
    await expect(page.getByRole('heading', { name: b.name })).toBeVisible();
    // The detail header has an Edit p-button with pencil icon.
    await page.locator('button:has(.pi-pencil)').first().click();
    await expect(page).toHaveURL(new RegExp(`/branches/${b.id}/edit$`));
  });

  test('handles a 404 gracefully', async ({ page, apiMock }) => {
    apiMock.override('GET', /\/api\/branches\/missing-id$/, () => ({
      status: 404,
      body: { code: 'ERRORS.BRANCHES.NOT_FOUND', message: 'Not found' },
    }));
    await page.goto('/branches/missing-id');
    // The component shows a spinner, then nothing — make sure we don't crash.
    await expect(page.locator('.p-toast, .p-message').filter({ hasText: /not found|error/i }).first()).toBeVisible({ timeout: 7_000 });
  });
});
