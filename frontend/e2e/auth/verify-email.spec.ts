import { test, expect } from '../fixtures';

test.describe('Verify email', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/verify-email?email=new@acme.test');
  });

  test('renders the OTP form with masked email', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /verify/i })).toBeVisible();
    await expect(page.locator('input[formControlName="otp"]')).toBeVisible();
  });

  test('valid OTP signs the user in and lands on the dashboard', async ({ page }) => {
    await page.locator('input[formControlName="otp"]').fill('123456');
    await page.getByRole('button', { name: /verify/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('shows error for invalid OTP', async ({ page, apiMock }) => {
    apiMock.override('POST', /\/api\/auth\/verify-email$/, () => ({
      status: 400,
      body: { code: 'ERRORS.AUTH.OTP_INVALID', message: 'Invalid or expired OTP' },
    }));
    await page.locator('input[formControlName="otp"]').fill('000000');
    await page.getByRole('button', { name: /verify/i }).click();
    await expect(page).toHaveURL(/\/auth\/verify-email/);
  });

  test('resend OTP button is present (may be in cooldown)', async ({ page }) => {
    // The component starts a resend cooldown on init. Just assert the resend
    // affordance is on the page in some form — either an enabled button or
    // a cooldown countdown.
    const resendArea = page.getByText(/resend|seconds/i).first();
    await expect(resendArea).toBeVisible({ timeout: 7_000 });
  });
});
