import { test, expect } from '../fixtures';
import path from 'node:path';

// Permission gating: each role's storageState was saved by auth.setup.ts.
// We reuse those states here to assert sidebar visibility and route guards
// without re-logging in.

const authState = (role: string) => path.join('e2e', '.auth', `${role}.json`);

test.describe('Accountant role', () => {
  test.use({ storageState: authState('accountant'), role: 'accountant' });

  test('cannot access /users (redirects to dashboard)', async ({ page }) => {
    await page.goto('/users');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('can access /revenues and /expenses', async ({ page }) => {
    await page.goto('/revenues');
    await expect(page.getByRole('heading', { name: /revenue/i }).first()).toBeVisible();
    await page.goto('/expenses');
    await expect(page.getByRole('heading', { name: /expense/i }).first()).toBeVisible();
  });
});

test.describe('Viewer role', () => {
  test.use({ storageState: authState('viewer'), role: 'viewer' });

  test('cannot access /expenses', async ({ page }) => {
    await page.goto('/expenses');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('can still see /dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });
});

test.describe('Branch admin role', () => {
  test.use({ storageState: authState('branchAdmin'), role: 'branchAdmin' });

  test('cannot manage users', async ({ page }) => {
    await page.goto('/users');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('can access academy + finance pages', async ({ page }) => {
    await page.goto('/students');
    await expect(page.getByRole('heading', { name: /student/i }).first()).toBeVisible();
    await page.goto('/revenues');
    await expect(page.getByRole('heading', { name: /revenue/i }).first()).toBeVisible();
  });
});

test.describe('Branch list write affordances', () => {
  test.use({ storageState: authState('viewer'), role: 'viewer' });

  test('viewer does not see Add Branch button', async ({ page }) => {
    await page.goto('/branches');
    await expect(page.getByRole('button', { name: /add|new branch/i })).toHaveCount(0);
  });
});
