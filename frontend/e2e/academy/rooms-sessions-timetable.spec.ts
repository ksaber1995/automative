import { test, expect } from '../fixtures';
import { ROOMS } from '../helpers/mock-data';

test.describe('Rooms', () => {
  test('list renders', async ({ page }) => {
    await page.goto('/rooms');
    await expect(page.getByRole('heading', { name: /^rooms?$/i }).first()).toBeVisible();
  });

  test('create button is present', async ({ page }) => {
    await page.goto('/rooms');
    await expect(page.locator('button:has(.pi-plus)').first()).toBeVisible();
  });
});

test.describe('Sessions dashboard', () => {
  test('loads without errors', async ({ page }) => {
    await page.goto('/sessions');
    await expect(page.getByRole('heading', { name: /session/i }).first()).toBeVisible();
  });
});

test.describe('Timetable', () => {
  test('loads without errors', async ({ page }) => {
    await page.goto('/timetable');
    await expect(page.getByRole('heading', { name: /time ?table|schedule/i }).first()).toBeVisible();
  });
});

test.describe('Teacher attendance', () => {
  test('loads without errors', async ({ page }) => {
    await page.goto('/attendance/teachers');
    await expect(page.getByRole('heading').first()).toBeVisible();
  });
});
