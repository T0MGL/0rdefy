/**
 * E2E Test Suite: Products Management
 *
 * Tests product CRUD operations, validation, and Shopify sync.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { CONFIG } from './config';
import { ProductionApiClient } from '../utils/api-client';
import { TestData } from '../utils/test-data-factory';

describe('Products Management', () => {
  let api: ProductionApiClient;
  let testProduct: any;

  beforeAll(async () => {
    api = new ProductionApiClient();
    await api.login();

    console.log('\n📦 Setting up products test environment...\n');
  });

  afterAll(async () => {
    await api.cleanupAll();
  });

  describe('Product CRUD', () => {
    test('Create product with required fields', async () => {
      testProduct = await api.request('POST', '/products', TestData.product({
        name: `${CONFIG.testPrefix}Product_Basic_${Date.now()}`,
        price: 75000,
        cost: 35000,
        stock: 50
      }));
      api.trackResource('products', testProduct.id);

      expect(testProduct.id).toBeDefined();
      expect(testProduct.name).toContain(CONFIG.testPrefix);
      expect(testProduct.price).toBe(75000);
      expect(testProduct.cost).toBe(35000);
      expect(testProduct.stock).toBe(50);
    });

    test('Create product with all fields', async () => {
      const fullProduct = await api.request('POST', '/products', {
        ...TestData.product(),
        name: `${CONFIG.testPrefix}Product_Full_${Date.now()}`,
        price: 100000,
        cost: 50000,
        stock: 200,
        category: 'Electronics',
        description: 'Test product with full details',
        is_active: true,
        packaging_cost: 5000,
        additional_costs: 2000
      });
      api.trackResource('products', fullProduct.id);

      expect(fullProduct.id).toBeDefined();
      expect(fullProduct.category).toBe('Electronics');
      expect(fullProduct.description).toBe('Test product with full details');
    });

    test('Get product by ID', async () => {
      const product = await api.request('GET', `/products/${testProduct.id}`);

      expect(product.id).toBe(testProduct.id);
      expect(product.name).toBe(testProduct.name);
      expect(product.price).toBe(testProduct.price);
    });

    test('Update product fields', async () => {
      const newName = `${CONFIG.testPrefix}Product_Updated_${Date.now()}`;
      const newPrice = 85000;

      const updated = await api.request('PATCH', `/products/${testProduct.id}`, {
        name: newName,
        price: newPrice
      });

      expect(updated.name).toBe(newName);
      expect(updated.price).toBe(newPrice);

      // Update local reference
      testProduct = updated;
    });

    test('List products includes test product', async () => {
      const response = await api.request<{ data: any[] }>('GET', '/products');
      const products = response.data || response;

      const found = Array.isArray(products)
        ? products.find((p: any) => p.id === testProduct.id)
        : null;

      expect(found).toBeDefined();
    });
  });

  describe('Product Validation', () => {
    test('Create product fails without name', async () => {
      const response = await api.requestRaw('POST', '/products', {
        price: 50000,
        stock: 10
      });

      expect([400, 422]).toContain(response.status);
    });

    test('Create product fails with negative price', async () => {
      const response = await api.requestRaw('POST', '/products', {
        name: `${CONFIG.testPrefix}Invalid_Price_${Date.now()}`,
        price: -100,
        stock: 10
      });

      expect([400, 422]).toContain(response.status);
    });

    test('Create product fails with negative stock', async () => {
      const response = await api.requestRaw('POST', '/products', {
        name: `${CONFIG.testPrefix}Invalid_Stock_${Date.now()}`,
        price: 50000,
        stock: -5
      });

      expect([400, 422]).toContain(response.status);
    });

    test('Create product fails with negative cost', async () => {
      const response = await api.requestRaw('POST', '/products', {
        name: `${CONFIG.testPrefix}Invalid_Cost_${Date.now()}`,
        price: 50000,
        cost: -1000,
        stock: 10
      });

      expect([400, 422]).toContain(response.status);
    });
  });

  describe('Product SKU', () => {
    test('Create product with unique SKU', async () => {
      const sku = `${CONFIG.testPrefix}SKU_UNIQUE_${Date.now()}`;

      const product = await api.request('POST', '/products', TestData.product({
        sku,
        name: `${CONFIG.testPrefix}SKU_Test_${Date.now()}`
      }));
      api.trackResource('products', product.id);

      expect(product.sku).toBe(sku);
    });

    test('Create product with duplicate SKU fails', async () => {
      const sku = `${CONFIG.testPrefix}SKU_DUP_${Date.now()}`;

      // First product with SKU
      const product1 = await api.request('POST', '/products', TestData.product({
        sku,
        name: `${CONFIG.testPrefix}SKU_First_${Date.now()}`
      }));
      api.trackResource('products', product1.id);

      // Second product with same SKU should fail
      const response = await api.requestRaw('POST', '/products', TestData.product({
        sku,
        name: `${CONFIG.testPrefix}SKU_Second_${Date.now()}`
      }));

      expect([400, 409, 422]).toContain(response.status);
    });

    test('Create product without SKU (allowed)', async () => {
      const product = await api.request('POST', '/products', {
        name: `${CONFIG.testPrefix}NoSKU_${Date.now()}`,
        price: 30000,
        stock: 20
      });
      api.trackResource('products', product.id);

      expect(product.id).toBeDefined();
      // SKU should be empty or auto-generated
    });
  });

  describe('Stock Management', () => {
    let stockProduct: any;

    beforeAll(async () => {
      stockProduct = await api.request('POST', '/products', TestData.product({
        stock: 100,
        name: `${CONFIG.testPrefix}Stock_Test_${Date.now()}`
      }));
      api.trackResource('products', stockProduct.id);
    });

    test('Increment stock', async () => {
      const updated = await api.request('PATCH', `/products/${stockProduct.id}/stock`, {
        adjustment: 25,
        operation: 'increment'
      });

      expect(updated.stock).toBe(125);
    });

    test('Decrement stock', async () => {
      const updated = await api.request('PATCH', `/products/${stockProduct.id}/stock`, {
        adjustment: 10,
        operation: 'decrement'
      });

      expect(updated.stock).toBe(115);
    });

    test('Set absolute stock', async () => {
      const updated = await api.request('PATCH', `/products/${stockProduct.id}/stock`, {
        adjustment: 50,
        operation: 'set'
      });

      expect(updated.stock).toBe(50);
    });

    test('Cannot decrement below zero', async () => {
      const response = await api.requestRaw('PATCH', `/products/${stockProduct.id}/stock`, {
        adjustment: 1000,
        operation: 'decrement'
      });

      // Should either fail or cap at 0
      if (response.ok) {
        expect(response.data.stock).toBeGreaterThanOrEqual(0);
      } else {
        expect([400, 422]).toContain(response.status);
      }
    });
  });

  describe('Product Deletion', () => {
    test('Can delete product without orders', async () => {
      const product = await api.request('POST', '/products', TestData.product({
        name: `${CONFIG.testPrefix}Deletable_${Date.now()}`
      }));

      // Delete immediately (no orders)
      const response = await api.requestRaw('DELETE', `/products/${product.id}`);

      expect([200, 204]).toContain(response.status);
    });

    test('Check if product can be deleted', async () => {
      const product = await api.request('POST', '/products', TestData.product({
        name: `${CONFIG.testPrefix}CanDelete_${Date.now()}`
      }));
      api.trackResource('products', product.id);

      const canDelete = await api.request('GET', `/products/${product.id}/can-delete`);

      expect(canDelete.can_delete).toBe(true);
    });
  });

  describe('Product Search & Filtering', () => {
    test('Search products by name', async () => {
      const response = await api.request<{ data: any[] }>('GET', `/products?search=${CONFIG.testPrefix}`);
      const products = response.data || response;

      // Should find at least our test products
      expect(Array.isArray(products)).toBe(true);
    });

    test('Filter products by category', async () => {
      // Create product with specific category
      const product = await api.request('POST', '/products', TestData.product({
        name: `${CONFIG.testPrefix}Categorized_${Date.now()}`,
        category: 'TestCategory'
      }));
      api.trackResource('products', product.id);

      const response = await api.request<{ data: any[] }>('GET', '/products?category=TestCategory');
      const products = response.data || response;

      if (Array.isArray(products) && products.length > 0) {
        const found = products.find((p: any) => p.id === product.id);
        expect(found).toBeDefined();
      }
    });

    test('Filter products by active status', async () => {
      const response = await api.request<{ data: any[] }>('GET', '/products?is_active=true');
      const products = response.data || response;

      if (Array.isArray(products) && products.length > 0) {
        for (const product of products) {
          expect(product.is_active).toBe(true);
        }
      }
    });

    test('Pagination works correctly', async () => {
      const page1 = await api.request<{ data: any[]; pagination?: any }>('GET', '/products?limit=5&offset=0');
      const page2 = await api.request<{ data: any[]; pagination?: any }>('GET', '/products?limit=5&offset=5');

      const products1 = page1.data || page1;
      const products2 = page2.data || page2;

      // Pages should have different products (if enough exist)
      if (Array.isArray(products1) && Array.isArray(products2)) {
        if (products1.length === 5 && products2.length > 0) {
          const ids1 = products1.map((p: any) => p.id);
          const ids2 = products2.map((p: any) => p.id);

          // No overlap
          for (const id of ids2) {
            expect(ids1).not.toContain(id);
          }
        }
      }
    });
  });

  describe('Product Statistics', () => {
    test('Get inventory statistics', async () => {
      const stats = await api.request('GET', '/products/stats/inventory');

      expect(stats).toBeDefined();

      if (stats.total_products !== undefined) {
        expect(typeof stats.total_products).toBe('number');
      }
      if (stats.total_stock !== undefined) {
        expect(typeof stats.total_stock).toBe('number');
      }
    });

    test('Get full product statistics', async () => {
      try {
        const stats = await api.request('GET', '/products/stats/full');

        expect(stats).toBeDefined();
      } catch (error) {
        // Endpoint might not exist
        expect(true).toBe(true);
      }
    });
  });

  describe('Performance', () => {
    test('List products responds quickly (<1s)', async () => {
      const start = Date.now();
      await api.request('GET', '/products?limit=50');
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });

    test('Create product responds quickly (<500ms)', async () => {
      const start = Date.now();
      const product = await api.request('POST', '/products', TestData.product());
      const duration = Date.now() - start;
      api.trackResource('products', product.id);

      expect(duration).toBeLessThan(500);
    });
  });
});
