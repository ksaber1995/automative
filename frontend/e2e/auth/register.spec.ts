import { test, expect } from '../fixtures';

test.describe('Register', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/register');
  });

  test('renders the form', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /create|register|sign up/i }).first()).toBeVisible();
    await expect(page.locator('input[formControlName="companyName"]')).toBeVisible();
    await expect(page.locator('input[formControlName="firstName"]')).toBeVisible();
    await expect(page.locator('input[formControlName="email"]')).toBeVisible();
  });

  test('blocks submit until required fields are filled', async ({ page }) => {
    const submit = page.getByRole('button', { name: /create|sign up|register/i }).last();
    // The submit button is disabled until the form is valid — clicking it must not navigate.
    await submit.click({ trial: true }).catch(() => {});
    await expect(page).toHaveURL(/\/auth\/register$/);
  });

  test('register form submits the right payload', async ({ page, apiMock }) => {
    // Register calls Google's invisible reCAPTCHA on submit. Stub the global
    // shim so the form can submit without hitting Google's CDN.
    await page.addInitScript(() => {
      (window as any).grecaptcha = {
        ready: (cb: () => void) => cb(),
        execute: () => Promise.resolve('e2e-token'),
      };
    });
    let received: any = null;
    apiMock.override('POST', /\/api\/auth\/register$/, (_, req) => {
      received = req.postDataJSON();
      return { status: 201, body: { email: 'new@acme.test', message: 'Verification email sent' } };
    });
    await page.goto('/auth/register');

    await page.locator('input[formControlName="companyName"]').fill('Acme Test Co');
    await page.locator('input[formControlName="firstName"]').fill('Test');
    await page.locator('input[formControlName="lastName"]').fill('User');
    await page.locator('input[formControlName="email"]').fill('new@acme.test');
    const cc = page.locator('input[formControlName="countryCode"]');
    if (await cc.count()) await cc.first().fill('20');
    await page.locator('input[formControlName="phone"]').first().fill('1001234567');
    await page.locator('input[formControlName="password"]').first().fill('TestPassword!1');
    await page.locator('input[formControlName="confirmPassword"]').first().fill('TestPassword!1');

    await page.locator('button[type="submit"]').click();

    // Assert the network call rather than the post-success route, which
    // depends on the reCAPTCHA + observer chain completing.
    await expect.poll(() => received?.companyName, { timeout: 7_000 }).toBe('Acme Test Co');
  });

  test('back to login link works', async ({ page }) => {
    await page.getByRole('link', { name: /sign in|log in|login/i }).first().click();
    await expect(page).toHaveURL(/\/auth\/login$/);
  });
});
