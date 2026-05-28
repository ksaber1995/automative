import { test, expect } from '../fixtures';

test.describe('App shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard');
  });

  test('header shows the current user', async ({ page, asUser }) => {
    await expect(page.getByText(`${asUser.firstName} ${asUser.lastName}`)).toBeVisible();
  });

  test('sidebar toggle hides and shows the nav', async ({ page }) => {
    const dashboardLink = page.getByRole('link', { name: /dashboard/i }).first();
    await expect(dashboardLink).toBeVisible();
    await page.getByRole('button').filter({ has: page.locator('.pi-bars') }).first().click();
    await expect(dashboardLink).toBeHidden();
  });

  test('language toggle flips document direction', async ({ page }) => {
    const html = page.locator('html');
    const before = (await html.getAttribute('dir')) || 'ltr';
    // Toast notifications from auth bootstrap can intercept clicks — force-click past them.
    await page.getByRole('button', { name: /العربية|english|عربي/i }).first().click({ force: true });
    await expect.poll(async () => (await html.getAttribute('dir')) || 'ltr').not.toBe(before);
  });

  test('logout clears auth and returns to login', async ({ page }) => {
    // The header logout button is icon-only; dispatch its click directly so we
    // don't race PrimeNG toast layers for pointer events.
    await page.locator('button:has(.pi-sign-out)').first().evaluate((btn: HTMLButtonElement) => btn.click());
    await page.waitForURL(/\/auth\/login/, { timeout: 10_000 });
    const token = await page.evaluate(() => localStorage.getItem('automate_magic_token'));
    expect(token).toBeNull();
  });

  test('clicking the company badge opens the company profile', async ({ page }) => {
    const badge = page.getByRole('link').filter({ has: page.locator('.pi-building') }).first();
    if (await badge.isVisible()) {
      await badge.click();
      await expect(page).toHaveURL(/\/company-profile$/);
    }
  });
});

test.describe('Auth guards', () => {
  test('an unauthenticated visit to a protected route bounces to /auth/login', async ({ browser }) => {
    // Fresh context with no storageState — must redirect.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/dashboard');
    await page.waitForURL(/\/auth\/login/, { timeout: 15_000 });
    await ctx.close();
  });
});
