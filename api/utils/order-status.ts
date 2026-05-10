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
export const isInTransit = (s: string | null | undefined): boolean =>
    !!s && IN_TRANSIT_STATUSES.has(s);
export const isPostPending = (s: string | null | undefined): boolean =>
    !!s && POST_PENDING_STATUSES.has(s);
export const isDispatched = (status: string | null | undefined, shippedAt: string | null | undefined): boolean => {
    if (!status) return false;
    if (DISPATCHED_STATUSES.has(status)) return true;
    return status === 'cancelled' && !!shippedAt;
};
