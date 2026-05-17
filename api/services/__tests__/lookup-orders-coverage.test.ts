/**
 * Unit tests for ExternalWebhookService.lookupOrders coverage attachment.
 *
 * Run with:
 *   npx tsx --test api/services/__tests__/lookup-orders-coverage.test.ts
 *
 * Background. Phase 1 of the synchronous cascade plan: GET
 * /api/webhook/orders/:storeId/lookup must return a `coverage` block per
 * order so Helena (NOCTE n8n workflow) can branch on carrier_type without
 * waiting for the /confirm response. Migration 192 already exposes
 * `carrier_type` in get_order_coverage_status; this test exercises the
 * service-level wiring.
 *
 * Strategy. Stub supabaseAdmin.from('orders') to return canned rows, stub
 * supabaseAdmin.rpc('get_order_coverage_status') to return canned coverage
 * payloads keyed by city. Then call the singleton lookupOrders() and assert
 * on the response shape.
 *
 * The pure helpers (coverageCacheKey, buildFallbackCoverage) are exported
 * from the service module so they can be asserted directly without booting
 * Express or hitting Supabase.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// connection.ts validates env at import-time, set defaults so the module loads
process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_ANON_KEY ??= 'test-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service';

const connectionModule = await import('../../db/connection');
const serviceModule = await import('../external-webhook.service');
const { externalWebhookService, coverageCacheKey, buildFallbackCoverage } = serviceModule;

const supabaseAdmin = connectionModule.supabaseAdmin;
const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
const originalRpc = supabaseAdmin.rpc.bind(supabaseAdmin);

const STORE_ID = '1eeaf2c7-2cd2-4257-8213-d90b1280a19d';

type Row = Record<string, unknown>;

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

function stubOrdersQuery(rows: Row[], count?: number): void {
  (supabaseAdmin as any).from = (table: string) => {
    if (table !== 'orders') return originalFrom(table);
    const builder: any = {
      _rows: rows,
      _count: count ?? rows.length,
      select() { return this; },
      eq() { return this; },
      is() { return this; },
      or() { return this; },
      in() { return this; },
      order() { return this; },
      limit() { return this; },
      then(resolve: (v: any) => any) {
        // Terminal: awaiting the builder triggers this. Mimics PostgrestBuilder.
        return Promise.resolve({ data: this._rows, error: null, count: this._count }).then(resolve);
      },
    };
    return builder;
  };
}

function stubRpc(
  responder: (fn: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null },
  calls: RpcCall[]
): void {
  (supabaseAdmin as any).rpc = (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return Promise.resolve(responder(fn, args));
  };
}

function baseOrderRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'order-' + Math.random().toString(36).slice(2, 8),
    order_number: null,
    shopify_order_name: '#1001',
    shopify_order_number: '1001',
    customer_first_name: 'Ana',
    customer_last_name: 'Pereira',
    customer_phone: '+595981000000',
    customer_email: null,
    customer_address: 'Av. Mariscal Lopez 1234',
    shipping_address: null,
    delivery_zone: null,
    shipping_city: 'Asuncion',
    total_price: 229000,
    subtotal_price: 229000,
    total_shipping: 0,
    total_discounts: 0,
    cod_amount: 229000,
    payment_method: 'cash_on_delivery',
    financial_status: 'pending',
    sleeves_status: 'pending',
    courier_id: null,
    is_pickup: false,
    delivery_preferences: null,
    delivery_notes: null,
    created_at: '2026-05-10T12:00:00Z',
    confirmed_at: null,
    delivered_at: null,
    line_items: [
      { name: 'NOCTE Aviator', sku: 'NOC-AV-001', quantity: 1, price: 229000, variant_title: 'Negro / M' },
    ],
    ...overrides,
  };
}

describe('coverageCacheKey', () => {
  it('collapses null, undefined, empty, and whitespace to the same sentinel', () => {
    const sentinel = coverageCacheKey(null);
    assert.equal(coverageCacheKey(undefined), sentinel);
    assert.equal(coverageCacheKey(''), sentinel);
    assert.equal(coverageCacheKey('   '), sentinel);
  });

  it('is case-insensitive and trim-insensitive', () => {
    assert.equal(coverageCacheKey('Asuncion'), coverageCacheKey('asuncion'));
    assert.equal(coverageCacheKey(' ATYRA '), coverageCacheKey('atyra'));
  });

  it('distinguishes different cities', () => {
    assert.notEqual(coverageCacheKey('Asuncion'), coverageCacheKey('Atyra'));
  });
});

describe('buildFallbackCoverage', () => {
  it('emits no_shipping_city when city is null', () => {
    const stub = buildFallbackCoverage(null);
    assert.equal(stub.has_coverage, null);
    assert.equal(stub.reason, 'no_shipping_city');
    assert.equal(stub.shipping_city, null);
    assert.equal(stub.store_active_carriers_count, 0);
    assert.deepEqual(stub.available_carriers, []);
  });

  it('emits a null reason when we just failed to fetch (city is present)', () => {
    const stub = buildFallbackCoverage('Asuncion');
    assert.equal(stub.has_coverage, null);
    assert.equal(stub.reason, null);
    assert.equal(stub.shipping_city, 'Asuncion');
  });
});

describe('lookupOrders coverage attachment', () => {
  afterEach(() => {
    (supabaseAdmin as any).from = originalFrom;
    (supabaseAdmin as any).rpc = originalRpc;
  });

  it('attaches coverage with only internal carriers for an Asuncion order', async () => {
    stubOrdersQuery([baseOrderRow({ shipping_city: 'Asuncion' })]);
    const rpcCalls: RpcCall[] = [];
    stubRpc(
      (_fn, args) => ({
        data: {
          shipping_city: args.p_shipping_city,
          shipping_city_normalized: 'asuncion',
          has_coverage: true,
          reason: null,
          store_active_carriers_count: 2,
          available_carriers: [
            { carrier_id: 'lucero', name: 'Lucero del este', rate: 25000, is_cheapest: true, carrier_type: 'internal' },
            { carrier_id: 'nimbus', name: 'Nimbus', rate: 30000, is_cheapest: false, carrier_type: 'internal' },
          ],
        },
        error: null,
      }),
      rpcCalls
    );

    const result = await externalWebhookService.lookupOrders(STORE_ID, { phone: '+595981000000' });

    assert.equal(result.success, true);
    assert.equal(result.orders.length, 1);
    const order = result.orders[0];
    assert.equal(order.coverage.has_coverage, true);
    assert.equal(order.coverage.reason, null);
    assert.equal(order.coverage.available_carriers.length, 2);
    assert.ok(order.coverage.available_carriers.every((c) => c.carrier_type === 'internal'));
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].fn, 'get_order_coverage_status');
    assert.equal(rpcCalls[0].args.p_store_id, STORE_ID);
  });

  it('surfaces external carrier (TSI) in coverage for an Atyra order', async () => {
    stubOrdersQuery([baseOrderRow({ shipping_city: 'Atyra' })]);
    const rpcCalls: RpcCall[] = [];
    stubRpc(
      (_fn, args) => ({
        data: {
          shipping_city: args.p_shipping_city,
          shipping_city_normalized: 'atyra',
          has_coverage: true,
          reason: null,
          store_active_carriers_count: 3,
          available_carriers: [
            { carrier_id: 'tsi', name: 'TSI', rate: 30000, is_cheapest: true, carrier_type: 'external' },
            { carrier_id: 'lucero', name: 'Lucero del este', rate: 35000, is_cheapest: false, carrier_type: 'internal' },
          ],
        },
        error: null,
      }),
      rpcCalls
    );

    const result = await externalWebhookService.lookupOrders(STORE_ID, { phone: '+595981000000' });

    assert.equal(result.success, true);
    const carriers = result.orders[0].coverage.available_carriers;
    assert.equal(carriers.length, 2);
    assert.equal(carriers[0].carrier_type, 'external');
    assert.equal(carriers[0].is_cheapest, true);
    assert.equal(carriers[1].carrier_type, 'internal');
  });

  it('returns has_coverage:false with reason no_coverage_in_store for an uncovered city (Pilar)', async () => {
    stubOrdersQuery([baseOrderRow({ shipping_city: 'Pilar' })]);
    const rpcCalls: RpcCall[] = [];
    stubRpc(
      (_fn, _args) => ({
        data: {
          shipping_city: 'Pilar',
          shipping_city_normalized: 'pilar',
          has_coverage: false,
          reason: 'no_coverage_in_store',
          store_active_carriers_count: 3,
          available_carriers: [],
        },
        error: null,
      }),
      rpcCalls
    );

    const result = await externalWebhookService.lookupOrders(STORE_ID, { phone: '+595981000000' });

    const cov = result.orders[0].coverage;
    assert.equal(cov.has_coverage, false);
    assert.equal(cov.reason, 'no_coverage_in_store');
    assert.equal(cov.available_carriers.length, 0);
    assert.equal(cov.store_active_carriers_count, 3);
  });

  it('returns the no_shipping_city stub WITHOUT calling the RPC when shipping_city is null', async () => {
    stubOrdersQuery([baseOrderRow({ shipping_city: null })]);
    const rpcCalls: RpcCall[] = [];
    stubRpc(
      () => ({ data: null, error: { message: 'should never be called' } }),
      rpcCalls
    );

    const result = await externalWebhookService.lookupOrders(STORE_ID, { phone: '+595981000000' });

    const cov = result.orders[0].coverage;
    assert.equal(cov.has_coverage, null);
    assert.equal(cov.reason, 'no_shipping_city');
    assert.equal(cov.shipping_city, null);
    assert.equal(rpcCalls.length, 0);
  });

  it('caches per request: 3 orders for the same phone + same city = 1 RPC call', async () => {
    stubOrdersQuery([
      baseOrderRow({ id: 'a', shipping_city: 'Asuncion' }),
      baseOrderRow({ id: 'b', shipping_city: 'Asuncion' }),
      baseOrderRow({ id: 'c', shipping_city: 'asuncion' }), // case mismatch, still cache hit
    ]);
    const rpcCalls: RpcCall[] = [];
    stubRpc(
      (_fn, args) => ({
        data: {
          shipping_city: args.p_shipping_city,
          shipping_city_normalized: 'asuncion',
          has_coverage: true,
          reason: null,
          store_active_carriers_count: 1,
          available_carriers: [
            { carrier_id: 'lucero', name: 'Lucero del este', rate: 25000, is_cheapest: true, carrier_type: 'internal' },
          ],
        },
        error: null,
      }),
      rpcCalls
    );

    const result = await externalWebhookService.lookupOrders(STORE_ID, { phone: '+595981000000' });

    assert.equal(result.orders.length, 3);
    assert.equal(rpcCalls.length, 1);
    for (const order of result.orders) {
      assert.equal(order.coverage.has_coverage, true);
      assert.equal(order.coverage.available_carriers.length, 1);
    }
  });

  it('parallelizes distinct cities: 2 orders, 2 cities = 2 RPC calls (in parallel)', async () => {
    stubOrdersQuery([
      baseOrderRow({ id: 'asu', shipping_city: 'Asuncion' }),
      baseOrderRow({ id: 'aty', shipping_city: 'Atyra' }),
    ]);
    const rpcCalls: RpcCall[] = [];
    stubRpc(
      (_fn, args) => {
        const city = String(args.p_shipping_city);
        if (city === 'Asuncion') {
          return {
            data: {
              shipping_city: city,
              shipping_city_normalized: 'asuncion',
              has_coverage: true,
              reason: null,
              store_active_carriers_count: 2,
              available_carriers: [
                { carrier_id: 'lucero', name: 'Lucero', rate: 25000, is_cheapest: true, carrier_type: 'internal' },
              ],
            },
            error: null,
          };
        }
        return {
          data: {
            shipping_city: city,
            shipping_city_normalized: 'atyra',
            has_coverage: true,
            reason: null,
            store_active_carriers_count: 2,
            available_carriers: [
              { carrier_id: 'tsi', name: 'TSI', rate: 30000, is_cheapest: true, carrier_type: 'external' },
            ],
          },
          error: null,
        };
      },
      rpcCalls
    );

    const result = await externalWebhookService.lookupOrders(STORE_ID, { phone: '+595981000000' });

    assert.equal(rpcCalls.length, 2);
    const asu = result.orders.find((o) => o.id === 'asu')!;
    const aty = result.orders.find((o) => o.id === 'aty')!;
    assert.equal(asu.coverage.available_carriers[0].carrier_type, 'internal');
    assert.equal(aty.coverage.available_carriers[0].carrier_type, 'external');
  });

  it('falls back to a stub (and still returns the order) when the RPC errors', async () => {
    stubOrdersQuery([baseOrderRow({ shipping_city: 'Asuncion' })]);
    const rpcCalls: RpcCall[] = [];
    stubRpc(
      () => ({ data: null, error: { message: 'pg_rpc transient failure' } }),
      rpcCalls
    );

    const result = await externalWebhookService.lookupOrders(STORE_ID, { phone: '+595981000000' });

    assert.equal(result.success, true);
    assert.equal(result.orders.length, 1);
    const cov = result.orders[0].coverage;
    assert.equal(cov.has_coverage, null);
    assert.equal(cov.shipping_city, 'Asuncion');
    assert.equal(cov.store_active_carriers_count, 0);
    assert.deepEqual(cov.available_carriers, []);
  });

  it('falls back to a stub when the RPC throws', async () => {
    stubOrdersQuery([baseOrderRow({ shipping_city: 'Asuncion' })]);
    (supabaseAdmin as any).rpc = () => {
      throw new Error('connection refused');
    };

    const result = await externalWebhookService.lookupOrders(STORE_ID, { phone: '+595981000000' });

    assert.equal(result.success, true);
    const cov = result.orders[0].coverage;
    assert.equal(cov.has_coverage, null);
    assert.deepEqual(cov.available_carriers, []);
  });

  it('preserves the rest of the lookup response shape unchanged', async () => {
    stubOrdersQuery([baseOrderRow({ shipping_city: 'Asuncion' })]);
    stubRpc(
      (_fn, args) => ({
        data: {
          shipping_city: args.p_shipping_city,
          shipping_city_normalized: 'asuncion',
          has_coverage: true,
          reason: null,
          store_active_carriers_count: 1,
          available_carriers: [
            { carrier_id: 'lucero', name: 'Lucero', rate: 25000, is_cheapest: true, carrier_type: 'internal' },
          ],
        },
        error: null,
      }),
      []
    );

    const result = await externalWebhookService.lookupOrders(STORE_ID, { phone: '+595981000000' });

    const o = result.orders[0];
    assert.equal(o.order_number, '#1001');
    assert.equal(o.customer_name, 'Ana Pereira');
    assert.equal(o.city, 'Asuncion');
    assert.equal(o.payment_method, 'cash_on_delivery');
    assert.equal(o.items.length, 1);
    assert.equal(o.items[0].sku, 'NOC-AV-001');
    assert.equal(o.items[0].quantity, 1);
    assert.ok(o.coverage); // coverage exists
  });
});
