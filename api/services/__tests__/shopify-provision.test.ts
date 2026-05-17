/**
 * Unit tests for shopify-provision.service.
 *
 * Run with:
 *   npx tsx --test api/services/__tests__/shopify-provision.test.ts
 *
 * Scope:
 *   - normalizeCountryCode: country code mapping with CHECK constraint.
 *   - parsePlanFromSubscriptionName: defensive plan-name parsing.
 *   - exchangeSessionTokenForOfflineToken: stubs axios to verify request
 *     shape and error propagation.
 *
 * provisionShopifyMerchant itself depends on supabaseAdmin and would
 * require a fixture DB to run meaningfully. Its component pieces are
 * tested here; end-to-end coverage lives in the manual E2E QA pass
 * against a dev store on Day 10 of the sprint.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// connection.ts validates env at import-time, set defaults so the module loads
process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_ANON_KEY ??= 'test-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service';
process.env.JWT_SECRET ??= 'test-jwt-secret-for-unit-tests-only-min-32-chars';
process.env.SUPABASE_JWT_SECRET ??= 'test-supabase-jwt-secret-for-unit-tests';
process.env.SHOPIFY_API_KEY ??= 'test-api-key';
process.env.SHOPIFY_API_SECRET ??= 'test-api-secret';

const provision = await import('../shopify-provision.service');
const utils = await import('../shopify-utils.service');

describe('normalizeCountryCode', () => {
  it('passes through supported countries verbatim', () => {
    assert.equal(provision.normalizeCountryCode('PY'), 'PY');
    assert.equal(provision.normalizeCountryCode('US'), 'US');
    assert.equal(provision.normalizeCountryCode('ES'), 'ES');
  });

  it('uppercases lowercase input', () => {
    assert.equal(provision.normalizeCountryCode('py'), 'PY');
    assert.equal(provision.normalizeCountryCode('ar'), 'AR');
  });

  it('trims whitespace before checking', () => {
    assert.equal(provision.normalizeCountryCode('  MX  '), 'MX');
  });

  it('falls back to US for unsupported countries', () => {
    assert.equal(provision.normalizeCountryCode('GB'), 'US');
    assert.equal(provision.normalizeCountryCode('CA'), 'US');
    assert.equal(provision.normalizeCountryCode('DE'), 'US');
  });

  it('falls back to US for null, undefined, empty', () => {
    assert.equal(provision.normalizeCountryCode(null), 'US');
    assert.equal(provision.normalizeCountryCode(undefined), 'US');
    assert.equal(provision.normalizeCountryCode(''), 'US');
  });

  it('falls back to US for arbitrary garbage strings', () => {
    assert.equal(provision.normalizeCountryCode('xx'), 'US');
    assert.equal(provision.normalizeCountryCode('123'), 'US');
  });
});

describe('parsePlanFromSubscriptionName', () => {
  it('extracts known plans from subscription names', () => {
    assert.equal(utils.parsePlanFromSubscriptionName('Ordefy Starter (Monthly)'), 'starter');
    assert.equal(utils.parsePlanFromSubscriptionName('Ordefy Growth (Annual)'), 'growth');
    assert.equal(utils.parsePlanFromSubscriptionName('Ordefy Professional (Monthly)'), 'professional');
  });

  it('is case-insensitive', () => {
    assert.equal(utils.parsePlanFromSubscriptionName('ORDEFY STARTER'), 'starter');
    assert.equal(utils.parsePlanFromSubscriptionName('Ordefy professional'), 'professional');
  });

  it('returns null for unknown names', () => {
    assert.equal(utils.parsePlanFromSubscriptionName('Unrelated subscription'), null);
    assert.equal(utils.parsePlanFromSubscriptionName(''), null);
    assert.equal(utils.parsePlanFromSubscriptionName('free'), null);
  });

  it('prefers professional over the others when name contains multiple', () => {
    // Defensive: priority matches code order (professional > growth > starter)
    assert.equal(
      utils.parsePlanFromSubscriptionName('Professional Starter Growth bundle'),
      'professional',
    );
  });
});

describe('exchangeSessionTokenForOfflineToken', () => {
  let originalRequest: any;
  let capturedRequest: { url: string; data: string; headers: any } | null = null;

  beforeEach(async () => {
    const axiosMod = await import('axios');
    originalRequest = (axiosMod.default as any).post;
    capturedRequest = null;
  });

  afterEach(async () => {
    const axiosMod = await import('axios');
    (axiosMod.default as any).post = originalRequest;
  });

  it('builds the correct OAuth Token Exchange request', async () => {
    const axiosMod = await import('axios');
    (axiosMod.default as any).post = async (url: string, body: string, opts: any) => {
      capturedRequest = { url, data: body, headers: opts.headers };
      return {
        status: 200,
        data: {
          access_token: 'shpat_offline_xyz',
          scope: 'read_products,write_orders',
        },
      };
    };

    const result = await provision.exchangeSessionTokenForOfflineToken({
      shopDomain: 'test-shop.myshopify.com',
      sessionToken: 'session.token.value',
      clientId: 'client-id-123',
      clientSecret: 'client-secret-456',
    });

    assert.equal(result.accessToken, 'shpat_offline_xyz');
    assert.equal(result.scope, 'read_products,write_orders');
    assert.equal(capturedRequest?.url, 'https://test-shop.myshopify.com/admin/oauth/access_token');

    const params = new URLSearchParams(capturedRequest!.data);
    assert.equal(params.get('client_id'), 'client-id-123');
    assert.equal(params.get('client_secret'), 'client-secret-456');
    assert.equal(params.get('grant_type'), 'urn:ietf:params:oauth:grant-type:token-exchange');
    assert.equal(params.get('subject_token'), 'session.token.value');
    assert.equal(params.get('subject_token_type'), 'urn:ietf:params:oauth:token-type:id_token');
    assert.equal(
      params.get('requested_token_type'),
      'urn:shopify:params:oauth:token-type:offline-access-token',
    );
  });

  it('throws when Shopify responds non-200', async () => {
    const axiosMod = await import('axios');
    (axiosMod.default as any).post = async () => ({
      status: 401,
      data: { error: 'invalid_token', error_description: 'session token expired' },
    });

    await assert.rejects(
      () =>
        provision.exchangeSessionTokenForOfflineToken({
          shopDomain: 'test-shop.myshopify.com',
          sessionToken: 'expired.session.token',
          clientId: 'client-id',
          clientSecret: 'client-secret',
        }),
      /Shopify token exchange failed \(401\): session token expired/,
    );
  });

  it('throws when access_token missing from response body', async () => {
    const axiosMod = await import('axios');
    (axiosMod.default as any).post = async () => ({
      status: 200,
      data: {},
    });

    await assert.rejects(
      () =>
        provision.exchangeSessionTokenForOfflineToken({
          shopDomain: 'test-shop.myshopify.com',
          sessionToken: 'session.token',
          clientId: 'client-id',
          clientSecret: 'client-secret',
        }),
      /Shopify token exchange failed \(200\):/,
    );
  });
});
