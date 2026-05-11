// Single authoritative source for every metric the app displays. Endpoints
// MUST consume these helpers instead of inlining their own status filters,
// denominators, or currency assumptions. Drift between dashboard cards and
// COD module cards is what motivated this file (see audit
// outputs/ordefy/metrics-audit-2026-05-09.md, section 3 "Canonical formulas").
//
// Every helper takes a normalized order list (already loaded into memory by
// the caller) instead of running its own DB query. This keeps the helpers
// pure, unit-testable, and lets the route batch the IO once.
//
// Conventions:
//   - Status sets come from api/utils/order-status.ts. Never inline literals.
//   - Currency is segregated. Helpers that aggregate money take a currency
//     filter and only sum rows that match. Use `groupByCurrency` to build a
//     dict response when the caller needs every currency a store transacts in.
//   - Period scoping (dates, timezone) is the caller's responsibility. These
//     helpers do not parse dates.
//   - Functions ending in `Rate` return a percentage in [0, 100]. NaN-safe:
//     denominator zero returns null so the caller can render "n/a" instead of
//     a misleading 0.

import {
    DISPATCHED_STATUSES,
    IN_TRANSIT_STATUSES,
    POST_PENDING_STATUSES,
    isCancelled,
    isDelivered as isDeliveredBase,
    isDispatched as isDispatchedBase,
    isInTransit,
    isPostPending,
    isRejected,
    isReturned,
} from './order-status';

// `delivered` AND `settled` both count as terminal-success cash. `settled`
// is the post-148c canonical state for "paid by carrier", aliased to delivered
// in every revenue/profit calculation.
export const TERMINAL_SUCCESS_STATUSES: ReadonlySet<string> = new Set([
    'delivered',
    'settled',
]);

export const isTerminalSuccess = (status: string | null | undefined): boolean =>
    !!status && TERMINAL_SUCCESS_STATUSES.has(status);

// Backwards-compatible alias. Used when migrating old code that called
// isDelivered. Keep both available so the migration is gradual and obviously
// correct in PR diffs (we extend coverage, never narrow it).
export const isDeliveredOrSettled = isTerminalSuccess;

// Re-export so callers only import from one module.
export { isDispatchedBase as isDispatched, isInTransit, isPostPending };
export { DISPATCHED_STATUSES, IN_TRANSIT_STATUSES, POST_PENDING_STATUSES };

// Failure-after-dispatch: orders that left the warehouse but did not pay.
// Used by carrier success rate and incident analytics.
export const FAILED_AFTER_DISPATCH_STATUSES: ReadonlySet<string> = new Set([
    'returned',
    'delivery_failed',
    'not_delivered',
]);

export const isFailedAfterDispatch = (
    status: string | null | undefined,
    shippedAt: string | null | undefined,
): boolean => {
    if (!status) return false;
    if (FAILED_AFTER_DISPATCH_STATUSES.has(status)) return true;
    return status === 'cancelled' && !!shippedAt;
};

// Cancelled-before-dispatch: orders rejected by COD operator before being
// shipped. These count toward cancellation rate but NOT toward delivery
// rate (denominator).
export const isCancelledBeforeDispatch = (
    status: string | null | undefined,
    shippedAt: string | null | undefined,
): boolean => {
    if (!status) return false;
    if (status === 'rejected') return true;
    return status === 'cancelled' && !shippedAt;
};

// Minimal order shape every helper consumes. Routes can pass richer objects;
// extra fields are ignored. Putting this in one place forces a single mental
// model of "what an order is" inside metrics math.
export interface CanonicalOrder {
    sleeves_status: string | null;
    total_price: number | string | null;
    shipping_cost?: number | string | null;
    currency?: string | null;
    shipped_at?: string | null;
    delivered_at?: string | null;
    in_transit_at?: string | null;
    is_test?: boolean | null;
    deleted_at?: string | null;
    courier_id?: string | null;
}

// Extended shape for cost calculations. Line item totals are pre-aggregated
// per order by the caller so this stays a pure function.
export interface OrderWithCosts extends CanonicalOrder {
    productCost?: number; // sum of order_line_items.unit_cost * quantity for this order
}

