import { test, expect } from '../fixtures';
import { BRANCHES } from '../helpers/mock-data';

const branch = BRANCHES[1]; // Westside Lab, no financials

test.describe('Edit branch', () => {
  test('pre-fills the form with existing values', async ({ page }) => {
    await page.goto(`/branches/${branch.id}/edit`);
    await expect(page.locator('#name')).toHaveValue(branch.name);
    await expect(page.locator('#code')).toHaveValue(branch.code);
  });

  test('saving updates the branch and returns to the list', async ({ page, apiMock }) => {
    let body: any = null;
    apiMock.override('PATCH', new RegExp(`/api/branches/${branch.id}$`), (_, req) => {
      body = req.postDataJSON();
      return { body: { ...branch, ...(body as object) } };
    });

    await page.goto(`/branches/${branch.id}/edit`);
    await page.locator('#name').fill('Westside Lab Renamed');
    await page.getByRole('button', { name: /save|update|submit/i }).click();

    await expect(page).toHaveURL(/\/branches$/);
    expect(body).toMatchObject({ name: 'Westside Lab Renamed' });
  });
});
