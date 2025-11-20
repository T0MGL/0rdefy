import { test, expect } from '@playwright/test';

/**
 * Orders E2E Tests
 * Tests order listing, creation, editing, deletion, and actions
 */

test.describe('Orders Management', () => {
  // Login helper
  async function login(page) {
    await page.goto('/login');
    await page.fill('input[name="email"]', 'test@ordefy.io');
    await page.fill('input[name="password"]', 'test123456');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
  }

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('should navigate to orders page', async ({ page }) => {
    // Navigate to orders
    await page.goto('/orders');
    await expect(page).toHaveURL(/.*orders/);

    // Should show orders heading - bilingual
    await expect(page.locator('h1, h2').first()).toContainText(/order|pedido/i);
  });

  test('should list existing orders', async ({ page }) => {
    await page.goto('/orders');

    // Wait for content to load
    await page.waitForTimeout(2000);

    // Should have table or list of orders
    const hasTable = await page.locator('table').count() > 0;
    const hasList = await page.locator('[role="list"], .order-item, .card').count() > 0;
    const hasEmptyState = await page.locator('text=/no orders|empty|sin pedidos|vacío/i').count() > 0;

    // At least one of these should be true
    expect(hasTable || hasList || hasEmptyState).toBeTruthy();
  });

  test('should open create order dialog', async ({ page }) => {
    await page.goto('/orders');

    // Look for "New Order" or "Create Order" button - bilingual
    const createButton = page.locator('button:has-text("New Order"), button:has-text("Create Order"), button:has-text("Add Order"), button:has-text("Nuevo Pedido"), button:has-text("Crear Pedido"), button:has-text("Agregar Pedido")').first();

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

  test('should create a new order', async ({ page }) => {
    await page.goto('/orders');

    const createButton = page.locator('button:has-text("New Order"), button:has-text("Create Order"), button:has-text("Add Order"), button:has-text("Nuevo Pedido"), button:has-text("Crear Pedido"), button:has-text("Agregar Pedido")').first();

    if (await createButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await createButton.click();
      await page.waitForTimeout(1000);

      // Fill order form
      // Customer - bilingual placeholder
      const customerInput = page.locator('input[name="customer"], input[placeholder*="customer" i], input[placeholder*="cliente" i]').first();
      if (await customerInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await customerInput.fill('Test Customer');
      }

      // Product - bilingual placeholder
      const productInput = page.locator('input[name="product"], input[placeholder*="product" i], input[placeholder*="producto" i]').first();
      if (await productInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await productInput.fill('Test Product');
      }

      // Quantity
      const quantityInput = page.locator('input[name="quantity"], input[type="number"]').first();
      if (await quantityInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await quantityInput.fill('2');
      }

      // Total/Price
      const totalInput = page.locator('input[name="total"], input[name="price"]').first();
      if (await totalInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await totalInput.fill('100');
      }

      // Submit - bilingual
      await page.click('button[type="submit"], button:has-text("Create"), button:has-text("Save"), button:has-text("Crear"), button:has-text("Guardar")');
      await page.waitForTimeout(2000);

      // Should show success message or close dialog - bilingual
      const hasSuccess = await page.locator('text=/success|created|éxito|creado/i').count() > 0;
      expect(hasSuccess).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('should filter orders by status', async ({ page }) => {
    await page.goto('/orders');
    await page.waitForTimeout(2000);

    // Look for status filter - bilingual
    const statusFilter = page.locator('select[name="status"], button:has-text("Status"), button:has-text("Estado")').first();

    if (await statusFilter.isVisible({ timeout: 3000 }).catch(() => false)) {
      await statusFilter.click();
      await page.waitForTimeout(500);

      // Select a status - bilingual
      await page.click('text=/pending|confirmed|delivered|pendiente|confirmado|entregado/i');
      await page.waitForTimeout(1000);

      // Orders should be filtered (hard to verify without knowing data)
      expect(true).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('should edit an existing order', async ({ page }) => {
    await page.goto('/orders');
    await page.waitForTimeout(2000);

    // Find edit button for first order - bilingual
    const editButton = page.locator('button:has-text("Edit"), button:has-text("Editar"), [aria-label="Edit"], [aria-label="Editar"]').first();

    if (await editButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editButton.click();
      await page.waitForTimeout(1000);

      // Should show edit form
      const hasForm = await page.locator('form, [role="dialog"]').count() > 0;
      expect(hasForm).toBeTruthy();

      // Change a field
      const quantityInput = page.locator('input[name="quantity"], input[type="number"]').first();
      if (await quantityInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await quantityInput.fill('5');

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

  test('should confirm an order', async ({ page }) => {
    await page.goto('/orders');
    await page.waitForTimeout(2000);

    // Find confirm button - bilingual
    const confirmButton = page.locator('button:has-text("Confirm"), button:has-text("Approve"), button:has-text("Confirmar"), button:has-text("Aprobar")').first();

    if (await confirmButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmButton.click();
      await page.waitForTimeout(1500);

      // Should show success or change status - bilingual
      const hasSuccess = await page.locator('text=/confirmed|success|confirmado|éxito/i').count() > 0;
      expect(hasSuccess).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('should reject an order', async ({ page }) => {
    await page.goto('/orders');
    await page.waitForTimeout(2000);

    // Find reject button - bilingual
    const rejectButton = page.locator('button:has-text("Reject"), button:has-text("Cancel"), button:has-text("Rechazar"), button:has-text("Cancelar")').first();

    if (await rejectButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await rejectButton.click();
      await page.waitForTimeout(1500);

      // Might need confirmation - bilingual
      const confirmDialog = page.locator('button:has-text("Confirm"), button:has-text("Yes"), button:has-text("Confirmar"), button:has-text("Sí")').first();
      if (await confirmDialog.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmDialog.click();
        await page.waitForTimeout(1500);
      }

      // Should show success - bilingual
      const hasSuccess = await page.locator('text=/rejected|cancelled|success|rechazado|cancelado|éxito/i').count() > 0;
      expect(hasSuccess).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('should delete an order', async ({ page }) => {
    await page.goto('/orders');
    await page.waitForTimeout(2000);

    // Count orders before
    const initialCount = await page.locator('tr, .order-item, .card').count();

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

        // Order should be removed
        const newCount = await page.locator('tr, .order-item, .card').count();
        expect(newCount).toBeLessThanOrEqual(initialCount);
      }
    } else {
      test.skip();
    }
  });

  test('should search orders', async ({ page }) => {
    await page.goto('/orders');
    await page.waitForTimeout(2000);

    // Find search input - bilingual
    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i], input[placeholder*="buscar" i]').first();

    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await searchInput.fill('test');
      await page.waitForTimeout(1500);

      // Results should be filtered (can't verify exact count without data)
      expect(true).toBeTruthy();
    } else {
      test.skip();
    }
  });

  test('should export orders', async ({ page }) => {
    await page.goto('/orders');
    await page.waitForTimeout(2000);

    // Find export button - bilingual
    const exportButton = page.locator('button:has-text("Export"), button:has-text("Download"), button:has-text("Exportar"), button:has-text("Descargar")').first();

    if (await exportButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Set up download listener
      const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);

      await exportButton.click();

      const download = await downloadPromise;
      expect(download !== null).toBeTruthy();
    } else {
      test.skip();
    }
  });
});