const num = (v: unknown): number => {
    if (v === null || v === undefined) return 0;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
};

const ratePercent = (num: number, den: number): number | null => {
    if (den <= 0) return null;
    const pct = (num / den) * 100;
    return Number.isFinite(pct) ? pct : null;
};

// Filter a list to only orders that should count in metrics. Soft-deleted
// rows and is_test rows are out. Routes that select with their own filter
// SHOULD also call this defensively because a SELECT * pattern can drift.
export function filterActive<T extends CanonicalOrder>(orders: T[]): T[] {
    return orders.filter(
        (o) => !o.deleted_at && o.is_test !== true,
    );
}

// Sum total_price filtered by status predicate, optionally by currency.
function sumWhere(
    orders: CanonicalOrder[],
    predicate: (o: CanonicalOrder) => boolean,
    currency?: string,
): number {
    return orders
        .filter((o) => (currency ? o.currency === currency : true))
        .filter(predicate)
        .reduce((sum, o) => sum + num(o.total_price), 0);
}

// Group orders by currency. Stores that only ever transact in one currency
// get a single-key dict. Multi-currency stores get multiple. The caller can
// short-circuit to a scalar response when there is exactly one key.
export function groupByCurrency<T extends CanonicalOrder>(
    orders: T[],
    storeCurrency: string,
): Map<string, T[]> {
    const m = new Map<string, T[]>();
    for (const o of orders) {
        const c = (o.currency || storeCurrency) as string;
        if (!m.has(c)) m.set(c, []);
        m.get(c)!.push(o);
    }
    return m;
}

// =====================================================================
// 3.1 Revenue Real (delivered cash)
// =====================================================================
// Money that has terminally landed: delivered or settled.
// Excludes additional_values income; that goes to a separate metric.
export function revenueReal(
    orders: CanonicalOrder[],
    currency?: string,
): number {
    return sumWhere(orders, (o) => isTerminalSuccess(o.sleeves_status), currency);
}

// =====================================================================
// 3.2 Revenue Proyectado
// =====================================================================
// delivered cash + (in-transit gross * deliveryRate). Default 85% only when
// there is in-transit pipeline AND zero delivered (new store / new period).
// If there is delivered data, use the period's actual rate.
export function revenueProyectado(
    orders: CanonicalOrder[],
    currency?: string,
): number {
    const delivered = revenueReal(orders, currency);
    const inTransitGross = sumWhere(
        orders,
        (o) => isInTransit(o.sleeves_status),
        currency,
    );
    const dRate = deliveryRateDecimal(orders, currency);
    return delivered + inTransitGross * dRate;
}

// =====================================================================
// 3.3 Tasa de Entrega (canonical)
// =====================================================================
// delivered+settled / dispatched. Decimal in [0, 1] for math; multiply by
// 100 for display. Returns null when denominator is 0.
export function deliveryRate(
    orders: CanonicalOrder[],
    currency?: string,
): number | null {
    const filtered = currency
        ? orders.filter((o) => o.currency === currency)
        : orders;
    const delivered = filtered.filter((o) => isTerminalSuccess(o.sleeves_status)).length;
    const dispatched = filtered.filter((o) => isDispatchedBase(o.sleeves_status, o.shipped_at)).length;
    return ratePercent(delivered, dispatched);
}

// Same metric as decimal in [0, 1]. Used inside revenueProyectado() and any
// other math that multiplies by the rate. Default 0.85 only when the period
// has no signal at all (zero delivered, zero dispatched).
export function deliveryRateDecimal(
    orders: CanonicalOrder[],
    currency?: string,
): number {
    const filtered = currency
        ? orders.filter((o) => o.currency === currency)
        : orders;
    const delivered = filtered.filter((o) => isTerminalSuccess(o.sleeves_status)).length;
    const inTransit = filtered.filter((o) => isInTransit(o.sleeves_status)).length;
    const den = delivered + inTransit;
    if (den === 0) return 0.85;
    if (delivered === 0) return 0.85;
    return delivered / den;
}

