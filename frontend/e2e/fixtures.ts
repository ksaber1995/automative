import { test as base, expect, type Page } from '@playwright/test';
import { installApiMocks, type ApiMockHandle } from './helpers/api-mock';
import { USERS, type MockUser } from './helpers/mock-data';

type Role = keyof typeof USERS;

// Per-role test fixtures. Each test starts on the dashboard with the API
// already mocked and the requested user logged in. Override the role via
// `test.use({ role: 'accountant' })` or the per-test `role` parameter.

type Fixtures = {
  role: Role;
  apiMock: ApiMockHandle;
  asUser: MockUser;
};

export const test = base.extend<Fixtures>({
  role: ['admin', { option: true }],

  asUser: async ({ role }, use) => {
    await use(USERS[role]);
  },

  apiMock: [
    async ({ page, asUser }, use) => {
      const handle = await installApiMocks(page, asUser);
      await use(handle);
    },
    { auto: true },
  ],
});

export { expect };

/** Navigate to a path and wait for the auth bootstrap to settle. */
export async function gotoApp(page: Page, path = '/dashboard') {
  await page.goto(path);
  // The shell uses a fixed header — wait for it to be visible before continuing.
  await page.waitForLoadState('domcontentloaded');
}

/** Resolve a PrimeNG p-button by its translated label text. */
export function pButton(page: Page, name: string | RegExp) {
  return page.getByRole('button', { name });
}
