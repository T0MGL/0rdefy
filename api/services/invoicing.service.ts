/**
 * Invoicing Service (Orchestrator)
 *
 * Manages the full electronic invoicing lifecycle:
 * 1. Fiscal config setup (RUC, timbrado, certificate)
 * 2. Invoice generation (XML via xmlgen)
 * 3. XML signing (RSA-SHA256)
 * 4. SIFEN submission (or demo mock)
 * 5. Invoice storage and event logging
 */

import { logger } from '../utils/logger';
import { supabaseAdmin } from '../db/connection';
import { encrypt, decrypt } from './sifen/encryption';
import { signXML } from './sifen/xml-signer';
import * as sifenClient from './sifen/sifen-client';
import * as sifenDemo from './sifen/sifen-demo';
import type { SifenEnv, SifenResponse } from './sifen/sifen-client';

/**
 * Validate Paraguay RUC DV using Modulo 11 algorithm.
 */
function validateRucDV(ruc: string, dv: number): boolean {
  if (!ruc || !/^\d+$/.test(ruc)) return false;
  const baseMax = 11;
  let total = 0;
  let factor = 2;
  for (let i = ruc.length - 1; i >= 0; i--) {
    total += parseInt(ruc[i], 10) * factor;
    factor++;
    if (factor > baseMax) factor = 2;
  }
  const resto = total % 11;
  const expected = resto > 1 ? 11 - resto : 0;
  return expected === dv;
}

// xmlgen is dynamically imported since it's a CommonJS module
let xmlgen: any = null;
async function getXmlgen() {
  if (!xmlgen) {
    try {
      xmlgen = await import('facturacionelectronicapy-xmlgen');
      // Handle both default and named exports
      xmlgen = xmlgen.default || xmlgen;
    } catch (err: any) {
      logger.error('[Invoicing] Failed to load xmlgen:', err.message);
      throw new Error('facturacionelectronicapy-xmlgen package not available');
    }
  }
  return xmlgen;
}

// ================================================================
// Types
// ================================================================

export interface FiscalConfigInput {
  ruc: string;
  ruc_dv: number;
  razon_social: string;
  nombre_fantasia?: string;
  tipo_contribuyente: number;
  tipo_regimen?: number;
  timbrado: string;
  timbrado_fecha_inicio?: string;
  timbrado_fecha_fin?: string;
  establecimiento_codigo?: string;
  punto_expedicion?: string;
  establecimiento_direccion?: string;
  establecimiento_departamento?: number;
  establecimiento_distrito?: number;
  establecimiento_ciudad?: number;
  establecimiento_telefono?: string;
  establecimiento_email?: string;
  actividad_economica_codigo?: string;
  actividad_economica_descripcion?: string;
  sifen_environment?: SifenEnv;
}

