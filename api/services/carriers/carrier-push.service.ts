/**
 * Carrier push: send an order to the merchant's connected carrier when it
 * reaches the status the merchant configured.
 *
 * Called fire-and-forget from the order status transition points. It must never
 * throw into those handlers: a failed external push leaves the order in its
 * correct local state and records carrier_push_status='failed' for the retry
 * worker to pick up.
 *
 * Idempotency is layered because CreatePaqueteV2 has no cancel:
 *   1. claim_carrier_push() RPC: advisory lock per order + existing-external-id
 *      check. Only the single claimant proceeds to call the API.
 *   2. findExistingByReference() against the carrier before the write, in case
 *      a previous attempt created the package but the DB write was lost.
 */

import * as Sentry from '@sentry/node';
import { supabaseAdmin } from '../../db/connection';
import { logger } from '../../utils/logger';
import { getCarrier } from './carrier-adapter';
import { loadCredentials } from './credentials.service';
import './registry';
import type { CarrierOrderInput } from './carrier-adapter';

const log = logger.child('Carrier:Push');

interface IntegrationConfig {
  provider: string;
  autoPush: boolean;
  triggerStatus: string;
}

async function loadActiveIntegration(storeId: string): Promise<IntegrationConfig | null> {
  const { data, error } = await supabaseAdmin
    .from('shipping_integrations')
    .select('provider, auto_push, trigger_status, is_active')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .not('provider', 'is', null)
    .maybeSingle();

  if (error || !data || !data.provider) return null;
  return {
    provider: data.provider,
    autoPush: data.auto_push ?? false,
    triggerStatus: data.trigger_status ?? 'ready_to_ship',
  };
}

interface OrderRow {
  id: string;
  order_number: string | null;
  shopify_order_name: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_ruc: string | null;
  customer_address: string | null;
  shipping_city: string | null;
  shipping_city_normalized: string | null;
  delivery_zone: string | null;
  cod_amount: number | string | null;
}

async function loadOrder(storeId: string, orderId: string): Promise<OrderRow | null> {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select(
      'id, order_number, shopify_order_name, customer_name, customer_phone, customer_ruc, customer_address, shipping_city, shipping_city_normalized, delivery_zone, cod_amount',
    )
    .eq('id', orderId)
    .eq('store_id', storeId)
    .is('deleted_at', null)
    .single();

  if (error || !data) return null;
  return data as OrderRow;
}

function toCarrierInput(storeId: string, order: OrderRow): CarrierOrderInput {
  const reference = order.order_number || order.shopify_order_name || order.id;
  const codRaw = order.cod_amount;
  const cod = typeof codRaw === 'string' ? Number(codRaw) : (codRaw ?? 0);

  return {
    storeId,
    orderNumber: reference,
    customerName: order.customer_name ?? 'Cliente',
    customerPhone: order.customer_phone,
    customerDocument: order.customer_ruc,
    address: order.customer_address,
    city: order.shipping_city_normalized || order.shipping_city,
    department: order.delivery_zone,
    description: `Pedido ${reference}`,
    codAmount: Number.isFinite(cod) ? cod : 0,
  };
}

/**
 * Main entrypoint. storeId/orderId/newStatus come from the transition handlers.
 * Returns silently when nothing should happen (no integration, auto_push off,
 * status mismatch, already sent). Never throws.
 */
