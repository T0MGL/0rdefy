/**
 * Order status: single source of truth.
 *
 * Mirrors the Postgres enum `order_status` declared in
 *   db/migrations/017_fix_orders_schema.sql
 *   db/migrations/022_returns_system.sql
 *   db/migrations/148a_add_settled_enum_value.sql
 *
 * Plan reference: iterative-whistling-flute (section 4.1).
 *
 * Why this file exists separately from src/types/index.ts:
 *   1. Breaks the dependency cycle: helpers, labels, colors, and the state
 *      machine all live next to the type definition and can be imported by
 *      both app code and components without pulling the full Order interface.
 *   2. Gives us a single location to evolve when a new enum value is added
 *      (one file, not every consumer).
 */

/**
 * Canonical order status. Exact mirror of the Postgres enum order_status.
 *
 * Lifecycle:
 *   pending -> confirmed -> in_preparation -> ready_to_ship -> in_transit
 *     -> delivered -> settled (terminal)
 *   Any stage -> cancelled | rejected
 *   delivered | in_transit -> returned
 */
export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'in_preparation'
  | 'ready_to_ship'
  | 'in_transit'
  | 'delivered'
  | 'settled'
  | 'cancelled'
  | 'rejected'
  | 'returned';

/**
 * Legacy VARCHAR values that existed in the `sleeves_status` column but were
 * never part of the Postgres enum. They should never appear in a type that
 * round-trips through the API, but they DO appear in historical data until
 * migration 148c runs. The audit script + helpers read these via
 * legacyStatusToEnum() at the boundary.
 *
 * @deprecated Remove once migration 148c is applied and the code sweep is
 *             complete. Tracked by scripts/audit_sleeves_status.ts.
 */
export type LegacyOrderStatus =
  | 'contacted'
  | 'awaiting_carrier'
  | 'shipped'
  | 'incident';

export const ORDER_STATUSES: readonly OrderStatus[] = [
  'pending',
  'confirmed',
  'in_preparation',
  'ready_to_ship',
  'in_transit',
  'delivered',
  'settled',
  'cancelled',
  'rejected',
  'returned',
] as const;

/**
 * Spanish labels used across the UI. Single source of truth for i18n.
 * "Liquidado" is the LATAM financial term for "money received from courier".
 */
export const statusLabel: Record<OrderStatus, string> = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  in_preparation: 'En preparacion',
  ready_to_ship: 'Listo para envio',
  in_transit: 'En camino',
  delivered: 'Entregado',
  settled: 'Liquidado',
  cancelled: 'Cancelado',
  rejected: 'Rechazado',
  returned: 'Devuelto',
};

/**
 * Tailwind color tokens for badges. Green = terminal + healthy, amber =
 * pending financial reconciliation, red = negative terminal, neutral zinc
 * for in-progress states. Reused by every badge component.
 */
export const statusColor: Record<OrderStatus, string> = {
  pending: 'bg-zinc-100 text-zinc-800 border-zinc-200',
  confirmed: 'bg-blue-100 text-blue-800 border-blue-200',
  in_preparation: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  ready_to_ship: 'bg-violet-100 text-violet-800 border-violet-200',
  in_transit: 'bg-sky-100 text-sky-800 border-sky-200',
  delivered: 'bg-amber-100 text-amber-800 border-amber-200',
  settled: 'bg-primary/10 text-primary border-primary/30',
  cancelled: 'bg-red-100 text-red-800 border-red-200',
  rejected: 'bg-red-100 text-red-800 border-red-200',
  returned: 'bg-orange-100 text-orange-800 border-orange-200',
};

/**
 * Maps historical legacy VARCHAR values to the canonical enum. Matches the
 * backfill inside 148c_sleeves_status_cleanup.sql so the runtime conversion
 * and the database backfill produce identical results.
 */
export function legacyStatusToEnum(legacy: string | null | undefined): OrderStatus {
  if (legacy == null) {
    return 'pending';
  }
  const map: Record<string, OrderStatus> = {
    pending: 'pending',
    contacted: 'pending',
    awaiting_carrier: 'pending',
    confirmed: 'confirmed',
    in_preparation: 'in_preparation',
    ready_to_ship: 'ready_to_ship',
    shipped: 'in_transit',
    in_transit: 'in_transit',
    delivered: 'delivered',
    incident: 'delivered',
    settled: 'settled',
    cancelled: 'cancelled',
    rejected: 'rejected',
    returned: 'returned',
  };
  return map[legacy] ?? 'pending';
}

/**
 * Terminal states do not transition further. settled is terminal for the
 * happy path, cancelled / rejected / returned for the rejection paths.
 */
export function isTerminalStatus(status: OrderStatus): boolean {
  return (
    status === 'settled' ||
    status === 'cancelled' ||
    status === 'rejected' ||
    status === 'returned'
  );
}

/**
 * Canonical client-side helpers. Mirror the API helpers in
 * api/utils/order-status.ts. Use these inside components instead of writing
 * `o.status === 'delivered'` literals so the dashboard, the COD module and
 * any per-carrier card always agree on what each metric means.
 *
 * Accepts the legacy VARCHAR variants the data layer still emits for
 * pre-148c stores.
 */
