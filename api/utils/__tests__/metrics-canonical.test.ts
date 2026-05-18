/**
 * Unit tests for canonical metrics formulas.
 *
 * Run with:
 *   npx tsx --test api/utils/__tests__/metrics-canonical.test.ts
 *
 * The fixtures are deliberately minimal but exercise every status the audit
 * flagged as drifting between endpoints (delivered, settled, in_transit,
 * shipped legacy, returned, delivery_failed, cancelled with/without
 * shipped_at, rejected, pending). Drift in any helper here means drift in
 * production cards.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    averageOrderValue,
    cancellationRate,
    confirmationRate,
    customerLtv,
    deliveryRate,
    deliveryRateDecimal,
    filterActive,
    grossMarginPct,
    grossProfitReal,
    isFailedAfterDispatch,
    isTerminalSuccess,
    netMarginPct,
    netProfitReal,
    orderCountsByBucket,
    pendingCash,
    realCostPerOrder,
    revenueProyectado,
    revenueReal,
    returnRate,
    roas,
    roi,
    snapshot,
    vatCollected,
    type OrderWithCosts,
} from '../metrics-canonical';
import { ACTIVE_SETTLEMENT_STATUSES, isActiveSettlement } from '../order-status';

const o = (overrides: Partial<OrderWithCosts>): OrderWithCosts => ({
    sleeves_status: overrides.sleeves_status ?? 'pending',
    total_price: overrides.total_price ?? 0,
    shipping_cost: overrides.shipping_cost ?? 0,
    currency: overrides.currency ?? 'PYG',
    shipped_at: overrides.shipped_at ?? null,
    delivered_at: overrides.delivered_at ?? null,
    in_transit_at: overrides.in_transit_at ?? null,
    is_test: overrides.is_test ?? false,
    deleted_at: overrides.deleted_at ?? null,
    courier_id: overrides.courier_id ?? null,
    productCost: overrides.productCost ?? 0,
});

describe('isTerminalSuccess', () => {
    it('returns true for delivered and settled, false for everything else', () => {
        assert.equal(isTerminalSuccess('delivered'), true);
        assert.equal(isTerminalSuccess('settled'), true);
        assert.equal(isTerminalSuccess('in_transit'), false);
        assert.equal(isTerminalSuccess('shipped'), false);
        assert.equal(isTerminalSuccess('returned'), false);
        assert.equal(isTerminalSuccess('pending'), false);
        assert.equal(isTerminalSuccess(null), false);
        assert.equal(isTerminalSuccess(undefined), false);
    });
});

describe('isFailedAfterDispatch', () => {
    it('catches returned, delivery_failed, not_delivered, and cancelled-with-shipped_at', () => {
        assert.equal(isFailedAfterDispatch('returned', null), true);
        assert.equal(isFailedAfterDispatch('delivery_failed', null), true);
        assert.equal(isFailedAfterDispatch('not_delivered', null), true);
        assert.equal(isFailedAfterDispatch('cancelled', '2026-01-01T00:00:00Z'), true);
        assert.equal(isFailedAfterDispatch('cancelled', null), false); // pre-dispatch cancel
        assert.equal(isFailedAfterDispatch('rejected', null), false); // never shipped
        assert.equal(isFailedAfterDispatch('delivered', null), false);
    });
});

describe('filterActive', () => {
    it('removes soft-deleted and is_test rows', () => {
        const orders = [
            o({ sleeves_status: 'delivered', total_price: 100 }),
            o({ sleeves_status: 'delivered', total_price: 200, deleted_at: '2026-01-01' }),
            o({ sleeves_status: 'delivered', total_price: 300, is_test: true }),
        ];
        assert.equal(filterActive(orders).length, 1);
    });
});

describe('revenueReal', () => {
    it('sums total_price for delivered + settled, ignores everything else', () => {
        const orders = [
            o({ sleeves_status: 'delivered', total_price: 100 }),
            o({ sleeves_status: 'settled', total_price: 200 }),
            o({ sleeves_status: 'in_transit', total_price: 999 }),
            o({ sleeves_status: 'returned', total_price: 999 }),
            o({ sleeves_status: 'pending', total_price: 999 }),
        ];
        assert.equal(revenueReal(orders), 300);
    });

    it('segregates by currency', () => {
        const orders = [
            o({ sleeves_status: 'delivered', total_price: 100, currency: 'PYG' }),
            o({ sleeves_status: 'delivered', total_price: 200, currency: 'USD' }),
        ];
        assert.equal(revenueReal(orders, 'PYG'), 100);
        assert.equal(revenueReal(orders, 'USD'), 200);
        assert.equal(revenueReal(orders), 300);
    });

    // Regression test for fix/is-delivered-include-settled (PR #4):
    // before the fix, settled orders dropped out of analytics.ts realRevenue
    // because the route used the strict isDelivered helper. The canonical
    // formula in this file always treated 'settled' as terminal-success, so
    // we lock that invariant down so neither side can drift again.
    it('treats settled as revenue, parity with cod-metrics and analytics overview', () => {
        const orders = [
            o({ sleeves_status: 'delivered', total_price: 1000 }),
            o({ sleeves_status: 'settled', total_price: 1000 }),
        ];
        // Both states count, same weight. Flipping delivered -> settled (which
        // is what settlement reconciliation does) must not move the dashboard.
        assert.equal(revenueReal(orders), 2000);

        const onlyDelivered = [o({ sleeves_status: 'delivered', total_price: 1000 })];
        const onlySettled = [o({ sleeves_status: 'settled', total_price: 1000 })];
        assert.equal(revenueReal(onlyDelivered), revenueReal(onlySettled));
    });
});

// Settlement queue isolation invariant: orders.sleeves_status='settled' is
// a separate enum from settlements.status (which the queue filters by). A
// settled order does NOT appear in the pending settlement queue because
// ACTIVE_SETTLEMENT_STATUSES is about the settlements table row state, not
// the order row state. Locks down the assumption baked into PR #4.
describe('settlement queue vs settled order isolation', () => {
    it('ACTIVE_SETTLEMENT_STATUSES only references settlement-record states, not order states', () => {
        assert.equal(ACTIVE_SETTLEMENT_STATUSES.has('settled'), false);
        assert.equal(ACTIVE_SETTLEMENT_STATUSES.has('delivered'), false);
        assert.equal(isActiveSettlement('settled'), false);
        assert.equal(isActiveSettlement('pending'), true);
        assert.equal(isActiveSettlement('partial'), true);
    });
});

describe('revenueProyectado', () => {
    it('adds delivered cash + in_transit gross weighted by delivery rate', () => {
        // 2 delivered, 2 in_transit. period rate = 2/4 = 0.5
        const orders = [
            o({ sleeves_status: 'delivered', total_price: 100 }),
            o({ sleeves_status: 'delivered', total_price: 100 }),
            o({ sleeves_status: 'in_transit', total_price: 200 }),
            o({ sleeves_status: 'in_transit', total_price: 200 }),
        ];
        // delivered=200, in_transit gross = 400. rate = 0.5. proj = 200 + 400*0.5 = 400
        assert.equal(revenueProyectado(orders), 400);
    });

    it('uses 0.85 default when period has no delivered orders', () => {
        const orders = [o({ sleeves_status: 'in_transit', total_price: 100 })];
        // delivered=0, denom=1 (in_transit). decimal default = 0.85
        // proj = 0 + 100 * 0.85 = 85
        assert.equal(revenueProyectado(orders), 85);
    });
});

describe('deliveryRate', () => {
    it('delivered+settled / dispatched, returns null if no dispatched', () => {
        const orders = [
            o({ sleeves_status: 'delivered', total_price: 1 }),
            o({ sleeves_status: 'delivered', total_price: 1 }),
            o({ sleeves_status: 'in_transit', total_price: 1 }),
            o({ sleeves_status: 'returned', total_price: 1 }),
            o({ sleeves_status: 'cancelled', total_price: 1, shipped_at: '2026-01-01T00:00:00Z' }),
        ];
        // dispatched: delivered(2) + in_transit(1) + returned(1) + cancelled-with-shipped(1) = 5
        // delivered+settled: 2
        // rate = 40
        assert.equal(deliveryRate(orders), 40);
    });

    it('returns null when nothing is dispatched', () => {
        const orders = [
            o({ sleeves_status: 'pending', total_price: 1 }),
            o({ sleeves_status: 'cancelled', total_price: 1 }), // pre-dispatch cancel
        ];
        assert.equal(deliveryRate(orders), null);
    });

    it('counts settled orders in delivered numerator', () => {
        const orders = [
            o({ sleeves_status: 'delivered', total_price: 1 }),
            o({ sleeves_status: 'settled', total_price: 1 }),
            o({ sleeves_status: 'in_transit', total_price: 1 }),
        ];
        // 2 delivered (delivered+settled) / 3 dispatched (delivered+settled+in_transit) ~= 66.67
        const got = deliveryRate(orders);
        assert.ok(got !== null && Math.abs(got - (2 / 3) * 100) < 0.01,
            `expected ~66.67, got ${got}`);
    });
});

describe('deliveryRateDecimal', () => {
    it('returns 0.85 default for empty period', () => {
        assert.equal(deliveryRateDecimal([]), 0.85);
    });

    it('returns 0.85 default when only in_transit (no delivered yet)', () => {
        const orders = [o({ sleeves_status: 'in_transit', total_price: 1 })];
        assert.equal(deliveryRateDecimal(orders), 0.85);
    });

    it('returns delivered/(delivered+in_transit) when both present', () => {
        const orders = [
            o({ sleeves_status: 'delivered', total_price: 1 }),
            o({ sleeves_status: 'delivered', total_price: 1 }),
            o({ sleeves_status: 'delivered', total_price: 1 }),
            o({ sleeves_status: 'in_transit', total_price: 1 }),
        ];
        assert.equal(deliveryRateDecimal(orders), 0.75);
    });
});

describe('confirmationRate', () => {
    it('post_pending / total. Includes everything past pending including failures', () => {
        const orders = [
            o({ sleeves_status: 'pending', total_price: 1 }),
            o({ sleeves_status: 'pending', total_price: 1 }),
            o({ sleeves_status: 'confirmed', total_price: 1 }),
            o({ sleeves_status: 'in_transit', total_price: 1 }),
            o({ sleeves_status: 'delivered', total_price: 1 }),
            o({ sleeves_status: 'returned', total_price: 1 }),
            o({ sleeves_status: 'settled', total_price: 1 }),
            o({ sleeves_status: 'delivery_failed', total_price: 1 }),
        ];
        // post_pending count = 6 (everything except pending pending)
        // total = 8
        assert.equal(confirmationRate(orders), 75);
    });

    it('reproduces the bug where cod-metrics undercounted by excluding in_transit and settled', () => {
        // Snapshot of the audit critical-3 finding: same dataset, two formulas.
        const orders = [
            o({ sleeves_status: 'pending', total_price: 1 }),
            o({ sleeves_status: 'in_transit', total_price: 1 }), // missing in cod-metrics formula
            o({ sleeves_status: 'settled', total_price: 1 }), // missing in cod-metrics formula
            o({ sleeves_status: 'delivered', total_price: 1 }),
        ];
        // Canonical: 3/4 = 75%
        assert.equal(confirmationRate(orders), 75);
        // Old cod-metrics formula would have returned 1/4 = 25% (only 'delivered' from the legacy set).
        // The new helper closes that gap.
    });
});

describe('cancellationRate', () => {
    it('cancelled+rejected / total', () => {
        const orders = [
            o({ sleeves_status: 'cancelled', total_price: 1 }),
            o({ sleeves_status: 'rejected', total_price: 1 }),
            o({ sleeves_status: 'delivered', total_price: 1 }),
            o({ sleeves_status: 'pending', total_price: 1 }),
        ];
        assert.equal(cancellationRate(orders), 50);
    });
});

describe('returnRate', () => {
    it('returned / (delivered + settled + returned)', () => {
        const orders = [
            o({ sleeves_status: 'delivered', total_price: 1 }),
            o({ sleeves_status: 'delivered', total_price: 1 }),
            o({ sleeves_status: 'settled', total_price: 1 }),
            o({ sleeves_status: 'returned', total_price: 1 }),
        ];
        // den = 4, num = 1, rate = 25
        assert.equal(returnRate(orders), 25);
    });

    it('returns null when no terminal orders', () => {
        const orders = [o({ sleeves_status: 'pending', total_price: 1 })];
        assert.equal(returnRate(orders), null);
    });
});

describe('grossProfitReal', () => {
    it('delivered revenue minus delivered cogs', () => {
        const orders = [
            o({ sleeves_status: 'delivered', total_price: 200, productCost: 60 }),
            o({ sleeves_status: 'delivered', total_price: 200, productCost: 80 }),
            o({ sleeves_status: 'in_transit', total_price: 9999, productCost: 9999 }), // ignored
        ];
        assert.equal(grossProfitReal(orders), 200 + 200 - 60 - 80);
    });
});

describe('netProfitReal', () => {
    it('delivered revenue - (cogs + shipping + confirmation_fee*delivered + ad_spend)', () => {
        const orders = [
            o({ sleeves_status: 'delivered', total_price: 100, productCost: 30, shipping_cost: 10 }),
            o({ sleeves_status: 'delivered', total_price: 100, productCost: 40, shipping_cost: 10 }),
        ];
        // rev=200, cogs=70, shipping=20, confFee=5*2=10, ads=15. net=200-70-20-10-15=85
        assert.equal(netProfitReal(orders, { confirmationFee: 5, adSpend: 15 }), 85);
    });
});

describe('grossMarginPct / netMarginPct', () => {
    it('returns null when revenue is zero', () => {
        assert.equal(grossMarginPct([]), null);
        assert.equal(netMarginPct([], { confirmationFee: 0, adSpend: 0 }), null);
    });

    it('computes correctly when revenue is positive', () => {
        const orders = [
            o({ sleeves_status: 'delivered', total_price: 100, productCost: 40 }),
        ];
        assert.equal(grossMarginPct(orders), 60);
    });
});

describe('roas', () => {
    it('returns null when adSpend is zero (NOT zero)', () => {
        const orders = [o({ sleeves_status: 'delivered', total_price: 100 })];
        assert.equal(roas(orders, 0), null);
    });

    it('computes revenue/adSpend correctly', () => {
        const orders = [o({ sleeves_status: 'delivered', total_price: 100 })];
        assert.equal(roas(orders, 50), 2);
    });
});

describe('roi', () => {
    it('returns null when total costs are zero', () => {
        assert.equal(roi([], { confirmationFee: 0, adSpend: 0 }), null);
    });

    it('computes (rev - costs) / costs * 100', () => {
        const orders = [
            o({ sleeves_status: 'delivered', total_price: 200, productCost: 50, shipping_cost: 10 }),
        ];
        // costs = 50 + 10 + 5*1 + 35 = 100. rev=200. roi = (200-100)/100*100 = 100
        assert.equal(roi(orders, { confirmationFee: 5, adSpend: 35 }), 100);
    });
});

describe('customerLtv', () => {
    it('only counts delivered+settled per currency', () => {
        const orders = [
            o({ sleeves_status: 'delivered', total_price: 100, currency: 'PYG' }),
            o({ sleeves_status: 'settled', total_price: 50, currency: 'PYG' }),
            o({ sleeves_status: 'returned', total_price: 999, currency: 'PYG' }),
            o({ sleeves_status: 'delivered', total_price: 25, currency: 'USD' }),
        ];
        assert.equal(customerLtv(orders, 'PYG'), 150);
        assert.equal(customerLtv(orders, 'USD'), 25);
    });
});

describe('averageOrderValue', () => {
    it('revenue/count(delivered), null when no delivered', () => {
        assert.equal(averageOrderValue([]), null);
        const orders = [
            o({ sleeves_status: 'delivered', total_price: 100 }),
            o({ sleeves_status: 'delivered', total_price: 300 }),
            o({ sleeves_status: 'pending', total_price: 9999 }), // not in denom
        ];
        assert.equal(averageOrderValue(orders), 200);
    });
});

describe('vatCollected', () => {
    it('returns 0 when tax rate is 0 or negative', () => {
        const orders = [o({ sleeves_status: 'delivered', total_price: 11000 })];
        assert.equal(vatCollected(orders, 0), 0);
        assert.equal(vatCollected(orders, -5), 0);
    });

    it('computes IVA = revenue - revenue/(1 + rate/100)', () => {
        const orders = [o({ sleeves_status: 'delivered', total_price: 11000 })];
        // 10% tax: IVA = 11000 - 11000/1.1 = 1000
        assert.equal(vatCollected(orders, 10), 1000);
    });
});

describe('orderCountsByBucket', () => {
    it('every order lands in exactly one bucket, total invariant holds', () => {
        const orders = [
            o({ sleeves_status: 'delivered' }),
            o({ sleeves_status: 'settled' }),
            o({ sleeves_status: 'in_transit' }),
            o({ sleeves_status: 'shipped' }), // legacy in_transit
            o({ sleeves_status: 'pending' }),
            o({ sleeves_status: 'cancelled' }),
            o({ sleeves_status: 'rejected' }),
            o({ sleeves_status: 'returned' }),
            o({ sleeves_status: 'unknown_legacy' }),
        ];
        const buckets = orderCountsByBucket(orders);
        const sum = buckets.delivered + buckets.inTransit + buckets.pending +
                    buckets.cancelled + buckets.returned + buckets.other;
        assert.equal(sum, buckets.total);
        assert.equal(buckets.delivered, 2);
        assert.equal(buckets.inTransit, 2);
        assert.equal(buckets.pending, 1);
        assert.equal(buckets.cancelled, 2);
        assert.equal(buckets.returned, 1);
        assert.equal(buckets.other, 1);
    });
});

describe('pendingCash', () => {
    it('post_pending pre-terminal with payment_status=pending', () => {
        const orders = [
            { ...o({ sleeves_status: 'in_transit', total_price: 100 }), payment_status: 'pending' },
            { ...o({ sleeves_status: 'ready_to_ship', total_price: 50 }), payment_status: 'pending' },
            { ...o({ sleeves_status: 'delivered', total_price: 200 }), payment_status: 'pending' }, // not pending cash, already terminal
            { ...o({ sleeves_status: 'returned', total_price: 80 }), payment_status: 'pending' }, // failed terminal, not pending
            { ...o({ sleeves_status: 'in_transit', total_price: 1000 }), payment_status: 'collected' }, // collected, not pending
        ];
        assert.equal(pendingCash(orders), 150);
    });
});

describe('realCostPerOrder', () => {
    it('returns 0 when there are no delivered orders', () => {
        const orders = [
            o({ sleeves_status: 'pending', total_price: 100 }),
            o({ sleeves_status: 'cancelled', total_price: 200 }),
            o({ sleeves_status: 'in_transit', total_price: 150 }),
        ];
        assert.equal(realCostPerOrder(orders, 50000), 0);
    });

    it('divides realCosts by delivered count only', () => {
        const orders = [
            o({ sleeves_status: 'delivered', total_price: 100 }),
            o({ sleeves_status: 'delivered', total_price: 100 }),
            o({ sleeves_status: 'settled', total_price: 100 }),
            o({ sleeves_status: 'pending', total_price: 100 }),
            o({ sleeves_status: 'cancelled', total_price: 100 }),
        ];
        // 3 delivered (delivered + settled count as terminal success).
        // realCosts of 90 -> 30 per delivered order.
        assert.equal(realCostPerOrder(orders, 90), 30);
    });

    it('drops off-currency orders before counting', () => {
        const orders = [
            o({ sleeves_status: 'delivered', total_price: 100, currency: 'PYG' }),
            o({ sleeves_status: 'delivered', total_price: 100, currency: 'PYG' }),
            o({ sleeves_status: 'delivered', total_price: 100, currency: 'USD' }), // dropped
        ];
        assert.equal(realCostPerOrder(orders, 60, 'PYG'), 30);
    });
});

describe('snapshot regression fixture', () => {
    it('produces stable output for a known mixed dataset', () => {
        const orders = [
            o({ sleeves_status: 'delivered', total_price: 100, productCost: 30, shipping_cost: 5 }),
            o({ sleeves_status: 'settled', total_price: 100, productCost: 40, shipping_cost: 5 }),
            o({ sleeves_status: 'in_transit', total_price: 200, productCost: 80, shipping_cost: 10 }),
            o({ sleeves_status: 'pending', total_price: 50 }),
            o({ sleeves_status: 'cancelled', total_price: 30 }),
            o({ sleeves_status: 'returned', total_price: 60, productCost: 20 }),
        ];
        const snap = snapshot(orders, {
            confirmationFee: 5,
            adSpend: 20,
            storeCurrency: 'PYG',
        });
        assert.equal(snap.totalOrders, 6);
        assert.equal(snap.revenueReal, 200);
        // Buckets invariant
        const sum = snap.buckets.delivered + snap.buckets.inTransit + snap.buckets.pending +
                    snap.buckets.cancelled + snap.buckets.returned + snap.buckets.other;
        assert.equal(sum, snap.buckets.total);
    });
});
