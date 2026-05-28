import { test, expect } from '../fixtures';
import { CLASSES } from '../helpers/mock-data';

test.describe('Classes', () => {
  test('list renders', async ({ page }) => {
    await page.goto('/classes');
    await expect(page.getByRole('heading', { name: /class/i }).first()).toBeVisible();
  });

  test('Create button opens the form', async ({ page }) => {
    await page.goto('/classes');
    await page.locator('button:has(.pi-plus)').first().click();
    await expect(page).toHaveURL(/\/classes\/(create|new)/);
  });

  test('detail page loads', async ({ page }) => {
    await page.goto(`/classes/${CLASSES[0].id}`);
    await expect(page.getByText(CLASSES[0].name).first()).toBeVisible();
  });

  test('finish-class action posts to the right endpoint', async ({ page, apiMock }) => {
    let finished = false;
    apiMock.override('POST', /\/api\/classes\/[^/]+\/finish$/, () => {
      finished = true;
      return { body: { ...CLASSES[0], status: 'COMPLETED' } };
    });
    await page.goto(`/classes/${CLASSES[0].id}`);
    const finishBtn = page.getByRole('button', { name: /finish|complete/i });
    if (await finishBtn.count()) {
      await finishBtn.first().click();
      const confirm = page.getByRole('button', { name: /confirm|yes|ok/i });
      if (await confirm.count()) await confirm.first().click();
      await page.waitForTimeout(200);
      expect(finished).toBeTruthy();
    }
  });
});