// =====================================================================
// 3.4 Tasa de Confirmacion (canonical)
// =====================================================================
// post_pending / total. Includes every state past 'pending', success or
// failure. This is the single source of truth that BOTH /api/cod-metrics and
// /api/analytics/confirmation-metrics MUST consume.
export function confirmationRate(orders: CanonicalOrder[]): number | null {
    const total = orders.length;
    const confirmed = orders.filter((o) => isPostPending(o.sleeves_status)).length;
    return ratePercent(confirmed, total);
}

// =====================================================================
// 3.5 Tasa de Cancelacion
// =====================================================================
export function cancellationRate(orders: CanonicalOrder[]): number | null {
    const total = orders.length;
    const cancelled = orders.filter(
        (o) => isCancelled(o.sleeves_status) || isRejected(o.sleeves_status),
    ).length;
    return ratePercent(cancelled, total);
}

// =====================================================================
// 3.6 Tasa de Devolucion
// =====================================================================
export function returnRate(orders: CanonicalOrder[]): number | null {
    const returned = orders.filter((o) => isReturned(o.sleeves_status)).length;
    const den = orders.filter(
        (o) =>
            isTerminalSuccess(o.sleeves_status) || isReturned(o.sleeves_status),
    ).length;
    return ratePercent(returned, den);
}

// =====================================================================
// 3.7 Beneficio Bruto Real
// =====================================================================
// delivered revenue - delivered COGS. Caller pre-aggregates per-order
// product cost (snapshot from order_line_items.unit_cost migration 128).
export function grossProfitReal(
    orders: OrderWithCosts[],
    currency?: string,
): number {
    const delivered = orders
        .filter((o) => (currency ? o.currency === currency : true))
        .filter((o) => isTerminalSuccess(o.sleeves_status));
    const revenue = delivered.reduce((s, o) => s + num(o.total_price), 0);
    const cogs = delivered.reduce((s, o) => s + num(o.productCost), 0);
    return revenue - cogs;
}

// =====================================================================
// 3.8 Beneficio Neto Real
// =====================================================================
// revenue_real - (cogs_real + shipping_real + confirmation_fee*delivered + ad_spend)
export function netProfitReal(
    orders: OrderWithCosts[],
    options: {
        confirmationFee: number;
        adSpend: number; // already scoped to period by caller
        currency?: string;
    },
): number {
    const filtered = options.currency
        ? orders.filter((o) => o.currency === options.currency)
        : orders;
    const delivered = filtered.filter((o) => isTerminalSuccess(o.sleeves_status));
    const revenue = delivered.reduce((s, o) => s + num(o.total_price), 0);
    const cogs = delivered.reduce((s, o) => s + num(o.productCost), 0);
    const shipping = delivered.reduce((s, o) => s + num(o.shipping_cost), 0);
    const confirmation = delivered.length * num(options.confirmationFee);
    return revenue - (cogs + shipping + confirmation + num(options.adSpend));
}

// =====================================================================
// 3.9 Margen Bruto, Margen Neto
// =====================================================================
export function grossMarginPct(
    orders: OrderWithCosts[],
    currency?: string,
): number | null {
    const rev = revenueReal(orders, currency);
    if (rev <= 0) return null;
    return (grossProfitReal(orders, currency) / rev) * 100;
}

export function netMarginPct(
    orders: OrderWithCosts[],
    options: { confirmationFee: number; adSpend: number; currency?: string },
): number | null {
    const rev = revenueReal(orders, options.currency);
    if (rev <= 0) return null;
    return (netProfitReal(orders, options) / rev) * 100;
}

// =====================================================================
// 3.10 ROAS
// =====================================================================
// Returns null when adSpend is 0 (n/a). Never 0. Routes that previously
// returned 0 in this case were ambiguous between "ran ads, got nothing" and
// "ran no ads".
export function roas(
    orders: CanonicalOrder[],
    adSpend: number,
    currency?: string,
): number | null {
    if (adSpend <= 0) return null;
    return revenueReal(orders, currency) / adSpend;
}

