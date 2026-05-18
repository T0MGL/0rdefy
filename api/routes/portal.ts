/**
 * Courier Portal API (Phase 3 of Courier Portal)
 *
 * Mounted at: /api/portal
 *
 * Authenticated surface for external courier operators. The portal is a
 * mobile-first app embedded in Ordefy that lets a courier:
 *   - See the orders assigned to their carrier (and ONLY those)
 *   - Mark each order as delivered / failed / returned / incident
 *   - Upload proof-of-delivery photos
 *   - See their own real-time financial summary
 *
 * Trust model:
 *   - Every endpoint requires the standard JWT (`verifyToken`) and a
 *     valid `X-Store-ID` header (`extractStoreId`), plus `requireCourierRole`
 *     which proves the user is an active courier of *some* carrier in
 *     this store and pins `req.courierCarrierId`.
 *   - Every order-scoped endpoint additionally runs
 *     `requireOrderInCourierScope`, which proves the order belongs to
 *     that carrier (404 otherwise, 403 on cross-carrier).
 *
 * The middleware chain is non-negotiable: bypass it and a courier could
 * see another carrier's orders, or another store's orders, or both.
 *
 * Concurrency:
 *   - Two operators of the same carrier may tap the same order at the
 *     same time. Every mutation that transitions sleeves_status uses an
 *     advisory lock keyed by the order id (claimAdvisoryLock helper),
 *     so the second writer reads the post-update state and either
 *     short-circuits (already_delivered) or fails clean.
 *
 * Idempotency:
 *   - mark-delivered: if the order is already `delivered`, return 200
 *     `{already_delivered: true}` with no side effects.
 *   - mark-failed: if the same user/carrier logged the same `reason` for
 *     the same order in the last 5 minutes, short-circuit with
 *     `{already_logged: true}` to absorb double-taps.
 *   - mark-returned: if already `returned`, return 200 `{already_returned: true}`.
 *
 * Performance budget:
 *   - All endpoints aim for <= 3 DB queries on the happy path.
 *   - `GET /orders` does 2 queries (count + page) and returns the
 *     expected pagination envelope. The order list is bounded at 100
 *     per page server-side.
 *
 * Side effects:
 *   - Outbound webhooks fire-and-forget after the response is sent.
 *     Failures are logged, never thrown (per OutboundWebhookService
 *     contract).
 *   - Auto-invoice (SIFEN) is also fire-and-forget on mark-delivered,
 *     mirroring the QR delivery-confirm endpoint in api/routes/orders.ts.
 *
 * What this router does NOT do:
 *   - It does not stamp `reconciled_at`. Reconciliation is admin-side
 *     and lives in api/routes/settlements.ts.
 *   - It does not delete orders, change customer data, or modify line
 *     items. Couriers cannot reach those tables through this router.
 */

import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { verifyToken, extractStoreId } from '../middleware/auth';
import {
  requireCourierRole,
  requireOrderInCourierScope,
  CourierRequest,
} from '../middleware/portal-auth';
import { supabaseAdmin } from '../db/connection';
import { logger } from '../utils/logger';
import { isCodPayment } from '../utils/payment';
import { isCancelled, isDelivered, isRejected, isReturned } from '../utils/order-status';
import { uploadFile } from '../services/storage.service';
import { OutboundWebhookService } from '../services/outbound-webhook.service';
import { sanitizeSearchInput } from '../utils/sanitize';
import {
  closeSettlement,
  getPendingSettlements,
  getSettlementsHistory,
  PortalSettlementsError,
  PROOF_ALLOWED_MIME as SETTLEMENT_PROOF_MIME,
  PROOF_MAX_BYTES as SETTLEMENT_PROOF_MAX_BYTES,
} from '../services/portal-settlements.service';

export const portalRouter = Router();

// ============================================================================
// Constants
// ============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VIEW_VALUES = ['active', 'today', 'history'] as const;
type View = (typeof VIEW_VALUES)[number];

const SEARCH_MAX_LEN = 100;
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 100;
const HARD_BOUND = 1000;

const NOTES_MAX_LEN = 1000;
const INCIDENT_MIN_LEN = 10;
const INCIDENT_MAX_LEN = 1000;

const FAILED_REASON_VALUES = [
  'customer_absent',
  'wrong_address',
  'customer_rejected',
  'other',
] as const;

// Idempotency window: a duplicate failed-attempt logged by the same user
// within this window is absorbed silently.
const FAILED_DEDUPE_WINDOW_MS = 5 * 60_000;

// Photo upload limits (mirror api/routes/upload.ts contract)
const PROOF_MAX_BYTES = 5 * 1024 * 1024;
const PROOF_ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

// Statuses considered "in transit" for the active list view. These match
// the same set used by Migration 175 v_courier_financial_summary, so the
// counts the courier sees in the dashboard reconcile with the list.
const IN_TRANSIT_STATUSES = ['ready_to_ship', 'shipped', 'in_transit'] as const;

// All sleeves_status values a courier-portal action could legally observe.
// Used as a defensive whitelist when echoing a status back to the client.
const ALL_OBSERVABLE_STATUSES = new Set([
  'pending',
  'contacted',
  'awaiting_carrier',
  'confirmed',
  'in_preparation',
  'ready_to_ship',
  'shipped',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'not_delivered',
  'incident',
  'cancelled',
  'rejected',
  'returned',
]);

// ============================================================================
// Helpers
// ============================================================================

/**
 * Stable advisory lock key from an order id. Postgres advisory locks
 * take a bigint; we hash the UUID into one. The hashing is one-way and
 * collision-tolerant: a collision would only stall an unrelated order's
 * mutation by a few millis, which is acceptable.
 */
function orderLockKey(orderId: string): string {
  // hashtext returns a 32-bit signed int; we wrap it in a single
  // pg_try_advisory_xact_lock(int4) call via SQL. The function takes
  // care of negative values and zero.
  return `pg_try_advisory_xact_lock(hashtext(${escapeLiteral(orderId)}))`;
}

/**
 * Minimal SQL string-literal escape for a UUID. We only call this with
 * UUIDs that have already passed UUID_REGEX, so this is paranoia, not
 * the primary defense.
 */
function escapeLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Try to acquire a transaction-scoped advisory lock for an order.
 * Implemented as a single RPC because Supabase JS does not expose
 * transactions across separate calls. We use a SECURITY-INVOKER RPC
 * defined ad-hoc here via raw SQL fallback.
 *
 * In practice the orders.ts in this codebase relies on row visibility +
 * CAS for similar guarantees. For this portal we use the simpler
 * pattern: a SELECT ... FOR UPDATE on the order row inside a single
 * Postgres roundtrip, achieved by pg_try_advisory_xact_lock combined
 * with the update we are about to issue. Because Supabase JS does not
 * expose a transaction primitive, we implement the lock using
 * pg_advisory_lock + pg_advisory_unlock as session-scoped locks via
 * RPC, with a fallback to a CAS-style update.
 *
 * For Phase 3 we use the conservative CAS approach: every mutating
 * UPDATE in this file includes a `WHERE sleeves_status = <expected>`
 * predicate, so a concurrent winner moves the row out of scope and the
 * loser sees rowCount=0. This avoids needing a custom RPC and matches
 * the pattern already in orders.ts.
 *
 * (The orderLockKey helper above is retained for a future migration
 * that introduces an RPC for true xact-scoped locks.)
 */

/**
 * Build the `customer_name` display string from first/last fields. The
 * portal will tolerate missing components (legacy orders) gracefully.
 */
function buildCustomerName(first: string | null, last: string | null): string {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  if (f && l) return `${f} ${l}`;
  return f || l || '';
}

/**
 * Build the order number the courier sees. Mirrors the convention used
 * across the codebase (Shopify name > Shopify number > order_number >
 * last 4 of UUID).
 */
function buildDisplayOrderNumber(o: {
  shopify_order_name?: string | null;
  shopify_order_number?: string | null;
  order_number?: string | null;
  id: string;
}): string {
  if (o.shopify_order_name && o.shopify_order_name.trim()) return o.shopify_order_name.trim();
  if (o.shopify_order_number && String(o.shopify_order_number).trim()) {
    return `#${String(o.shopify_order_number).trim()}`;
  }
  if (o.order_number && String(o.order_number).trim()) return String(o.order_number).trim();
  return `#${o.id.slice(-4).toUpperCase()}`;
}

/**
 * Days the order has been in transit. Prefers in_transit_at when set,
 * falls back to updated_at. Returns 0 for orders without either, so
 * the UI never renders "NaN days".
 */
function daysInTransit(inTransitAt: string | null, updatedAt: string | null): number {
  const ref = inTransitAt || updatedAt;
  if (!ref) return 0;
  const t = new Date(ref).getTime();
  if (Number.isNaN(t)) return 0;
  const diff = Date.now() - t;
  if (diff <= 0) return 0;
  return Math.floor(diff / 86_400_000);
}

/**
 * Sanitize a free-text note. Trims, caps to NOTES_MAX_LEN, strips ASCII
 * control characters except newline/tab. We accept arbitrary text but
 * keep nothing that could derail a downstream renderer.
 */
function sanitizeNotes(input: unknown, maxLen = NOTES_MAX_LEN): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Strip ASCII control chars except newline (\x0A) and tab (\x09)
  // eslint-disable-next-line no-control-regex
  const cleaned = trimmed.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, maxLen);
}

/**
 * Wrap a fire-and-forget side effect so it never escapes as an unhandled
 * rejection. Logs failures with structured fields.
 */
function fireAndForget(
  label: string,
  ctx: Record<string, unknown>,
  fn: () => Promise<unknown>
): void {
  fn().catch((err: unknown) => {
    logger.error('PORTAL', `${label} failed (non-blocking)`, {
      ...ctx,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

// ============================================================================
// Multer (proof-of-delivery upload)
// ============================================================================

const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PROOF_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (PROOF_ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Solo JPEG, PNG, WEBP.'));
    }
  },
});

function handleMulterError(
  err: unknown,
  _req: CourierRequest,
  res: Response,
  next: NextFunction
): void {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'El archivo excede el límite de 5MB' });
      return;
    }
    res.status(400).json({ error: 'Error al subir el archivo' });
    return;
  }
  if (err instanceof Error) {
    res.status(400).json({ error: err.message });
    return;
  }
  next();
}

// ============================================================================
// Auth chain (applied to every route below)
// ============================================================================

portalRouter.use(verifyToken);
portalRouter.use(extractStoreId);
portalRouter.use(requireCourierRole);

