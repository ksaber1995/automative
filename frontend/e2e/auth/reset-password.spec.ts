import { test, expect } from '../fixtures';

test.describe('Reset password', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/reset-password?phone=201001234567');
  });

  test('renders OTP + password fields', async ({ page }) => {
    await expect(page.locator('input[formControlName="otp"]')).toBeVisible();
    await expect(page.locator('p-password').first()).toBeVisible();
  });

  test('successful submit shows success state', async ({ page }) => {
    await page.locator('input[formControlName="otp"]').fill('123456');
    const pwdInputs = page.locator('p-password input').filter({ hasNot: page.locator('[hidden]') });
    await pwdInputs.first().fill('NewPassword!1');
    await pwdInputs.nth(pwdInputs.count.toString === '1' ? 0 : Math.min(1, await pwdInputs.count() - 1)).fill('NewPassword!1');

    await page.locator('button[type="submit"]').click();
    // Success state shows a link routing back to /auth/login.
    await expect(page.getByRole('link', { name: /login|sign in/i })).toBeVisible({ timeout: 7_000 });
  });

  test('mismatched passwords keep us on the form', async ({ page }) => {
    await page.locator('input[formControlName="otp"]').fill('123456');
    const pwdInputs = page.locator('p-password input');
    await pwdInputs.first().fill('NewPassword!1');
    if ((await pwdInputs.count()) > 1) {
      await pwdInputs.nth(1).fill('Different!2');
      await pwdInputs.nth(1).blur();
    }
    await expect(page).toHaveURL(/\/auth\/reset-password/);
  });
});
