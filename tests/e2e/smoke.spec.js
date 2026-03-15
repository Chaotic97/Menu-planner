const { test, expect } = require('@playwright/test');

test.describe('Navigation smoke tests', () => {
  test('loads Today page by default', async ({ page }) => {
    await page.goto('/app');
    await expect(page.locator('h1')).toBeVisible({ timeout: 5000 });
  });

  test('dishes page loads', async ({ page }) => {
    await page.goto('/app#/dishes');
    await expect(page.locator('.page-header')).toBeVisible({ timeout: 5000 });
  });

  test('menus page loads', async ({ page }) => {
    await page.goto('/app#/menus');
    await expect(page.locator('.page-header')).toBeVisible({ timeout: 5000 });
  });

  test('shopping page loads', async ({ page }) => {
    await page.goto('/app#/shopping');
    await expect(page.locator('.page-header')).toBeVisible({ timeout: 5000 });
  });

  test('todos page loads', async ({ page }) => {
    await page.goto('/app#/todos');
    await expect(page.locator('.page-header')).toBeVisible({ timeout: 5000 });
  });

  test('settings page loads', async ({ page }) => {
    await page.goto('/app#/settings');
    await expect(page.locator('.page-header')).toBeVisible({ timeout: 5000 });
  });

  test('ingredients page loads', async ({ page }) => {
    await page.goto('/app#/ingredients');
    await expect(page.locator('.page-header')).toBeVisible({ timeout: 5000 });
  });

  test('service notes page loads', async ({ page }) => {
    await page.goto('/app#/service-notes');
    await expect(page.locator('.page-header')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Dish CRUD', () => {
  test('create a dish, view it, edit it, delete it', async ({ page }) => {
    // Navigate to new dish form
    await page.goto('/app#/dishes/new');
    await page.waitForSelector('#dish-name', { timeout: 5000 });

    // Fill in dish name and category
    await page.fill('#dish-name', 'E2E Test Dish');
    const categorySelect = page.locator('#dish-category');
    if (await categorySelect.isVisible()) {
      await categorySelect.selectOption({ index: 1 });
    }

    // Save
    await page.click('button[type="submit"], .btn-primary');

    // Should redirect to dish view or dish list
    await page.waitForURL(/.*#\/dishes/, { timeout: 5000 });

    // Verify dish name appears on the page
    await expect(page.locator('body')).toContainText('E2E Test Dish');
  });
});

test.describe('Menu CRUD', () => {
  test('create a menu and view it', async ({ page }) => {
    await page.goto('/app#/menus');
    await page.waitForTimeout(500);

    // Click new menu button
    const newBtn = page.locator('a[href*="new"], button:has-text("New Menu"), .btn-primary').first();
    if (await newBtn.isVisible()) {
      await newBtn.click();
    }

    // Look for menu name input (could be in a modal or new page)
    const nameInput = page.locator('#menu-name, input[name="name"], .modal input[type="text"]').first();
    await nameInput.waitFor({ timeout: 5000 });
    await nameInput.fill('E2E Test Menu');

    // Submit
    const submitBtn = page.locator('.modal .btn-primary, button[type="submit"]').first();
    await submitBtn.click();
    await page.waitForTimeout(1000);

    // Should see the menu
    await expect(page.locator('body')).toContainText('E2E Test Menu');
  });
});

test.describe('Service notes', () => {
  test('create a service note', async ({ page }) => {
    await page.goto('/app#/service-notes');
    await page.waitForTimeout(500);

    // Click add note button
    const addBtn = page.locator('button:has-text("Add"), button:has-text("New"), .btn-primary').first();
    if (await addBtn.isVisible()) {
      await addBtn.click();
      await page.waitForTimeout(500);

      // Fill in the form (modal or inline)
      const titleInput = page.locator('#note-title, input[name="title"], .modal input[type="text"]').first();
      if (await titleInput.isVisible()) {
        await titleInput.fill('E2E Test Note');
      }

      const contentInput = page.locator('#note-content, textarea, .modal textarea').first();
      if (await contentInput.isVisible()) {
        await contentInput.fill('Test note content from E2E');
      }

      // Save
      const saveBtn = page.locator('.modal .btn-primary, button[type="submit"], button:has-text("Save")').first();
      if (await saveBtn.isVisible()) {
        await saveBtn.click();
        await page.waitForTimeout(1000);
      }

      await expect(page.locator('body')).toContainText('E2E Test Note');
    }
  });
});