// =====================================================================
// 3.11 ROI (general)
// =====================================================================
export function roi(
    orders: OrderWithCosts[],
    options: { confirmationFee: number; adSpend: number; currency?: string },
): number | null {
    const rev = revenueReal(orders, options.currency);
    const filtered = options.currency
        ? orders.filter((o) => o.currency === options.currency)
        : orders;
    const delivered = filtered.filter((o) => isTerminalSuccess(o.sleeves_status));
    const cogs = delivered.reduce((s, o) => s + num(o.productCost), 0);
    const shipping = delivered.reduce((s, o) => s + num(o.shipping_cost), 0);
    const confirmation = delivered.length * num(options.confirmationFee);
    const totalCosts = cogs + shipping + confirmation + num(options.adSpend);
    if (totalCosts <= 0) return null;
    return ((rev - totalCosts) / totalCosts) * 100;
}

// =====================================================================
// 3.13 LTV (per customer aggregation, called by route)
// =====================================================================
// Sum of delivered+settled total_price for one customer, in their currency.
// Caller passes the customer's order list pre-filtered.
export function customerLtv(
    orders: CanonicalOrder[],
    currency?: string,
): number {
    return revenueReal(orders, currency);
}

// =====================================================================
// 3.14 Ticket Promedio (AOV)
// =====================================================================
// revenue_real / count(delivered+settled). NOT total_orders. NOT including
// additional_values income.
export function averageOrderValue(
    orders: CanonicalOrder[],
    currency?: string,
): number | null {
    const filtered = currency
        ? orders.filter((o) => o.currency === currency)
        : orders;
    const delivered = filtered.filter((o) => isTerminalSuccess(o.sleeves_status));
    if (delivered.length === 0) return null;
    return delivered.reduce((s, o) => s + num(o.total_price), 0) / delivered.length;
}

// =====================================================================
// 3.15 IVA Recolectado
// =====================================================================
export function vatCollected(
    orders: CanonicalOrder[],
    taxRatePercent: number,
    currency?: string,
): number {
    if (taxRatePercent <= 0) return 0;
    const rev = revenueReal(orders, currency);
    return rev - rev / (1 + taxRatePercent / 100);
}

// =====================================================================
// 3.15b Costo por Pedido (real)
// =====================================================================
// realCosts / deliveredCount. Both sides reference the delivered set so the
// figure is internally consistent. Caller passes the already-computed
// realCosts (productos delivered + envio delivered + confirmacion delivered
// + gasto_publicitario full) to avoid recalculation drift.
export function realCostPerOrder(
    orders: CanonicalOrder[],
    realCosts: number,
    currency?: string,
): number {
    const filtered = currency
        ? orders.filter((o) => o.currency === currency)
        : orders;
    const delivered = filtered.filter((o) => isTerminalSuccess(o.sleeves_status));
    if (delivered.length === 0) return 0;
    return realCosts / delivered.length;
}

// =====================================================================
// 3.16 Cantidad de Pedidos (status buckets)
// =====================================================================
// Returns a dict that sums to the total order count. Invariant the caller
// can assert in tests. `pending` is broken out separately so the dashboard
// donut never miscounts.
export function orderCountsByBucket(orders: CanonicalOrder[]): {
    total: number;
    delivered: number; // delivered + settled
    inTransit: number; // in transit pipeline
    pending: number;
    cancelled: number; // cancelled + rejected
    returned: number;
    other: number; // catch-all for legacy / unmapped values
} {
    const counts = {
        total: orders.length,
        delivered: 0,
        inTransit: 0,
        pending: 0,
        cancelled: 0,
        returned: 0,
        other: 0,
    };
    for (const o of orders) {
        const s = o.sleeves_status;
        if (isTerminalSuccess(s)) counts.delivered++;
        else if (isInTransit(s)) counts.inTransit++;
        else if (s === 'pending') counts.pending++;
        else if (s === 'cancelled' || s === 'rejected') counts.cancelled++;
        else if (s === 'returned') counts.returned++;
        else counts.other++;
    }
    return counts;
}

// =====================================================================
// Carrier success rate (canonical, used by COD by-carrier and CarrierDetail)
// =====================================================================
// delivered / (delivered + failed_after_dispatch). Same denominator everywhere
// so dashboard rates and carrier-detail rates align.
export function carrierSuccessRate(orders: CanonicalOrder[]): number | null {
    const delivered = orders.filter((o) => isTerminalSuccess(o.sleeves_status)).length;
    const failed = orders.filter((o) =>
        isFailedAfterDispatch(o.sleeves_status, o.shipped_at),
    ).length;
    return ratePercent(delivered, delivered + failed);
}

