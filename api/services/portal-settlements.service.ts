/**
 * Courier Portal · Settlements service
 *
 * Backend logic for the three "self-close" endpoints under
 * /api/portal/settlements/*. Sits between the route handler and
 * Supabase so the route stays declarative and the DB work is
 * idempotent + auditable.
 *
 * Trust model:
 *   Auto-paid. When a courier closes a settlement from the portal,
 *   the resulting daily_settlements row is stamped status='paid' and
 *   amount_paid = total_amount_collected. The attached bank-transfer
 *   screenshot is evidence, not a gate. Admin can still flip to
 *   `disputed` from the dashboard if fraud is detected.
 *
 * Concurrency:
 *   process_reconciliation_by_carrier (Migration 184) already takes a
 *   pg_advisory_xact_lock keyed on (store_id, carrier_id). Two
 *   couriers of the same carrier closing in parallel will serialize,
 *   and the loser's UPDATE writes 0 rows because reconciled_at became
 *   non-null mid-flight (the RPC throws "Some orders are already
 *   reconciled" in that case, which we surface as 409).
 *
 * Side effects on closeSettlement:
 *   - daily_settlements row stamped paid + courier audit columns.
 *   - settlement_payment_proofs row with file metadata.
 *   - Storage object at settlement-proofs/{store_id}/{settlement_id}/{uuid}.{ext}.
 *   - No webhook fired (the close itself is a courier-side action;
 *     downstream automation listens for the manual admin verification).
 *
 * What this service does NOT do:
 *   - It does not call /api/settlements/reconcile-by-carrier. It
 *     invokes the RPC directly with the courier's user id so the
 *     audit trail attributes the action correctly.
 *   - It does not validate `requireCourierRole`; that is the
 *     responsibility of the route layer.
 */

import { randomUUID } from 'crypto';
import * as path from 'path';
import { supabaseAdmin } from '../db/connection';
import { logger } from '../utils/logger';
import {
  PortalSettlementsError,
  PROOF_ALLOWED_MIME,
  PROOF_MAX_BYTES,
  PAYMENT_REFERENCE_MAX_LEN,
  NOTES_MAX_LEN,
  extensionFromMime,
  sanitizeText,
  validateCloseInput,
  validateProof,
  type CloseSettlementInput,
} from '../utils/portal-settlements-validators';

export {
  PortalSettlementsError,
  PROOF_ALLOWED_MIME,
  PROOF_MAX_BYTES,
} from '../utils/portal-settlements-validators';
export type { CloseSettlementInput } from '../utils/portal-settlements-validators';

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const STORAGE_BUCKET = 'settlement-proofs';
const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface PendingSettlementsResult {
  summary: {
    total_orders: number;
    total_cod_to_remit: number;
    total_prepaid_count: number;
    oldest_delivery_date: string | null;
    newest_delivery_date: string | null;
    days_oldest: number;
    failed_attempt_fee_percent: number;
  };
  orders: Array<{
    id: string;
    display_order_number: string;
    customer_name: string;
    customer_phone: string | null;
    customer_address: string | null;
    customer_city: string | null;
    total_price: number;
    cod_amount: number;
    payment_method: string | null;
    prepaid_method: string | null;
    is_cod: boolean;
    delivered_at: string | null;
  }>;
}

export interface SettlementHistoryItem {
  id: string;
  settlement_code: string;
  settlement_date: string | null;
  min_delivery_date: string | null;
  max_delivery_date: string | null;
  total_orders: number;
  total_delivered: number;
  total_not_delivered: number;
  total_cod_collected: number;
  total_carrier_fees: number;
  total_extra_charges: number;
  failed_attempt_fee: number;
  net_receivable: number;
  amount_paid: number;
  status: string;
  payment_method: string | null;
  payment_reference: string | null;
  submitted_by_courier_at: string | null;
  created_at: string | null;
  proofs: Array<{
    id: string;
    signed_url: string;
    mime_type: string;
    file_size_bytes: number;
    amount_claimed: number;
    payment_reference: string | null;
    payment_method: string | null;
    uploaded_at: string;
  }>;
}

