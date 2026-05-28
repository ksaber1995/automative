import { test as setup, expect } from '@playwright/test';
import { installApiMocks } from './helpers/api-mock';
import { USERS } from './helpers/mock-data';
import path from 'node:path';
import fs from 'node:fs';

const authDir = path.join('e2e', '.auth');
fs.mkdirSync(authDir, { recursive: true });

const roles = [
  { name: 'admin', user: USERS.admin },
  { name: 'globalAdmin', user: USERS.globalAdmin },
  { name: 'branchAdmin', user: USERS.branchAdmin },
  { name: 'accountant', user: USERS.accountant },
  { name: 'viewer', user: USERS.viewer },
] as const;

for (const { name, user } of roles) {
  setup(`authenticate as ${name}`, async ({ page }) => {
    await installApiMocks(page, user);
    await page.goto('/auth/login');

    // The login screen renders a primeng password field plus a plain input.
    await page.getByLabel(/email or phone/i).fill(user.email);
    await page.locator('#password input').fill('TestPassword!1');
    await page.getByRole('button', { name: /sign in/i }).click();

    // Successful login navigates to /dashboard.
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.context().storageState({ path: path.join(authDir, `${name}.json`) });
  });
}
