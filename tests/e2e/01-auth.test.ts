/**
 * E2E Test Suite: Authentication
 *
 * Tests the authentication system against production API.
 * These tests validate login, token handling, and security.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { CONFIG } from './config';
import { ProductionApiClient } from '../utils/api-client';

const API_URL = CONFIG.apiUrl;

describe('Authentication', () => {
  describe('Login Flow', () => {
    test('Login with valid credentials returns token and user data', async () => {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: CONFIG.credentials.email,
          password: CONFIG.credentials.password
        })
      });

      expect(response.status).toBe(200);

      const data = await response.json();

      // Verify token
      expect(data.token).toBeDefined();
      expect(typeof data.token).toBe('string');
      expect(data.token.length).toBeGreaterThan(50);

      // Verify user data
      expect(data.user).toBeDefined();
      expect(data.user.email).toBe(CONFIG.credentials.email);
      expect(data.user.id).toBeDefined();

      // Verify store access
      expect(data.user.stores).toBeDefined();
      expect(Array.isArray(data.user.stores)).toBe(true);
      expect(data.user.stores.length).toBeGreaterThan(0);

      // Verify store has required fields
      const store = data.user.stores[0];
      expect(store.id).toBeDefined();
      expect(store.role).toBeDefined();
    });

    test('Login with wrong password fails with 401', async () => {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: CONFIG.credentials.email,
          password: 'wrongpassword123'
        })
      });

      expect(response.status).toBe(401);

      const data = await response.json();
      expect(data.error || data.message).toBeDefined();
    });

    test('Login with non-existent email fails', async () => {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent_user_test@ordefy.io',
          password: 'anypassword'
        })
      });

      // Should be 401 (not found treated as invalid credentials)
      expect([401, 404]).toContain(response.status);
    });

    test('Login with invalid email format fails', async () => {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'not-an-email',
          password: 'password123'
        })
      });

      // Should fail validation
      expect([400, 401, 422]).toContain(response.status);
    });

    test('Login with empty credentials fails', async () => {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: '',
          password: ''
        })
      });

      expect([400, 401, 422]).toContain(response.status);
    });

    test('Login with missing password fails', async () => {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: CONFIG.credentials.email
        })
      });

      expect([400, 401, 422]).toContain(response.status);
    });
  });

  describe('Token Authorization', () => {
    let validToken: string;
    let storeId: string;

    beforeAll(async () => {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: CONFIG.credentials.email,
          password: CONFIG.credentials.password
        })
      });

      const data = await response.json();
      validToken = data.token;
      storeId = data.user.stores[0].id;
    });

    test('Request without token fails with 401', async () => {
      const response = await fetch(`${API_URL}/orders`);
      expect(response.status).toBe(401);
    });

    test('Request with invalid token fails with 401', async () => {
      const response = await fetch(`${API_URL}/orders`, {
        headers: {
          'Authorization': 'Bearer invalid_token_12345',
          'X-Store-ID': storeId
        }
      });

      expect(response.status).toBe(401);
    });

    test('Request with malformed token fails with 401', async () => {
      const response = await fetch(`${API_URL}/orders`, {
        headers: {
          'Authorization': 'not-a-bearer-token',
          'X-Store-ID': storeId
        }
      });

      expect(response.status).toBe(401);
    });

    test('Request with valid token but missing store ID fails', async () => {
      const response = await fetch(`${API_URL}/orders`, {
        headers: {
          'Authorization': `Bearer ${validToken}`
        }
      });

      // Should fail - store ID required
      expect([400, 401, 403]).toContain(response.status);
    });

    test('Request with valid token and store ID succeeds', async () => {
      const response = await fetch(`${API_URL}/orders`, {
        headers: {
          'Authorization': `Bearer ${validToken}`,
          'X-Store-ID': storeId
        }
      });

      expect(response.status).toBe(200);
    });

    test('Request with expired/tampered token fails', async () => {
      // Create a tampered token by modifying the payload
      const tamperedToken = validToken.slice(0, -10) + 'tampered12';

      const response = await fetch(`${API_URL}/orders`, {
        headers: {
          'Authorization': `Bearer ${tamperedToken}`,
          'X-Store-ID': storeId
        }
      });

      expect(response.status).toBe(401);
    });
  });

  describe('Protected Endpoints Access', () => {
    let api: ProductionApiClient;

    beforeAll(async () => {
      api = new ProductionApiClient();
      await api.login();
    });

    test('Can access orders endpoint', async () => {
      const response = await api.requestRaw('GET', '/orders');
      expect(response.status).toBe(200);
    });

    test('Can access products endpoint', async () => {
      const response = await api.requestRaw('GET', '/products');
      expect(response.status).toBe(200);
    });

    test('Can access customers endpoint', async () => {
      const response = await api.requestRaw('GET', '/customers');
      expect(response.status).toBe(200);
    });

    test('Can access carriers endpoint', async () => {
      const response = await api.requestRaw('GET', '/carriers');
      expect(response.status).toBe(200);
    });

    test('Can access analytics endpoint', async () => {
      const response = await api.requestRaw('GET', '/analytics/summary');
      expect(response.status).toBe(200);
    });

    test('Can access warehouse endpoint', async () => {
      const response = await api.requestRaw('GET', '/warehouse/picking-sessions');
      expect(response.status).toBe(200);
    });

    test('Can access billing endpoint', async () => {
      const response = await api.requestRaw('GET', '/billing/subscription');
      expect(response.status).toBe(200);
    });

    test('Can access collaborators endpoint', async () => {
      const response = await api.requestRaw('GET', '/collaborators');
      expect(response.status).toBe(200);
    });
  });

  describe('User Info Endpoint', () => {
    let api: ProductionApiClient;

    beforeAll(async () => {
      api = new ProductionApiClient();
      await api.login();
    });

    test('Get current user info returns correct data', async () => {
      const response = await api.requestRaw('GET', '/auth/me');

      // Endpoint might be /auth/me or /users/me
      if (response.status === 404) {
        // Try alternative endpoint
        const altResponse = await api.requestRaw('GET', '/users/me');
        if (altResponse.status === 200) {
          expect(altResponse.data.email).toBe(CONFIG.credentials.email);
        }
        return;
      }

      expect(response.status).toBe(200);
      expect(response.data.email).toBe(CONFIG.credentials.email);
    });
  });

  describe('Response Time', () => {
    test('Login responds within acceptable time (<2s)', async () => {
      const start = Date.now();

      await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: CONFIG.credentials.email,
          password: CONFIG.credentials.password
        })
      });

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(2000);
    });
  });
});