export interface FiscalConfig extends FiscalConfigInput {
  id: string;
  store_id: string;
  certificate_data: any;
  certificate_password_encrypted: string | null;
  next_document_number: number;
  is_active: boolean;
  setup_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface InvoiceFilters {
  status?: string;
  tipo_documento?: number;
  from_date?: string;
  to_date?: string;
  limit?: number;
  offset?: number;
}

// ================================================================
// Fiscal Config Management
// ================================================================

/**
 * Get the fiscal config for a store. Masks sensitive fields.
 */
export async function getFiscalConfig(storeId: string) {
  const { data, error } = await supabaseAdmin
    .from('fiscal_config')
    .select('*')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .single();

  if (error || !data) return null;

  // Mask sensitive fields
  return {
    ...data,
    certificate_data: data.certificate_data ? '[ENCRYPTED]' : null,
    certificate_password_encrypted: data.certificate_password_encrypted ? '***' : null,
  };
}

/**
 * Create or update fiscal config for a store.
 */
export async function setupFiscalConfig(storeId: string, input: FiscalConfigInput) {
  // Validate RUC + DV (Modulo 11)
  if (!validateRucDV(input.ruc, input.ruc_dv)) {
    throw new Error('El dígito verificador (DV) no coincide con el RUC. Verifique el número.');
  }

  // Check if config already exists
  const { data: existing } = await supabaseAdmin
    .from('fiscal_config')
    .select('id')
    .eq('store_id', storeId)
    .single();

  const environment = input.sifen_environment || 'demo';

  const configData = {
    store_id: storeId,
    ruc: input.ruc,
    ruc_dv: input.ruc_dv,
    razon_social: input.razon_social,
    nombre_fantasia: input.nombre_fantasia || null,
    tipo_contribuyente: input.tipo_contribuyente,
    tipo_regimen: input.tipo_regimen || null,
    timbrado: input.timbrado,
    timbrado_fecha_inicio: input.timbrado_fecha_inicio || null,
    timbrado_fecha_fin: input.timbrado_fecha_fin || null,
    establecimiento_codigo: input.establecimiento_codigo || '001',
    punto_expedicion: input.punto_expedicion || '001',
    establecimiento_direccion: input.establecimiento_direccion || null,
    establecimiento_departamento: input.establecimiento_departamento || null,
    establecimiento_distrito: input.establecimiento_distrito || null,
    establecimiento_ciudad: input.establecimiento_ciudad || null,
    establecimiento_telefono: input.establecimiento_telefono || null,
    establecimiento_email: input.establecimiento_email || null,
    actividad_economica_codigo: input.actividad_economica_codigo || null,
    actividad_economica_descripcion: input.actividad_economica_descripcion || null,
    sifen_environment: environment,
    is_active: true,
    // In demo mode, setup is complete without certificate (cert only needed for signing in test/prod)
    // In test/prod, setup_completed is set to true when certificate is uploaded
    setup_completed: environment === 'demo',
  };

  if (existing) {
    const { data, error } = await supabaseAdmin
      .from('fiscal_config')
      .update(configData)
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw new Error(`Error updating fiscal config: ${error.message}`);
    return data;
  } else {
    const { data, error } = await supabaseAdmin
      .from('fiscal_config')
      .insert(configData)
      .select()
      .single();

    if (error) throw new Error(`Error creating fiscal config: ${error.message}`);
    return data;
  }
}

/**
 * Upload and encrypt a .p12 certificate.
 */
export async function uploadCertificate(storeId: string, certBuffer: Buffer, certPassword: string) {
  // Encrypt the password before storing
  const encryptedPassword = encrypt(certPassword);

  const { data, error } = await supabaseAdmin
    .from('fiscal_config')
    .update({
      certificate_data: certBuffer,
      certificate_password_encrypted: encryptedPassword,
      setup_completed: true,
    })
    .eq('store_id', storeId)
    .eq('is_active', true)
    .select('id, setup_completed')
    .single();

  if (error) throw new Error(`Error uploading certificate: ${error.message}`);
  return data;
}

/**
 * Validate the current fiscal config.
 */
export async function validateConfig(storeId: string) {
  // Try the RPC first (available after migration 125)
  const { data, error } = await supabaseAdmin
    .rpc('validate_fiscal_config', { p_store_id: storeId });

  if (!error) return data;

  // Fallback validation if RPC doesn't exist yet
  logger.warn('[Invoicing] validate_fiscal_config RPC not available, using fallback:', error.message);

  const config = await getFiscalConfig(storeId);
  if (!config) {
    return { valid: false, errors: ['No hay configuración fiscal activa'], warnings: [] };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!config.ruc) errors.push('RUC no configurado');
  if (!config.razon_social) errors.push('Razón social no configurada');
  if (!config.timbrado) errors.push('Timbrado no configurado');
  if (!config.tipo_contribuyente) errors.push('Tipo de contribuyente no configurado');

  if (config.sifen_environment !== 'demo') {
    if (config.certificate_data === null || config.certificate_data === '[ENCRYPTED]' === false) {
      // certificate_data is masked as '[ENCRYPTED]' when present
    }
    if (config.certificate_password_encrypted === null || config.certificate_password_encrypted === '***' === false) {
      // password is masked as '***' when present
    }
    // Since we're working with the masked version, check for non-demo requiring cert
    if (!config.certificate_data || config.certificate_data === null) {
      errors.push('Certificado digital requerido para ambiente ' + config.sifen_environment);
    }
  }

  if (!config.establecimiento_codigo) warnings.push('Código de establecimiento no configurado (usando 001)');
  if (!config.punto_expedicion) warnings.push('Punto de expedición no configurado (usando 001)');

  return { valid: errors.length === 0, errors, warnings };
}

// ================================================================
// Invoice Generation
// ================================================================

/**
 * Generate an invoice for a delivered order.
 * Full pipeline: validate → build XML → sign → send/mock → store.
 */
export async function generateInvoice(storeId: string, orderId: string) {
  logger.info(`[Invoicing] Generating invoice for order ${orderId} in store ${storeId}`);

  // 1. Get fiscal config
  const { data: config, error: configErr } = await supabaseAdmin
    .from('fiscal_config')
    .select('*')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .single();

  if (configErr || !config) {
    throw new Error('No active fiscal configuration found. Please complete setup first.');
  }

  // 2. Get order with line items and customer data
  const { data: order, error: orderErr } = await supabaseAdmin
    .from('orders')
    .select(`
      *,
      order_line_items(id, product_name, quantity, unit_price, sku),
      customers(name, email, address)
    `)
    .eq('id', orderId)
    .eq('store_id', storeId)
    .single();

  if (orderErr || !order) {
    throw new Error(`Order not found: ${orderId}`);
  }

  // 3. Validate customer has RUC
  if (!order.customer_ruc) {
    throw new Error('Customer RUC is required for invoicing. Order has no customer_ruc.');
  }

  // Check if invoice already exists for this order
  const { data: existingInvoice } = await supabaseAdmin
    .from('invoices')
    .select('id, cdc, sifen_status')
    .eq('order_id', orderId)
    .eq('store_id', storeId)
    .not('sifen_status', 'eq', 'cancelled')
    .single();

  if (existingInvoice) {
    throw new Error(`Invoice already exists for this order (CDC: ${existingInvoice.cdc || 'pending'})`);
  }

  // 4. Get next document number (atomic)
  const { data: docNumber, error: docErr } = await supabaseAdmin
    .rpc('get_next_invoice_number', { p_store_id: storeId });

  if (docErr || !docNumber) {
    throw new Error(`Failed to get next document number: ${docErr?.message}`);
  }

  // 5. Build parameters for xmlgen
  const isDemo = config.sifen_environment === 'demo';
  const lineItems = order.order_line_items || [];

  // Calculate IVA (Paraguay: 10% standard rate)
  const subtotal = lineItems.reduce((sum: number, item: any) => {
    return sum + (item.unit_price || 0) * (item.quantity || 1);
  }, 0);

  // All items at 10% IVA rate by default
  const iva10 = Math.round(subtotal / 11); // IVA included in price
  const total = subtotal;

  // Build xmlgen params
  const params = {
    version: 150,
    ruc: config.ruc,
    razonSocial: config.razon_social,
    nombreFantasia: config.nombre_fantasia || config.razon_social,
    tpiCDC: null as any, // Will be calculated by xmlgen
    tipoContribuyente: config.tipo_contribuyente,
    tipoRegimen: config.tipo_regimen || undefined,
    timbradoNumero: config.timbrado,
    timbradoFecha: config.timbrado_fecha_inicio || new Date().toISOString().split('T')[0],
    tipoDocumento: 1, // Factura electrónica
    establecimiento: config.establecimiento_codigo || '001',
    punto: config.punto_expedicion || '001',
    numero: String(docNumber).padStart(7, '0'),
    fecha: new Date().toISOString().split('T')[0],
    tipoEmision: 1, // Normal
    tipoTransaccion: 2, // Venta de mercaderías
    tipoImpuesto: 1, // IVA
    moneda: 'PYG',
    condicionAnticipo: undefined,
    condicionTipoCambio: undefined,
  };

  const data = {
    tipoDocumento: 1,
    establecimiento: params.establecimiento,
    punto: params.punto,
    numero: params.numero,
    fecha: params.fecha,
    tipoEmision: 1,
    tipoTransaccion: 2,
    tipoImpuesto: 1,
    moneda: 'PYG',
    cliente: {
      contribuyente: true,
      ruc: order.customer_ruc,
      dvRuc: order.customer_ruc_dv,
      tipoOperacion: 1, // B2B
      nombre: order.customer_name || order.customers?.name || 'Sin nombre',
      direccion: order.customer_address || order.customers?.address || order.address || '',
      email: order.customers?.email || '',
      pais: 'PRY',
      tipoContribuyente: 1,
    },
    factura: {
      presencia: 2, // Electrónica
    },
    condicion: {
      tipo: order.payment_method === 'cod' ? 1 : 2, // 1=Contado, 2=Crédito
      entregas: order.payment_method === 'cod' ? [{
        tipo: 1, // Efectivo
        monto: String(total),
        moneda: 'PYG',
      }] : undefined,
    },
    items: lineItems.map((item: any, index: number) => ({
      codigo: item.sku || String(index + 1),
      descripcion: item.product_name || 'Producto',
      observacion: '',
      unidadMedida: 77, // Unidad
      cantidad: item.quantity || 1,
      precioUnitario: item.unit_price || 0,
      cambio: 0,
      descuento: 0,
      anticipo: 0,
      ppiGravado: 10, // 10% IVA
      tipoIvaPorItem: 1, // Gravado IVA
      propina: 0,
    })),
  };

  // 6. Generate XML
  let xmlGenerated: string;
  let cdc: string | undefined;

  try {
    const xmlgenLib = await getXmlgen();
    // xmlgen.generateXMLDE returns an object with xml and CDC
    const result = xmlgenLib.generateXMLDE(params, data);
    xmlGenerated = typeof result === 'string' ? result : result.xml || result;

    // Extract CDC from generated XML
    const cdcMatch = xmlGenerated.match(/<Id>([0-9]{44})<\/Id>/);
    cdc = cdcMatch ? cdcMatch[1] : undefined;
  } catch (err: any) {
    logger.error(`[Invoicing] XML generation failed:`, err.message);
    // Log the error event
    await logInvoiceEvent(storeId, null, 'error', { phase: 'xml_generation', error: err.message });
    throw new Error(`XML generation failed: ${err.message}`);
  }

  // 7. Create invoice record
  const { data: invoice, error: invoiceErr } = await supabaseAdmin
    .from('invoices')
    .insert({
      store_id: storeId,
      order_id: orderId,
      cdc,
      document_number: docNumber,
      tipo_documento: 1,
      customer_ruc: order.customer_ruc,
      customer_ruc_dv: order.customer_ruc_dv,
      customer_name: order.customer_name || order.customers?.name || null,
      customer_email: order.customers?.email || null,
      customer_address: order.address || order.customers?.address || null,
      subtotal,
      iva_5: 0,
      iva_10: iva10,
      iva_exento: 0,
      total,
      currency: 'PYG',
      sifen_status: isDemo ? 'demo' : 'pending',
      xml_generated: xmlGenerated,
    })
    .select()
    .single();

  if (invoiceErr || !invoice) {
    throw new Error(`Failed to create invoice record: ${invoiceErr?.message}`);
  }

  await logInvoiceEvent(storeId, invoice.id, 'generated', {
    document_number: docNumber,
    cdc,
    environment: config.sifen_environment,
  });

  // 8. Handle by environment
  let sifenResponse: SifenResponse;

  if (isDemo) {
    // Demo mode: mock response, no SIFEN call
    sifenResponse = sifenDemo.mockSendDE(String(docNumber), cdc || '');

    await supabaseAdmin
      .from('invoices')
      .update({
        sifen_status: 'demo',
        sifen_response_code: sifenResponse.responseCode,
        sifen_response_message: sifenResponse.responseMessage,
      })
      .eq('id', invoice.id);

    await logInvoiceEvent(storeId, invoice.id, 'approved', {
      mode: 'demo',
      response: sifenResponse,
    });
  } else {
    // Test/Prod: sign XML → send to SIFEN
    try {
      // Validate certificate exists before attempting to sign
      if (!config.certificate_password_encrypted || !config.certificate_data) {
        throw new Error('Certificado digital no configurado. Suba un certificado .p12 en la configuración fiscal.');
      }

      // Decrypt certificate password
      const certPassword = decrypt(config.certificate_password_encrypted);
      // Supabase returns BYTEA as hex string prefixed with \x
      const certHex = typeof config.certificate_data === 'string'
        ? config.certificate_data.replace(/^\\x/, '')
        : config.certificate_data;
      const certBuffer = typeof certHex === 'string'
        ? Buffer.from(certHex, 'hex')
        : Buffer.from(config.certificate_data);

      // Sign XML
      const xmlSigned = await signXML(xmlGenerated, certBuffer, certPassword);

      await supabaseAdmin
        .from('invoices')
        .update({ xml_signed: xmlSigned })
        .eq('id', invoice.id);

      await logInvoiceEvent(storeId, invoice.id, 'signed', { cdc });

      // Send to SIFEN
      sifenResponse = await sifenClient.sendDE(
        String(docNumber),
        xmlSigned,
        config.sifen_environment as Exclude<SifenEnv, 'demo'>
      );

      const newStatus = sifenResponse.success ? 'approved' : 'rejected';

      await supabaseAdmin
        .from('invoices')
        .update({
          xml_signed: xmlSigned,
          sifen_status: newStatus,
          sifen_response_code: sifenResponse.responseCode,
          sifen_response_message: sifenResponse.responseMessage,
          sent_to_sifen_at: new Date().toISOString(),
          ...(sifenResponse.success && { approved_at: new Date().toISOString() }),
        })
        .eq('id', invoice.id);

      await logInvoiceEvent(storeId, invoice.id, sifenResponse.success ? 'approved' : 'rejected', {
        response_code: sifenResponse.responseCode,
        response_message: sifenResponse.responseMessage,
      });
    } catch (err: any) {
      logger.error(`[Invoicing] SIFEN send failed:`, err.message);

      await supabaseAdmin
        .from('invoices')
        .update({
          sifen_status: 'rejected',
          sifen_response_message: err.message,
        })
        .eq('id', invoice.id);

      await logInvoiceEvent(storeId, invoice.id, 'error', {
        phase: 'sifen_send',
        error: err.message,
      });

      sifenResponse = {
        success: false,
        responseCode: 'SEND_ERROR',
        responseMessage: err.message,
      };
    }
  }

  // 9. Link invoice to order
  await supabaseAdmin
    .from('orders')
    .update({ invoice_id: invoice.id })
    .eq('id', orderId)
    .eq('store_id', storeId);

  logger.info(`[Invoicing] Invoice ${invoice.id} created for order ${orderId} (status: ${isDemo ? 'demo' : sifenResponse.success ? 'approved' : 'rejected'})`);

  return {
    invoice_id: invoice.id,
    cdc,
    document_number: docNumber,
    status: isDemo ? 'demo' : sifenResponse.success ? 'approved' : 'rejected',
    response: sifenResponse,
  };
}

// ================================================================
// Invoice Queries
// ================================================================

/**
 * Get a single invoice with its events.
 */
export async function getInvoice(storeId: string, invoiceId: string) {
  const { data: invoice, error } = await supabaseAdmin
    .from('invoices')
    .select('id, cdc, document_number, tipo_documento, customer_ruc, customer_ruc_dv, customer_name, customer_email, customer_address, subtotal, iva_5, iva_10, iva_exento, total, currency, sifen_status, sifen_response_code, sifen_response_message, kude_url, sent_to_sifen_at, approved_at, created_at, updated_at, order_id')
    .eq('id', invoiceId)
    .eq('store_id', storeId)
    .single();

  if (error || !invoice) return null;

  const { data: events } = await supabaseAdmin
    .from('invoice_events')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: true });

  return { ...invoice, events: events || [] };
}

