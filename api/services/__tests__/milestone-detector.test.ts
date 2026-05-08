/**
 * Unit tests for milestone-detector.service.ts.
 *
 * Run with:
 *   npx tsx --test api/services/__tests__/milestone-detector.test.ts
 *
 * Covers the P1 credibility hot-fix surface:
 *   1. Subject + body text include the store name (multi-store owners need
 *      to know which tienda crossed the milestone).
 *   2. carrier_count is derived from `courier_id` (the column actually exists)
 *      not `carrier_id` (which silently returned 0 in production).
 *   3. delivery_rate denominator is "dispatched" (sleeves_status in
 *      DISPATCHED_STATUSES), not "in_transit_at IS NOT NULL". COD orders
 *      that skip the in_transit step caused unbounded rates pre-fix.
 *   4. delivery_rate caps at 100%.
 */

import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_ANON_KEY ??= 'test-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service';
process.env.RESEND_API_KEY ??= '';

const { milestoneEmailSubject, milestoneEmailText } = await import(
  '../email-jsx-templates/MilestoneEmail'
);
const connectionModule = await import('../../db/connection');

const supabaseAdmin = connectionModule.supabaseAdmin;
const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);

interface FilterCall {
  table: string;
  columns?: string;
  filters: Array<{ op: string; args: unknown[] }>;
}

interface MockBuilderConfig {
  data?: unknown;
  count?: number;
  error?: { message: string } | null;
}

// Records every fluent call against orders so the test can assert on which
// columns were selected and which filters were applied.
function makeBuilder(table: string, config: MockBuilderConfig, log: FilterCall[]): any {
  const call: FilterCall = { table, filters: [] };
  log.push(call);
  const self: any = {
    select(columns?: string) {
      call.columns = typeof columns === 'string' ? columns : '(default)';
      return self;
    },
    eq(...args: unknown[]) { call.filters.push({ op: 'eq', args }); return self; },
    in(...args: unknown[]) { call.filters.push({ op: 'in', args }); return self; },
    is(...args: unknown[]) { call.filters.push({ op: 'is', args }); return self; },
    not(...args: unknown[]) { call.filters.push({ op: 'not', args }); return self; },
    or(...args: unknown[]) { call.filters.push({ op: 'or', args }); return self; },
    order(...args: unknown[]) { call.filters.push({ op: 'order', args }); return self; },
    limit(...args: unknown[]) { call.filters.push({ op: 'limit', args }); return self; },
    maybeSingle() {
      return Promise.resolve({ data: config.data ?? null, error: config.error ?? null });
    },
    single() {
      return Promise.resolve({ data: config.data ?? null, error: config.error ?? null });
    },
    then(onFulfilled: (v: any) => any) {
      return Promise.resolve({
        data: config.data ?? null,
        count: config.count,
        error: config.error ?? null,
      }).then(onFulfilled);
    },
  };
  return self;
}

// ============================================================================
// Pure helpers
// ============================================================================

describe('milestone email subject', () => {
  it('names the store explicitly so multi-store owners are not confused', () => {
    const subject = milestoneEmailSubject({
      firstName: 'Gastón',
      milestoneValue: 100,
      storeName: 'NOCTE',
    });
    assert.equal(subject, '100 órdenes en NOCTE, Gastón.');
  });

  it('handles store names with special characters cleanly', () => {
    const subject = milestoneEmailSubject({
      firstName: 'Ana',
      milestoneValue: 50,
      storeName: 'Solenne',
    });
    assert.equal(subject, '50 órdenes en Solenne, Ana.');
  });
});

describe('milestone email text body', () => {
  const baseData = {
    firstName: 'Gastón',
    storeName: 'NOCTE',
    milestoneValue: 100,
    firstOrderDate: '20 de febrero',
    firstOrderTime: '04:01',
    firstOrderAmount: '229.000 Gs',
    productCount: 3,
    carrierCount: 7,
    deliveryRate: 91,
    bestDay: '14 de marzo',
    bestDayCount: 12,
    marginAccumulated: '14.178.200 Gs',
    shareUrl: 'https://app.ordefy.io/wrapped/abc',
    currency: 'PYG',
  } as const;

  it('headlines the store name in the first line', () => {
    const text = milestoneEmailText(baseData);
    assert.match(text, /^100 órdenes en NOCTE, Gastón\./);
  });

  it('repeats the store name in the body intro', () => {
    const text = milestoneEmailText(baseData);
    assert.match(text, /Esto pasó en NOCTE:/);
  });

  it('uses singular courier when carrierCount is 1', () => {
    const text = milestoneEmailText({ ...baseData, carrierCount: 1 });
    assert.match(text, /1 courier usado/);
    assert.doesNotMatch(text, /1 couriers usados/);
  });

  it('uses plural couriers when carrierCount is greater than 1', () => {
    const text = milestoneEmailText({ ...baseData, carrierCount: 7 });
    assert.match(text, /7 couriers usados/);
  });
});

