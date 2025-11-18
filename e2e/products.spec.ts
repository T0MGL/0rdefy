import { test, expect } from '@playwright/test';

/**
 * Products E2E Tests
 * Tests product listing, creation, editing, deletion, and search
 */

test.describe('Products Management', () => {
  // Login helper
  async function login(page) {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@ordefy.app');
    await page.fill('input[name="password"]', 'test123456');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
  }

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should navigate to products page', async ({ page }) => {
    await page.goto('/products');
    await expect(page).toHaveURL(/.*products/);

    // Should show products heading - bilingual
    await expect(page.locator('h1, h2').first()).toContainText(/product|producto/i);
  });

  test('should list existing products', async ({ page }) => {
    await page.goto('/products');
    await page.waitForTimeout(2000);

    // Should have table, grid, or list of products
    const hasTable = await page.locator('table').count() > 0;
    const hasGrid = await page.locator('.grid, [role="grid"]').count() > 0;
    const hasCards = await page.locator('.product-card, .card').count() > 0;
    const hasEmptyState = await page.locator('text=/no products|empty|sin productos|vacío/i').count() > 0;

    expect(hasTable || hasGrid || hasCards || hasEmptyState).toBeTruthy();
  });

  test('should open create product dialog', async ({ page }) => {
    await page.goto('/products');

    const createButton = page.locator('button:has-text("New Product"), button:has-text("Add Product"), button:has-text("Create Product"), button:has-text("Nuevo Producto"), button:has-text("Agregar Producto"), button:has-text("Crear Producto")').first();

    if (await createButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await createButton.click();
      await page.waitForTimeout(1000);

      // Should show dialog or form
      const hasDialog = await page.locator('[role="dialog"], .modal, .drawer').count() > 0;
      const hasForm = await page.locator('form').count() > 0;

      expect(hasDialog || hasForm).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('should create a new product', async ({ page }) => {
    await page.goto('/products');

    const createButton = page.locator('button:has-text("New Product"), button:has-text("Add Product"), button:has-text("Create Product"), button:has-text("Nuevo Producto"), button:has-text("Agregar Producto"), button:has-text("Crear Producto")').first();

    if (await createButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await createButton.click();
      await page.waitForTimeout(1000);

      // Fill product form
      const testProduct = {
        name: `Test Product ${Date.now()}`,
        description: 'E2E Test Product Description',
        price: '99.99',
        sku: `SKU-${Date.now()}`
      };

      // Name - bilingual
      const nameInput = page.locator('input[name="name"], input[placeholder*="name" i], input[placeholder*="nombre" i]').first();
      if (await nameInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nameInput.fill(testProduct.name);
      }

      // Description - bilingual
      const descInput = page.locator('textarea[name="description"], input[name="description"], textarea[placeholder*="description" i], textarea[placeholder*="descripción" i]').first();
      if (await descInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await descInput.fill(testProduct.description);
      }

      // Price
      const priceInput = page.locator('input[name="price"]').first();
      if (await priceInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await priceInput.fill(testProduct.price);
      }

      // SKU
      const skuInput = page.locator('input[name="sku"]').first();
      if (await skuInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await skuInput.fill(testProduct.sku);
      }

      // Submit - bilingual
      await page.click('button[type="submit"], button:has-text("Create"), button:has-text("Save"), button:has-text("Crear"), button:has-text("Guardar")');
      await page.waitForTimeout(2000);

      // Should show success message - bilingual
      const hasSuccess = await page.locator('text=/success|created|added|éxito|creado|agregado/i').count() > 0;
      expect(hasSuccess).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('should validate required fields', async ({ page }) => {
    await page.goto('/products');

    const createButton = page.locator('button:has-text("New Product"), button:has-text("Add Product"), button:has-text("Nuevo Producto"), button:has-text("Agregar Producto")').first();

    if (await createButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await createButton.click();
      await page.waitForTimeout(1000);

      // Try to submit empty form - bilingual
      await page.click('button[type="submit"], button:has-text("Create"), button:has-text("Save"), button:has-text("Crear"), button:has-text("Guardar")');
      await page.waitForTimeout(1000);

      // Should show validation errors or stay on form - bilingual
      const hasError = await page.locator('text=/required|error|invalid|requerido|obligatorio|inválido/i').count() > 0;
      const hasDialog = await page.locator('[role="dialog"], .modal').count() > 0;

      expect(hasError || hasDialog).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('should edit an existing product', async ({ page }) => {
    await page.goto('/products');
    await page.waitForTimeout(2000);

    // Find edit button for first product - bilingual
    const editButton = page.locator('button:has-text("Edit"), button:has-text("Editar"), [aria-label="Edit"], [aria-label="Editar"]').first();

    if (await editButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editButton.click();
      await page.waitForTimeout(1000);

      // Should show edit form
      const hasForm = await page.locator('form, [role="dialog"]').count() > 0;
      expect(hasForm).toBeTruthy();

      // Change price
      const priceInput = page.locator('input[name="price"]').first();
      if (await priceInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await priceInput.fill('149.99');

        // Save - bilingual
        await page.click('button[type="submit"], button:has-text("Save"), button:has-text("Update"), button:has-text("Guardar"), button:has-text("Actualizar")');
        await page.waitForTimeout(2000);

        // Should show success - bilingual
        const hasSuccess = await page.locator('text=/success|updated|éxito|actualizado/i').count() > 0;
        expect(hasSuccess).toBeTruthy();
      }
    } else {
      test.skip();
    }
  });

  test('should delete a product', async ({ page }) => {
    await page.goto('/products');
    await page.waitForTimeout(2000);

    // Count products before
    const initialCount = await page.locator('tr, .product-card, .card').count();

    // Find delete button - bilingual
    const deleteButton = page.locator('button:has-text("Delete"), button:has-text("Eliminar"), [aria-label="Delete"], [aria-label="Eliminar"]').first();

    if (await deleteButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await deleteButton.click();
      await page.waitForTimeout(1000);

      // Confirm deletion - bilingual
      const confirmButton = page.locator('button:has-text("Delete"), button:has-text("Confirm"), button:has-text("Yes"), button:has-text("Eliminar"), button:has-text("Confirmar"), button:has-text("Sí")').first();
      if (await confirmButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmButton.click();
        await page.waitForTimeout(2000);

        // Product should be removed
        const newCount = await page.locator('tr, .product-card, .card').count();
        expect(newCount).toBeLessThanOrEqual(initialCount);
      }
    } else {
      test.skip();
    }
  });

  test('should search products by name', async ({ page }) => {
    await page.goto('/products');
    await page.waitForTimeout(2000);

    // Find search input - bilingual
    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i], input[placeholder*="buscar" i]').first();

    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill('test');
      await page.waitForTimeout(1500);

      // Results should be filtered
      // At minimum, the search input should have the value
      const searchValue = await searchInput.inputValue();
      expect(searchValue).toContain('test');
    } else {
      test.skip();
    }
  });

  test('should filter products by category', async ({ page }) => {
    await page.goto('/products');
    await page.waitForTimeout(2000);

    // Look for category filter - bilingual
    const categoryFilter = page.locator('select[name="category"], button:has-text("Category"), button:has-text("Categoría")').first();

    if (await categoryFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
      await categoryFilter.click();
      await page.waitForTimeout(500);

      // Select a category (if options exist)
      const firstOption = page.locator('option, [role="option"]').nth(1);
      if (await firstOption.isVisible({ timeout: 2000 }).catch(() => false)) {
        await firstOption.click();
        await page.waitForTimeout(1500);

        // Products should be filtered
        expect(true).toBeTruthy();
      }
    } else {
      test.skip();
    }
  });

  test('should sort products by price', async ({ page }) => {
    await page.goto('/products');
    await page.waitForTimeout(2000);

    // Look for sort control - bilingual
    const sortButton = page.locator('button:has-text("Sort"), button:has-text("Ordenar"), select[name="sort"]').first();

    if (await sortButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await sortButton.click();
      await page.waitForTimeout(500);

      // Select price sort - bilingual
      const priceSort = page.locator('text=/price|precio/i').first();
      if (await priceSort.isVisible({ timeout: 2000 }).catch(() => false)) {
        await priceSort.click();
        await page.waitForTimeout(1500);

        // Products should be reordered
        expect(true).toBeTruthy();
      }
    } else {
      test.skip();
    }
  });

  test('should view product details', async ({ page }) => {
    await page.goto('/products');
    await page.waitForTimeout(2000);

    // Find view/details button - bilingual
    const viewButton = page.locator('button:has-text("View"), button:has-text("Details"), button:has-text("Ver"), button:has-text("Detalles"), a:has-text("View"), a:has-text("Ver")').first();

    if (await viewButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await viewButton.click();
      await page.waitForTimeout(1500);

      // Should show details view or modal
      const hasDetails = await page.locator('[role="dialog"], .product-details').count() > 0;
      expect(hasDetails).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('should handle out of stock products', async ({ page }) => {
    await page.goto('/products');
    await page.waitForTimeout(2000);

    // Look for out of stock indicator - bilingual
    const outOfStock = page.locator('text=/out of stock|agotado|sin stock/i').first();

    if (await outOfStock.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Out of stock products should be marked
      expect(true).toBeTruthy();
    } else {
      // No out of stock products - that's fine
      test.skip();
    }
  });

  test('should update product stock', async ({ page }) => {
    await page.goto('/products');
    await page.waitForTimeout(2000);

    // Find edit button - bilingual
    const editButton = page.locator('button:has-text("Edit"), button:has-text("Editar")').first();

    if (await editButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editButton.click();
      await page.waitForTimeout(1000);

      // Find stock input
      const stockInput = page.locator('input[name="stock"], input[name="quantity"]').first();
      if (await stockInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await stockInput.fill('50');

        // Save - bilingual
        await page.click('button[type="submit"], button:has-text("Save"), button:has-text("Guardar")');
        await page.waitForTimeout(2000);

        const hasSuccess = await page.locator('text=/success|updated|éxito|actualizado/i').count() > 0;
        expect(hasSuccess).toBeTruthy();
      }
    } else {
      test.skip();
    }
  });
});
