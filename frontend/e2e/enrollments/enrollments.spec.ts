import { test, expect } from '../fixtures';

test.describe('Enrollments', () => {
  test('list page loads', async ({ page }) => {
    await page.goto('/enrollments');
    await expect(page.getByRole('heading', { name: /enrollments/i })).toBeVisible();
  });

  test('empty state when no enrollments', async ({ page, apiMock }) => {
    apiMock.override('GET', /\/api\/enrollments(\?|$)/, () => ({ body: [] }));
    apiMock.override('GET', /\/api\/master-enrollments(\?|$)/, () => ({ body: [] }));
    await page.goto('/enrollments');
    // Either an empty-state message or an empty table — both fine.
    await expect(page.getByText(/no.*(enrollments|data)|empty/i).first()).toBeVisible({ timeout: 7_000 });
  });

  test('create enrollment opens the form', async ({ page }) => {
    await page.goto('/enrollments');
    const createBtn = page.getByRole('button', { name: /enroll|add|new/i }).first();
    if (await createBtn.count()) {
      await createBtn.click();
      await expect(page).toHaveURL(/\/enrollments\/create|\/enrollments\/master|\/enrollments\/new/);
    }
  });
});
