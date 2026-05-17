/**
 * Unit tests for the Shopify Token Exchange route.
 *
 * Run with:
 *   npx tsx --test api/routes/__tests__/shopify-auth.test.ts
 *
 * Covers:
 *   - Feature flag gate (503 when disabled).
 *   - Body schema validation (400 for bad payloads).
 *   - Session token signature + audience verification.
 *   - shop query param mismatch detection.
 *
 * The Shopify Admin API call (Token Exchange itself) and Supabase
 * provisioning are stubbed out via dynamic import overrides; this test
 * file focuses on the HTTP surface of the route, not the side-effecting
 * paths covered elsewhere.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

// Force-set required env BEFORE any module loads. dotenv.config() inside
// db/connection will only set values that are not already defined, so
// these overrides win.
process.env.SUPABASE_URL = 'http://localhost';
process.env.SUPABASE_ANON_KEY = 'test-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service';
process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests-only-min-32-chars';
process.env.SUPABASE_JWT_SECRET = 'test-supabase-jwt-secret-for-unit-tests';
process.env.SHOPIFY_API_KEY = 'test-api-key';
process.env.SHOPIFY_API_SECRET = 'test-api-secret-for-hmac';
process.env.SHOPIFY_TOKEN_EXCHANGE_ENABLED = 'true';

function makeSessionToken(opts: { dest: string; audMatches?: boolean }): string {
  return jwt.sign(
    {
      iss: `https://${opts.dest}/admin`,
      dest: opts.dest,
      aud: opts.audMatches === false ? 'wrong-key' : 'test-api-key',
      sub: 'shopify-user-123',
      jti: 'unique-id',
      sid: 'session-id',
      nbf: Math.floor(Date.now() / 1000) - 10,
      iat: Math.floor(Date.now() / 1000) - 10,
      exp: Math.floor(Date.now() / 1000) + 60,
    },
    'test-api-secret-for-hmac',
    { algorithm: 'HS256' },
  );
}

// Build a minimal Express request/response pair for handler invocation.
function mockReq(opts: {
  body?: any;
  query?: any;
  headers?: Record<string, string>;
}): any {
  return {
    body: opts.body ?? {},
    query: opts.query ?? {},
    headers: opts.headers ?? {},
    get(name: string) {
      return this.headers[name.toLowerCase()];
    },
  };
}

function mockRes(): any {
  const res: any = {
    statusCode: 200,
    headersSent: false,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      this.headersSent = true;
      return this;
    },
  };
  return res;
}

// Pull the route handler out of the router stack for direct invocation.
async function loadHandler(): Promise<(req: any, res: any) => Promise<void>> {
  const mod = await import('../shopify-auth');
  const layer = (mod.shopifyAuthRouter.stack as any[]).find(
    (l) => l.route?.path === '/token-exchange',
  );
  if (!layer) throw new Error('token-exchange route not registered');
  return layer.route.stack[0].handle as any;
}

describe('POST /api/shopify/auth/token-exchange', () => {
  beforeEach(() => {
    // Default flag on for each test; individual tests flip it off.
    process.env.SHOPIFY_TOKEN_EXCHANGE_ENABLED = 'true';
  });

  it('returns 503 when feature flag is off', async () => {
    process.env.SHOPIFY_TOKEN_EXCHANGE_ENABLED = 'false';

    const handler = await loadHandler();
    const req = mockReq({ body: { session_token: makeSessionToken({ dest: 's.myshopify.com' }) } });
    const res = mockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error, 'token_exchange_disabled');
  });

  it('returns 400 when body is missing session_token', async () => {
    const handler = await loadHandler();
    const req = mockReq({ body: {} });
    const res = mockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'invalid_body');
  });

  it('returns 400 when session token is malformed', async () => {
    const handler = await loadHandler();
    const req = mockReq({
      body: { session_token: 'this-is-not-a-real-jwt-but-passes-min-length-check' },
    });
    const res = mockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'invalid_session_token');
  });

  it('returns 400 when session token audience does not match SHOPIFY_API_KEY', async () => {
    const handler = await loadHandler();
    const req = mockReq({
      body: {
        session_token: makeSessionToken({
          dest: 'malicious.myshopify.com',
          audMatches: false,
        }),
      },
    });
    const res = mockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'invalid_session_token');
  });

  it('returns 400 when query.shop disagrees with token.dest', async () => {
    const handler = await loadHandler();
    const req = mockReq({
      body: { session_token: makeSessionToken({ dest: 'real-shop.myshopify.com' }) },
      query: { shop: 'spoofed-shop.myshopify.com' },
    });
    const res = mockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'shop_mismatch');
  });

  it('returns 400 when query.shop is malformed', async () => {
    const handler = await loadHandler();
    const req = mockReq({
      body: { session_token: makeSessionToken({ dest: 'real-shop.myshopify.com' }) },
      query: { shop: 'not-a-shopify-domain' },
    });
    const res = mockRes();

    await handler(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'invalid_query');
  });
});