export async function pushOrderToCarrier(
  storeId: string,
  orderId: string,
  newStatus: string,
): Promise<void> {
  // Set once claim_carrier_push hands back the row it reserved. The recorders
  // anchor on this id; before the claim there is no row to update, so a failure
  // raised earlier (no integration loaded, etc.) records nothing.
  let shipmentId: string | null = null;
  try {
    const integration = await loadActiveIntegration(storeId);
    if (!integration || !integration.autoPush) return;
    if (newStatus !== integration.triggerStatus) return;

    const entry = getCarrier(integration.provider);
    if (!entry) {
      log.warn('active integration references unknown provider', {
        storeId,
        provider: integration.provider,
      });
      return;
    }

    const { data: claimRows, error: claimError } = await supabaseAdmin.rpc('claim_carrier_push', {
      p_store_id: storeId,
      p_order_id: orderId,
      p_provider: integration.provider,
    });

    if (claimError) {
      log.error('claim_carrier_push failed', { storeId, orderId, error: claimError.message });
      return;
    }

    // claim_carrier_push returns a set: ('claimed', <id>) or ('already_sent', null).
    const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
    if (!claim || claim.status !== 'claimed' || !claim.shipment_id) {
      // 'already_sent': another transition or a prior push already dispatched.
      return;
    }
    const claimedId: string = claim.shipment_id;
    shipmentId = claimedId;

    const creds = await loadCredentials(storeId, integration.provider);
    if (!creds) {
      await recordFailure(claimedId, storeId, orderId, 'Credenciales no disponibles');
      return;
    }

    const order = await loadOrder(storeId, orderId);
    if (!order) {
      await recordFailure(claimedId, storeId, orderId, 'Pedido no encontrado');
      return;
    }

    const input = toCarrierInput(storeId, order);

    // Secondary guard against the no-cancel risk: if a prior attempt created
    // the package at the carrier but lost the DB write, adopt that result
    // instead of dispatching a duplicate.
    const existing = await entry.adapter.findExistingByReference(creds, input.orderNumber).catch((err) => {
      log.warn('findExistingByReference failed, proceeding to create', {
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    });

    const result = existing ?? (await entry.adapter.createShipment(creds, input));

    const { error: recordError } = await supabaseAdmin.rpc('record_carrier_push_result', {
      p_shipment_id: claimedId,
      p_external_id: result.externalId,
      p_nro_guia: result.nroGuia,
    });

    if (recordError) {
      // The package exists at the carrier but we failed to persist it. Log
      // loudly: the retry worker would otherwise re-dispatch. The external id
      // is the recovery anchor.
      log.error('record_carrier_push_result failed after dispatch', {
        storeId,
        orderId,
        externalId: result.externalId,
        error: recordError.message,
      });
      return;
    }

    log.info('order pushed to carrier', {
      storeId,
      orderId,
      provider: integration.provider,
      externalId: result.externalId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('pushOrderToCarrier failed', { storeId, orderId, error: message });
    // shipmentId is null only when the throw happened before the claim, i.e.
    // before any row was reserved. There is nothing to mark failed in that case.
    if (shipmentId) {
      await recordFailure(shipmentId, storeId, orderId, message);
    }
  }
}

// Retries past this count are abandoned by the sweep worker (same MAX_ATTEMPTS).
// We surface the crossing here so an exhausted push is never silent.
const MAX_PUSH_ATTEMPTS = 8;

async function recordFailure(
  shipmentId: string,
  storeId: string,
  orderId: string,
  error: string,
): Promise<void> {
  const { error: rpcError } = await supabaseAdmin.rpc('record_carrier_push_failure', {
    p_shipment_id: shipmentId,
    p_error: error,
  });
  if (rpcError) {
    log.error('record_carrier_push_failure failed', { storeId, orderId, shipmentId, error: rpcError.message });
    return;
  }

  // Read back the attempt count so an exhausted push (>= MAX) is escalated
  // operationally instead of dying silent at carrier_push_status='failed'.
  const { data: row, error: readError } = await supabaseAdmin
    .from('shipments')
    .select('carrier_push_attempts')
    .eq('id', shipmentId)
    .maybeSingle();

  if (readError || !row) return;

  const attempts = row.carrier_push_attempts ?? 0;
  if (attempts >= MAX_PUSH_ATTEMPTS) {
    const exhausted = new Error(
      `Carrier push exhausted after ${attempts} attempts: ${error}`,
    );
    log.error('carrier push exhausted, no further retries', {
      storeId,
      orderId,
      shipmentId,
      attempts,
      lastError: error,
    });
    Sentry.captureException(exhausted, {
      tags: { area: 'carrier_push', outcome: 'exhausted' },
      extra: { storeId, orderId, shipmentId, attempts, lastError: error },
    });
  }
}
