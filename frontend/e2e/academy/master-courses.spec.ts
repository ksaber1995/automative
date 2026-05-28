import { test, expect } from '../fixtures';
import { MASTER_COURSES } from '../helpers/mock-data';

test.describe('Master courses', () => {
  test('list renders', async ({ page }) => {
    await page.goto('/master-courses');
    await expect(page.getByRole('heading', { name: /master/i })).toBeVisible();
    await expect(page.getByText(MASTER_COURSES[0].name).first()).toBeVisible();
  });

  test('detail page loads', async ({ page }) => {
    await page.goto(`/master-courses/${MASTER_COURSES[0].id}`);
    await expect(page.getByText(MASTER_COURSES[0].name).first()).toBeVisible();
  });
});
