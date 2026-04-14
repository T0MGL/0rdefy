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
import { signXML, extractPemsFromP12 } from './sifen/xml-signer';
import * as sifenClient from './sifen/sifen-client';
import * as sifenDemo from './sifen/sifen-demo';
import type { SifenEnv, SifenResponse, SifenMtls } from './sifen/sifen-client';
import { injectQR, SIFEN_TEST_ID_CSC, SIFEN_TEST_CSC } from './sifen/qr-generator';
import { sendInvoiceEmail } from './email.service';

// ================================================================
// SIFEN KUDE URL
// Public consultation URL for an approved DTE on DNIT's portal.
// Format is the same for test and prod environments.
// ================================================================
function buildKudeUrl(cdc: string): string {
  return `https://ekuatia.set.gov.py/consultas/qr?nVersion=150&Id=${cdc}`;
}

/**
 * Fire-and-forget: send the invoice email to the customer.
 * Never throws. Logs errors and continues.
 */
async function dispatchInvoiceEmail(params: {
  invoiceId: string;
  storeId: string;
  storeName: string;
  customerEmail: string | null | undefined;
  customerName: string | null | undefined;
  documentNumber: number;
  invoiceDate: string;
  lineItems: Array<{ product_name: string | null; quantity: number; unit_price: number }>;
  subtotal: number;
  iva10: number;
  total: number;
  kudeUrl: string | null;
  isDemo: boolean;
}): Promise<void> {
  if (!params.customerEmail) {
    logger.info(`[Invoicing] No customer email for invoice ${params.invoiceId}, skipping email`);
    return;
  }

  const formatPyg = (amount: number) =>
    new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG', maximumFractionDigits: 0 }).format(amount);

  const invoiceDate = new Date(params.invoiceDate).toLocaleDateString('es-PY', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  try {
    await sendInvoiceEmail(
      params.customerEmail,
      {
        customerName: params.customerName || 'Cliente',
        storeName: params.storeName,
        documentNumber: String(params.documentNumber),
        invoiceDate,
        items: params.lineItems.map((item) => ({
          name: item.product_name || 'Producto',
          quantity: item.quantity || 1,
          unitPrice: formatPyg(item.unit_price || 0),
        })),
        subtotal: formatPyg(params.subtotal),
        iva10: formatPyg(params.iva10),
        total: formatPyg(params.total),
        kudeUrl: params.kudeUrl,
        isDemo: params.isDemo,
      },
      params.storeName
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error(`[Invoicing] Invoice email failed for invoice ${params.invoiceId}: ${message}`);
  }
}

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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      logger.error(`[Invoicing] Failed to load xmlgen: ${message}`);
      throw new Error('facturacionelectronicapy-xmlgen package not available');
    }
  }
  return xmlgen;
}

// ================================================================
// xmlgen param builders
// ================================================================

// Asunción geo codes from SIFEN's master categories.
// These are sane defaults when the store has not configured its own address.
const ASUNCION_DEFAULTS = {
  departamento: 1, // Capital
  distrito: 1, // Asunción
  ciudad: 1, // Asunción (distrito)
  departamentoDescripcion: 'CAPITAL',
  distritoDescripcion: 'ASUNCION (DISTRITO)',
  ciudadDescripcion: 'ASUNCION (DISTRITO)',
};

/**
 * Random 9-digit security code (dCodSeg). xmlgen embeds this into the CDC.
 * Must be a STRING in xmlgen's shape.
 */
function generateCodigoSeguridad(): string {
  return String(Math.floor(100_000_000 + Math.random() * 899_999_999));
}

/**
 * Build the xmlgen `params` object from the store's fiscal config.
 *
 * xmlgen v1.0.280 expects (verified against its source in
 * node_modules/facturacionelectronicapy-xmlgen/dist/services/):
 *   - ruc: full "RUC-DV" string (e.g. "80167845-5")
 *   - timbradoNumero: string, 8 digits
 *   - establecimientos: array (not string establecimiento)
 *   - actividadesEconomicas: array
 */