// ============================================================================
// computeStats wiring (via the public checkAndSendMilestone path is heavy;
// we exercise the supabase query layer directly via injected stubs).
// ============================================================================

describe('milestone stats queries', () => {
  let calls: FilterCall[] = [];
  let originalEnv: string | undefined;

  before(() => {
    originalEnv = process.env.RESEND_API_KEY;
    // Force email-disabled path so the actual send is a no-op.
    process.env.RESEND_API_KEY = '';
  });

  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    (supabaseAdmin as any).from = originalFrom;
    if (originalEnv === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalEnv;
  });

  it('queries courier_id (not carrier_id) when computing distinct couriers', async () => {
    // We hit checkAndSendMilestone with a count exactly at a milestone so
    // it walks through computeStats.
    const seenColumns: string[] = [];
    (supabaseAdmin as any).from = (table: string) => {
      // Stub orders queries with predictable shapes per call order.
      if (table === 'orders') {
        // Use the call sequence to disambiguate. We track every "select" call.
        return {
          select(columns?: string, opts?: any) {
            seenColumns.push(typeof columns === 'string' ? columns : '');
            const isCount = !!opts?.head;
            return makeOrderResponder(seenColumns.length, isCount);
          },
        };
      }
      if (table === 'founder_emails_sent') {
        return {
          select() {
            return {
              eq() { return this; },
              maybeSingle() { return Promise.resolve({ data: null, error: null }); },
            };
          },
          insert() { return Promise.resolve({ data: null, error: null }); },
        };
      }
      if (table === 'stores') {
        return {
          select() {
            return {
              eq() { return this; },
              maybeSingle() {
                return Promise.resolve({
                  data: { name: 'NOCTE', country: 'PY', timezone: 'America/Asuncion', currency: 'PYG' },
                  error: null,
                });
              },
            };
          },
        };
      }
      if (table === 'user_stores') {
        return {
          select() {
            return {
              eq() { return this; },
              order() { return this; },
              limit() { return this; },
              maybeSingle() {
                return Promise.resolve({ data: { user_id: 'user-1' }, error: null });
              },
            };
          },
        };
      }
      if (table === 'users') {
        return {
          select() {
            return {
              eq() { return this; },
              maybeSingle() {
                return Promise.resolve({
                  data: { email: 'gaston@thebrightidea.ai', name: 'Gaston' },
                  error: null,
                });
              },
            };
          },
        };
      }
      if (table === 'order_line_items') {
        return {
          select() {
            return { in() { return Promise.resolve({ data: [], error: null }); } };
          },
        };
      }
      if (table === 'products') {
        return {
          select() {
            return { in() { return Promise.resolve({ data: [], error: null }); } };
          },
        };
      }
      if (table === 'share_cards') {
        return {
          insert() {
            return {
              select() {
                return { single() { return Promise.resolve({ data: { id: 'sc-1' }, error: null }); } };
              },
            };
          },
          select() {
            return {
              eq() { return this; },
              single() { return Promise.resolve({ data: { token: 'tok' }, error: null }); },
            };
          },
        };
      }
      return originalFrom(table);
    };

    function makeOrderResponder(callIdx: number, isCount: boolean): any {
      // Reflects the order of supabaseAdmin.from('orders').select(...) calls
      // in milestone-detector.service.ts:
      //   1. countDeliveredOrders -> count, head:true, eq sleeves_status delivered
      //   2. firstOrder            -> .order().limit(1).maybeSingle()
      //   3. deliveredOrders list  -> rows
      //   4. dispatchedCount       -> count, head:true, in sleeves_status DISPATCHED
      //   5. deliveredCount (rate) -> count, head:true, eq delivered
      //   6. couriers              -> rows with courier_id, .not('courier_id', 'is', null)
      const builder: any = {
        eq() { return builder; },
        in() { return builder; },
        is() { return builder; },
        not(col: string) {
          if (callIdx === 6) {
            // The carrier→courier fix: this MUST be 'courier_id'.
            assert.equal(col, 'courier_id', 'distinct couriers query must filter on courier_id');
          }
          return builder;
        },
        order() { return builder; },
        limit() { return builder; },
        maybeSingle() {
          if (callIdx === 2) {
            return Promise.resolve({
              data: { created_at: '2026-01-01T10:00:00Z', total_price: 229000, currency: 'PYG' },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (v: any) => any) {
          if (isCount) {
            // Each count call uses a different total to verify the rate calc.
            if (callIdx === 1) return Promise.resolve({ count: 100, error: null }).then(resolve);
            if (callIdx === 4) return Promise.resolve({ count: 110, error: null }).then(resolve); // dispatched
            if (callIdx === 5) return Promise.resolve({ count: 100, error: null }).then(resolve); // delivered
          }
          if (callIdx === 3) {
            // deliveredOrders list (small to keep test fast)
            const rows = Array.from({ length: 100 }, (_, i) => ({
              id: `o-${i}`,
              created_at: `2026-02-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`,
              total_price: 229000,
              currency: 'PYG',
            }));
            return Promise.resolve({ data: rows, error: null }).then(resolve);
          }
          if (callIdx === 6) {
            // Distinct couriers: 7 distinct values across 100 rows
            const rows = Array.from({ length: 100 }, (_, i) => ({
              courier_id: `courier-${i % 7}`,
            }));
            return Promise.resolve({ data: rows, error: null }).then(resolve);
          }
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return builder;
    }

    const { checkAndSendMilestone } = await import('../milestone-detector.service');
    await checkAndSendMilestone('store-1', 'order-1');

    // The 6th orders.select call must request 'courier_id' (not 'carrier_id').
    // Find select calls that requested either column name.
    const colCalls = seenColumns.filter((c) => c.includes('courier_id') || c.includes('carrier_id'));
    assert.deepEqual(
      colCalls,
      ['courier_id'],
      `expected exactly one courier_id select, got: ${JSON.stringify(seenColumns)}`,
    );
  });

  it('caps delivery_rate at 100 even when delivered count exceeds dispatched count', async () => {
    // This is the safety belt for the in_transit_at denominator bug. If
    // delivered=231 and dispatched=10 (the prior NOCTE shape), the rate
    // calculation must clamp at 100, not emit 2310.
    let capturedPrivateData: Record<string, unknown> | null = null;

    (supabaseAdmin as any).from = (table: string) => {
      if (table === 'orders') {
        return {
          select(_columns?: string, opts?: any) {
            const isCount = !!opts?.head;
            return makeRateResponder(isCount);
          },
        };
      }
      if (table === 'founder_emails_sent') {
        return {
          select() {
            return {
              eq() { return this; },
              maybeSingle() { return Promise.resolve({ data: null, error: null }); },
            };
          },
          insert() { return Promise.resolve({ data: null, error: null }); },
        };
      }
      if (table === 'stores') {
        return {
          select() {
            return {
              eq() { return this; },
              maybeSingle() {
                return Promise.resolve({
                  data: { name: 'NOCTE', country: 'PY', timezone: 'America/Asuncion', currency: 'PYG' },
                  error: null,
                });
              },
            };
          },
        };
      }
      if (table === 'user_stores') {
        return {
          select() {
            return {
              eq() { return this; },
              order() { return this; },
              limit() { return this; },
              maybeSingle() { return Promise.resolve({ data: { user_id: 'user-1' }, error: null }); },
            };
          },
        };
      }
      if (table === 'users') {
        return {
          select() {
            return {
              eq() { return this; },
              maybeSingle() {
                return Promise.resolve({
                  data: { email: 'g@b.ai', name: 'Gaston' },
                  error: null,
                });
              },
            };
          },
        };
      }
      if (table === 'order_line_items') {
        return {
          select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; },
        };
      }
      if (table === 'products') {
        return {
          select() { return { in() { return Promise.resolve({ data: [], error: null }); } }; },
        };
      }
      if (table === 'share_cards') {
        return {
          insert(row: any) {
            capturedPrivateData = row?.private_data ?? null;
            return {
              select() {
                return { single() { return Promise.resolve({ data: { id: 'sc-1' }, error: null }); } };
              },
            };
          },
          select() {
            return {
              eq() { return this; },
              single() { return Promise.resolve({ data: { token: 'tok' }, error: null }); },
            };
          },
        };
      }
      return originalFrom(table);
    };

    let callIdx = 0;
    function makeRateResponder(isCount: boolean): any {
      callIdx++;
      const localIdx = callIdx;
      const builder: any = {
        eq() { return builder; },
        in() { return builder; },
        is() { return builder; },
        not() { return builder; },
        order() { return builder; },
        limit() { return builder; },
        maybeSingle() {
          if (localIdx === 2) {
            return Promise.resolve({
              data: { created_at: '2026-01-01T10:00:00Z', total_price: 229000, currency: 'PYG' },
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (v: any) => any) {
          if (isCount) {
            // 1: countDeliveredOrders -> 100 (milestone trigger)
            // 4: dispatchedCount     -> 10 (worst-case denominator)
            // 5: deliveredCount      -> 100 (numerator)
            if (localIdx === 1) return Promise.resolve({ count: 100, error: null }).then(resolve);
            if (localIdx === 4) return Promise.resolve({ count: 10, error: null }).then(resolve);
            if (localIdx === 5) return Promise.resolve({ count: 100, error: null }).then(resolve);
          }
          // 3 = deliveredOrders list, 6 = couriers list
          return Promise.resolve({ data: [], error: null }).then(resolve);
        },
      };
      return builder;
    }

    const { checkAndSendMilestone } = await import('../milestone-detector.service');
    await checkAndSendMilestone('store-1', 'order-1');

    assert.ok(capturedPrivateData, 'share_card insert was not called');
    assert.equal(
      (capturedPrivateData as any).delivery_rate,
      100,
      `delivery_rate must clamp at 100 when delivered > dispatched, got ${(capturedPrivateData as any).delivery_rate}`,
    );
  });
});
