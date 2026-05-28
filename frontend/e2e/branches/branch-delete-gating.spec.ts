import { test, expect } from '../fixtures';
import { BRANCHES } from '../helpers/mock-data';

// Behavior shipped on 2026-05-28: the trash icon must only appear for a
// branch when its `hasFinancials` flag is false. Branches with any revenue,
// expense, or expense payment lose the delete affordance entirely.

test.describe('Branch delete gating', () => {
  test('shows trash icon only for branches without financials', async ({ page }) => {
    await page.goto('/branches');
    await expect(page.getByText(BRANCHES[0].name).first()).toBeVisible();

    const withFinancials = page.getByRole('row', { name: new RegExp(BRANCHES[0].name) });
    const withoutFinancials = page.getByRole('row', { name: new RegExp(BRANCHES[1].name) });

    await expect(withFinancials.locator('button:has(.pi-trash)')).toHaveCount(0);
    await expect(withoutFinancials.locator('button:has(.pi-trash)')).toBeVisible();
  });

  test('deleting a financial-free branch confirms then removes it', async ({ page, apiMock }) => {
    let deletedId: string | null = null;
    apiMock.override('DELETE', /\/api\/branches\/[^/]+$/, (url) => {
      deletedId = url.pathname.split('/').pop()!;
      return { body: { message: 'Deleted', deactivated: false, counts: { revenues: 0, expenses: 0, expensePayments: 0, students: 0, employees: 0, products: 0 } } };
    });

    await page.goto('/branches');
    await expect(page.getByText(BRANCHES[1].name).first()).toBeVisible();

    await page.getByRole('row', { name: new RegExp(BRANCHES[1].name) })
      .locator('button:has(.pi-trash)').click();

    // The confirm dialog opens and fetches deletion impact — wait for it.
    await expect(page.getByRole('dialog')).toBeVisible();
    // Within the dialog footer, the destructive button carries the trash icon too.
    await page.getByRole('dialog').locator('button:has(.pi-trash)').click();

    await expect.poll(() => deletedId).toBe(BRANCHES[1].id);
  });
});
