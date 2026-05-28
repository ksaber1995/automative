import { test, expect } from '../fixtures';
import { COURSES } from '../helpers/mock-data';

test.describe('Courses', () => {
  test('list renders existing courses', async ({ page }) => {
    await page.goto('/courses');
    await expect(page.getByRole('heading', { name: /courses/i })).toBeVisible();
    await expect(page.getByText(COURSES[0].name).first()).toBeVisible();
  });

  test('Add Course button leads to create form', async ({ page }) => {
    await page.goto('/courses');
    await page.getByRole('button', { name: /add|new course/i }).first().click();
    await expect(page).toHaveURL(/\/courses\/create$/);
  });

  test('create form renders the required fields', async ({ page }) => {
    await page.goto('/courses/create');
    await expect(page.locator('input[formControlName="name"], #name')).toBeVisible();
    await expect(page.locator('input[formControlName="code"], #code')).toBeVisible();
  });

  test('detail page renders course info', async ({ page }) => {
    const c = COURSES[0];
    await page.goto(`/courses/${c.id}`);
    await expect(page.getByText(c.name).first()).toBeVisible();
  });
});
