import { test, expect } from '../fixtures';

test.describe('Forgot password', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/forgot-password');
  });

  test('renders the form', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /forgot|reset/i })).toBeVisible();
    await expect(page.locator('input[formControlName="phone"]')).toBeVisible();
  });

  test('submitting a phone shows the success state', async ({ page }) => {
    await page.locator('input[formControlName="countryCode"]').fill('20');
    await page.locator('input[formControlName="phone"]').fill('1001234567');
    await page.getByRole('button', { name: /send|submit|continue/i }).first().click();
    await expect(page.getByText(/code|sent|whatsapp/i).first()).toBeVisible();
  });

  test('back to login link works', async ({ page }) => {
    await page.getByRole('link', { name: /back to login|sign in/i }).first().click();
    await expect(page).toHaveURL(/\/auth\/login$/);
  });
});
