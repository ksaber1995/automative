import { test, expect } from '../fixtures';

test.describe('Reports', () => {
  test('list renders', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: /reports/i })).toBeVisible();
  });
});

test.describe('Settings', () => {
  test('renders for admin role', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();
  });
});

test.describe('Company profile', () => {
  test('renders for any signed-in user', async ({ page }) => {
    await page.goto('/company-profile');
    await expect(page.getByRole('heading')).toBeVisible();
  });
});