export interface SettlementHistoryResult {
  settlements: SettlementHistoryItem[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    has_more: boolean;
  };
}

export interface CloseSettlementResult {
  success: true;
  settlement_id: string;
  settlement_code: string;
  status: string;
  proof_id: string;
  net_receivable: number;
  total_orders: number;
  total_delivered: number;
  total_cod_collected: number;
  total_carrier_fees: number;
}

// ----------------------------------------------------------------------------
// 1) GET pending
// ----------------------------------------------------------------------------

/**
 * Returns the courier's pending reconciliation backlog: a summary
 * (counts, dates, urgency) plus the detailed list of orders.
 *
 * Two DB roundtrips:
 *   - SELECT from v_pending_reconciliation_by_carrier (single row)
 *   - SELECT from get_pending_reconciliation_orders_by_carrier (list)
 *
 * Both are filtered server-side by (store_id, carrier_id) and the
 * carrier_id MUST come from the request's pinned courierCarrierId.
 */
export async function getPendingSettlements(
  storeId: string,
  carrierId: string
): Promise<PendingSettlementsResult> {
  const [summaryRes, ordersRes] = await Promise.all([
    supabaseAdmin
      .from('v_pending_reconciliation_by_carrier')
      .select(
        'total_orders, total_cod, total_prepaid, oldest_delivery_date, newest_delivery_date, days_oldest, failed_attempt_fee_percent'
      )
      .eq('store_id', storeId)
      .eq('carrier_id', carrierId)
      .maybeSingle(),
    supabaseAdmin.rpc('get_pending_reconciliation_orders_by_carrier', {
      p_store_id: storeId,
      p_carrier_id: carrierId,
    }),
  ]);

  if (summaryRes.error) {
    logger.error('PORTAL_SETTLEMENTS', 'pending summary query failed', {
      store_id: storeId,
      carrier_id: carrierId,
      error: summaryRes.error.message,
    });
    throw new PortalSettlementsError(
      'No se pudo cargar el resumen pendiente.',
      500,
      'PENDING_SUMMARY_FAILED'
    );
  }

  if (ordersRes.error) {
    logger.error('PORTAL_SETTLEMENTS', 'pending orders RPC failed', {
      store_id: storeId,
      carrier_id: carrierId,
      error: ordersRes.error.message,
    });
    throw new PortalSettlementsError(
      'No se pudo cargar los pedidos pendientes.',
      500,
      'PENDING_ORDERS_FAILED'
    );
  }

  const s = summaryRes.data;
  const orders = Array.isArray(ordersRes.data) ? ordersRes.data : [];

  return {
    summary: {
      total_orders: Number(s?.total_orders ?? 0),
      total_cod_to_remit: Number(s?.total_cod ?? 0),
      total_prepaid_count: Number(s?.total_prepaid ?? 0),
      oldest_delivery_date: (s?.oldest_delivery_date as string | null) ?? null,
      newest_delivery_date: (s?.newest_delivery_date as string | null) ?? null,
      days_oldest: Number(s?.days_oldest ?? 0),
      failed_attempt_fee_percent: Number(s?.failed_attempt_fee_percent ?? 50),
    },
    orders: orders.map((o: any) => ({
      id: String(o.id),
      display_order_number: String(o.display_order_number ?? ''),
      customer_name: String(o.customer_name ?? '').trim(),
      customer_phone: o.customer_phone ? String(o.customer_phone) : null,
      customer_address: o.customer_address ? String(o.customer_address) : null,
      customer_city: o.customer_city ? String(o.customer_city) : null,
      total_price: Number(o.total_price ?? 0),
      cod_amount: Number(o.cod_amount ?? 0),
      payment_method: o.payment_method ? String(o.payment_method) : null,
      prepaid_method: o.prepaid_method ? String(o.prepaid_method) : null,
      is_cod: !!o.is_cod,
      delivered_at: o.delivered_at ? String(o.delivered_at) : null,
    })),
  };
}

// ----------------------------------------------------------------------------
// 2) GET history
// ----------------------------------------------------------------------------