/**
 * List invoices with filters and pagination.
 */
export async function getInvoices(storeId: string, filters: InvoiceFilters = {}) {
  const { status, tipo_documento, from_date, to_date, limit = 50, offset = 0 } = filters;

  let query = supabaseAdmin
    .from('invoices')
    .select('id, cdc, document_number, tipo_documento, customer_ruc, customer_name, total, sifen_status, created_at, order_id', { count: 'exact' })
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('sifen_status', status);
  if (tipo_documento) query = query.eq('tipo_documento', tipo_documento);
  if (from_date) query = query.gte('created_at', from_date);
  if (to_date) query = query.lte('created_at', to_date);

  const { data, error, count } = await query;

  if (error) throw new Error(`Error fetching invoices: ${error.message}`);

  return {
    invoices: data || [],
    total: count || 0,
    limit,
    offset,
  };
}

/**
 * Get invoice statistics for a store.
 */
export async function getInvoiceStats(storeId: string) {
  // Use the v_invoice_summary view for efficient aggregation (no full table scan)
  const { data, error } = await supabaseAdmin
    .from('v_invoice_summary')
    .select('*')
    .eq('store_id', storeId)
    .maybeSingle();

  if (error) {
    // Fallback to manual count if view doesn't exist yet
    logger.warn('[Invoicing] v_invoice_summary view error, using fallback:', error.message);
    const { count } = await supabaseAdmin
      .from('invoices')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', storeId);

    return {
      total: count || 0,
      approved: 0,
      rejected: 0,
      pending: 0,
      demo: 0,
      cancelled: 0,
      total_facturado: 0,
    };
  }

  if (!data) {
    return { total: 0, approved: 0, rejected: 0, pending: 0, demo: 0, cancelled: 0, total_facturado: 0 };
  }

  return {
    total: Number(data.total_invoices) || 0,
    approved: Number(data.approved) || 0,
    rejected: Number(data.rejected) || 0,
    pending: Number(data.pending) || 0,
    demo: Number(data.demo) || 0,
    cancelled: Number(data.cancelled) || 0,
    total_facturado: Number(data.total_facturado) || 0,
  };
}

