import { test, expect } from '../fixtures';
import { EVENTS } from '../helpers/mock-data';

test.describe('Events', () => {
  test('list renders', async ({ page }) => {
    await page.goto('/events');
    await expect(page.getByRole('heading', { name: /events/i })).toBeVisible();
    await expect(page.getByText(EVENTS[0].name).first()).toBeVisible();
  });

  test('Create button opens the form', async ({ page }) => {
    await page.goto('/events');
    await page.getByRole('button', { name: /add|new event/i }).first().click();
    await expect(page).toHaveURL(/\/events\/create$/);
  });

  test('detail page loads', async ({ page }) => {
    await page.goto(`/events/${EVENTS[0].id}`);
    await expect(page.getByText(EVENTS[0].name).first()).toBeVisible();
  });
});