// =====================================================================
// Pending cash (COD module)
// =====================================================================
// total_price of orders that are post_pending, payment still pending, AND
// have not terminally failed. Broken out from cod-metrics inline filter so
// the formula is unit-testable.
export function pendingCash(
    orders: (CanonicalOrder & { payment_status?: string | null })[],
    currency?: string,
): number {
    const filtered = currency
        ? orders.filter((o) => o.currency === currency)
        : orders;
    // Live in-transit pipeline owed money: post-pending, not yet terminal-
    // success, not failed-delivery (returned / delivery_failed / not_delivered),
    // and the payment_status flag still says "pending" (the merchant has not
    // collected from the customer yet). payment_status is a separate enum
    // from order_status and the literal is intentional.
    return filtered
        .filter(
            (o) =>
                isPostPending(o.sleeves_status) &&
                !isTerminalSuccess(o.sleeves_status) &&
                !FAILED_AFTER_DISPATCH_STATUSES.has(o.sleeves_status ?? '') &&
                o.payment_status === 'pending',
        )
        .reduce((s, o) => s + num(o.total_price), 0);
}

// =====================================================================
// 3.17 Marketing expense proration over a query window
// =====================================================================
// Marketing/ad spend rows in `additional_values` can optionally carry a
// (period_start, period_end) span. When set, the row is treated as a flat
// daily allocation and only the days that overlap the dashboard query
// window are counted. Rows without a period behave as before: 100% of the
// amount is attributed to `date` and counts iff `date` falls inside the
// window.
//
// This helper is pure and unit-testable so every endpoint that aggregates
// marketing spend consumes the same formula. Drift here was the original
// source of the "load 5M for the month, see 5M on day 1" bug.
//
// Inputs:
//   - row: { amount, date, period_start, period_end } — string dates in
//     YYYY-MM-DD, matching the storage format of additional_values.
//   - windowStart, windowEnd: inclusive bounds, YYYY-MM-DD.
//
// Returns: amount portion attributable to [windowStart, windowEnd].
export interface ProratableExpense {
    amount: number | string | null | undefined;
    date: string | null | undefined;
    period_start?: string | null;
    period_end?: string | null;
}

// Days between two YYYY-MM-DD calendar dates, inclusive. Operates on the
// string representation directly (UTC arithmetic on midnight epochs) to
// stay timezone-neutral. The caller is responsible for passing window
// bounds already formatted in the store's local timezone.
function daysInclusive(startYmd: string, endYmd: string): number {
    const s = Date.UTC(
        Number(startYmd.slice(0, 4)),
        Number(startYmd.slice(5, 7)) - 1,
        Number(startYmd.slice(8, 10)),
    );
    const e = Date.UTC(
        Number(endYmd.slice(0, 4)),
        Number(endYmd.slice(5, 7)) - 1,
        Number(endYmd.slice(8, 10)),
    );
    if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return 0;
    return Math.round((e - s) / 86_400_000) + 1;
}

export function proratedAmountInWindow(
    row: ProratableExpense,
    windowStart: string,
    windowEnd: string,
): number {
    const amount = num(row.amount);
    if (amount <= 0) return 0;

    const ps = row.period_start ? String(row.period_start).slice(0, 10) : null;
    const pe = row.period_end ? String(row.period_end).slice(0, 10) : null;

    // Legacy single-date row: count if the calendar day falls in the window.
    if (!ps || !pe) {
        const d = row.date ? String(row.date).slice(0, 10) : null;
        if (!d) return 0;
        if (d < windowStart || d > windowEnd) return 0;
        return amount;
    }

    // Period row: prorate over the overlap. Daily rate is amount /
    // (period_end - period_start + 1). The contribution to the window is
    // dailyRate * overlapDays. Overlap is the intersection of
    // [ps, pe] with [windowStart, windowEnd].
    const periodDays = daysInclusive(ps, pe);
    if (periodDays <= 0) return 0;

    const overlapStart = ps > windowStart ? ps : windowStart;
    const overlapEnd = pe < windowEnd ? pe : windowEnd;
    if (overlapEnd < overlapStart) return 0;

    const overlapDays = daysInclusive(overlapStart, overlapEnd);
    if (overlapDays <= 0) return 0;

    return (amount / periodDays) * overlapDays;
}