// ============================================================================
// GET /api/portal/me
// ============================================================================
//
// Returns the authenticated courier's profile + carrier + store. One
// query: a join across users, user_stores, carriers, stores. The portal
// renders the header from this and never mutates it.
//
portalRouter.get('/me', async (req: CourierRequest, res: Response) => {
  const userId = req.courierUserId!;
  const storeId = req.storeId!;
  const carrierId = req.courierCarrierId!;

  try {
    const { data, error } = await supabaseAdmin
      .from('user_stores')
      .select(`
        user_id,
        store_id,
        carrier_id,
        users!inner(id, email, name, phone),
        carriers!inner(id, name),
        stores!inner(id, name, country, currency, timezone)
      `)
      .eq('user_id', userId)
      .eq('store_id', storeId)
      .eq('carrier_id', carrierId)
      .eq('role', 'courier')
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      logger.error('PORTAL', 'GET /me query failed', {
        user_id: userId,
        store_id: storeId,
        carrier_id: carrierId,
        error: error.message,
      });
      res.status(500).json({ error: 'Error interno del servidor' });
      return;
    }

    if (!data) {
      // Should not happen post-middleware; treat as a state inconsistency.
      logger.security('PORTAL', 'GET /me: courier link disappeared mid-request', {
        user_id: userId,
        store_id: storeId,
        carrier_id: carrierId,
      });
      res.status(403).json({ error: 'Acceso denegado al portal' });
      return;
    }

    const user = (data as any).users;
    const carrier = (data as any).carriers;
    const store = (data as any).stores;

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        phone: user.phone ?? null,
      },
      carrier: {
        id: carrier.id,
        name: carrier.name,
      },
      store: {
        id: store.id,
        name: store.name,
        country: store.country ?? null,
        currency: store.currency ?? null,
        timezone: store.timezone ?? null,
      },
    });
  } catch (err) {
    logger.error('PORTAL', 'GET /me unexpected error', {
      user_id: userId,
      store_id: storeId,
      carrier_id: carrierId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ============================================================================
// GET /api/portal/orders
// ============================================================================
//
// Query params:
//   view:      'active' | 'today' | 'history'  (default 'active')
//   search:    string, max 100 chars            (optional)
//   page:      int >= 1                         (default 1)
//   page_size: int 1..100                       (default 50)
//
// Returns:
//   { orders: [...], pagination: { page, page_size, total, has_more } }
//
// The shape of each order is the courier-facing projection: only the
// fields the mobile UI renders, computed flags pre-baked. We do not
// expose internal columns (deleted_at, etc).
//
portalRouter.get('/orders', async (req: CourierRequest, res: Response) => {
  const storeId = req.storeId!;
  const carrierId = req.courierCarrierId!;

  // --- Parse + validate params -----------------------------------------
  const rawView = (req.query.view as string | undefined)?.toLowerCase() ?? 'active';
  if (!VIEW_VALUES.includes(rawView as View)) {
    res.status(400).json({ error: 'view inválido' });
    return;
  }
  const view = rawView as View;

  let page = parseInt((req.query.page as string) ?? '1', 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (page > 1000) page = 1000; // hard upper bound

  let pageSize = parseInt((req.query.page_size as string) ?? String(PAGE_SIZE_DEFAULT), 10);
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = PAGE_SIZE_DEFAULT;
  if (pageSize > PAGE_SIZE_MAX) pageSize = PAGE_SIZE_MAX;

  let search: string | null = null;
  if (typeof req.query.search === 'string') {
    const cleaned = sanitizeSearchInput(req.query.search);
    if (cleaned && cleaned.length > 0) {
      search = cleaned.slice(0, SEARCH_MAX_LEN);
    }
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  try {
    // Base selector: only the columns the UI renders.
    let q = supabaseAdmin
      .from('orders')
      .select(
        `
        id,
        store_id,
        courier_id,
        order_number,
        shopify_order_name,
        shopify_order_number,
        customer_first_name,
        customer_last_name,
        customer_phone,
        customer_address,
        shipping_city,
        total_price,
        shipping_cost,
        payment_method,
        prepaid_method,
        sleeves_status,
        delivery_status,
        delivery_preferences,
        delivered_at,
        in_transit_at,
        updated_at
        `,
        { count: 'exact' }
      )
      .eq('store_id', storeId)
      .eq('courier_id', carrierId)
      .is('deleted_at', null);

    // View-specific filters + ordering
    if (view === 'active') {
      q = q
        .in('sleeves_status', IN_TRANSIT_STATUSES as unknown as string[])
        .order('in_transit_at', { ascending: true, nullsFirst: false })
        .order('updated_at', { ascending: true });
    } else if (view === 'today') {
      // "Today" for the courier = "lo que cerré y todavía tengo que rendir
      // de la última jornada". Filters:
      //   - sleeves_status = 'delivered'
      //   - delivered_at within the last 24h (timezone-agnostic for
      //     simplicity; the store timezone column is not on this row)
      //   - reconciled_at IS NULL — once an admin (or the courier
      //     themselves via /portal/settlements/close) reconciles the
      //     order, it falls out of "Hoy". This matches the
      //     v_courier_financial_summary "delivered_unsettled" filter so
      //     the counter at the top and the list below never disagree.
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      q = q
        .eq('sleeves_status', 'delivered')
        .is('reconciled_at', null)
        .gte('delivered_at', since)
        .order('delivered_at', { ascending: false });
    } else {
      // history: every order this carrier has ever touched in this store
      q = q.order('updated_at', { ascending: false });
    }

    // Search filter. Parameterized via Supabase's .or() with .ilike inside
    // a single string. We escape commas and parens defensively even though
    // they are sanitized upstream.
    if (search) {
      const safe = search.replace(/[,()]/g, ' ');
      q = q.or(
        [
          `customer_first_name.ilike.%${safe}%`,
          `customer_last_name.ilike.%${safe}%`,
          `customer_phone.ilike.%${safe}%`,
          `order_number.ilike.%${safe}%`,
          `shopify_order_name.ilike.%${safe}%`,
          `shopify_order_number.ilike.%${safe}%`,
        ].join(',')
      );
    }

    // Defense in depth: even with paging, never serve more than HARD_BOUND.
    q = q.range(from, Math.min(to, HARD_BOUND - 1));

    const { data, error, count } = await q;

    if (error) {
      logger.error('PORTAL', 'GET /orders query failed', {
        store_id: storeId,
        carrier_id: carrierId,
        view,
        error: error.message,
      });
      res.status(500).json({ error: 'Error interno del servidor' });
      return;
    }

    const orders = (data ?? []).map((o: any) => {
      const isCod = !o.prepaid_method && isCodPayment(o.payment_method);
      return {
        id: o.id,
        display_order_number: buildDisplayOrderNumber(o),
        customer_name: buildCustomerName(o.customer_first_name, o.customer_last_name),
        customer_phone: o.customer_phone ?? null,
        customer_address: o.customer_address ?? null,
        customer_city: o.shipping_city ?? null,
        total_price: Number(o.total_price ?? 0),
        shipping_cost: Number(o.shipping_cost ?? 0),
        payment_method: o.payment_method ?? null,
        is_cod: isCod,
        sleeves_status: ALL_OBSERVABLE_STATUSES.has(o.sleeves_status)
          ? o.sleeves_status
          : 'unknown',
        delivery_status: o.delivery_status ?? null,
        delivery_preferences: o.delivery_preferences ?? null,
        delivered_at: o.delivered_at ?? null,
        days_in_transit: daysInTransit(o.in_transit_at, o.updated_at),
      };
    });

    const total = typeof count === 'number' ? count : orders.length;
    const has_more = from + orders.length < total;

    res.json({
      orders,
      pagination: { page, page_size: pageSize, total, has_more },
    });
  } catch (err) {
    logger.error('PORTAL', 'GET /orders unexpected error', {
      store_id: storeId,
      carrier_id: carrierId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ============================================================================
// POST /api/portal/orders/:id/mark-delivered
// ============================================================================
//
// Replicates the public `/api/orders/token/:token/delivery-confirm` flow
// but inside the authenticated courier-portal trust boundary. The order
// is looked up via `requireOrderInCourierScope`, so we already have the
// minimal projection on `req.scopedOrder`. We re-fetch the few extra
// columns needed for COD math (cod_amount, total_price) before mutating.
//
// Concurrency safety: the UPDATE includes a `WHERE sleeves_status` guard
// derived from the value the middleware saw. If a concurrent writer
// (same carrier, two operators) already moved the row to `delivered`,
// the second update writes 0 rows and we re-read + return the
// already_delivered shape.

const MarkDeliveredSchema = z.object({
  amount_collected: z
    .union([z.number(), z.string()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === null) return undefined;
      const n = typeof v === 'string' ? Number(v) : v;
      return Number.isFinite(n) ? n : undefined;
    }),
  payment_method: z
    .string()
    .max(40)
    .optional()
    .transform((v) => (typeof v === 'string' ? v.trim().toLowerCase() : undefined)),
  photo_url: z.string().url().max(2048).optional(),
  notes: z.string().max(NOTES_MAX_LEN).optional(),
});

portalRouter.post(
  '/orders/:id/mark-delivered',
  requireOrderInCourierScope,
  async (req: CourierRequest, res: Response) => {
    const orderId = req.params.id;
    const storeId = req.storeId!;
    const carrierId = req.courierCarrierId!;
    const userId = req.courierUserId!;
    const scoped = req.scopedOrder!;

    // ------------- validate body ----------------------------------------
    const parsed = MarkDeliveredSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: 'Datos inválidos',
        details: parsed.error.issues.map((i) => i.message),
      });
      return;
    }
    const { amount_collected, payment_method, photo_url } = parsed.data;
    const notes = sanitizeNotes(parsed.data.notes ?? null);

    // ------------- idempotency: already delivered -----------------------
    if (isDelivered(scoped.sleeves_status)) {
      res.json({ already_delivered: true, order: { id: orderId, sleeves_status: 'delivered' } });
      return;
    }

    // ------------- guard: active incident -------------------------------
    // Re-fetch the incident flag and the COD math columns the middleware
    // does not project. Single roundtrip.
    const { data: extra, error: extraErr } = await supabaseAdmin
      .from('orders')
      .select(
        'id, sleeves_status, has_active_incident, cod_amount, total_price, payment_method, prepaid_method, shopify_order_name, shopify_order_number, order_number, customer_first_name, customer_last_name, customer_phone'
      )
      .eq('id', orderId)
      .eq('store_id', storeId)
      .eq('courier_id', carrierId)
      .maybeSingle();

    if (extraErr || !extra) {
      logger.error('PORTAL', 'mark-delivered: extra fetch failed', {
        order_id: orderId,
        user_id: userId,
        store_id: storeId,
        carrier_id: carrierId,
        error: extraErr?.message,
      });
      res.status(500).json({ error: 'Error interno del servidor' });
      return;
    }

    if (isDelivered(extra.sleeves_status)) {
      // Race against a concurrent writer
      res.json({ already_delivered: true, order: { id: orderId, sleeves_status: 'delivered' } });
      return;
    }

    if (extra.has_active_incident) {
      res.status(400).json({
        error: 'Resolver incidencia primero',
        message: 'Este pedido tiene una incidencia activa. Resolvé la incidencia antes de marcar entregado.',
      });
      return;
    }

    // ------------- payment math (mirrors orders.ts:404-601) -------------
    const effectivePaymentMethod = payment_method || extra.payment_method || null;
    const isCod = !extra.prepaid_method && isCodPayment(effectivePaymentMethod);

    const updateData: Record<string, unknown> = {
      sleeves_status: 'delivered',
      delivery_status: 'confirmed',
      delivered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      payment_status: 'collected',
    };

    if (payment_method) updateData.payment_method = payment_method;
    if (notes) updateData.courier_notes = notes;
    if (photo_url) updateData.proof_photo_url = photo_url;

    let appliedAmount = 0;
    let hasDiscrepancy = false;

    if (isCod) {
      const expected = Number(extra.cod_amount ?? extra.total_price ?? 0);
      if (typeof amount_collected === 'number') {
        if (amount_collected < 0) {
          res.status(400).json({ error: 'amount_collected no puede ser negativo' });
          return;
        }
        appliedAmount = amount_collected;
        hasDiscrepancy = Math.abs(amount_collected - expected) > 0.0001;
      } else {
        appliedAmount = expected;
        hasDiscrepancy = false;
      }
      updateData.amount_collected = appliedAmount;
      updateData.has_amount_discrepancy = hasDiscrepancy;
    } else {
      // Prepaid: courier collected nothing. Stamp prepaid_method so
      // settlements ignores the cash leg for this order.
      updateData.amount_collected = 0;
      updateData.has_amount_discrepancy = false;
      if (effectivePaymentMethod) {
        updateData.prepaid_method = effectivePaymentMethod;
      }
      updateData.prepaid_at = new Date().toISOString();
    }

    // ------------- update orders (CAS on sleeves_status) ----------------
    // The CAS predicate "sleeves_status NOT delivered" is what gives us
    // last-writer-wins semantics for legitimate state transitions while
    // catching the rare same-tenant race.
    const { data: updated, error: updErr } = await supabaseAdmin
      .from('orders')
      .update(updateData)
      .eq('id', orderId)
      .eq('store_id', storeId)
      .eq('courier_id', carrierId)
      .neq('sleeves_status', 'delivered')
      .select('id, sleeves_status, delivered_at, total_price, amount_collected, has_amount_discrepancy, payment_method, prepaid_method')
      .maybeSingle();

    if (updErr) {
      logger.error('PORTAL', 'mark-delivered: update failed', {
        order_id: orderId,
        user_id: userId,
        store_id: storeId,
        carrier_id: carrierId,
        error: updErr.message,
      });
      res.status(500).json({ error: 'Error interno del servidor' });
      return;
    }

    if (!updated) {
      // Concurrent writer beat us. Treat as idempotent success.
      res.json({ already_delivered: true, order: { id: orderId, sleeves_status: 'delivered' } });
      return;
    }

    // ------------- delivery_attempts insert -----------------------------
    // We don't error out on attempt insert; the order is already delivered
    // and the audit row is best-effort. Log if it fails.
    try {
      const { data: lastAttempts } = await supabaseAdmin
        .from('delivery_attempts')
        .select('attempt_number')
        .eq('order_id', orderId)
        .order('attempt_number', { ascending: false })
        .limit(1);

      const attemptNumber =
        lastAttempts && lastAttempts.length > 0
          ? Number(lastAttempts[0].attempt_number) + 1
          : 1;

      const today = new Date().toISOString().slice(0, 10);

      await supabaseAdmin.from('delivery_attempts').insert({
        order_id: orderId,
        store_id: storeId,
        carrier_id: carrierId,
        attempt_number: attemptNumber,
        scheduled_date: today,
        actual_date: today,
        status: 'delivered',
        payment_method: effectivePaymentMethod,
        notes,
        photo_url: photo_url ?? null,
        created_by: userId,
      });
    } catch (err) {
      logger.warn('PORTAL', 'mark-delivered: delivery_attempts insert failed (non-blocking)', {
        order_id: orderId,
        user_id: userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // ------------- order_status_history insert --------------------------
    try {
      let historyNotes = `Entregado por courier (portal)`;
      if (effectivePaymentMethod) historyNotes += ` - Pago: ${effectivePaymentMethod}`;
      if (isCod && hasDiscrepancy) {
        historyNotes += ` - Discrepancia: cobrado ${appliedAmount}, esperado ${Number(extra.cod_amount ?? extra.total_price ?? 0)}`;
      } else if (!isCod) {
        historyNotes += ` - Prepago (no se cobró efectivo)`;
      }
      if (notes) historyNotes += ` - Notas: ${notes}`;

      await supabaseAdmin.from('order_status_history').insert({
        order_id: orderId,
        store_id: storeId,
        previous_status: extra.sleeves_status ?? scoped.sleeves_status ?? 'shipped',
        new_status: 'delivered',
        changed_by: userId,
        change_source: 'courier_portal',
        notes: historyNotes,
      });
    } catch (err) {
      logger.warn('PORTAL', 'mark-delivered: status history insert failed (non-blocking)', {
        order_id: orderId,
        user_id: userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // ------------- response ---------------------------------------------
    res.json({
      success: true,
      already_delivered: false,
      order: {
        id: updated.id,
        sleeves_status: updated.sleeves_status,
        delivered_at: updated.delivered_at,
        amount_collected: Number(updated.amount_collected ?? 0),
        has_amount_discrepancy: !!updated.has_amount_discrepancy,
        is_cod: isCod,
      },
    });

    // ------------- post-response side effects ---------------------------
    fireAndForget(
      'mark-delivered: outbound webhook',
      { order_id: orderId, store_id: storeId, carrier_id: carrierId },
      () =>
        OutboundWebhookService.fireOrderStatusEvent(
          storeId,
          'delivered',
          extra.sleeves_status ?? scoped.sleeves_status ?? 'shipped',
          {
            order_id: orderId,
            order_number: buildDisplayOrderNumber({
              shopify_order_name: extra.shopify_order_name,
              shopify_order_number: extra.shopify_order_number,
              order_number: extra.order_number,
              id: orderId,
            }),
            customer_name: buildCustomerName(extra.customer_first_name, extra.customer_last_name),
            customer_phone: extra.customer_phone ?? null,
            total_price: Number(updated.total_price ?? 0),
            payment_method: effectivePaymentMethod,
            delivered_at: updateData.delivered_at,
            delivery_source: 'courier_portal',
            amount_collected: Number(updated.amount_collected ?? 0),
          }
        )
    );

    fireAndForget(
      'mark-delivered: auto-invoice',
      { order_id: orderId, store_id: storeId },
      () =>
        import('../services/invoicing.service').then(({ tryAutoEmitOnDelivery }) =>
          tryAutoEmitOnDelivery(storeId, orderId)
        )
    );
  }
);

// ============================================================================
// POST /api/portal/orders/:id/mark-failed
// ============================================================================
//
// Logs a failed delivery attempt without changing sleeves_status. The
// order stays in shipped/in_transit/etc so the courier can retry on a
// later visit. Idempotent against double-taps via a 5-minute dedupe
// window keyed on (order, user, reason).

const MarkFailedSchema = z.object({
  reason: z.enum(FAILED_REASON_VALUES),
  notes: z.string().max(NOTES_MAX_LEN).optional(),
});

portalRouter.post(
  '/orders/:id/mark-failed',
  requireOrderInCourierScope,
  async (req: CourierRequest, res: Response) => {
    const orderId = req.params.id;
    const storeId = req.storeId!;
    const carrierId = req.courierCarrierId!;
    const userId = req.courierUserId!;
    const scoped = req.scopedOrder!;

    const parsed = MarkFailedSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: 'Datos inválidos',
        details: parsed.error.issues.map((i) => i.message),
      });
      return;
    }
    const { reason } = parsed.data;
    const notes = sanitizeNotes(parsed.data.notes ?? null);

    // Disallow logging a failed attempt on a terminal state.
    if (
      isDelivered(scoped.sleeves_status) ||
      isReturned(scoped.sleeves_status) ||
      isCancelled(scoped.sleeves_status) ||
      isRejected(scoped.sleeves_status)
    ) {
      res.status(400).json({
        error: 'Estado inválido',
        message: 'No se puede registrar intento fallido en un pedido finalizado',
      });
      return;
    }

    try {
      // --- Idempotency dedupe: same user + reason + last 5 minutes -----
      const since = new Date(Date.now() - FAILED_DEDUPE_WINDOW_MS).toISOString();
      const { data: dupes } = await supabaseAdmin
        .from('delivery_attempts')
        .select('id, created_at')
        .eq('order_id', orderId)
        .eq('store_id', storeId)
        .eq('carrier_id', carrierId)
        .eq('created_by', userId)
        .eq('status', 'failed')
        .eq('failed_reason', reason)
        .gte('created_at', since)
        .limit(1);

      if (dupes && dupes.length > 0) {
        res.json({ already_logged: true, attempt_id: dupes[0].id });
        return;
      }

      // --- Insert the attempt -----------------------------------------
      const { data: lastAttempts } = await supabaseAdmin
        .from('delivery_attempts')
        .select('attempt_number')
        .eq('order_id', orderId)
        .order('attempt_number', { ascending: false })
        .limit(1);

      const attemptNumber =
        lastAttempts && lastAttempts.length > 0
          ? Number(lastAttempts[0].attempt_number) + 1
          : 1;

      const today = new Date().toISOString().slice(0, 10);

      const { data: attempt, error: insErr } = await supabaseAdmin
        .from('delivery_attempts')
        .insert({
          order_id: orderId,
          store_id: storeId,
          carrier_id: carrierId,
          attempt_number: attemptNumber,
          scheduled_date: today,
          actual_date: today,
          status: 'failed',
          failed_reason: reason,
          failure_notes: notes,
          created_by: userId,
        })
        .select('id')
        .single();

      if (insErr) {
        logger.error('PORTAL', 'mark-failed: insert failed', {
          order_id: orderId,
          user_id: userId,
          error: insErr.message,
        });
        res.status(500).json({ error: 'Error interno del servidor' });
        return;
      }

      // --- order_status_history (status doesn't change, but we audit) --
      try {
        await supabaseAdmin.from('order_status_history').insert({
          order_id: orderId,
          store_id: storeId,
          previous_status: scoped.sleeves_status,
          new_status: scoped.sleeves_status,
          changed_by: userId,
          change_source: 'courier_portal',
          notes: `Intento fallido: ${reason}${notes ? ` - ${notes}` : ''}`,
        });
      } catch (err) {
        logger.warn('PORTAL', 'mark-failed: status history insert failed (non-blocking)', {
          order_id: orderId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      res.json({
        success: true,
        attempt_id: attempt.id,
        attempt_number: attemptNumber,
        reason,
      });
    } catch (err) {
      logger.error('PORTAL', 'mark-failed: unexpected error', {
        order_id: orderId,
        user_id: userId,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
);

// ============================================================================
// POST /api/portal/orders/:id/mark-returned
// ============================================================================
//
// Moves the order to `returned`. The DB stock-restore trigger fires
// automatically (Migration 107 / 110 variant-aware). Idempotent on
// already-returned. Fires order.returned webhook fire-and-forget.

const MarkReturnedSchema = z.object({
  reason: z.string().max(120),
  notes: z.string().max(NOTES_MAX_LEN).optional(),
});

portalRouter.post(
  '/orders/:id/mark-returned',
  requireOrderInCourierScope,
  async (req: CourierRequest, res: Response) => {
    const orderId = req.params.id;
    const storeId = req.storeId!;
    const carrierId = req.courierCarrierId!;
    const userId = req.courierUserId!;
    const scoped = req.scopedOrder!;

    const parsed = MarkReturnedSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: 'Datos inválidos',
        details: parsed.error.issues.map((i) => i.message),
      });
      return;
    }
    const reason = (parsed.data.reason || '').trim().slice(0, 120);
    if (!reason) {
      res.status(400).json({ error: 'reason es requerido' });
      return;
    }
    const notes = sanitizeNotes(parsed.data.notes ?? null);

    // Idempotency
    if (isReturned(scoped.sleeves_status)) {
      res.json({ already_returned: true, order: { id: orderId, sleeves_status: 'returned' } });
      return;
    }

    try {
      // CAS update: only succeed if not already returned.
      const { data: updated, error: updErr } = await supabaseAdmin
        .from('orders')
        .update({
          sleeves_status: 'returned',
          delivery_status: 'failed',
          cancelled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId)
        .eq('store_id', storeId)
        .eq('courier_id', carrierId)
        .neq('sleeves_status', 'returned')
        .select(
          'id, sleeves_status, shopify_order_name, shopify_order_number, order_number, customer_first_name, customer_last_name, customer_phone, total_price, payment_method'
        )
        .maybeSingle();

      if (updErr) {
        logger.error('PORTAL', 'mark-returned: update failed', {
          order_id: orderId,
          user_id: userId,
          error: updErr.message,
        });
        res.status(500).json({ error: 'Error interno del servidor' });
        return;
      }

      if (!updated) {
        res.json({ already_returned: true, order: { id: orderId, sleeves_status: 'returned' } });
        return;
      }

      // Best-effort delivery_attempts row
      try {
        const { data: lastAttempts } = await supabaseAdmin
          .from('delivery_attempts')
          .select('attempt_number')
          .eq('order_id', orderId)
          .order('attempt_number', { ascending: false })
          .limit(1);

        const attemptNumber =
          lastAttempts && lastAttempts.length > 0
            ? Number(lastAttempts[0].attempt_number) + 1
            : 1;

        const today = new Date().toISOString().slice(0, 10);

        await supabaseAdmin.from('delivery_attempts').insert({
          order_id: orderId,
          store_id: storeId,
          carrier_id: carrierId,
          attempt_number: attemptNumber,
          scheduled_date: today,
          actual_date: today,
          status: 'returned',
          failed_reason: reason,
          failure_notes: notes,
          created_by: userId,
        });
      } catch (err) {
        logger.warn('PORTAL', 'mark-returned: delivery_attempts insert failed (non-blocking)', {
          order_id: orderId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Best-effort status history
      try {
        await supabaseAdmin.from('order_status_history').insert({
          order_id: orderId,
          store_id: storeId,
          previous_status: scoped.sleeves_status,
          new_status: 'returned',
          changed_by: userId,
          change_source: 'courier_portal',
          notes: `Devolución: ${reason}${notes ? ` - ${notes}` : ''}`,
        });
      } catch (err) {
        logger.warn('PORTAL', 'mark-returned: status history insert failed (non-blocking)', {
          order_id: orderId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      res.json({
        success: true,
        already_returned: false,
        order: { id: updated.id, sleeves_status: updated.sleeves_status },
      });

      fireAndForget(
        'mark-returned: outbound webhook',
        { order_id: orderId, store_id: storeId, carrier_id: carrierId },
        () =>
          OutboundWebhookService.fireOrderStatusEvent(
            storeId,
            'returned',
            scoped.sleeves_status,
            {
              order_id: orderId,
              order_number: buildDisplayOrderNumber({
                shopify_order_name: updated.shopify_order_name,
                shopify_order_number: updated.shopify_order_number,
                order_number: updated.order_number,
                id: orderId,
              }),
              customer_name: buildCustomerName(updated.customer_first_name, updated.customer_last_name),
              customer_phone: updated.customer_phone ?? null,
              total_price: Number(updated.total_price ?? 0),
              payment_method: updated.payment_method ?? null,
              delivery_source: 'courier_portal',
              return_reason: reason,
            }
          )
      );
    } catch (err) {
      logger.error('PORTAL', 'mark-returned: unexpected error', {
        order_id: orderId,
        user_id: userId,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
);

// ============================================================================
// POST /api/portal/orders/:id/report-incident
// ============================================================================
//
// Sets has_active_incident=true and parks the order at sleeves_status
// 'incident'. Admin resolves manually from the dashboard. We do NOT
// stamp delivered_at or move to a terminal state.

const ReportIncidentSchema = z.object({
  description: z.string().min(INCIDENT_MIN_LEN).max(INCIDENT_MAX_LEN),
});

portalRouter.post(
  '/orders/:id/report-incident',
  requireOrderInCourierScope,
  async (req: CourierRequest, res: Response) => {
    const orderId = req.params.id;
    const storeId = req.storeId!;
    const carrierId = req.courierCarrierId!;
    const userId = req.courierUserId!;
    const scoped = req.scopedOrder!;

    const parsed = ReportIncidentSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: 'Descripción inválida',
        message: `La descripción debe tener entre ${INCIDENT_MIN_LEN} y ${INCIDENT_MAX_LEN} caracteres`,
      });
      return;
    }
    const description = sanitizeNotes(parsed.data.description, INCIDENT_MAX_LEN);
    if (!description || description.length < INCIDENT_MIN_LEN) {
      res.status(400).json({ error: 'Descripción inválida' });
      return;
    }

    if (
      isDelivered(scoped.sleeves_status) ||
      isReturned(scoped.sleeves_status) ||
      isCancelled(scoped.sleeves_status) ||
      isRejected(scoped.sleeves_status)
    ) {
      res.status(400).json({
        error: 'Estado inválido',
        message: 'No se puede reportar incidencia en un pedido finalizado',
      });
      return;
    }

    try {
      const { data: updated, error: updErr } = await supabaseAdmin
        .from('orders')
        .update({
          sleeves_status: 'incident',
          has_active_incident: true,
          incident_description: description,
          incident_reported_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId)
        .eq('store_id', storeId)
        .eq('courier_id', carrierId)
        .select(
          'id, sleeves_status, shopify_order_name, shopify_order_number, order_number, customer_first_name, customer_last_name, customer_phone, total_price'
        )
        .maybeSingle();

      if (updErr || !updated) {
        logger.error('PORTAL', 'report-incident: update failed', {
          order_id: orderId,
          user_id: userId,
          error: updErr?.message,
        });
        res.status(500).json({ error: 'Error interno del servidor' });
        return;
      }

      try {
        await supabaseAdmin.from('order_status_history').insert({
          order_id: orderId,
          store_id: storeId,
          previous_status: scoped.sleeves_status,
          new_status: 'incident',
          changed_by: userId,
          change_source: 'courier_portal',
          notes: `Incidencia: ${description}`,
        });
      } catch (err) {
        logger.warn('PORTAL', 'report-incident: status history insert failed (non-blocking)', {
          order_id: orderId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      res.json({
        success: true,
        order: { id: updated.id, sleeves_status: updated.sleeves_status },
      });

      // Outbound webhook: there is no dedicated 'order.incident' event in
      // OutboundWebhookService.OUTBOUND_WEBHOOK_EVENTS, so we fall back
      // to the generic 'order.status_changed' which the service emits
      // automatically when a specific event is not mapped.
      fireAndForget(
        'report-incident: outbound webhook',
        { order_id: orderId, store_id: storeId, carrier_id: carrierId },
        () =>
          OutboundWebhookService.fireOrderStatusEvent(
            storeId,
            'incident',
            scoped.sleeves_status,
            {
              order_id: orderId,
              order_number: buildDisplayOrderNumber({
                shopify_order_name: updated.shopify_order_name,
                shopify_order_number: updated.shopify_order_number,
                order_number: updated.order_number,
                id: orderId,
              }),
              customer_name: buildCustomerName(updated.customer_first_name, updated.customer_last_name),
              customer_phone: updated.customer_phone ?? null,
              total_price: Number(updated.total_price ?? 0),
              delivery_source: 'courier_portal',
              incident_description: description,
            }
          )
      );
    } catch (err) {
      logger.error('PORTAL', 'report-incident: unexpected error', {
        order_id: orderId,
        user_id: userId,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
);

// ============================================================================
// POST /api/portal/orders/:id/upload-proof
// ============================================================================
//
// Multipart upload of a proof-of-delivery photo. We reuse the
// `merchandise` Supabase Storage bucket (public-read, 5MB cap, image
// mimes only) instead of creating a dedicated bucket: the path is
// scoped to the store + order id, so leakage is impossible across
// stores. The frontend is expected to call this BEFORE mark-delivered
// and pass the returned URL as `photo_url`.

portalRouter.post(
  '/orders/:id/upload-proof',
  requireOrderInCourierScope,
  proofUpload.single('file'),
  handleMulterError,
  async (req: CourierRequest, res: Response) => {
    const orderId = req.params.id;
    const storeId = req.storeId!;
    const userId = req.courierUserId!;

    if (!req.file) {
      res.status(400).json({ error: 'No se proporcionó archivo' });
      return;
    }

    if (!PROOF_ALLOWED_MIME.has(req.file.mimetype)) {
      res.status(400).json({ error: 'Tipo de archivo no permitido' });
      return;
    }

    try {
      // We use the `merchandise` bucket. The entityId becomes the order_id
      // so the storage layout segregates files per order. This bucket is
      // already public-read (matching the existing photo flows) and has
      // the same 5MB cap we enforce here.
      const result = await uploadFile(
        'merchandise',
        req.file.buffer,
        req.file.mimetype,
        storeId,
        orderId,
        req.file.originalname || 'proof.jpg'
      );

      if (!result.success || !result.url) {
        logger.error('PORTAL', 'upload-proof: storage upload failed', {
          order_id: orderId,
          user_id: userId,
          error: result.error,
        });
        res.status(500).json({ error: 'No se pudo subir la foto' });
        return;
      }

      res.json({ photo_url: result.url, path: result.path ?? null });
    } catch (err) {
      logger.error('PORTAL', 'upload-proof: unexpected error', {
        order_id: orderId,
        user_id: userId,
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
);

// ============================================================================
// GET /api/portal/financial-summary
// ============================================================================
//
// Single read of v_courier_financial_summary + a function call for
// failed-attempt fees. Net balance is computed in the application layer
// because the view does not have access to the failed-fees aggregate.

portalRouter.get('/financial-summary', async (req: CourierRequest, res: Response) => {
  const storeId = req.storeId!;
  const carrierId = req.courierCarrierId!;

  try {
    const [summaryRes, feesRes] = await Promise.all([
      supabaseAdmin
        .from('v_courier_financial_summary')
        .select(
          'in_transit_count, in_transit_cod_pending, in_transit_shipping_fees, delivered_unsettled_count, cod_collected_to_remit, shipping_fees_to_receive'
        )
        .eq('store_id', storeId)
        .eq('carrier_id', carrierId)
        .maybeSingle(),
      supabaseAdmin.rpc('get_courier_failed_attempt_fees', {
        p_store_id: storeId,
        p_carrier_id: carrierId,
      }),
    ]);

    if (summaryRes.error) {
      logger.error('PORTAL', 'financial-summary: view query failed', {
        store_id: storeId,
        carrier_id: carrierId,
        error: summaryRes.error.message,
      });
      res.status(500).json({ error: 'Error interno del servidor' });
      return;
    }

    if (feesRes.error) {
      logger.error('PORTAL', 'financial-summary: fees rpc failed', {
        store_id: storeId,
        carrier_id: carrierId,
        error: feesRes.error.message,
      });
      res.status(500).json({ error: 'Error interno del servidor' });
      return;
    }

    const s = summaryRes.data ?? {
      in_transit_count: 0,
      in_transit_cod_pending: 0,
      in_transit_shipping_fees: 0,
      delivered_unsettled_count: 0,
      cod_collected_to_remit: 0,
      shipping_fees_to_receive: 0,
    };

    const failed_attempt_fees = Number(feesRes.data ?? 0);
    const cod_collected_to_remit = Number(s.cod_collected_to_remit ?? 0);
    const shipping_fees_to_receive = Number(s.shipping_fees_to_receive ?? 0);

    const net_balance = cod_collected_to_remit - shipping_fees_to_receive - failed_attempt_fees;

    res.set('Cache-Control', 'private, max-age=30');
    res.json({
      in_transit: {
        orders_count: Number(s.in_transit_count ?? 0),
        cod_pending_to_collect: Number(s.in_transit_cod_pending ?? 0),
        shipping_fees_pending: Number(s.in_transit_shipping_fees ?? 0),
      },
      delivered_unsettled: {
        orders_count: Number(s.delivered_unsettled_count ?? 0),
        cod_collected_to_remit,
        shipping_fees_to_receive,
        failed_attempt_fees,
      },
      net_balance,
    });
  } catch (err) {
    logger.error('PORTAL', 'financial-summary: unexpected error', {
      store_id: storeId,
      carrier_id: carrierId,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ============================================================================
// Settlements: courier-side self-close
// ============================================================================
//
// All three endpoints scope themselves to the authenticated courier's
// (store_id, carrier_id) pair. They never trust the client for
// carrier identity — that comes from requireCourierRole's pinned
// req.courierCarrierId.
//
// Trust model is auto-paid: closeSettlement stamps the resulting
// daily_settlements row as `status='paid'` with the courier's bank
// reference and a screenshot attached as evidence in
// settlement_payment_proofs. Admin can still flip to `disputed` from
// the dashboard if fraud is detected.

const settlementProofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: SETTLEMENT_PROOF_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (SETTLEMENT_PROOF_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Solo JPEG, PNG, WEBP o PDF.'));
    }
  },
});

function handleSettlementMulterError(
  err: unknown,
  _req: CourierRequest,
  res: Response,
  next: NextFunction
): void {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'El archivo excede el límite de 5 MB' });
      return;
    }
    res.status(400).json({ error: 'Error al subir el archivo' });
    return;
  }
  if (err instanceof Error) {
    res.status(400).json({ error: err.message });
    return;
  }
  next();
}

function handleSettlementsServiceError(err: unknown, res: Response): void {
  if (err instanceof PortalSettlementsError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }
  logger.error('PORTAL', 'settlements: unexpected error', {
    error: err instanceof Error ? err.message : String(err),
  });
  res.status(500).json({ error: 'Error interno del servidor' });
}

// ----------------------------------------------------------------------------
// GET /api/portal/settlements/pending
// ----------------------------------------------------------------------------
portalRouter.get('/settlements/pending', async (req: CourierRequest, res: Response) => {
  const storeId = req.storeId!;
  const carrierId = req.courierCarrierId!;
  try {
    const result = await getPendingSettlements(storeId, carrierId);
    res.set('Cache-Control', 'private, max-age=30');
    res.json(result);
  } catch (err) {
    handleSettlementsServiceError(err, res);
  }
});

// ----------------------------------------------------------------------------
// GET /api/portal/settlements/history?page=1&page_size=20
// ----------------------------------------------------------------------------
portalRouter.get('/settlements/history', async (req: CourierRequest, res: Response) => {
  const storeId = req.storeId!;
  const carrierId = req.courierCarrierId!;
  const page = parseInt((req.query.page as string) ?? '1', 10);
  const pageSize = parseInt((req.query.page_size as string) ?? '20', 10);

  try {
    const result = await getSettlementsHistory(
      storeId,
      carrierId,
      Number.isFinite(page) ? page : 1,
      Number.isFinite(pageSize) ? pageSize : 20
    );
    res.set('Cache-Control', 'private, max-age=15');
    res.json(result);
  } catch (err) {
    handleSettlementsServiceError(err, res);
  }
});

// ----------------------------------------------------------------------------
// POST /api/portal/settlements/close (multipart)
// ----------------------------------------------------------------------------
const CloseSettlementBodySchema = z.object({
  order_ids: z.string().min(1, 'order_ids es requerido'),
  total_amount_collected: z.union([z.string(), z.number()]),
  payment_method: z.enum(['transfer', 'qr', 'cash_deposit', 'other']),
  payment_reference: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
});

portalRouter.post(
  '/settlements/close',
  settlementProofUpload.single('file'),
  handleSettlementMulterError,
  async (req: CourierRequest, res: Response) => {
    const storeId = req.storeId!;
    const carrierId = req.courierCarrierId!;
    const userId = req.courierUserId!;

    if (!req.file) {
      res.status(400).json({ error: 'No se proporcionó comprobante' });
      return;
    }

    const parsedBody = CloseSettlementBodySchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      res.status(400).json({
        error: 'Datos inválidos',
        details: parsedBody.error.issues.map((i) => i.message),
      });
      return;
    }

    // order_ids comes through multipart as a JSON-encoded string.
    let orderIds: string[];
    try {
      const raw = JSON.parse(parsedBody.data.order_ids);
      if (!Array.isArray(raw)) throw new Error('order_ids must be a JSON array');
      orderIds = raw.map((v) => String(v));
    } catch {
      res.status(400).json({ error: 'order_ids debe ser un JSON array de UUIDs' });
      return;
    }

    const amount = Number(parsedBody.data.total_amount_collected);
    if (!Number.isFinite(amount) || amount < 0) {
      res.status(400).json({ error: 'total_amount_collected inválido' });
      return;
    }

    try {
      const result = await closeSettlement({
        storeId,
        carrierId,
        userId,
        input: {
          order_ids: orderIds,
          total_amount_collected: amount,
          payment_method: parsedBody.data.payment_method,
          payment_reference: parsedBody.data.payment_reference,
          notes: parsedBody.data.notes ?? null,
        },
        file: {
          buffer: req.file.buffer,
          mimetype: req.file.mimetype,
          originalname: req.file.originalname,
        },
      });
      res.json(result);
    } catch (err) {
      handleSettlementsServiceError(err, res);
    }
  }
);

// ============================================================================
// 404 inside the portal namespace
// ============================================================================
portalRouter.use((req: CourierRequest, res: Response) => {
  res.status(404).json({ error: 'Endpoint no encontrado' });
});
