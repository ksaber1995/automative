import { defineConfig, devices } from '@playwright/test';

// All API calls in tests are mocked via page.route(), so we never hit the real
// dev/prod backends. The webServer below boots `ng serve` once and the suite
// reuses it (CI runs a fresh server each time via reuseExistingServer:false).
const PORT = Number(process.env.PW_PORT || 4200);
const BASE_URL = process.env.PW_BASE_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    locale: 'en-US',
    timezoneId: 'UTC',
  },

  // Auth setup runs first; each role-scoped project depends on it so it
  // reuses the saved storageState file instead of re-logging in per test.
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-admin',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/admin.json',
      },
      testIgnore: [/.*\.setup\.ts/, /auth\/.*\.spec\.ts/, /permissions\/.*\.spec\.ts/],
    },
    {
      name: 'chromium-anon',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /auth\/.*\.spec\.ts/,
    },
    {
      name: 'chromium-roles',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
      testMatch: /permissions\/.*\.spec\.ts/,
    },
  ],

  webServer: {
    command: 'npm run start -- --port=4200 --host=127.0.0.1',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
