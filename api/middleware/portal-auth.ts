/**
 * Portal Auth Middleware (Courier Portal)
 *
 * Runs after verifyToken + extractStoreId. Confirms the authenticated
 * user is an active courier in the current store and pins the carrier
 * scope for the rest of the request handler. Every portal mutation
 * downstream relies on req.courierCarrierId being correct.
 *
 * Single DB roundtrip per request: one RPC call to
 * get_user_courier_carrier_id (Migration 174). The function is
 * SECURITY DEFINER with a fixed search_path, so it cannot be
 * subverted by RLS, schema-prefix tricks, or impersonation.
 *
 * The courier portal has TWO trust boundaries:
 *   1. Auth: is this user a courier of *some* carrier in this store?
 *   2. Scope: does this :orderId belong to *that* carrier?
 *
 * (1) is enforced by requireCourierRole.
 * (2) is enforced by requireOrderInCourierScope, which also caches
 *     the order on the request so the handler does not re-fetch.
 */

import { Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { supabaseAdmin } from '../db/connection';
import { AuthRequest } from './auth';

// UUID grammar. Loose enough to accept any RFC-4122 UUID, strict enough
// to reject anything else before it touches the DB.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// last_active_at is rate-limited at the application layer to avoid a
// hot write per request. 60s gives the admin "last seen" indicator
// enough resolution without saturating the row.
const LAST_ACTIVE_THROTTLE_MS = 60_000;

// In-memory throttle map. Per-process. With multiple Railway replicas
// this means up to N writes per minute per courier (N = replica count),
// which is acceptable. Bounded to prevent unbounded growth.
const lastActiveCache = new Map<string, number>();
const LAST_ACTIVE_CACHE_MAX = 10_000;

export interface CourierRequest extends AuthRequest {
  courierCarrierId?: string;
  courierUserId?: string;
  // Cache of the order resolved by requireOrderInCourierScope. The
  // handler should read from this instead of re-querying.
  scopedOrder?: {
    id: string;
    store_id: string;
    courier_id: string | null;
    sleeves_status: string;
    delivery_status: string | null;
    payment_method: string | null;
    delivered_at: string | null;
  };
}

/**
 * Validate that req.userId and req.storeId are well-formed UUIDs.
 * Defense in depth: the auth + extractStoreId middlewares already
 * inject these, but a missing or malformed value should never reach
 * a SECURITY DEFINER RPC.
 */
function validateUuids(req: CourierRequest): { ok: boolean; reason?: string } {
  if (!req.userId || !UUID_REGEX.test(req.userId)) {
    return { ok: false, reason: 'invalid_user_id' };
  }
  if (!req.storeId || !UUID_REGEX.test(req.storeId)) {
    return { ok: false, reason: 'invalid_store_id' };
  }
  return { ok: true };
}

/**
 * Best-effort, fire-and-forget update of user_stores.last_active_at.
 * Throttled to 1 write per courier per LAST_ACTIVE_THROTTLE_MS. Errors
 * are swallowed: this is a UI nicety, not a correctness primitive.
 */
function touchLastActive(userId: string, storeId: string): void {
  const key = `${userId}:${storeId}`;
  const now = Date.now();
  const last = lastActiveCache.get(key);

  if (last !== undefined && now - last < LAST_ACTIVE_THROTTLE_MS) {
    return;
  }

  if (lastActiveCache.size >= LAST_ACTIVE_CACHE_MAX) {
    const firstKey = lastActiveCache.keys().next().value;
    if (firstKey) lastActiveCache.delete(firstKey);
  }
  lastActiveCache.set(key, now);

  void supabaseAdmin
    .from('user_stores')
    .update({ last_active_at: new Date(now).toISOString() })
    .eq('user_id', userId)
    .eq('store_id', storeId)
    .eq('role', 'courier')
    .eq('is_active', true)
    .then(({ error }) => {
      if (error) {
        logger.warn('PORTAL_AUTH', 'last_active_at update failed', {
          user_id: userId,
          store_id: storeId,
          error: error.message
        });
      }
    });
}

/**
 * requireCourierRole
 *
 * Mounts AFTER verifyToken + extractStoreId. Resolves the carrier the
 * authenticated user operates for in the requested store. Rejects with:
 *   401 if userId/storeId are missing or malformed
 *   403 if the user is not an active courier in this store
 *   500 on RPC failure
 *
 * On success: req.courierCarrierId and req.courierUserId are pinned,
 * and last_active_at is touched (rate-limited).
 */
export async function requireCourierRole(
  req: CourierRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const validation = validateUuids(req);
  if (!validation.ok) {
    logger.security('PORTAL_AUTH', 'malformed identity on portal request', {
      reason: validation.reason,
      user_id: req.userId,
      store_id: req.storeId
    });
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('get_user_courier_carrier_id', {
      p_user_id: req.userId,
      p_store_id: req.storeId
    });

    if (error) {
      logger.error('PORTAL_AUTH', 'get_user_courier_carrier_id RPC failed', {
        user_id: req.userId,
        store_id: req.storeId,
        error: error.message
      });
      res.status(500).json({ error: 'Error interno del servidor' });
      return;
    }

    // The RPC returns a single UUID or NULL. Reject anything else.
    const carrierId = typeof data === 'string' ? data : null;

    if (!carrierId) {
      logger.warn('PORTAL_AUTH', 'non-courier denied portal access', {
        user_id: req.userId,
        store_id: req.storeId
      });
      res.status(403).json({ error: 'Acceso denegado al portal de couriers' });
      return;
    }

    req.courierCarrierId = carrierId;
    req.courierUserId = req.userId;

    touchLastActive(req.userId!, req.storeId!);

    logger.debug('PORTAL_AUTH', 'courier authorized', {
      user_id: req.userId,
      store_id: req.storeId,
      carrier_id: carrierId
    });

    next();
  } catch (err) {
    logger.error('PORTAL_AUTH', 'requireCourierRole unexpected error', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

/**
 * requireOrderInCourierScope
 *
 * Validates that `:orderId` in the route params belongs to the courier's
 * carrier_id and store_id. Caches the order on req.scopedOrder so the
 * handler can read it without a second DB hit.
 *
 * MUST be mounted AFTER requireCourierRole. Returns:
 *   400 if :orderId is missing or malformed
 *   404 if the order does not exist in this store
 *   403 if the order exists but is assigned to a different carrier
 *   500 on DB failure
 *
 * SECURITY: We separate 404 from 403 so the admin can reason about
 * misuse patterns from logs. The courier never sees the differentiating
 * payload (both are dead ends from the client's POV).
 */
export async function requireOrderInCourierScope(
  req: CourierRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const orderId = req.params.orderId || req.params.id;

  if (!orderId || !UUID_REGEX.test(orderId)) {
    res.status(400).json({ error: 'orderId invalido' });
    return;
  }

  if (!req.courierCarrierId || !req.storeId) {
    logger.error('PORTAL_AUTH', 'requireOrderInCourierScope without prior requireCourierRole', {
      order_id: orderId
    });
    res.status(500).json({ error: 'Error interno del servidor' });
    return;
  }

  try {
    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select('id, store_id, courier_id, sleeves_status, delivery_status, payment_method, delivered_at')
      .eq('id', orderId)
      .eq('store_id', req.storeId)
      .maybeSingle();

    if (error) {
      logger.error('PORTAL_AUTH', 'order scope lookup failed', {
        order_id: orderId,
        store_id: req.storeId,
        error: error.message
      });
      res.status(500).json({ error: 'Error interno del servidor' });
      return;
    }

    if (!order) {
      logger.warn('PORTAL_AUTH', 'order not found in store', {
        order_id: orderId,
        store_id: req.storeId,
        user_id: req.courierUserId
      });
      res.status(404).json({ error: 'Pedido no encontrado' });
      return;
    }

    if (order.courier_id !== req.courierCarrierId) {
      logger.security('PORTAL_AUTH', 'cross-carrier order access denied', {
        order_id: orderId,
        store_id: req.storeId,
        user_id: req.courierUserId,
        courier_carrier_id: req.courierCarrierId,
        order_carrier_id: order.courier_id
      });
      res.status(403).json({ error: 'Acceso denegado a este pedido' });
      return;
    }

    req.scopedOrder = order;
    next();
  } catch (err) {
    logger.error('PORTAL_AUTH', 'requireOrderInCourierScope unexpected error', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}
