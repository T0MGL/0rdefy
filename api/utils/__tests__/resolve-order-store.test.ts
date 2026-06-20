/**
 * Unit tests for resolveOrderStore, the multi-store ownership/auto-heal resolver.
 *
 * Run with:
 *   npx tsx --test api/utils/__tests__/resolve-order-store.test.ts
 *
 * Background: an order-scoped mutation must run under the store that OWNS the
 * order, never the (possibly stale) X-Store-ID active in the caller's tab. A
 * multi-store owner can hold store A active while acting on an order in store B.
 * Matching the order against store A returns zero rows and surfaces as a false
 * 404. This resolver reconciles header store vs order store:
 *   - header === order store          -> ok, healed=false (fast path)
 *   - header !== order store, caller   -> ok, healed=true (auto-heal), with the
 *     manages the order's store           caller's role in the resolved store so
 *                                          the route can re-authorize
 *   - header !== order store, caller   -> mismatch (no cross-store widening)
 *     has no access to that store
 *   - order does not exist             -> not_found
 *
 * Strategy: stub supabaseAdmin.from to return canned rows per table (orders,
 * user_stores) through the same chainable-builder pattern used across the API
 * test suite. Each call returns a fresh builder so .single() resolves the row
 * staged for that table.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// connection.ts validates env at import-time; set defaults so the module loads.
process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_ANON_KEY ??= 'test-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service';

const connectionModule = await import('../../db/connection');
const { resolveOrderStore } = await import('../resolve-order-store');

const supabaseAdmin = connectionModule.supabaseAdmin;
const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);

const STORE_A = '11111111-1111-1111-1111-111111111111';
const STORE_B = '22222222-2222-2222-2222-222222222222';
const ORDER_ID = '33333333-3333-3333-3333-333333333333';
const USER_ID = '44444444-4444-4444-4444-444444444444';

interface StagedTables {
  // The single order row, or null to simulate a non-existent order.
  order: { store_id: string } | null;
  // The caller's row in user_stores for the order's owning store, or null when
  // the caller does not manage that store.
  access?: { role: string } | null;
}

// Each .from(table) returns its own builder so order and user_stores resolve
// independently. Unknown tables defer to the real client (never hit in tests).
function stub({ order, access = null }: StagedTables): void {
  (supabaseAdmin as any).from = (table: string) => {
    if (table !== 'orders' && table !== 'user_stores') return originalFrom(table);
    const row = table === 'orders' ? order : access;
    const builder: any = {
      select() { return this; },
      eq() { return this; },
      is() { return this; },
      single() {
        return Promise.resolve(
          row ? { data: row, error: null } : { data: null, error: { code: 'PGRST116' } }
        );
      },
    };
    return builder;
  };
}

describe('resolveOrderStore', () => {
  beforeEach(() => {
    (supabaseAdmin as any).from = originalFrom;
  });

  afterEach(() => {
    (supabaseAdmin as any).from = originalFrom;
  });

  it('fast path: header store owns the order -> ok, not healed, no extra query', async () => {
    stub({ order: { store_id: STORE_A } });
    const result = await resolveOrderStore({
      orderId: ORDER_ID,
      headerStoreId: STORE_A,
      userId: USER_ID,
    });
    assert.equal(result.outcome, 'ok');
    if (result.outcome === 'ok') {
      assert.equal(result.storeId, STORE_A);
      assert.equal(result.healed, false);
      assert.equal(result.resolvedRole, null);
    }
  });

  it('auto-heal: header store A, order in store B, caller manages B -> ok, healed, role surfaced', async () => {
    stub({ order: { store_id: STORE_B }, access: { role: 'admin' } });
    const result = await resolveOrderStore({
      orderId: ORDER_ID,
      headerStoreId: STORE_A,
      userId: USER_ID,
    });
    assert.equal(result.outcome, 'ok');
    if (result.outcome === 'ok') {
      assert.equal(result.storeId, STORE_B);
      assert.equal(result.healed, true);
      assert.equal(result.resolvedRole, 'admin');
    }
  });

  it('mismatch: header store A, order in store B, caller has no access to B -> mismatch', async () => {
    stub({ order: { store_id: STORE_B }, access: null });
    const result = await resolveOrderStore({
      orderId: ORDER_ID,
      headerStoreId: STORE_A,
      userId: USER_ID,
    });
    assert.equal(result.outcome, 'mismatch');
    if (result.outcome === 'mismatch') {
      assert.equal(result.orderStoreId, STORE_B);
    }
  });

  it('not_found: order does not exist -> not_found before any store logic', async () => {
    stub({ order: null });
    const result = await resolveOrderStore({
      orderId: ORDER_ID,
      headerStoreId: STORE_A,
      userId: USER_ID,
    });
    assert.equal(result.outcome, 'not_found');
  });

  it('shopify session: cross-store header is never auto-healed -> mismatch', async () => {
    // A Shopify webhook session is not user-scoped. Even though the order lives
    // in store B, the resolver must not auto-heal: the header store is proven
    // upstream and cross-store widening would be wrong here.
    stub({ order: { store_id: STORE_B }, access: { role: 'owner' } });
    const result = await resolveOrderStore({
      orderId: ORDER_ID,
      headerStoreId: STORE_A,
      userId: USER_ID,
      isShopifySession: true,
    });
    assert.equal(result.outcome, 'mismatch');
  });

  it('no userId: cannot evaluate cross-store access -> mismatch instead of heal', async () => {
    stub({ order: { store_id: STORE_B }, access: { role: 'owner' } });
    const result = await resolveOrderStore({
      orderId: ORDER_ID,
      headerStoreId: STORE_A,
    });
    assert.equal(result.outcome, 'mismatch');
  });
});