function buildXmlgenParams(config: any, opts?: { tipoRegimenFallback?: number }) {
  const codigo = config.establecimiento_codigo || '001';
  return {
    version: 150,
    ruc: `${config.ruc}-${config.ruc_dv}`,
    razonSocial: config.razon_social,
    nombreFantasia: config.nombre_fantasia || config.razon_social,
    timbradoNumero: config.timbrado,
    timbradoFecha:
      (config.timbrado_fecha_inicio || new Date().toISOString().split('T')[0]) + 'T00:00:00',
    tipoContribuyente: config.tipo_contribuyente,
    tipoRegimen: config.tipo_regimen ?? opts?.tipoRegimenFallback ?? 8, // 8 = Régimen general
    establecimientos: [
      {
        codigo,
        direccion: config.establecimiento_direccion || 'Asunción',
        numeroCasa: '0',
        complementoDireccion1: '',
        complementoDireccion2: '',
        departamento: config.establecimiento_departamento ?? ASUNCION_DEFAULTS.departamento,
        departamentoDescripcion: ASUNCION_DEFAULTS.departamentoDescripcion,
        distrito: config.establecimiento_distrito ?? ASUNCION_DEFAULTS.distrito,
        distritoDescripcion: ASUNCION_DEFAULTS.distritoDescripcion,
        ciudad: config.establecimiento_ciudad ?? ASUNCION_DEFAULTS.ciudad,
        ciudadDescripcion: ASUNCION_DEFAULTS.ciudadDescripcion,
        telefono: config.establecimiento_telefono || '021000000',
        // SIFEN schema requires dEmailE BEFORE dDenSuc. If the fiscal
        // config has no email, default to a placeholder derived from the
        // fantasy name so xmlgen emits the element in the right order.
        email:
          config.establecimiento_email ||
          `facturacion@${(config.nombre_fantasia || 'empresa').toLowerCase().replace(/\s+/g, '')}.com.py`,
        denominacion: config.nombre_fantasia || 'Casa Central',
      },
    ],
    actividadesEconomicas: [
      {
        codigo: config.actividad_economica_codigo || '47114',
        descripcion:
          config.actividad_economica_descripcion ||
          'Venta al por menor de productos en tiendas no especializadas',
      },
    ],
  };
}

/**
 * Build the signer-identity block (data.usuario) that xmlgen expects.
 * These values identify the natural person responsible for emitting the DE
 * (required by MT-SIFEN-010 section D100 when generating B2C/B2B invoices).
 *
 * Default to the store's legal representative; callers with collaborator-
 * level invoicing should thread their own values through here.
 */
function buildUsuarioBlock() {
  return {
    documentoTipo: 1, // Cédula
    documentoNumero: '5712264',
    nombre: 'ROGER GASTON LOPEZ ALFONSO',
    cargo: 'REPRESENTANTE LEGAL',
  };
}

/**
 * Sign, inject QR, and send a DE to SIFEN. Thin orchestrator for the
 * generate{Invoice,ManualInvoice} flows.
 */
async function signInjectSend(params: {
  xmlGenerated: string;
  docNumber: number;
  config: any;
}): Promise<{ xmlSigned: string; xmlFinal: string; sifen: SifenResponse }> {
  if (!params.config.encrypted_private_key || !params.config.cert_pem) {
    throw new Error(
      'Certificado digital no configurado. Suba un certificado .p12 en la configuración fiscal.',
    );
  }

  const env = params.config.sifen_environment as 'test' | 'prod';
  const privateKeyPem = decrypt(params.config.encrypted_private_key);
  const certPem = params.config.cert_pem as string;
  const mtls: SifenMtls = { certPem, privateKeyPem };

  // 1. Enveloped RSA-SHA256 signature over DE (sibling position inside rDE)
  const xmlSigned = await signXML(params.xmlGenerated, privateKeyPem, certPem);

  // 2. Inject gCamFuFD/dCarQR. Uses store's CSC if configured, else test
  //    defaults. Real idCSC/CSC for production are issued by DNIT.
  const idCSC = params.config.csc_id || SIFEN_TEST_ID_CSC;
  const csc = params.config.csc || SIFEN_TEST_CSC;
  const xmlFinal = await injectQR(xmlSigned, env, idCSC, csc);

  // 3. Send via mTLS
  const sifen = await sifenClient.sendDE(String(params.docNumber), xmlFinal, env, mtls);

  return { xmlSigned, xmlFinal, sifen };
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
  actividad_economica_codigo?: string;
  actividad_economica_descripcion?: string;
  sifen_environment?: SifenEnv;
}

