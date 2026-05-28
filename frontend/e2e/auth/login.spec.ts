import { test, expect } from '../fixtures';

test.describe('Login', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/login');
  });

  test('renders the form', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.getByLabel(/email or phone/i)).toBeVisible();
    await expect(page.locator('#password input')).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('validates required fields before submit', async ({ page }) => {
    await page.getByRole('button', { name: /sign in/i }).click();
    // Form stays on the same URL — no POST fired because of client-side validation.
    await expect(page).toHaveURL(/\/auth\/login$/);
  });

  test('logs in with valid credentials and lands on the dashboard', async ({ page }) => {
    await page.getByLabel(/email or phone/i).fill('admin@acme.test');
    await page.locator('#password input').fill('TestPassword!1');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('shows server error on invalid credentials', async ({ page, apiMock }) => {
    apiMock.override('POST', /\/api\/auth\/login$/, () => ({
      status: 401,
      body: { code: 'ERRORS.AUTH.INVALID_CREDENTIALS', message: 'Invalid email or password' },
    }));
    await page.getByLabel(/email or phone/i).fill('admin@acme.test');
    await page.locator('#password input').fill('WrongPassword!1');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/invalid email or password/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/login$/);
  });

  test('redirects to verify-email when email is not verified', async ({ page, apiMock }) => {
    apiMock.override('POST', /\/api\/auth\/login$/, () => ({
      status: 403,
      body: { code: 'ERRORS.AUTH.EMAIL_NOT_VERIFIED', message: 'Email not verified', email: 'pending@acme.test' },
    }));
    await page.getByLabel(/email or phone/i).fill('pending@acme.test');
    await page.locator('#password input').fill('TestPassword!1');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/auth\/verify-email\?email=/);
  });

  test('navigates to register page', async ({ page }) => {
    await page.getByRole('link', { name: /sign up|register/i }).click();
    await expect(page).toHaveURL(/\/auth\/register$/);
  });
});
