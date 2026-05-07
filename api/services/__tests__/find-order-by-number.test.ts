/**
 * Unit tests for ExternalWebhookService.findOrderByNumber lookup semantics.
 *
 * Run with:
 *   npx tsx --test api/services/__tests__/find-order-by-number.test.ts
 *
 * Background: order_number is NOT unique per store. The previous implementation
 * used .limit(1).maybeSingle() without ORDER BY, which let PostgREST pick an
 * arbitrary row when duplicates existed. When the picked row was a stale
 * delivered order, the confirm endpoint rejected with INVALID_STATUS even
 * though a confirmable pending order with the same number existed.
 *
 * The fix orders matches by created_at DESC, prefers active rows
 * (pending/contacted), and surfaces MULTIPLE_ORDERS when more than one active
 * row shares the same number.
 *
 * Strategy: stub supabaseAdmin.from to return canned rows for the .or()
 * query and exercise the private method through the singleton.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// connection.ts validates env at import-time, set defaults so the module loads
process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_ANON_KEY ??= 'test-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service';

const connectionModule = await import('../../db/connection');
const { externalWebhookService } = await import('../external-webhook.service');

const supabaseAdmin = connectionModule.supabaseAdmin;
const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);

type Row = { id: string; sleeves_status: string; created_at: string };

function stubOrdersQuery(rows: Row[]): void {
  (supabaseAdmin as any).from = (table: string) => {
    if (table !== 'orders') return originalFrom(table);
    const builder: any = {
      _rows: rows,
      select() { return this; },
      eq() { return this; },
      is() { return this; },
      or() { return this; },
      order() { return this; },
      then(resolve: (v: any) => any) {
        return Promise.resolve({ data: this._rows, error: null }).then(resolve);
      }
    };
    return builder;
  };
}

function callFindOrderByNumber(orderNumber: string): Promise<any> {
  return (externalWebhookService as any).findOrderByNumber(
    '1eeaf2c7-2cd2-4257-8213-d90b1280a19d',
    orderNumber
  );
}

describe('findOrderByNumber', () => {
  afterEach(() => {
    (supabaseAdmin as any).from = originalFrom;
  });

  it('returns the pending row when the duplicate set is delivered + pending (the production bug case)', async () => {
    stubOrdersQuery([
      { id: 'pending-id', sleeves_status: 'pending', created_at: '2026-05-07T07:39:22Z' },
      { id: 'delivered-id', sleeves_status: 'delivered', created_at: '2026-04-17T16:49:28Z' }
    ]);

    const result = await callFindOrderByNumber('ORD-20260430');

    assert.equal(result.ok, true);
    assert.equal(result.order.id, 'pending-id');
    assert.equal(result.order.status, 'pending');
  });

  it('returns MULTIPLE_ORDERS when more than one active match shares the same number', async () => {
    stubOrdersQuery([
      { id: 'pending-1', sleeves_status: 'pending', created_at: '2026-05-07T08:00:00Z' },
      { id: 'pending-2', sleeves_status: 'pending', created_at: '2026-05-06T08:00:00Z' }
    ]);

    const result = await callFindOrderByNumber('ORD-20260430');

    assert.equal(result.ok, false);
    assert.equal(result.code, 'MULTIPLE_ORDERS');
    assert.equal(result.count, 2);
  });

  it('treats contacted as an active status alongside pending', async () => {
    stubOrdersQuery([
      { id: 'contacted-id', sleeves_status: 'contacted', created_at: '2026-05-07T08:00:00Z' },
      { id: 'pending-id', sleeves_status: 'pending', created_at: '2026-05-06T08:00:00Z' }
    ]);

    const result = await callFindOrderByNumber('ORD-20260430');

    assert.equal(result.ok, false);
    assert.equal(result.code, 'MULTIPLE_ORDERS');
    assert.equal(result.count, 2);
  });

  it('returns NOT_FOUND when no rows match', async () => {
    stubOrdersQuery([]);

    const result = await callFindOrderByNumber('ORD-99999999');

    assert.equal(result.ok, false);
    assert.equal(result.code, 'NOT_FOUND');
  });

  it('returns the most recent row when no row is in an active status', async () => {
    // Eg. status update API hitting an order that has been delivered, but the
    // number is duplicated across two delivered shipments. Pick the newer one
    // so we do not accidentally mutate stale history.
    stubOrdersQuery([
      { id: 'newer-delivered', sleeves_status: 'delivered', created_at: '2026-05-07T07:00:00Z' },
      { id: 'older-delivered', sleeves_status: 'delivered', created_at: '2026-04-17T16:00:00Z' }
    ]);

    const result = await callFindOrderByNumber('ORD-20260430');

    assert.equal(result.ok, true);
    assert.equal(result.order.id, 'newer-delivered');
    assert.equal(result.order.status, 'delivered');
  });

  it('returns the single match when only one row exists', async () => {
    stubOrdersQuery([
      { id: 'only-id', sleeves_status: 'pending', created_at: '2026-05-07T07:00:00Z' }
    ]);

    const result = await callFindOrderByNumber('ORD-20260430');

    assert.equal(result.ok, true);
    assert.equal(result.order.id, 'only-id');
    assert.equal(result.order.status, 'pending');
  });

  it('rejects empty input as NOT_FOUND without hitting the DB', async () => {
    let touched = false;
    (supabaseAdmin as any).from = () => {
      touched = true;
      return originalFrom('orders');
    };

    const result = await callFindOrderByNumber('   ');

    assert.equal(result.ok, false);
    assert.equal(result.code, 'NOT_FOUND');
    assert.equal(touched, false);
  });
});