// ================================================================
// Invoice Actions
// ================================================================

/**
 * Cancel an invoice via SIFEN event.
 */
export async function cancelInvoice(storeId: string, invoiceId: string, motivo: string) {
  const { data: invoice, error } = await supabaseAdmin
    .from('invoices')
    .select('id, cdc, sifen_status, order_id')
    .eq('id', invoiceId)
    .eq('store_id', storeId)
    .single();

  if (error || !invoice) throw new Error('Invoice not found');
  if (invoice.sifen_status === 'cancelled') throw new Error('Invoice is already cancelled');
  if (!invoice.cdc) throw new Error('Invoice has no CDC');

  // Separate query for fiscal config (avoids fragile join syntax)
  const { data: config } = await supabaseAdmin
    .from('fiscal_config')
    .select('sifen_environment, certificate_data, certificate_password_encrypted')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .maybeSingle();

  const isDemo = !config || config.sifen_environment === 'demo';

  if (isDemo) {
    // Demo mode: just update status
    await supabaseAdmin
      .from('invoices')
      .update({ sifen_status: 'cancelled' })
      .eq('id', invoiceId);

    await logInvoiceEvent(storeId, invoiceId, 'cancelled', { mode: 'demo', motivo });
  } else {
    // Real cancellation event to SIFEN (escape motivo to prevent XML injection)
    const escapedMotivo = motivo
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      .substring(0, 500); // Limit length for SIFEN
    const cancelXml = `<gCamEven><mOtEve>${escapedMotivo}</mOtEve></gCamEven>`;
    const response = await sifenClient.sendEvent(
      invoice.cdc,
      2, // Event type 2 = Cancellation
      cancelXml,
      config.sifen_environment
    );

    await supabaseAdmin
      .from('invoices')
      .update({
        sifen_status: response.success ? 'cancelled' : invoice.sifen_status,
        sifen_response_code: response.responseCode,
        sifen_response_message: response.responseMessage,
      })
      .eq('id', invoiceId);

    await logInvoiceEvent(storeId, invoiceId, response.success ? 'cancelled' : 'error', {
      motivo,
      response_code: response.responseCode,
      response_message: response.responseMessage,
    });

    if (!response.success) {
      throw new Error(`SIFEN cancellation failed: ${response.responseMessage}`);
    }
  }

  // Unlink invoice from order
  if (invoice.order_id) {
    await supabaseAdmin
      .from('orders')
      .update({ invoice_id: null })
      .eq('id', invoice.order_id)
      .eq('store_id', storeId);
  }

  return { success: true, message: 'Invoice cancelled' };
}

