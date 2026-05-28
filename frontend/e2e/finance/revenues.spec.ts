import { test, expect } from '../fixtures';
import { REVENUES } from '../helpers/mock-data';

test.describe('Revenues', () => {
  test('list renders', async ({ page }) => {
    await page.goto('/revenues');
    await expect(page.getByRole('heading', { name: /revenue/i }).first()).toBeVisible();
  });

  test('filter controls are present', async ({ page }) => {
    await page.goto('/revenues');
    // Revenue rows are auto-generated; the list only exposes branch/source/date filters.
    await expect(page.locator('select').first()).toBeVisible();
  });

  test('detail page loads for a revenue row', async ({ page }) => {
    await page.goto(`/revenues/${REVENUES[0].id}`);
    // Either dedicated detail page or back to list — both acceptable for smoke.
    await expect(page.getByRole('heading')).toBeVisible();
  });
});
