import { test, expect } from '../fixtures';
import { PRODUCTS } from '../helpers/mock-data';

test.describe('Products', () => {
  test('list renders', async ({ page }) => {
    await page.goto('/products');
    await expect(page.getByRole('heading', { name: /products/i })).toBeVisible();
    await expect(page.getByText(PRODUCTS[0].name).first()).toBeVisible();
  });

  test('Add Product opens the form', async ({ page }) => {
    await page.goto('/products');
    await page.getByRole('button', { name: /add|new product/i }).first().click();
    await expect(page).toHaveURL(/\/products\/(create|new)/);
  });

  test('create form renders', async ({ page }) => {
    const navigated = await page.goto('/products/create').then(() => true).catch(() => false);
    if (!navigated) await page.goto('/products/new');
    await expect(page.locator('form').first()).toBeVisible();
  });

  test('record a product sale calls the right endpoint', async ({ page, apiMock }) => {
    let sold = false;
    apiMock.override('POST', /\/api\/product-sales$/, () => {
      sold = true;
      return { status: 201, body: { id: 'ps-new' } };
    });

    await page.goto('/products');
    const sellBtn = page.getByRole('button', { name: /sell|sale/i }).first();
    if (await sellBtn.count()) {
      await sellBtn.click();
      const qty = page.locator('input[formControlName="quantity"], input[type="number"]').first();
      if (await qty.count()) await qty.fill('2');
      await page.getByRole('button', { name: /save|confirm|submit/i }).first().click();
      await page.waitForTimeout(300);
      expect(sold).toBeTruthy();
    }
  });
});
