import { test, expect } from '../fixtures';

test.describe('Dashboard', () => {
  test('renders KPI cards from the analytics response', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
    await expect(page.getByText(/total revenue/i).first()).toBeVisible();
    await expect(page.getByText(/total expenses/i).first()).toBeVisible();
    await expect(page.getByText(/net profit/i).first()).toBeVisible();
  });

  test('shows the formatted revenue figure', async ({ page }) => {
    await page.goto('/dashboard');
    // Default mock has totalRevenue 125000 — the currency formatter should print "125,000" or similar.
    await expect(page.locator('text=/125[,.]?000/').first()).toBeVisible();
  });

  test('handles empty data without crashing', async ({ page, apiMock }) => {
    apiMock.override('GET', /\/api\/analytics\/dashboard/, () => ({
      body: {
        companyWideSummary: {
          totalRevenue: 0, fixedExpenses: 0, variableExpenses: 0, salaries: 0,
          sharedExpenses: 0, totalExpenses: 0, netProfit: 0, allocationMethod: 'EQUAL', globalOverhead: 0,
        },
        branchSummaries: [],
        revenueByMonth: [],
        expensesByCategory: [],
        topPerformingBranches: [],
        period: { startDate: '2025-01-01', endDate: '2025-12-31' },
      },
    }));
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
  });

  test('surfaces server errors gracefully', async ({ page, apiMock }) => {
    apiMock.override('GET', /\/api\/analytics\/dashboard/, () => ({
      status: 500,
      body: { code: 'ERRORS.SERVER', message: 'Internal server error' },
    }));
    await page.goto('/dashboard');
    // The toast notification is dismissable — assert it appears at least briefly.
    await expect(page.locator('.p-toast, .p-message').filter({ hasText: /error|fail/i }).first()).toBeVisible({ timeout: 7_000 });
  });
});