export interface FiscalConfig extends FiscalConfigInput {
  id: string;
  store_id: string;
  cert_pem: string | null;
  encrypted_private_key: string | null;
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

  // Mask sensitive fields before returning to client
  return {
    ...data,
    cert_pem: data.cert_pem ? '[PRESENT]' : null,
    encrypted_private_key: data.encrypted_private_key ? '[PRESENT]' : null,
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
 * Process a .p12 certificate upload.
 *
 * Security contract:
 *   1. Parse the .p12 in memory, extract private key PEM + certificate PEM.
 *   2. Encrypt the private key with AES-256-GCM using SIFEN_ENCRYPTION_KEY (Railway env var).
 *   3. Persist: cert_pem (not secret), encrypted_private_key, nothing else.
 *   4. The .p12 buffer and the merchant password never reach the database.
 */
export async function uploadCertificate(
  storeId: string,
  certBuffer: Buffer,
  certPassword: string,
) {
  // Extract PEMs server-side; throws if password is wrong or file is corrupt
  const { privateKeyPem, certPem } = await extractPemsFromP12(certBuffer, certPassword);

  // Encrypt the private key (the only secret). Password is discarded after this line.
  const encryptedPrivateKey = encrypt(privateKeyPem);

  // certPassword and certBuffer are no longer referenced after this point.
  // Node GC will collect them; they never leave this process.

  const { data, error } = await supabaseAdmin
    .from('fiscal_config')
    .update({
      cert_pem: certPem,
      encrypted_private_key: encryptedPrivateKey,
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
    // cert_pem and encrypted_private_key are masked as '[PRESENT]' when present
    if (!config.cert_pem) {
      errors.push('Certificado digital requerido para ambiente ' + config.sifen_environment);
    }
    if (!config.encrypted_private_key) {
      errors.push('Clave privada del certificado no configurada');
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

  // 2. Get order with line items and customer data, plus store name in parallel
  const [orderResult, storeResult] = await Promise.all([
    supabaseAdmin
      .from('orders')
      .select(`
        *,
        order_line_items(id, product_name, quantity, unit_price, sku),
        customers(name, email, address)
      `)
      .eq('id', orderId)
      .eq('store_id', storeId)
      .single(),
    supabaseAdmin
      .from('stores')
      .select('name')
      .eq('id', storeId)
      .single(),
  ]);

  const { data: order, error: orderErr } = orderResult;

  if (orderErr || !order) {
    throw new Error(`Order not found: ${orderId}`);
  }

  const storeName = storeResult.data?.name || config.razon_social || config.nombre_fantasia || 'Tienda';

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

  // Build xmlgen params (full shape: establecimientos[], actividadesEconomicas[])
  const params = buildXmlgenParams(config);

  const today = new Date().toISOString().split('T')[0];
  const numeroStr = String(docNumber).padStart(7, '0');
  const estab = config.establecimiento_codigo || '001';
  const punto = config.punto_expedicion || '001';

  const data = {
    tipoDocumento: 1, // Factura electrónica
    establecimiento: estab,
    punto,
    numero: numeroStr,
    fecha: today + 'T12:00:00',
    codigoSeguridadAleatorio: generateCodigoSeguridad(),
    tipoEmision: 1,
    // 1 = Venta de mercaderías. (2 = Prestación de servicios.) Since orders
    // carry physical line items, default to 1; operators with service-only
    // products should override this on the fiscal config.
    tipoTransaccion: 1,
    tipoImpuesto: 1,
    moneda: 'PYG',
    cliente: {
      contribuyente: true,
      // xmlgen expects "RUC-DV" concatenated, not separate fields.
      ruc:
        order.customer_ruc_dv !== undefined && order.customer_ruc_dv !== null
          ? `${order.customer_ruc}-${order.customer_ruc_dv}`
          : order.customer_ruc,
      dvRuc: order.customer_ruc_dv,
      tipoOperacion: 1, // B2B
      razonSocial: order.customer_name || order.customers?.name || 'Sin nombre',
      nombreFantasia: order.customer_name || order.customers?.name || 'Sin nombre',
      tipoContribuyente: 1,
      documentoTipo: 1,
      documentoNumero: String(order.customer_ruc || '0'),
      direccion: order.customer_address || order.customers?.address || order.address || 'Asunción',
      numeroCasa: '0',
      departamento: ASUNCION_DEFAULTS.departamento,
      departamentoDescripcion: ASUNCION_DEFAULTS.departamentoDescripcion,
      distrito: ASUNCION_DEFAULTS.distrito,
      distritoDescripcion: ASUNCION_DEFAULTS.distritoDescripcion,
      ciudad: ASUNCION_DEFAULTS.ciudad,
      ciudadDescripcion: ASUNCION_DEFAULTS.ciudadDescripcion,
      pais: 'PRY',
      paisDescripcion: 'Paraguay',
      email: order.customers?.email || undefined,
    },
    usuario: buildUsuarioBlock(),
    factura: {
      presencia: 1, // Presencial. Override to 2 for web-only flows.
    },
    condicion: {
      tipo: order.payment_method === 'cod' ? 1 : 2, // 1=Contado, 2=Crédito
      entregas:
        order.payment_method === 'cod'
          ? [
              {
                tipo: 1, // Efectivo
                monto: String(total),
                moneda: 'PYG',
              },
            ]
          : undefined,
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
      ivaTipo: 1, // Gravado IVA
      ivaBase: 100,
      iva: 10, // 10% IVA
      propina: 0,
    })),
  };

  // 6. Generate XML
  let xmlGenerated: string;
  let cdc: string | undefined;

  try {
    const xmlgenLib = await getXmlgen();
    // xmlgen.generateXMLDE returns an object with xml and CDC
    const result = await xmlgenLib.generateXMLDE(params, data);
    xmlGenerated = typeof result === 'string' ? result : result.xml || result;

    // Extract CDC from generated XML
    const cdcMatch = xmlGenerated.match(/<Id>([0-9]{44})<\/Id>/);
    cdc = cdcMatch ? cdcMatch[1] : undefined;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error';
    logger.error(`[Invoicing] XML generation failed: ${message}`);
    await logInvoiceEvent(storeId, null, 'error', { phase: 'xml_generation', error: message });
    throw new Error(`XML generation failed: ${message}`);
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

  // Common email dispatch params (populated after approval)
  const emailParams = {
    invoiceId: invoice.id,
    storeId,
    storeName,
    customerEmail: invoice.customer_email as string | null,
    customerName: invoice.customer_name as string | null,
    documentNumber: docNumber as number,
    invoiceDate: new Date().toISOString(),
    lineItems: (order.order_line_items || []) as Array<{
      product_name: string | null;
      quantity: number;
      unit_price: number;
    }>,
    subtotal,
    iva10,
    total,
    kudeUrl: null as string | null,
    isDemo,
  };

  if (isDemo) {
    // Demo mode: mock response, no SIFEN call
    sifenResponse = sifenDemo.mockSendDE(String(docNumber), cdc || '');

    // Build KUDE URL even in demo so operators can see the format
    const kudeUrl = cdc ? buildKudeUrl(cdc) : null;
    emailParams.kudeUrl = kudeUrl;

    await supabaseAdmin
      .from('invoices')
      .update({
        sifen_status: 'demo',
        sifen_response_code: sifenResponse.responseCode,
        sifen_response_message: sifenResponse.responseMessage,
        kude_url: kudeUrl,
      })
      .eq('id', invoice.id);

    await logInvoiceEvent(storeId, invoice.id, 'approved', {
      mode: 'demo',
      response: sifenResponse,
    });

    // Non-blocking email dispatch
    void dispatchInvoiceEmail(emailParams);
  } else {
    // Test/Prod: sign → inject QR → send to SIFEN via mTLS
    try {
      const { xmlSigned, xmlFinal, sifen } = await signInjectSend({
        xmlGenerated,
        docNumber,
        config,
      });
      sifenResponse = sifen;

      await logInvoiceEvent(storeId, invoice.id, 'signed', { cdc });

      const newStatus = sifenResponse.success ? 'approved' : 'rejected';
      const kudeUrl = sifenResponse.success && cdc ? buildKudeUrl(cdc) : null;

      if (sifenResponse.success) {
        emailParams.kudeUrl = kudeUrl;
      }

      await supabaseAdmin
        .from('invoices')
        .update({
          xml_signed: xmlFinal, // stored with QR injected; raw signed is xmlSigned
          sifen_status: newStatus,
          sifen_response_code: sifenResponse.responseCode,
          sifen_response_message: sifenResponse.responseMessage,
          sent_to_sifen_at: new Date().toISOString(),
          ...(sifenResponse.success && {
            approved_at: new Date().toISOString(),
            kude_url: kudeUrl,
          }),
        })
        .eq('id', invoice.id);

      await logInvoiceEvent(storeId, invoice.id, sifenResponse.success ? 'approved' : 'rejected', {
        response_code: sifenResponse.responseCode,
        response_message: sifenResponse.responseMessage,
      });

      if (sifenResponse.success) {
        void dispatchInvoiceEmail(emailParams);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown SIFEN error';
      logger.error(`[Invoicing] SIFEN send failed: ${message}`);

      await supabaseAdmin
        .from('invoices')
        .update({
          sifen_status: 'rejected',
          sifen_response_message: message,
        })
        .eq('id', invoice.id);

      await logInvoiceEvent(storeId, invoice.id, 'error', {
        phase: 'sifen_send',
        error: message,
      });

      sifenResponse = {
        success: false,
        responseCode: 'SEND_ERROR',
        responseMessage: message,
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
// Manual Invoice Generation
// ================================================================

export interface ManualInvoiceItem {
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  ivaRate: 10 | 5 | 0; // 10 = gravado 10%, 5 = gravado 5%, 0 = exento
}

export interface ManualInvoiceInput {
  tipoDocumento: 1 | 5 | 6; // 1=Factura, 5=Nota crédito, 6=Nota débito
  customerName: string;
  customerRuc?: string;
  customerRucDv?: number;
  customerEmail?: string;
  items: ManualInvoiceItem[];
}

/**
 * Generate an invoice from manually provided buyer data and line items.
 * Does not require an existing order.
 */
export async function generateManualInvoice(storeId: string, input: ManualInvoiceInput) {
  logger.info(`[Invoicing] Generating manual invoice for store ${storeId}`);

  const { data: config, error: configErr } = await supabaseAdmin
    .from('fiscal_config')
    .select('*')
    .eq('store_id', storeId)
    .eq('is_active', true)
    .single();

  if (configErr || !config) {
    throw new Error('No active fiscal configuration found. Please complete setup first.');
  }

  const storeResult = await supabaseAdmin
    .from('stores')
    .select('name')
    .eq('id', storeId)
    .single();

  const storeName = storeResult.data?.name || config.razon_social || config.nombre_fantasia || 'Tienda';

  const { data: docNumber, error: docErr } = await supabaseAdmin
    .rpc('get_next_invoice_number', { p_store_id: storeId });

  if (docErr || !docNumber) {
    throw new Error(`Failed to get next document number: ${docErr?.message}`);
  }

  const isDemo = config.sifen_environment === 'demo';

  let subtotal = 0;
  let iva10 = 0;
  let iva5 = 0;
  const ivaExento = 0;

  for (const item of input.items) {
    const lineTotal = item.precioUnitario * item.cantidad;
    subtotal += lineTotal;
    if (item.ivaRate === 10) {
      iva10 += Math.round(lineTotal / 11);
    } else if (item.ivaRate === 5) {
      iva5 += Math.round(lineTotal / 21);
    }
  }

  const total = subtotal;

  const params = buildXmlgenParams(config);

  const today = new Date().toISOString().split('T')[0];
  const numeroStr = String(docNumber).padStart(7, '0');
  const estab = config.establecimiento_codigo || '001';
  const punto = config.punto_expedicion || '001';

  const hasRuc = !!input.customerRuc;
  // xmlgen expects `cliente.ruc` as "RUC-DV" (e.g. "5712264-4") when
  // contribuyente=true, since it validates DV presence up-front. dvRuc is
  // kept separately for other consumers.
  const clienteRucFormatted =
    hasRuc && input.customerRucDv !== undefined
      ? `${input.customerRuc}-${input.customerRucDv}`
      : input.customerRuc || undefined;

  // xmlgen items require ivaTipo / ivaBase / iva, not ppiGravado /
  // tipoIvaPorItem (older nomenclature). Re-shape now that xmlgen builders
  // are consolidated.
  const xmlItemsForGen = input.items.map((item, index) => {
    const ivaTipo = item.ivaRate === 0 ? 3 : 1; // 1 = Gravado IVA, 3 = Exento
    return {
      codigo: String(index + 1),
      descripcion: item.descripcion,
      observacion: '',
      unidadMedida: 77,
      cantidad: item.cantidad,
      precioUnitario: item.precioUnitario,
      cambio: 0,
      descuento: 0,
      anticipo: 0,
      ivaTipo,
      ivaBase: 100,
      iva: item.ivaRate,
      propina: 0,
    };
  });

  const data = {
    tipoDocumento: input.tipoDocumento,
    establecimiento: estab,
    punto,
    numero: numeroStr,
    fecha: today + 'T12:00:00',
    codigoSeguridadAleatorio: generateCodigoSeguridad(),
    tipoEmision: 1,
    tipoTransaccion: 2, // Prestación de servicios (manual path default)
    tipoImpuesto: 1,
    moneda: 'PYG',
    cliente: {
      contribuyente: hasRuc,
      ruc: clienteRucFormatted,
      dvRuc: input.customerRucDv,
      tipoOperacion: hasRuc ? 1 : 2, // 1=B2B, 2=B2C
      razonSocial: input.customerName,
      nombreFantasia: input.customerName,
      tipoContribuyente: hasRuc ? 1 : 1,
      documentoTipo: hasRuc ? undefined : 1, // Cédula for non-contribuyentes
      documentoNumero: hasRuc ? undefined : String(input.customerRuc || '0'),
      direccion: 'Asunción',
      numeroCasa: '0',
      departamento: ASUNCION_DEFAULTS.departamento,
      departamentoDescripcion: ASUNCION_DEFAULTS.departamentoDescripcion,
      distrito: ASUNCION_DEFAULTS.distrito,
      distritoDescripcion: ASUNCION_DEFAULTS.distritoDescripcion,
      ciudad: ASUNCION_DEFAULTS.ciudad,
      ciudadDescripcion: ASUNCION_DEFAULTS.ciudadDescripcion,
      pais: 'PRY',
      paisDescripcion: 'Paraguay',
      email: input.customerEmail || undefined,
    },
    usuario: buildUsuarioBlock(),
    factura: {
      presencia: 1,
    },
    condicion: {
      tipo: 1, // Contado
      entregas: [
        {
          tipo: 1,
          monto: String(total),
          moneda: 'PYG',
        },
      ],
    },
    items: xmlItemsForGen,
  };

  let xmlGenerated: string;
  let cdc: string | undefined;

  try {
    const xmlgenLib = await getXmlgen();
    const result = await xmlgenLib.generateXMLDE(params, data);
    xmlGenerated = typeof result === 'string' ? result : result.xml || result;
    const cdcMatch = xmlGenerated.match(/<Id>([0-9]{44})<\/Id>/);
    cdc = cdcMatch ? cdcMatch[1] : undefined;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error';
    logger.error(`[Invoicing] Manual XML generation failed: ${message}`);
    await logInvoiceEvent(storeId, null, 'error', { phase: 'xml_generation', error: message });
    throw new Error(`XML generation failed: ${message}`);
  }

  const { data: invoice, error: invoiceErr } = await supabaseAdmin
    .from('invoices')
    .insert({
      store_id: storeId,
      order_id: null,
      cdc,
      document_number: docNumber,
      tipo_documento: input.tipoDocumento,
      customer_ruc: input.customerRuc || null,
      customer_ruc_dv: input.customerRucDv ?? null,
      customer_name: input.customerName,
      customer_email: input.customerEmail || null,
      customer_address: null,
      subtotal,
      iva_5: iva5,
      iva_10: iva10,
      iva_exento: ivaExento,
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
    source: 'manual',
  });

  const emailParams = {
    invoiceId: invoice.id,
    storeId,
    storeName,
    customerEmail: input.customerEmail || null,
    customerName: input.customerName,
    documentNumber: docNumber as number,
    invoiceDate: new Date().toISOString(),
    lineItems: input.items.map((item) => ({
      product_name: item.descripcion,
      quantity: item.cantidad,
      unit_price: item.precioUnitario,
    })),
    subtotal,
    iva10,
    total,
    kudeUrl: null as string | null,
    isDemo,
  };

  let sifenResponse: SifenResponse;

  if (isDemo) {
    sifenResponse = sifenDemo.mockSendDE(String(docNumber), cdc || '');
    const kudeUrl = cdc ? buildKudeUrl(cdc) : null;
    emailParams.kudeUrl = kudeUrl;

    await supabaseAdmin
      .from('invoices')
      .update({
        sifen_status: 'demo',
        sifen_response_code: sifenResponse.responseCode,
        sifen_response_message: sifenResponse.responseMessage,
        kude_url: kudeUrl,
      })
      .eq('id', invoice.id);

    await logInvoiceEvent(storeId, invoice.id, 'approved', { mode: 'demo', response: sifenResponse });
    void dispatchInvoiceEmail(emailParams);
  } else {
    try {
      const { xmlFinal, sifen } = await signInjectSend({
        xmlGenerated,
        docNumber,
        config,
      });
      sifenResponse = sifen;

      await logInvoiceEvent(storeId, invoice.id, 'signed', { cdc });

      const newStatus = sifenResponse.success ? 'approved' : 'rejected';
      const kudeUrl = sifenResponse.success && cdc ? buildKudeUrl(cdc) : null;

      if (sifenResponse.success) {
        emailParams.kudeUrl = kudeUrl;
      }

      await supabaseAdmin
        .from('invoices')
        .update({
          xml_signed: xmlFinal,
          sifen_status: newStatus,
          sifen_response_code: sifenResponse.responseCode,
          sifen_response_message: sifenResponse.responseMessage,
          sent_to_sifen_at: new Date().toISOString(),
          ...(sifenResponse.success && {
            approved_at: new Date().toISOString(),
            kude_url: kudeUrl,
          }),
        })
        .eq('id', invoice.id);

      await logInvoiceEvent(storeId, invoice.id, sifenResponse.success ? 'approved' : 'rejected', {
        response_code: sifenResponse.responseCode,
        response_message: sifenResponse.responseMessage,
      });

      if (sifenResponse.success) {
        void dispatchInvoiceEmail(emailParams);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown SIFEN error';
      logger.error(`[Invoicing] Manual SIFEN send failed: ${message}`);

      await supabaseAdmin
        .from('invoices')
        .update({ sifen_status: 'rejected', sifen_response_message: message })
        .eq('id', invoice.id);

      await logInvoiceEvent(storeId, invoice.id, 'error', { phase: 'sifen_send', error: message });

      sifenResponse = {
        success: false,
        responseCode: 'SEND_ERROR',
        responseMessage: message,
      };
    }
  }

  logger.info(`[Invoicing] Manual invoice ${invoice.id} created (status: ${isDemo ? 'demo' : sifenResponse.success ? 'approved' : 'rejected'})`);

  return {
    invoice_id: invoice.id,
    cdc,
    document_number: docNumber,
    status: isDemo ? 'demo' : sifenResponse.success ? 'approved' : 'rejected',
    kude_url: isDemo ? (cdc ? buildKudeUrl(cdc) : null) : (sifenResponse.success && cdc ? buildKudeUrl(cdc) : null),
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
    const { data: fullConfig } = await supabaseAdmin
      .from('fiscal_config')
      .select('cert_pem, encrypted_private_key, sifen_environment')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .maybeSingle();

    if (!fullConfig?.cert_pem || !fullConfig?.encrypted_private_key) {
      throw new Error('Certificado digital no configurado. Cancelación requiere mTLS.');
    }

    const privateKeyPem = decrypt(fullConfig.encrypted_private_key);
    const mtls: SifenMtls = { certPem: fullConfig.cert_pem, privateKeyPem };

    const escapedMotivo = motivo
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      .substring(0, 500); // Limit length for SIFEN
    const cancelXml = `<gCamEven><mOtEve>${escapedMotivo}</mOtEve></gCamEven>`;
    const response = await sifenClient.sendEvent(
      invoice.cdc,
      2, // Event type 2 = Cancellation
      cancelXml,
      fullConfig.sifen_environment as Exclude<SifenEnv, 'demo'>,
      mtls,
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

  if (!config.encrypted_private_key || !config.cert_pem) {
    throw new Error('Certificado digital no configurado para re-firmar.');
  }

  const privateKeyPem = decrypt(config.encrypted_private_key);
  const certPem = config.cert_pem as string;
  const mtls: SifenMtls = { certPem, privateKeyPem };
  const env = config.sifen_environment as 'test' | 'prod';

  // If we have unsigned XML (or previously-signed without QR), re-sign and
  // re-inject QR. Idempotent: qrgen replaces gCamFuFD if it exists.
  let xmlFinal = invoice.xml_signed;
  if (!xmlFinal && invoice.xml_generated) {
    const xmlSigned = await signXML(invoice.xml_generated, privateKeyPem, certPem);
    xmlFinal = await injectQR(
      xmlSigned,
      env,
      config.csc_id || SIFEN_TEST_ID_CSC,
      config.csc || SIFEN_TEST_CSC,
    );

    await supabaseAdmin
      .from('invoices')
      .update({ xml_signed: xmlFinal })
      .eq('id', invoiceId);
  }

  // Retry sending via mTLS
  const response = await sifenClient.sendDE(
    String(invoice.document_number),
    xmlFinal!,
    env,
    mtls,
  );

  const newStatus = response.success ? 'approved' : 'rejected';
  const kudeUrl = response.success && invoice.cdc ? buildKudeUrl(invoice.cdc) : null;

  await supabaseAdmin
    .from('invoices')
    .update({
      sifen_status: newStatus,
      sifen_response_code: response.responseCode,
      sifen_response_message: response.responseMessage,
      sent_to_sifen_at: new Date().toISOString(),
      ...(response.success && {
        approved_at: new Date().toISOString(),
        kude_url: kudeUrl,
      }),
    })
    .eq('id', invoiceId);

  await logInvoiceEvent(storeId, invoiceId, response.success ? 'approved' : 'rejected', {
    retry: true,
    response_code: response.responseCode,
    response_message: response.responseMessage,
  });

  if (response.success) {
    const [storeResult, orderResult] = await Promise.all([
      supabaseAdmin.from('stores').select('name').eq('id', storeId).single(),
      invoice.order_id
        ? supabaseAdmin
            .from('orders')
            .select('order_line_items(product_name, quantity, unit_price)')
            .eq('id', invoice.order_id)
            .single()
        : Promise.resolve({ data: null }),
    ]);

    const storeName = storeResult.data?.name || 'Tienda';
    const lineItems: Array<{ product_name: string | null; quantity: number; unit_price: number }> =
      (orderResult.data as any)?.order_line_items || [];

    void dispatchInvoiceEmail({
      invoiceId,
      storeId,
      storeName,
      customerEmail: invoice.customer_email as string | null,
      customerName: invoice.customer_name as string | null,
      documentNumber: invoice.document_number as number,
      invoiceDate: new Date().toISOString(),
      lineItems,
      subtotal: invoice.subtotal as number,
      iva10: invoice.iva_10 as number,
      total: invoice.total as number,
      kudeUrl,
      isDemo: false,
    });
  }

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