/**
 * Retry sending a failed invoice to SIFEN.
 */
export async function retryInvoice(storeId: string, invoiceId: string) {
  const { data: invoice, error } = await supabaseAdmin
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .eq('store_id', storeId)
    .single();

  if (error || !invoice) throw new Error('Invoice not found');
  if (invoice.sifen_status !== 'rejected') {
    throw new Error('Only rejected invoices can be retried');
  }

  // Get config
  const { data: config } = await supabaseAdmin
    .from('fiscal_config')
    .select('*')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .single();

  if (!config) throw new Error('No active fiscal config');
  if (config.sifen_environment === 'demo') {
    throw new Error('Cannot retry in demo mode');
  }

  const xmlToSend = invoice.xml_signed || invoice.xml_generated;
  if (!xmlToSend) throw new Error('No XML available for retry');

  // If we have unsigned XML, sign it first
  let xmlSigned = invoice.xml_signed;
  if (!xmlSigned && invoice.xml_generated) {
    if (!config.certificate_password_encrypted || !config.certificate_data) {
      throw new Error('Certificado digital no configurado para re-firmar.');
    }
    const certPassword = decrypt(config.certificate_password_encrypted);
    const certHex = typeof config.certificate_data === 'string'
      ? config.certificate_data.replace(/^\\x/, '')
      : config.certificate_data;
    const certBuffer = typeof certHex === 'string'
      ? Buffer.from(certHex, 'hex')
      : Buffer.from(config.certificate_data);
    xmlSigned = await signXML(invoice.xml_generated, certBuffer, certPassword);

    await supabaseAdmin
      .from('invoices')
      .update({ xml_signed: xmlSigned })
      .eq('id', invoiceId);
  }

  // Retry sending
  const response = await sifenClient.sendDE(
    String(invoice.document_number),
    xmlSigned!,
    config.sifen_environment as Exclude<SifenEnv, 'demo'>
  );

  const newStatus = response.success ? 'approved' : 'rejected';

  await supabaseAdmin
    .from('invoices')
    .update({
      sifen_status: newStatus,
      sifen_response_code: response.responseCode,
      sifen_response_message: response.responseMessage,
      sent_to_sifen_at: new Date().toISOString(),
      ...(response.success && { approved_at: new Date().toISOString() }),
    })
    .eq('id', invoiceId);

  await logInvoiceEvent(storeId, invoiceId, response.success ? 'approved' : 'rejected', {
    retry: true,
    response_code: response.responseCode,
    response_message: response.responseMessage,
  });

  return {
    success: response.success,
    status: newStatus,
    response,
  };
}

/**
 * Download invoice XML.
 */
export async function downloadXML(storeId: string, invoiceId: string) {
  const { data, error } = await supabaseAdmin
    .from('invoices')
    .select('xml_signed, xml_generated, cdc, document_number')
    .eq('id', invoiceId)
    .eq('store_id', storeId)
    .single();

  if (error || !data) throw new Error('Invoice not found');

  return {
    xml: data.xml_signed || data.xml_generated,
    filename: `DTE-${data.cdc || data.document_number}.xml`,
  };
}

// ================================================================
// Helper: Event Logging
// ================================================================

async function logInvoiceEvent(
  storeId: string,
  invoiceId: string | null,
  eventType: string,
  details: Record<string, any>,
  createdBy?: string
) {
  if (!invoiceId) return;

  await supabaseAdmin
    .from('invoice_events')
    .insert({
      invoice_id: invoiceId,
      store_id: storeId,
      event_type: eventType,
      details,
      created_by: createdBy || null,
    })
    .then(({ error }) => {
      if (error) logger.error(`[Invoicing] Failed to log event:`, error.message);
    });
}