const HISTORY_DEFAULT_PAGE_SIZE = 20;
const HISTORY_MAX_PAGE_SIZE = 50;

export async function getSettlementsHistory(
  storeId: string,
  carrierId: string,
  page = 1,
  pageSize = HISTORY_DEFAULT_PAGE_SIZE
): Promise<SettlementHistoryResult> {
  const p = Math.max(1, Math.min(1000, Math.floor(page) || 1));
  const ps = Math.max(1, Math.min(HISTORY_MAX_PAGE_SIZE, Math.floor(pageSize) || HISTORY_DEFAULT_PAGE_SIZE));
  const from = (p - 1) * ps;
  const to = from + ps - 1;

  const { data, error, count } = await supabaseAdmin
    .from('daily_settlements')
    .select(
      `
      id,
      settlement_code,
      settlement_date,
      min_delivery_date,
      max_delivery_date,
      total_dispatched,
      total_delivered,
      total_not_delivered,
      total_cod_collected,
      total_carrier_fees,
      total_extra_charges,
      failed_attempt_fee,
      net_receivable,
      amount_paid,
      status,
      payment_method,
      payment_reference,
      submitted_by_courier_at,
      created_at,
      proofs:settlement_payment_proofs (
        id,
        storage_path,
        mime_type,
        file_size_bytes,
        amount_claimed,
        payment_reference,
        payment_method,
        created_at
      )
      `,
      { count: 'exact' }
    )
    .eq('store_id', storeId)
    .eq('carrier_id', carrierId)
    .order('settlement_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false, nullsFirst: false })
    .range(from, to);

  if (error) {
    logger.error('PORTAL_SETTLEMENTS', 'history query failed', {
      store_id: storeId,
      carrier_id: carrierId,
      error: error.message,
    });
    throw new PortalSettlementsError(
      'No se pudo cargar el historial de conciliaciones.',
      500,
      'HISTORY_FAILED'
    );
  }

  const rows = data ?? [];

  // Sign URLs for every proof in one batch where possible. The supabase-js
  // signing API doesn't expose a bulk variant, so we Promise.all instead.
  const allProofPaths: Array<{ rowIndex: number; proofIndex: number; path: string }> = [];
  rows.forEach((row: any, rowIndex: number) => {
    const proofs: any[] = Array.isArray(row.proofs) ? row.proofs : [];
    proofs.forEach((p: any, proofIndex: number) => {
      if (p?.storage_path) {
        allProofPaths.push({ rowIndex, proofIndex, path: p.storage_path });
      }
    });
  });

  const signedMap = new Map<string, string>();
  if (allProofPaths.length > 0) {
    const signed = await Promise.all(
      allProofPaths.map(({ path }) =>
        supabaseAdmin.storage
          .from(STORAGE_BUCKET)
          .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
          .then((r) => ({ path, url: r.data?.signedUrl ?? null, error: r.error }))
          .catch((err) => ({ path, url: null, error: err }))
      )
    );
    for (const { path, url, error: signErr } of signed) {
      if (signErr || !url) {
        logger.warn('PORTAL_SETTLEMENTS', 'sign URL failed (non-blocking)', {
          path,
          error: signErr instanceof Error ? signErr.message : String(signErr ?? 'unknown'),
        });
        continue;
      }
      signedMap.set(path, url);
    }
  }

  const settlements: SettlementHistoryItem[] = rows.map((row: any) => {
    const proofs: any[] = Array.isArray(row.proofs) ? row.proofs : [];
    return {
      id: String(row.id),
      settlement_code: String(row.settlement_code ?? ''),
      settlement_date: row.settlement_date ?? null,
      min_delivery_date: row.min_delivery_date ?? null,
      max_delivery_date: row.max_delivery_date ?? null,
      total_orders: Number(row.total_dispatched ?? 0),
      total_delivered: Number(row.total_delivered ?? 0),
      total_not_delivered: Number(row.total_not_delivered ?? 0),
      total_cod_collected: Number(row.total_cod_collected ?? 0),
      total_carrier_fees: Number(row.total_carrier_fees ?? 0),
      total_extra_charges: Number(row.total_extra_charges ?? 0),
      failed_attempt_fee: Number(row.failed_attempt_fee ?? 0),
      net_receivable: Number(row.net_receivable ?? 0),
      amount_paid: Number(row.amount_paid ?? 0),
      status: String(row.status ?? 'pending'),
      payment_method: row.payment_method ? String(row.payment_method) : null,
      payment_reference: row.payment_reference ? String(row.payment_reference) : null,
      submitted_by_courier_at: row.submitted_by_courier_at ?? null,
      created_at: row.created_at ?? null,
      proofs: proofs
        .map((p: any) => {
          const url = signedMap.get(p.storage_path);
          if (!url) return null;
          return {
            id: String(p.id),
            signed_url: url,
            mime_type: String(p.mime_type ?? ''),
            file_size_bytes: Number(p.file_size_bytes ?? 0),
            amount_claimed: Number(p.amount_claimed ?? 0),
            payment_reference: p.payment_reference ? String(p.payment_reference) : null,
            payment_method: p.payment_method ? String(p.payment_method) : null,
            uploaded_at: String(p.created_at ?? ''),
          };
        })
        .filter(Boolean) as SettlementHistoryItem['proofs'],
    };
  });

  const total = typeof count === 'number' ? count : settlements.length;
  return {
    settlements,
    pagination: {
      page: p,
      page_size: ps,
      total,
      has_more: from + settlements.length < total,
    },
  };
}

// ----------------------------------------------------------------------------
// 3) POST close
// ----------------------------------------------------------------------------

/**
 * Close a settlement on behalf of the authenticated courier.
 *
 * Steps (atomic from the courier's POV; not a single SQL transaction
 * because Supabase JS doesn't expose one across calls):
 *   1. Validate input (size, mime, UUIDs, payment method).
 *   2. Pre-flight that all requested orders are in scope, delivered,
 *      and not yet reconciled. The RPC also enforces this, but a
 *      pre-flight gives a precise 409 response shape.
 *   3. Call process_reconciliation_by_carrier RPC. Creates the
 *      daily_settlements row with status='pending' and stamps
 *      reconciled_at on each order in one xact.
 *   4. UPDATE daily_settlements row → status='paid', amount_paid,
 *      payment_date, payment_method, payment_reference,
 *      submitted_by_courier_*.
 *   5. Upload the file to settlement-proofs bucket.
 *   6. INSERT settlement_payment_proofs row.
 *
 * Compensation:
 *   - If step 5 fails after step 3-4 succeeded, we delete the file
 *     (best-effort) and roll the settlement to status='disputed' so
 *     admin sees something is off. The reconciled_at stamps on
 *     orders remain because flipping them back is unsafe (admin can
 *     handle this from the dashboard).
 *   - If step 6 fails after step 5, we delete the uploaded file and
 *     flip status='disputed' for the same reason.
 *
 * Returns the canonical close result the client renders.
 */
export async function closeSettlement(args: {
  storeId: string;
  carrierId: string;
  userId: string;
  input: CloseSettlementInput;
  file: { buffer: Buffer; mimetype: string; originalname?: string };
}): Promise<CloseSettlementResult> {
  const { storeId, carrierId, userId, input, file } = args;

  validateProof(file);
  validateCloseInput(input);

  const paymentReference = sanitizeText(input.payment_reference, PAYMENT_REFERENCE_MAX_LEN)!;
  const notes = sanitizeText(input.notes ?? null, NOTES_MAX_LEN);

  // ---- 2) Pre-flight scope check --------------------------------------
  // Quick existence + scope test before we burn time on the RPC. The
  // RPC re-validates, but a pre-flight surfaces ID mismatches cleanly.
  const { data: scopedRows, error: scopeErr } = await supabaseAdmin
    .from('orders')
    .select('id, sleeves_status, reconciled_at, courier_id')
    .eq('store_id', storeId)
    .in('id', input.order_ids);

  if (scopeErr) {
    logger.error('PORTAL_SETTLEMENTS', 'close: scope check failed', {
      store_id: storeId,
      carrier_id: carrierId,
      error: scopeErr.message,
    });
    throw new PortalSettlementsError(
      'No se pudo validar los pedidos seleccionados.',
      500,
      'SCOPE_CHECK_FAILED'
    );
  }

  const found = new Set<string>((scopedRows ?? []).map((o: any) => String(o.id)));
  const missing = input.order_ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new PortalSettlementsError(
      `${missing.length} pedido(s) no pertenecen a tu tienda o no existen.`,
      404,
      'ORDERS_NOT_FOUND'
    );
  }

  const wrongCarrier = (scopedRows ?? []).filter((o: any) => String(o.courier_id) !== carrierId);
  if (wrongCarrier.length > 0) {
    logger.security('PORTAL_SETTLEMENTS', 'close: cross-carrier attempt blocked', {
      user_id: userId,
      store_id: storeId,
      carrier_id: carrierId,
      order_ids: wrongCarrier.map((o: any) => o.id),
    });
    throw new PortalSettlementsError(
      'Algunos pedidos pertenecen a otra transportadora.',
      403,
      'CROSS_CARRIER_FORBIDDEN'
    );
  }

  const notDelivered = (scopedRows ?? []).filter(
    (o: any) => String(o.sleeves_status) !== 'delivered'
  );
  if (notDelivered.length > 0) {
    throw new PortalSettlementsError(
      `${notDelivered.length} pedido(s) no están entregados todavía.`,
      409,
      'ORDERS_NOT_DELIVERED'
    );
  }

  const alreadyReconciled = (scopedRows ?? []).filter((o: any) => o.reconciled_at !== null);
  if (alreadyReconciled.length > 0) {
    throw new PortalSettlementsError(
      `${alreadyReconciled.length} pedido(s) ya fueron conciliados.`,
      409,
      'ALREADY_RECONCILED'
    );
  }

  // ---- 3) RPC: process_reconciliation_by_carrier ----------------------
  const rpcOrders = input.order_ids.map((id) => ({ order_id: id, delivered: true }));

  const rpcRes = await supabaseAdmin.rpc('process_reconciliation_by_carrier', {
    p_store_id: storeId,
    p_user_id: userId,
    p_carrier_id: carrierId,
    p_total_amount_collected: input.total_amount_collected,
    p_discrepancy_notes: notes,
    p_orders: rpcOrders,
    p_extra_charges: [],
  });

  if (rpcRes.error) {
    const msg = rpcRes.error.message || '';
    logger.error('PORTAL_SETTLEMENTS', 'close: RPC failed', {
      user_id: userId,
      store_id: storeId,
      carrier_id: carrierId,
      error: msg,
    });
    if (/already reconciled/i.test(msg)) {
      throw new PortalSettlementsError(
        'Algunos pedidos ya fueron conciliados. Refrescá la lista.',
        409,
        'ALREADY_RECONCILED'
      );
    }
    if (/Carrier not found/i.test(msg)) {
      throw new PortalSettlementsError(
        'Transportadora no encontrada.',
        404,
        'CARRIER_NOT_FOUND'
      );
    }
    if (/No valid orders/i.test(msg)) {
      throw new PortalSettlementsError(
        'No hay pedidos válidos para conciliar.',
        400,
        'NO_VALID_ORDERS'
      );
    }
    throw new PortalSettlementsError(
      'No se pudo procesar la conciliación.',
      500,
      'RPC_FAILED'
    );
  }

  const rpcRow = Array.isArray(rpcRes.data) ? rpcRes.data[0] : rpcRes.data;
  if (!rpcRow || !rpcRow.settlement_id) {
    logger.error('PORTAL_SETTLEMENTS', 'close: RPC returned empty', {
      user_id: userId,
      store_id: storeId,
      carrier_id: carrierId,
    });
    throw new PortalSettlementsError(
      'No se pudo crear la conciliación.',
      500,
      'EMPTY_RPC_RESULT'
    );
  }

  const settlementId = String(rpcRow.settlement_id);
  const settlementCode = String(rpcRow.settlement_code ?? '');
  const netReceivable = Number(rpcRow.net_receivable ?? 0);

  // ---- 4) UPDATE daily_settlements → paid + courier audit -------------
  const { error: updErr } = await supabaseAdmin
    .from('daily_settlements')
    .update({
      status: 'paid',
      amount_paid: input.total_amount_collected,
      payment_date: new Date().toISOString().slice(0, 10),
      payment_method: input.payment_method,
      payment_reference: paymentReference,
      submitted_by_courier_at: new Date().toISOString(),
      submitted_by_courier_user_id: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', settlementId)
    .eq('store_id', storeId)
    .eq('carrier_id', carrierId);

  if (updErr) {
    logger.error('PORTAL_SETTLEMENTS', 'close: UPDATE settlement failed', {
      settlement_id: settlementId,
      user_id: userId,
      error: updErr.message,
    });
    // The settlement exists in pending state. We do not rollback because
    // reconciled_at stamps are non-trivial to undo. Surface as 500 so
    // admin can finish marking it paid manually.
    throw new PortalSettlementsError(
      'Conciliación creada pero no se pudo marcar como pagada. Contactá al admin.',
      500,
      'PAYMENT_UPDATE_FAILED'
    );
  }

  // ---- 5) Upload proof to Storage -------------------------------------
  const ext = extensionFromMime(file.mimetype) || path.extname(file.originalname || '').toLowerCase() || '.bin';
  const proofUuid = randomUUID();
  const storagePath = `${storeId}/${settlementId}/${proofUuid}${ext}`;

  const { error: uploadErr } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (uploadErr) {
    logger.error('PORTAL_SETTLEMENTS', 'close: storage upload failed', {
      settlement_id: settlementId,
      user_id: userId,
      error: uploadErr.message,
    });
    // Move settlement to disputed so admin notices.
    await supabaseAdmin
      .from('daily_settlements')
      .update({ status: 'disputed', updated_at: new Date().toISOString() })
      .eq('id', settlementId)
      .eq('store_id', storeId);
    throw new PortalSettlementsError(
      'No se pudo subir el comprobante. La conciliación quedó en disputa.',
      500,
      'PROOF_UPLOAD_FAILED'
    );
  }

  // ---- 6) INSERT settlement_payment_proofs ----------------------------
  const { data: proofRow, error: proofErr } = await supabaseAdmin
    .from('settlement_payment_proofs')
    .insert({
      settlement_id: settlementId,
      store_id: storeId,
      carrier_id: carrierId,
      uploaded_by: userId,
      storage_path: storagePath,
      mime_type: file.mimetype,
      file_size_bytes: file.buffer.length,
      payment_reference: paymentReference,
      payment_method: input.payment_method,
      amount_claimed: input.total_amount_collected,
      notes,
    })
    .select('id')
    .single();

  if (proofErr || !proofRow) {
    logger.error('PORTAL_SETTLEMENTS', 'close: proof insert failed', {
      settlement_id: settlementId,
      user_id: userId,
      error: proofErr?.message,
    });
    // Best-effort cleanup of orphan storage object.
    await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([storagePath]).catch(() => undefined);
    await supabaseAdmin
      .from('daily_settlements')
      .update({ status: 'disputed', updated_at: new Date().toISOString() })
      .eq('id', settlementId)
      .eq('store_id', storeId);
    throw new PortalSettlementsError(
      'No se pudo registrar el comprobante. La conciliación quedó en disputa.',
      500,
      'PROOF_INSERT_FAILED'
    );
  }

  return {
    success: true,
    settlement_id: settlementId,
    settlement_code: settlementCode,
    status: 'paid',
    proof_id: String(proofRow.id),
    net_receivable: netReceivable,
    total_orders: Number(rpcRow.total_orders ?? 0),
    total_delivered: Number(rpcRow.total_delivered ?? 0),
    total_cod_collected: Number(rpcRow.total_cod_collected ?? 0),
    total_carrier_fees: Number(rpcRow.total_carrier_fees ?? 0),
  };
}
