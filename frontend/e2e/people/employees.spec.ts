import { test, expect } from '../fixtures';
import { EMPLOYEES } from '../helpers/mock-data';

test.describe('Employees', () => {
  test('list renders', async ({ page }) => {
    await page.goto('/employees');
    await expect(page.getByRole('heading', { name: /employees/i })).toBeVisible();
    await expect(page.getByText(EMPLOYEES[0].firstName).first()).toBeVisible();
  });

  test('Add Employee opens create form', async ({ page }) => {
    await page.goto('/employees');
    await page.getByRole('button', { name: /add|new employee/i }).first().click();
    await expect(page).toHaveURL(/\/employees\/create$/);
  });

  test('detail page loads', async ({ page }) => {
    await page.goto(`/employees/${EMPLOYEES[0].id}`);
    await expect(page.getByText(EMPLOYEES[0].firstName).first()).toBeVisible();
  });

  test('create form renders', async ({ page }) => {
    await page.goto('/employees/create');
    await expect(page.locator('input[formControlName="firstName"], #firstName').first()).toBeVisible();
    await expect(page.locator('input[formControlName="lastName"], #lastName').first()).toBeVisible();
  });
});
