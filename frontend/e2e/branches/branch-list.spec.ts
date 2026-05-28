import { test, expect } from '../fixtures';
import { BRANCHES } from '../helpers/mock-data';

test.describe('Branches list', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/branches');
    await expect(page.getByRole('heading', { name: /branches/i }).first()).toBeVisible();
  });

  test('renders both branches from the mock', async ({ page }) => {
    for (const b of BRANCHES) {
      await expect(page.getByText(b.name, { exact: true }).first()).toBeVisible();
    }
  });

  test('status filter narrows the table', async ({ page, apiMock }) => {
    apiMock.override('GET', /\/api\/branches$/, () => ({
      body: [...BRANCHES, { ...BRANCHES[0], id: 'b-inactive', name: 'Closed Branch', isActive: false, hasFinancials: false }],
    }));
    await page.reload();

    await expect(page.getByText('Closed Branch')).toBeVisible();

    // Apply "Inactive Only" filter.
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: /inactive only/i }).click();

    await expect(page.getByText('Closed Branch')).toBeVisible();
    await expect(page.getByText(BRANCHES[0].name)).toBeHidden();
  });

  test('view action navigates to the branch detail', async ({ page }) => {
    // The action buttons in the table are icon-only PrimeNG p-buttons; pick them by icon class.
    await page.getByRole('row', { name: new RegExp(BRANCHES[0].name) })
      .locator('button:has(.pi-eye)').click();
    await expect(page).toHaveURL(new RegExp(`/branches/${BRANCHES[0].id}$`));
  });

  test('Add Branch button opens the create form', async ({ page }) => {
    await page.getByRole('button', { name: /add|new branch/i }).first().click();
    await expect(page).toHaveURL(/\/branches\/create$/);
  });
});