// Convenience: total marketing spend attributable to [windowStart, windowEnd]
// across a list of rows. Routes use this directly instead of inlining the
// reduce so the call site stays single-line and the formula is exercised by
// the unit tests below.
export function sumMarketingInWindow(
    rows: ProratableExpense[],
    windowStart: string,
    windowEnd: string,
): number {
    return rows.reduce(
        (sum, r) => sum + proratedAmountInWindow(r, windowStart, windowEnd),
        0,
    );
}

// Daily allocation: returns a map { 'YYYY-MM-DD': amount } summing the
// per-day contribution of every row that touches the window. Single-date
// rows contribute their full amount to their `date`. Period rows
// contribute (amount / periodDays) to each day in [period_start, period_end]
// intersected with [windowStart, windowEnd].
//
// Used by the chart endpoints so the daily bar reflects the prorated
// amount, not a single spike on the load date.
export function dailyMarketingAllocation(
    rows: ProratableExpense[],
    windowStart: string,
    windowEnd: string,
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of rows) {
        const amount = num(r.amount);
        if (amount <= 0) continue;

        const ps = r.period_start ? String(r.period_start).slice(0, 10) : null;
        const pe = r.period_end ? String(r.period_end).slice(0, 10) : null;

        if (!ps || !pe) {
            const d = r.date ? String(r.date).slice(0, 10) : null;
            if (!d) continue;
            if (d < windowStart || d > windowEnd) continue;
            out[d] = (out[d] ?? 0) + amount;
            continue;
        }

        const periodDays = daysInclusive(ps, pe);
        if (periodDays <= 0) continue;

        const overlapStart = ps > windowStart ? ps : windowStart;
        const overlapEnd = pe < windowEnd ? pe : windowEnd;
        if (overlapEnd < overlapStart) continue;

        const daily = amount / periodDays;
        // Walk day by day. Cheap: max ~365 iterations per row, and
        // periods are typically <= 31 days. Loop in UTC midnight epochs.
        const startMs = Date.UTC(
            Number(overlapStart.slice(0, 4)),
            Number(overlapStart.slice(5, 7)) - 1,
            Number(overlapStart.slice(8, 10)),
        );
        const endMs = Date.UTC(
            Number(overlapEnd.slice(0, 4)),
            Number(overlapEnd.slice(5, 7)) - 1,
            Number(overlapEnd.slice(8, 10)),
        );
        for (let t = startMs; t <= endMs; t += 86_400_000) {
            const y = new Date(t).getUTCFullYear();
            const m = String(new Date(t).getUTCMonth() + 1).padStart(2, '0');
            const d = String(new Date(t).getUTCDate()).padStart(2, '0');
            const key = `${y}-${m}-${d}`;
            out[key] = (out[key] ?? 0) + daily;
        }
    }
    return out;
}

// Helper for tests / debug. Snapshot the canonical formulas applied to a
// specific dataset. Wraps the most common card surface.
export function snapshot(
    orders: OrderWithCosts[],
    options: { confirmationFee: number; adSpend: number; storeCurrency: string },
) {
    return {
        totalOrders: orders.length,
        revenueReal: revenueReal(orders),
        revenueProyectado: revenueProyectado(orders),
        deliveryRatePct: deliveryRate(orders),
        confirmationRatePct: confirmationRate(orders),
        cancellationRatePct: cancellationRate(orders),
        returnRatePct: returnRate(orders),
        grossProfitReal: grossProfitReal(orders),
        netProfitReal: netProfitReal(orders, options),
        grossMarginPct: grossMarginPct(orders),
        netMarginPct: netMarginPct(orders, options),
        aov: averageOrderValue(orders),
        roas: roas(orders, options.adSpend),
        roi: roi(orders, options),
        buckets: orderCountsByBucket(orders),
    };
}
