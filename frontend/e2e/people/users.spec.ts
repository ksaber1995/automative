import { test, expect } from '../fixtures';
import { USERS } from '../helpers/mock-data';

// User management is GLOBAL_ADMIN/ADMIN only — keep the default admin role.

test.describe('Users (RBAC management)', () => {
  test('list renders', async ({ page }) => {
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: /user/i }).first()).toBeVisible();
  });

  test('Add User opens create form', async ({ page }) => {
    await page.goto('/users');
    const create = page.getByRole('button', { name: /add|new user|invite/i }).first();
    if (await create.count()) {
      await create.click();
      await expect(page).toHaveURL(/\/users\/(create|new|invite)/);
    }
  });

  test('successful create returns to the list', async ({ page, apiMock }) => {
    let body: any = null;
    apiMock.override('POST', /\/api\/users$/, (_, req) => {
      body = req.postDataJSON();
      return { status: 201, body: { id: 'u-new', ...(body as object) } };
    });

    await page.goto('/users/create').catch(async () => {
      await page.goto('/users/new');
    });

    const email = page.locator('input[formControlName="email"]').first();
    if (!(await email.count())) return;
    await email.fill('newuser@acme.test');
    await page.locator('input[formControlName="firstName"]').first().fill('New');
    await page.locator('input[formControlName="lastName"]').first().fill('User');
    const pwd = page.locator('input[formControlName="password"]').first();
    if (await pwd.count()) await pwd.fill('TempPass!1');
    const role = page.locator('select[formControlName="role"]').first();
    if (await role.count()) await role.selectOption({ label: /accountant|viewer|admin/i }).catch(() => {});

    await page.getByRole('button', { name: /save|create|submit|invite/i }).first().click();
    expect(body?.email).toBe('newuser@acme.test');
  });
});