export function isDeliveredStatus(status: string | null | undefined): boolean {
  return status === 'delivered' || status === 'settled';
}

export function isInTransitStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return [
    'confirmed',
    'in_preparation',
    'ready_to_ship',
    'in_transit',
    'shipped',
    'contacted',
    'incident',
  ].includes(status);
}

export function isPostPendingStatus(status: string | null | undefined): boolean {
  if (!status) return false;
  return (
    isInTransitStatus(status) ||
    isDeliveredStatus(status) ||
    status === 'returned' ||
    status === 'delivery_failed' ||
    status === 'not_delivered'
  );
}

const DISPATCHED_SET = new Set([
  'ready_to_ship',
  'shipped',
  'in_transit',
  'delivered',
  'settled',
  'returned',
  'delivery_failed',
  'not_delivered',
]);

export function isDispatchedStatus(
  status: string | null | undefined,
  shippedAt?: string | null,
): boolean {
  if (!status) return false;
  if (DISPATCHED_SET.has(status)) return true;
  return status === 'cancelled' && !!shippedAt;
}

// Per-status helpers. Mirror api/utils/order-status.ts so server math and
// client filters always agree. Always prefer these over inline ===
// comparisons; legacy VARCHAR forms get normalized at the boundary.
export const isPending = (s: string | null | undefined): boolean => s === 'pending';
export const isConfirmed = (s: string | null | undefined): boolean => s === 'confirmed';
export const isInPreparation = (s: string | null | undefined): boolean =>
  s === 'in_preparation';
export const isReadyToShip = (s: string | null | undefined): boolean =>
  s === 'ready_to_ship';
export const isStrictDelivered = (s: string | null | undefined): boolean =>
  s === 'delivered';
export const isSettled = (s: string | null | undefined): boolean => s === 'settled';
export const isReturned = (s: string | null | undefined): boolean => s === 'returned';
export const isCancelled = (s: string | null | undefined): boolean => s === 'cancelled';
export const isRejected = (s: string | null | undefined): boolean => s === 'rejected';

// Narrow "currently with the carrier" predicate. Excludes the warehouse-side
// states (confirmed, in_preparation, ready_to_ship). Use this when the UI
// needs to gate on "this parcel is physically out for delivery". Pre-148c
// the canonical state was 'shipped'; post-148c it's 'in_transit'. Both
// VARCHARs are accepted so the migration window keeps working.
const STRICT_IN_TRANSIT_SET = new Set(['shipped', 'in_transit']);
export const isStrictInTransit = (s: string | null | undefined): boolean =>
  !!s && STRICT_IN_TRANSIT_SET.has(s);

const FAILED_DELIVERY_SET = new Set(['delivery_failed', 'not_delivered', 'returned']);
export const isFailedDelivery = (s: string | null | undefined): boolean =>
  !!s && FAILED_DELIVERY_SET.has(s);

const AWAITING_CARRIER_SET = new Set(['awaiting_carrier']);
export const isAwaitingCarrier = (s: string | null | undefined): boolean =>
  !!s && AWAITING_CARRIER_SET.has(s);

// Settlement-record status (distinct enum from order_status). pending and
// partial both mean "still owe money to merchant".
const ACTIVE_SETTLEMENT_SET = new Set(['pending', 'partial']);
export const isActiveSettlement = (s: string | null | undefined): boolean =>
  !!s && ACTIVE_SETTLEMENT_SET.has(s);

/**
 * Canonical delivery rate for an order list. Mirrors API formula 3.3.
 * Returns null when no orders are dispatched (caller renders 'n/a').
 */
export function deliveryRatePct(
  orders: { status?: string | null; sleeves_status?: string | null; shipped_at?: string | null }[],
): number | null {
  const delivered = orders.filter((o) => isDeliveredStatus(o.status ?? o.sleeves_status)).length;
  const dispatched = orders.filter((o) =>
    isDispatchedStatus(o.status ?? o.sleeves_status, o.shipped_at),
  ).length;
  if (dispatched <= 0) return null;
  return (delivered / dispatched) * 100;
}

/**
 * State machine. Matches the Postgres reality enforced by the settlement
 * functions + triggers in 148b. Used by the manual override endpoint
 * (POST /api/orders/:id/settle) and future admin UIs to validate user driven
 * transitions before hitting the DB.
 *
 * Forward path: pending -> confirmed -> ... -> delivered -> settled.
 * Rejection from any non terminal state: cancelled, rejected.
 * From delivered or in_transit: returned.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['confirmed', 'cancelled', 'rejected'],
  confirmed: ['in_preparation', 'cancelled', 'rejected'],
  in_preparation: ['ready_to_ship', 'cancelled', 'rejected'],
  ready_to_ship: ['in_transit', 'cancelled', 'rejected'],
  in_transit: ['delivered', 'returned', 'cancelled', 'rejected'],
  delivered: ['settled', 'returned'],
  settled: [],
  cancelled: [],
  rejected: [],
  returned: [],
};

export function canTransitionTo(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) {
    return true;
  }
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function allowedNextStatuses(from: OrderStatus): readonly OrderStatus[] {
  return ALLOWED_TRANSITIONS[from];
}
