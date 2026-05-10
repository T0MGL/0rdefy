// Backend status taxonomy for analytics. Pre-148c (sleeves_status cleanup) the
// orders.sleeves_status column carries a mix of canonical enum values and
// legacy VARCHARs. Until the cleanup migration runs we accept both. Source of
// truth: src/lib/status.ts + db/migrations/148c_sleeves_status_cleanup.sql.

// Live pipeline: orders that have moved past 'pending' and are still expected
// to convert into delivered revenue. Their value goes into projectedRevenue,
// weighted by the store's historical delivery rate. We exclude 'pending' on
// purpose: COD operators routinely have a pile of pending orders that never
// get confirmed, and including them in the "delivered + en transito" card
// produces a useless inflated number.
export const IN_TRANSIT_STATUSES: ReadonlySet<string> = new Set([
    'confirmed',
    'in_preparation',
    'ready_to_ship',
    'in_transit',
    'shipped',      // legacy alias of in_transit pre-148c
    'contacted',    // legacy intermediate, treat as still-active pipeline
    'incident',     // legacy, recoverable per migration 116
]);

// Anything past 'pending' (succeeded or failed). Used by confirmation-metrics
// to count "orders that paid the confirmation fee" regardless of final outcome.
export const POST_PENDING_STATUSES: ReadonlySet<string> = new Set([
    ...IN_TRANSIT_STATUSES,
    'delivered',
    'returned',
    'delivery_failed',
    'not_delivered',
    'settled',
]);

// Statuses that count as "dispatched" (left the warehouse). Used for the
// delivery rate denominator. Cancelled orders only count if they were already
// shipped before being cancelled. `settled` is the post-148c terminal-success
// state, treated identically to `delivered` for math: it left the warehouse
// AND the carrier paid us. Excluding it (the original bug) made stores that
// settle their orders look like they had a 100% drop in deliveries.
export const DISPATCHED_STATUSES: ReadonlySet<string> = new Set([
    'ready_to_ship',
    'shipped',
    'in_transit',
    'delivered',
    'settled',
    'returned',
    'delivery_failed',
    'not_delivered',
]);

export const isDelivered = (s: string | null | undefined): boolean => s === 'delivered';

// Settled is the post-148c terminal-success state. For revenue / ROAS / profit
// math we treat delivered and settled as the same outcome ("the customer kept
// the product"). The two helpers stay separate so caller code can still
// distinguish "delivered, awaiting payout" from "fully reconciled" when it
// matters (e.g. the settlements queue).
export const isSettled = (s: string | null | undefined): boolean => s === 'settled';
export const isDeliveredOrSettled = (s: string | null | undefined): boolean =>
    s === 'delivered' || s === 'settled';

export const isPending = (s: string | null | undefined): boolean => s === 'pending';
export const isReadyToShip = (s: string | null | undefined): boolean => s === 'ready_to_ship';
export const isInPreparation = (s: string | null | undefined): boolean => s === 'in_preparation';
export const isConfirmed = (s: string | null | undefined): boolean => s === 'confirmed';
export const isReturned = (s: string | null | undefined): boolean => s === 'returned';
export const isCancelled = (s: string | null | undefined): boolean => s === 'cancelled';
export const isRejected = (s: string | null | undefined): boolean => s === 'rejected';

// Logistics failure: the parcel left the warehouse but did not reach the
// customer (refused at the door, unreachable, returned to origin). Used by
// the logistics dashboard's "perdidos" card and by COD reconciliation to
// short-circuit cash-in calculations. delivery_failed and not_delivered are
// pre-148c legacy values; returned is the canonical post-148c form.
export const FAILED_DELIVERY_STATUSES: ReadonlySet<string> = new Set([
    'delivery_failed',
    'not_delivered',
    'returned',
]);
export const isFailedDelivery = (s: string | null | undefined): boolean =>
    !!s && FAILED_DELIVERY_STATUSES.has(s);

export const isInTransit = (s: string | null | undefined): boolean =>
    !!s && IN_TRANSIT_STATUSES.has(s);
export const isPostPending = (s: string | null | undefined): boolean =>
    !!s && POST_PENDING_STATUSES.has(s);
export const isDispatched = (status: string | null | undefined, shippedAt: string | null | undefined): boolean => {
    if (!status) return false;
    if (DISPATCHED_STATUSES.has(status)) return true;
    return status === 'cancelled' && !!shippedAt;
};

// Settlement-record status (separate enum from order_status). Centralized
// here so the dashboards, the queue, and the reconciliation page agree on
// what "active" means. settlements.status uses 'pending' | 'partial' |
// 'completed' | 'cancelled'. Active = pending or partial (still owe money).
export const ACTIVE_SETTLEMENT_STATUSES: ReadonlySet<string> = new Set([
    'pending',
    'partial',
]);
export const isActiveSettlement = (s: string | null | undefined): boolean =>
    !!s && ACTIVE_SETTLEMENT_STATUSES.has(s);
