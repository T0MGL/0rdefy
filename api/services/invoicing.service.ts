/**
 * Invoicing Service (Orchestrator)
 *
 * Manages the full electronic invoicing lifecycle for Paraguay SIFEN:
 *   1. Fiscal identity management (RUC-level, shared across stores)
 *   2. Per-store link setup (establecimiento, punto expedicion, timbrado)
 *   3. Invoice generation (XML via xmlgen)
 *   4. XML signing (RSA-SHA256)
 *   5. SIFEN submission (or demo mock)
 *   6. Invoice storage and event logging
 *
 * Data model (post migration 161):
 *   fiscal_identities           : one row per RUC, owned by a user
 *   fiscal_identity_activities  : N activities per identity (1 principal)
 *   fiscal_identity_stores      : link identity <-> store, carries
 *                                 establecimiento / punto / timbrado /
 *                                 next_document_number
 *
 * Read path: getFiscalContext(storeId) returns the full { identity, link,
 * activities } joined shape, secrets masked. Every generator reads through
 * it - no direct fiscal_config access.
 *
 * Write path: setup is split into createIdentity / linkIdentityToStore /
 * updateStoreFields / uploadCertificate. The single setupFiscalConfig
 * entrypoint is kept (thin compat wrapper) so the existing wizard step
 * keeps working until the frontend ships the new split wizard.
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
import {
  validateRucDV,
  assertReadyToEmit,
  assertInvoicingCountry,
} from '../utils/fiscal-guards';
import { getStoreTimezone, getTodayInTimezone } from '../utils/dateUtils';

// ================================================================
// Types (exported for guards + routes)
// ================================================================

export interface FiscalIdentityRow {
  id: string;
  owner_user_id: string;
  ruc: string;
  ruc_dv: number;
  razon_social: string;
  nombre_fantasia: string | null;
  tipo_contribuyente: number;
  tipo_regimen: number | null;
  country: string;
  sifen_environment: SifenEnv;
  has_certificate: boolean;
  csc_id: string | null;
  representante_legal_nombre: string | null;
  representante_legal_documento_tipo: number | null;
  representante_legal_documento_numero: string | null;
  representante_legal_cargo: string | null;
  domicilio_fiscal_direccion: string | null;
  domicilio_fiscal_numero_casa: string | null;
  domicilio_fiscal_departamento: number | null;
  domicilio_fiscal_distrito: number | null;
  domicilio_fiscal_ciudad: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface FiscalActivityRow {
  id: string;
  codigo: string;
  descripcion: string;
  is_principal: boolean;
  display_order: number;
}

export interface FiscalIdentityStoreRow {
  id: string;
  store_id: string;
  timbrado: string;
  timbrado_fecha_inicio: string | null;
  timbrado_fecha_fin: string | null;
  establecimiento_codigo: string;
  punto_expedicion: string;
  establecimiento_direccion: string | null;
  establecimiento_departamento: number | null;
  establecimiento_distrito: number | null;
  establecimiento_ciudad: number | null;
  establecimiento_telefono: string | null;
  establecimiento_email: string | null;
  next_document_number: number;
  is_active: boolean;
  setup_completed: boolean;
}

export interface FiscalContext {
  identity: FiscalIdentityRow;
  link: FiscalIdentityStoreRow;
  activities: FiscalActivityRow[];
}

export interface FiscalIdentityInput {
  ruc: string;
  ruc_dv: number;
  razon_social: string;
  nombre_fantasia?: string | null;
  tipo_contribuyente: number;
  tipo_regimen?: number | null;
  sifen_environment?: SifenEnv;
  representante_legal_nombre?: string | null;
  representante_legal_documento_tipo?: number | null;
  representante_legal_documento_numero?: string | null;
  representante_legal_cargo?: string | null;
  domicilio_fiscal_direccion?: string | null;
  domicilio_fiscal_numero_casa?: string | null;
  domicilio_fiscal_departamento?: number | null;
  domicilio_fiscal_distrito?: number | null;
  domicilio_fiscal_ciudad?: number | null;
}

export interface FiscalIdentityActivityInput {
  codigo: string;
  descripcion: string;
  is_principal?: boolean;
  display_order?: number;
}

export interface FiscalStoreLinkInput {
  timbrado: string;
  timbrado_fecha_inicio?: string | null;
  timbrado_fecha_fin?: string | null;
  establecimiento_codigo?: string;
  punto_expedicion?: string;
  establecimiento_direccion?: string | null;
  establecimiento_departamento?: number | null;
  establecimiento_distrito?: number | null;
  establecimiento_ciudad?: number | null;
  establecimiento_telefono?: string | null;
  establecimiento_email?: string | null;
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
// SIFEN constants
// ================================================================

function buildKudeUrl(cdc: string): string {
  return `https://ekuatia.set.gov.py/consultas/qr?nVersion=150&Id=${cdc}`;
}

// Asuncion geo codes, used when the store has no configured address.
const ASUNCION_DEFAULTS = {
  departamento: 1,
  distrito: 1,
  ciudad: 1,
  departamentoDescripcion: 'CAPITAL',
  distritoDescripcion: 'ASUNCION (DISTRITO)',
  ciudadDescripcion: 'ASUNCION (DISTRITO)',
};

// ================================================================
// xmlgen dynamic import (CommonJS interop)
// ================================================================

let xmlgen: any = null;
async function getXmlgen() {
  if (!xmlgen) {
    try {
      xmlgen = await import('facturacionelectronicapy-xmlgen');
      xmlgen = xmlgen.default || xmlgen;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error';
      logger.error(`[Invoicing] Failed to load xmlgen: ${message}`);
      throw new Error('facturacionelectronicapy-xmlgen package not available');
    }
  }
  return xmlgen;
}

function generateCodigoSeguridad(): string {
  return String(Math.floor(100_000_000 + Math.random() * 899_999_999));
}

// ================================================================
// xmlgen param builders (consume FiscalContext)
// ================================================================

/**
 * Build xmlgen `params` (emitter + establecimiento + actividades) from
 * a resolved fiscal context.
 *
 * Accepts an optional `activityCode` to restrict the actividadesEconomicas
 * block to a single activity. Used when an identity has multiple
 * activities and the UI offered the operator a choice.
 */
function buildXmlgenParams(
  ctx: FiscalContext,
  opts?: { tipoRegimenFallback?: number; activityCode?: string; storeTimezone?: string },
) {
  const { identity, link, activities } = ctx;
  const codigo = link.establecimiento_codigo || '001';
  const tz = opts?.storeTimezone || 'America/Asuncion';

  // Principal activity first; selected code (if any) overrides.
  let activityList = activities;
  if (opts?.activityCode) {
    const filtered = activities.filter((a) => a.codigo === opts.activityCode);
    if (filtered.length === 0) {
      throw new Error(
        `La actividad economica ${opts.activityCode} no esta registrada en la identidad fiscal.`,
      );
    }
    activityList = filtered;
  } else if (activities.length > 1) {
    const principal = activities.find((a) => a.is_principal);
    activityList = principal ? [principal] : activities.slice(0, 1);
  }

  return {
    version: 150,
    ruc: `${identity.ruc}-${identity.ruc_dv}`,
    razonSocial: identity.razon_social,
    nombreFantasia: identity.nombre_fantasia || identity.razon_social,
    timbradoNumero: link.timbrado,
    timbradoFecha:
      (link.timbrado_fecha_inicio || getTodayInTimezone(tz)) + 'T00:00:00',
    tipoContribuyente: identity.tipo_contribuyente,
    tipoRegimen: identity.tipo_regimen ?? opts?.tipoRegimenFallback ?? 8,
    establecimientos: [
      {
        codigo,
        direccion: link.establecimiento_direccion || 'Asuncion',
        numeroCasa: '0',
        complementoDireccion1: '',
        complementoDireccion2: '',
        departamento: link.establecimiento_departamento ?? ASUNCION_DEFAULTS.departamento,
        departamentoDescripcion: ASUNCION_DEFAULTS.departamentoDescripcion,
        distrito: link.establecimiento_distrito ?? ASUNCION_DEFAULTS.distrito,
        distritoDescripcion: ASUNCION_DEFAULTS.distritoDescripcion,
        ciudad: link.establecimiento_ciudad ?? ASUNCION_DEFAULTS.ciudad,
        ciudadDescripcion: ASUNCION_DEFAULTS.ciudadDescripcion,
        telefono: link.establecimiento_telefono || '021000000',
        email:
          link.establecimiento_email ||
          `facturacion@${(identity.nombre_fantasia || 'empresa').toLowerCase().replace(/\s+/g, '')}.com.py`,
        denominacion: identity.nombre_fantasia || 'Casa Central',
      },
    ],
    actividadesEconomicas: activityList.map((a) => ({
      codigo: a.codigo,
      descripcion: a.descripcion,
    })),
  };
}

/**
 * Build xmlgen `data.usuario` (signer identity) from the fiscal context.
 * Replaces the old hardcoded representante legal with identity-level data.
 */
function buildUsuarioBlock(ctx: FiscalContext) {
  const id = ctx.identity;
  return {
    documentoTipo: id.representante_legal_documento_tipo ?? 1, // 1 = Cedula
    documentoNumero: id.representante_legal_documento_numero ?? '0',
    nombre: id.representante_legal_nombre ?? id.razon_social,
    cargo: id.representante_legal_cargo ?? 'REPRESENTANTE LEGAL',
  };
}

// ================================================================
// SIFEN pipeline (shared by generate / manual / retry)
// ================================================================

async function signInjectSend(params: {
  xmlGenerated: string;
  docNumber: number;
  identity: FiscalIdentityRow;
  certPem: string;
  privateKeyPem: string;
}): Promise<{ xmlSigned: string; xmlFinal: string; sifen: SifenResponse }> {
  const env = params.identity.sifen_environment as 'test' | 'prod';
  const mtls: SifenMtls = { certPem: params.certPem, privateKeyPem: params.privateKeyPem };

  const xmlSigned = await signXML(params.xmlGenerated, params.privateKeyPem, params.certPem);

  const idCSC = params.identity.csc_id || SIFEN_TEST_ID_CSC;
  const csc = SIFEN_TEST_CSC; // identity.csc is encrypted when present; stub uses test CSC
  const xmlFinal = await injectQR(xmlSigned, env, idCSC, csc);

  const sifen = await sifenClient.sendDE(String(params.docNumber), xmlFinal, env, mtls);

  return { xmlSigned, xmlFinal, sifen };
}

/**
 * Fire-and-forget invoice email dispatch.
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
    new Intl.NumberFormat('es-PY', {
      style: 'currency',
      currency: 'PYG',
      maximumFractionDigits: 0,
    }).format(amount);

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
      params.storeName,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error(`[Invoicing] Invoice email failed for invoice ${params.invoiceId}: ${message}`);
  }
}

// ================================================================
// Fiscal context resolution
// ================================================================

/**
 * Resolve the full fiscal context (identity + link + activities) for a
 * store via RPC. Secrets are masked (`has_certificate` boolean instead of
 * `cert_pem` / `encrypted_private_key`).
 *
 * Returns null if the store has no linked identity yet.
 */
export async function getFiscalContext(storeId: string): Promise<FiscalContext | null> {
  const { data, error } = await supabaseAdmin.rpc('get_fiscal_context_for_store', {
    p_store_id: storeId,
  });

  if (error) {
    logger.error(`[Invoicing] get_fiscal_context_for_store error: ${error.message}`);
    return null;
  }
  if (!data) return null;

  return data as FiscalContext;
}

/**
 * Internal: load raw secrets (cert_pem + decrypted private key) for a
 * store's identity. Never returns these to the client.
 */
async function loadCertificateMaterial(
  identityId: string,
): Promise<{ certPem: string; privateKeyPem: string }> {
  const { data, error } = await supabaseAdmin
    .from('fiscal_identities')
    .select('cert_pem, encrypted_private_key')
    .eq('id', identityId)
    .eq('is_active', true)
    .single();

  if (error || !data) throw new Error('Identidad fiscal no encontrada');
  if (!data.cert_pem || !data.encrypted_private_key) {
    throw new Error('Certificado digital no configurado en la identidad fiscal.');
  }

  return {
    certPem: data.cert_pem as string,
    privateKeyPem: decrypt(data.encrypted_private_key as string),
  };
}

// ================================================================
// Identity CRUD
// ================================================================

/**
 * Create a new fiscal identity for the given owner. The identity is
 * shareable across the owner's stores via linkIdentityToStore.
 */
export async function createIdentity(
  ownerUserId: string,
  input: FiscalIdentityInput,
): Promise<FiscalIdentityRow> {
  if (!validateRucDV(input.ruc, input.ruc_dv)) {
    throw new Error('El digito verificador (DV) no coincide con el RUC. Verifique el numero.');
  }

  const environment = input.sifen_environment || 'demo';

  const { data, error } = await supabaseAdmin
    .from('fiscal_identities')
    .insert({
      owner_user_id: ownerUserId,
      ruc: input.ruc,
      ruc_dv: input.ruc_dv,
      razon_social: input.razon_social,
      nombre_fantasia: input.nombre_fantasia ?? null,
      tipo_contribuyente: input.tipo_contribuyente,
      tipo_regimen: input.tipo_regimen ?? null,
      country: 'PY',
      sifen_environment: environment,
      representante_legal_nombre: input.representante_legal_nombre ?? null,
      representante_legal_documento_tipo: input.representante_legal_documento_tipo ?? null,
      representante_legal_documento_numero: input.representante_legal_documento_numero ?? null,
      representante_legal_cargo: input.representante_legal_cargo ?? null,
      domicilio_fiscal_direccion: input.domicilio_fiscal_direccion ?? null,
      domicilio_fiscal_numero_casa: input.domicilio_fiscal_numero_casa ?? null,
      domicilio_fiscal_departamento: input.domicilio_fiscal_departamento ?? null,
      domicilio_fiscal_distrito: input.domicilio_fiscal_distrito ?? null,
      domicilio_fiscal_ciudad: input.domicilio_fiscal_ciudad ?? null,
    })
    .select(
      'id, owner_user_id, ruc, ruc_dv, razon_social, nombre_fantasia, tipo_contribuyente, tipo_regimen, country, sifen_environment, csc_id, representante_legal_nombre, representante_legal_documento_tipo, representante_legal_documento_numero, representante_legal_cargo, domicilio_fiscal_direccion, domicilio_fiscal_numero_casa, domicilio_fiscal_departamento, domicilio_fiscal_distrito, domicilio_fiscal_ciudad, is_active, created_at, updated_at',
    )
    .single();

  if (error || !data) {
    throw new Error(`Error creando identidad fiscal: ${error?.message ?? 'unknown'}`);
  }

  return { ...(data as any), has_certificate: false } as FiscalIdentityRow;
}

/**
 * Update an existing identity. Does not touch the certificate.
 */
export async function updateIdentity(
  identityId: string,
  input: Partial<FiscalIdentityInput>,
): Promise<FiscalIdentityRow> {
  if (input.ruc && input.ruc_dv !== undefined) {
    if (!validateRucDV(input.ruc, input.ruc_dv)) {
      throw new Error('El digito verificador (DV) no coincide con el RUC.');
    }
  }

  const patch: Record<string, unknown> = {};
  const writable: (keyof FiscalIdentityInput)[] = [
    'razon_social',
    'nombre_fantasia',
    'tipo_contribuyente',
    'tipo_regimen',
    'sifen_environment',
    'representante_legal_nombre',
    'representante_legal_documento_tipo',
    'representante_legal_documento_numero',
    'representante_legal_cargo',
    'domicilio_fiscal_direccion',
    'domicilio_fiscal_numero_casa',
    'domicilio_fiscal_departamento',
    'domicilio_fiscal_distrito',
    'domicilio_fiscal_ciudad',
  ];
  for (const key of writable) {
    if (input[key] !== undefined) patch[key] = input[key];
  }
  // RUC / DV only mutable when both provided together.
  if (input.ruc !== undefined && input.ruc_dv !== undefined) {
    patch.ruc = input.ruc;
    patch.ruc_dv = input.ruc_dv;
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('Nada para actualizar.');
  }

  const { data, error } = await supabaseAdmin
    .from('fiscal_identities')
    .update(patch)
    .eq('id', identityId)
    .select(
      'id, owner_user_id, ruc, ruc_dv, razon_social, nombre_fantasia, tipo_contribuyente, tipo_regimen, country, sifen_environment, csc_id, representante_legal_nombre, representante_legal_documento_tipo, representante_legal_documento_numero, representante_legal_cargo, domicilio_fiscal_direccion, domicilio_fiscal_numero_casa, domicilio_fiscal_departamento, domicilio_fiscal_distrito, domicilio_fiscal_ciudad, is_active, created_at, updated_at, cert_pem, encrypted_private_key',
    )
    .single();

  if (error || !data) {
    throw new Error(`Error actualizando identidad fiscal: ${error?.message ?? 'unknown'}`);
  }

  const hasCert = Boolean((data as any).cert_pem && (data as any).encrypted_private_key);
  const { cert_pem: _a, encrypted_private_key: _b, ...rest } = data as any;
  return { ...rest, has_certificate: hasCert } as FiscalIdentityRow;
}

/**
 * List fiscal identities owned by the given user.
 */
export async function listIdentitiesForOwner(
  ownerUserId: string,
): Promise<Array<FiscalIdentityRow & { activities: FiscalActivityRow[] }>> {
  const { data, error } = await supabaseAdmin
    .from('fiscal_identities')
    .select(
      'id, owner_user_id, ruc, ruc_dv, razon_social, nombre_fantasia, tipo_contribuyente, tipo_regimen, country, sifen_environment, cert_pem, encrypted_private_key, csc_id, representante_legal_nombre, representante_legal_documento_tipo, representante_legal_documento_numero, representante_legal_cargo, domicilio_fiscal_direccion, domicilio_fiscal_numero_casa, domicilio_fiscal_departamento, domicilio_fiscal_distrito, domicilio_fiscal_ciudad, is_active, created_at, updated_at, fiscal_identity_activities(id, codigo, descripcion, is_principal, display_order)',
    )
    .eq('owner_user_id', ownerUserId)
    .eq('is_active', true)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Error listando identidades: ${error.message}`);

  return (data ?? []).map((row: any) => {
    const { cert_pem, encrypted_private_key, fiscal_identity_activities, ...rest } = row;
    return {
      ...rest,
      has_certificate: Boolean(cert_pem && encrypted_private_key),
      activities: (fiscal_identity_activities ?? []).sort(
        (a: FiscalActivityRow, b: FiscalActivityRow) => a.display_order - b.display_order,
      ),
    };
  });
}

// ================================================================
// Identity activities CRUD
// ================================================================

export async function addIdentityActivity(
  identityId: string,
  input: FiscalIdentityActivityInput,
): Promise<FiscalActivityRow> {
  const is_principal = input.is_principal ?? false;

  // If flagging as principal, demote any other principal first.
  if (is_principal) {
    await supabaseAdmin
      .from('fiscal_identity_activities')
      .update({ is_principal: false })
      .eq('identity_id', identityId)
      .eq('is_principal', true);
  }

  const { data, error } = await supabaseAdmin
    .from('fiscal_identity_activities')
    .insert({
      identity_id: identityId,
      codigo: input.codigo,
      descripcion: input.descripcion,
      is_principal,
      display_order: input.display_order ?? 0,
    })
    .select('id, codigo, descripcion, is_principal, display_order')
    .single();

  if (error || !data) throw new Error(`Error creando actividad: ${error?.message ?? 'unknown'}`);
  return data as FiscalActivityRow;
}

export async function updateIdentityActivity(
  identityId: string,
  activityId: string,
  input: Partial<FiscalIdentityActivityInput>,
): Promise<FiscalActivityRow> {
  const patch: Record<string, unknown> = {};
  if (input.codigo !== undefined) patch.codigo = input.codigo;
  if (input.descripcion !== undefined) patch.descripcion = input.descripcion;
  if (input.display_order !== undefined) patch.display_order = input.display_order;

  if (input.is_principal === true) {
    await supabaseAdmin
      .from('fiscal_identity_activities')
      .update({ is_principal: false })
      .eq('identity_id', identityId)
      .neq('id', activityId);
    patch.is_principal = true;
  } else if (input.is_principal === false) {
    patch.is_principal = false;
  }

  const { data, error } = await supabaseAdmin
    .from('fiscal_identity_activities')
    .update(patch)
    .eq('id', activityId)
    .eq('identity_id', identityId)
    .select('id, codigo, descripcion, is_principal, display_order')
    .single();

  if (error || !data) throw new Error(`Error actualizando actividad: ${error?.message ?? 'unknown'}`);
  return data as FiscalActivityRow;
}

export async function deleteIdentityActivity(
  identityId: string,
  activityId: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('fiscal_identity_activities')
    .delete()
    .eq('id', activityId)
    .eq('identity_id', identityId);

  if (error) throw new Error(`Error eliminando actividad: ${error.message}`);
}

// ================================================================
// Identity <-> Store link CRUD
// ================================================================

/**
 * Link an existing identity to a store with its establecimiento / punto /
 * timbrado config. Fails if the store is already linked (one-per-store
 * enforced by UNIQUE on fiscal_identity_stores.store_id).
 */
export async function linkIdentityToStore(
  identityId: string,
  storeId: string,
  input: FiscalStoreLinkInput,
): Promise<FiscalIdentityStoreRow> {
  const { data, error } = await supabaseAdmin
    .from('fiscal_identity_stores')
    .insert({
      identity_id: identityId,
      store_id: storeId,
      timbrado: input.timbrado,
      timbrado_fecha_inicio: input.timbrado_fecha_inicio ?? null,
      timbrado_fecha_fin: input.timbrado_fecha_fin ?? null,
      establecimiento_codigo: input.establecimiento_codigo ?? '001',
      punto_expedicion: input.punto_expedicion ?? '001',
      establecimiento_direccion: input.establecimiento_direccion ?? null,
      establecimiento_departamento: input.establecimiento_departamento ?? null,
      establecimiento_distrito: input.establecimiento_distrito ?? null,
      establecimiento_ciudad: input.establecimiento_ciudad ?? null,
      establecimiento_telefono: input.establecimiento_telefono ?? null,
      establecimiento_email: input.establecimiento_email ?? null,
      setup_completed: true,
    })
    .select(
      'id, store_id, timbrado, timbrado_fecha_inicio, timbrado_fecha_fin, establecimiento_codigo, punto_expedicion, establecimiento_direccion, establecimiento_departamento, establecimiento_distrito, establecimiento_ciudad, establecimiento_telefono, establecimiento_email, next_document_number, is_active, setup_completed',
    )
    .single();

  if (error || !data) throw new Error(`Error vinculando identidad a tienda: ${error?.message ?? 'unknown'}`);
  return data as FiscalIdentityStoreRow;
}

/**
 * Update the per-store fields (establecimiento, punto, timbrado, etc).
 */
export async function updateStoreFields(
  storeId: string,
  input: Partial<FiscalStoreLinkInput>,
): Promise<FiscalIdentityStoreRow> {
  const patch: Record<string, unknown> = {};
  const writable: (keyof FiscalStoreLinkInput)[] = [
    'timbrado',
    'timbrado_fecha_inicio',
    'timbrado_fecha_fin',
    'establecimiento_codigo',
    'punto_expedicion',
    'establecimiento_direccion',
    'establecimiento_departamento',
    'establecimiento_distrito',
    'establecimiento_ciudad',
    'establecimiento_telefono',
    'establecimiento_email',
  ];
  for (const key of writable) {
    if (input[key] !== undefined) patch[key] = input[key];
  }

  if (Object.keys(patch).length === 0) throw new Error('Nada para actualizar.');

  const { data, error } = await supabaseAdmin
    .from('fiscal_identity_stores')
    .update(patch)
    .eq('store_id', storeId)
    .eq('is_active', true)
    .select(
      'id, store_id, timbrado, timbrado_fecha_inicio, timbrado_fecha_fin, establecimiento_codigo, punto_expedicion, establecimiento_direccion, establecimiento_departamento, establecimiento_distrito, establecimiento_ciudad, establecimiento_telefono, establecimiento_email, next_document_number, is_active, setup_completed',
    )
    .single();

  if (error || !data) throw new Error(`Error actualizando link: ${error?.message ?? 'unknown'}`);
  return data as FiscalIdentityStoreRow;
}

// ================================================================
// Certificate upload (identity-level)
// ================================================================

/**
 * Process a .p12 certificate upload at the identity level. All stores
 * linked to this identity will share the same certificate.
 *
 * Security contract (unchanged from legacy):
 *   1. Parse the .p12 in memory, extract private key PEM + certificate PEM.
 *   2. Encrypt the private key with AES-256-GCM using SIFEN_ENCRYPTION_KEY.
 *   3. Persist: cert_pem (not secret), encrypted_private_key.
 *   4. The .p12 buffer and password never reach the database.
 */
export async function uploadCertificate(
  identityId: string,
  certBuffer: Buffer,
  certPassword: string,
): Promise<{ identity_id: string; has_certificate: true }> {
  const { privateKeyPem, certPem } = await extractPemsFromP12(certBuffer, certPassword);
  const encryptedPrivateKey = encrypt(privateKeyPem);

  const { error } = await supabaseAdmin
    .from('fiscal_identities')
    .update({
      cert_pem: certPem,
      encrypted_private_key: encryptedPrivateKey,
    })
    .eq('id', identityId)
    .eq('is_active', true);

  if (error) throw new Error(`Error guardando certificado: ${error.message}`);

  // Mark all linked stores as setup_completed (certificate unblocks them).
  await supabaseAdmin
    .from('fiscal_identity_stores')
    .update({ setup_completed: true })
    .eq('identity_id', identityId)
    .eq('is_active', true);

  return { identity_id: identityId, has_certificate: true };
}

// ================================================================
// Legacy-compatible facade: keeps /api/invoicing/config working
// ================================================================

/**
 * Legacy wrapper. Returns a flat shape that mirrors the old fiscal_config
 * row (with secrets masked). Used by the current wizard until it is split
 * into identity / link / certificate.
 */
export async function getFiscalConfig(storeId: string) {
  const ctx = await getFiscalContext(storeId);
  if (!ctx) return null;

  return {
    id: ctx.link.id,
    store_id: ctx.link.store_id,
    ruc: ctx.identity.ruc,
    ruc_dv: ctx.identity.ruc_dv,
    razon_social: ctx.identity.razon_social,
    nombre_fantasia: ctx.identity.nombre_fantasia,
    tipo_contribuyente: ctx.identity.tipo_contribuyente,
    tipo_regimen: ctx.identity.tipo_regimen,
    timbrado: ctx.link.timbrado,
    timbrado_fecha_inicio: ctx.link.timbrado_fecha_inicio,
    timbrado_fecha_fin: ctx.link.timbrado_fecha_fin,
    establecimiento_codigo: ctx.link.establecimiento_codigo,
    punto_expedicion: ctx.link.punto_expedicion,
    establecimiento_direccion: ctx.link.establecimiento_direccion,
    establecimiento_departamento: ctx.link.establecimiento_departamento,
    establecimiento_distrito: ctx.link.establecimiento_distrito,
    establecimiento_ciudad: ctx.link.establecimiento_ciudad,
    establecimiento_telefono: ctx.link.establecimiento_telefono,
    establecimiento_email: ctx.link.establecimiento_email,
    actividad_economica_codigo: ctx.activities.find((a) => a.is_principal)?.codigo ?? null,
    actividad_economica_descripcion: ctx.activities.find((a) => a.is_principal)?.descripcion ?? null,
    sifen_environment: ctx.identity.sifen_environment,
    next_document_number: ctx.link.next_document_number,
    is_active: ctx.link.is_active,
    setup_completed: ctx.link.setup_completed,
    identity_id: ctx.identity.id,
    cert_pem: ctx.identity.has_certificate ? '[PRESENT]' : null,
    encrypted_private_key: ctx.identity.has_certificate ? '[PRESENT]' : null,
  };
}

/**
 * Legacy wrapper: receive the merged wizard payload and internally split
 * it into createIdentity + linkIdentityToStore. Idempotent on the link
 * (if the store already has an identity, we update in place).
 */
export async function setupFiscalConfig(
  storeId: string,
  input: {
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
  },
) {
  if (!validateRucDV(input.ruc, input.ruc_dv)) {
    throw new Error('El digito verificador (DV) no coincide con el RUC. Verifique el numero.');
  }

  // Resolve store owner (same rule as migration 161 data migration).
  const { data: ownerRow } = await supabaseAdmin
    .from('user_stores')
    .select('user_id')
    .eq('store_id', storeId)
    .eq('role', 'owner')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!ownerRow) {
    throw new Error('No se encontro owner para esta tienda.');
  }
  const ownerUserId = ownerRow.user_id as string;

  // Upsert identity (by owner + RUC + DV).
  let identityId: string;
  const { data: existingIdentity } = await supabaseAdmin
    .from('fiscal_identities')
    .select('id')
    .eq('owner_user_id', ownerUserId)
    .eq('ruc', input.ruc)
    .eq('ruc_dv', input.ruc_dv)
    .maybeSingle();

  if (existingIdentity) {
    identityId = existingIdentity.id;
    await updateIdentity(identityId, {
      razon_social: input.razon_social,
      nombre_fantasia: input.nombre_fantasia,
      tipo_contribuyente: input.tipo_contribuyente,
      tipo_regimen: input.tipo_regimen,
      sifen_environment: input.sifen_environment,
    });
  } else {
    const identity = await createIdentity(ownerUserId, {
      ruc: input.ruc,
      ruc_dv: input.ruc_dv,
      razon_social: input.razon_social,
      nombre_fantasia: input.nombre_fantasia,
      tipo_contribuyente: input.tipo_contribuyente,
      tipo_regimen: input.tipo_regimen,
      sifen_environment: input.sifen_environment,
    });
    identityId = identity.id;
  }

  // Upsert activity (legacy path exposes a single principal activity).
  if (input.actividad_economica_codigo && input.actividad_economica_descripcion) {
    const { data: existingActivity } = await supabaseAdmin
      .from('fiscal_identity_activities')
      .select('id')
      .eq('identity_id', identityId)
      .eq('codigo', input.actividad_economica_codigo)
      .maybeSingle();

    if (existingActivity) {
      await updateIdentityActivity(identityId, existingActivity.id, {
        descripcion: input.actividad_economica_descripcion,
        is_principal: true,
      });
    } else {
      await addIdentityActivity(identityId, {
        codigo: input.actividad_economica_codigo,
        descripcion: input.actividad_economica_descripcion,
        is_principal: true,
      });
    }
  }

  // Upsert link.
  const { data: existingLink } = await supabaseAdmin
    .from('fiscal_identity_stores')
    .select('id')
    .eq('store_id', storeId)
    .maybeSingle();

  if (existingLink) {
    await updateStoreFields(storeId, {
      timbrado: input.timbrado,
      timbrado_fecha_inicio: input.timbrado_fecha_inicio,
      timbrado_fecha_fin: input.timbrado_fecha_fin,
      establecimiento_codigo: input.establecimiento_codigo,
      punto_expedicion: input.punto_expedicion,
      establecimiento_direccion: input.establecimiento_direccion,
      establecimiento_departamento: input.establecimiento_departamento,
      establecimiento_distrito: input.establecimiento_distrito,
      establecimiento_ciudad: input.establecimiento_ciudad,
      establecimiento_telefono: input.establecimiento_telefono,
      establecimiento_email: input.establecimiento_email,
    });
  } else {
    await linkIdentityToStore(identityId, storeId, {
      timbrado: input.timbrado,
      timbrado_fecha_inicio: input.timbrado_fecha_inicio,
      timbrado_fecha_fin: input.timbrado_fecha_fin,
      establecimiento_codigo: input.establecimiento_codigo,
      punto_expedicion: input.punto_expedicion,
      establecimiento_direccion: input.establecimiento_direccion,
      establecimiento_departamento: input.establecimiento_departamento,
      establecimiento_distrito: input.establecimiento_distrito,
      establecimiento_ciudad: input.establecimiento_ciudad,
      establecimiento_telefono: input.establecimiento_telefono,
      establecimiento_email: input.establecimiento_email,
    });
  }

  return getFiscalConfig(storeId);
}

/**
 * Legacy wrapper: validate via RPC (which now reads from new schema).
 */
export async function validateConfig(storeId: string) {
  const { data, error } = await supabaseAdmin.rpc('validate_fiscal_config', {
    p_store_id: storeId,
  });
  if (error) throw new Error(`Error validando config: ${error.message}`);
  return data;
}

// ================================================================
// Invoice Generation
// ================================================================

export async function generateInvoice(
  storeId: string,
  orderId: string,
  opts?: { activityCode?: string },
) {
  logger.info(`[Invoicing] Generating invoice for order ${orderId} in store ${storeId}`);

  const ctx = await getFiscalContext(storeId);
  if (!ctx) {
    throw new Error('No hay configuracion fiscal activa para esta tienda.');
  }
  assertInvoicingCountry(ctx);
  assertReadyToEmit(ctx);

  const [orderResult, storeResult] = await Promise.all([
    supabaseAdmin
      .from('orders')
      .select(
        `*,
        order_line_items(id, product_name, quantity, unit_price, sku),
        customers(name, email, address)`,
      )
      .eq('id', orderId)
      .eq('store_id', storeId)
      .single(),
    supabaseAdmin.from('stores').select('name').eq('id', storeId).single(),
  ]);

  const { data: order, error: orderErr } = orderResult;
  if (orderErr || !order) throw new Error(`Order not found: ${orderId}`);

  const storeName =
    storeResult.data?.name || ctx.identity.razon_social || ctx.identity.nombre_fantasia || 'Tienda';

  if (!order.customer_ruc) {
    throw new Error('El cliente de esta orden no tiene RUC. Agrega el RUC antes de facturar.');
  }

  const { data: existingInvoice } = await supabaseAdmin
    .from('invoices')
    .select('id, cdc, sifen_status')
    .eq('order_id', orderId)
    .eq('store_id', storeId)
    .not('sifen_status', 'eq', 'cancelled')
    .single();

  if (existingInvoice) {
    throw new Error(`Ya existe una factura para esta orden (CDC: ${existingInvoice.cdc || 'pending'})`);
  }

  const { data: docNumber, error: docErr } = await supabaseAdmin.rpc('get_next_invoice_number', {
    p_store_id: storeId,
  });

  if (docErr || !docNumber) {
    throw new Error(`No se pudo obtener el siguiente numero de documento: ${docErr?.message}`);
  }

  const isDemo = ctx.identity.sifen_environment === 'demo';
  const lineItems = order.order_line_items || [];
  const subtotal = lineItems.reduce(
    (sum: number, item: any) => sum + (item.unit_price || 0) * (item.quantity || 1),
    0,
  );
  const iva10 = Math.round(subtotal / 11);
  const total = subtotal;

  // SIFEN requires the invoice date in local Paraguay time. Building it from
  // UTC at 21:00+ local drifts into "tomorrow" and the receipt is rejected.
  const storeTz = await getStoreTimezone(supabaseAdmin, storeId);
  const params = buildXmlgenParams(ctx, {
    activityCode: opts?.activityCode,
    storeTimezone: storeTz,
  });

  const today = getTodayInTimezone(storeTz);
  const numeroStr = String(docNumber).padStart(7, '0');
  const estab = ctx.link.establecimiento_codigo || '001';
  const punto = ctx.link.punto_expedicion || '001';

  const data = {
    tipoDocumento: 1,
    establecimiento: estab,
    punto,
    numero: numeroStr,
    fecha: today + 'T12:00:00',
    codigoSeguridadAleatorio: generateCodigoSeguridad(),
    tipoEmision: 1,
    tipoTransaccion: 1,
    tipoImpuesto: 1,
    moneda: 'PYG',
    cliente: {
      contribuyente: true,
      ruc:
        order.customer_ruc_dv !== undefined && order.customer_ruc_dv !== null
          ? `${order.customer_ruc}-${order.customer_ruc_dv}`
          : order.customer_ruc,
      dvRuc: order.customer_ruc_dv,
      tipoOperacion: 1,
      razonSocial: order.customer_name || order.customers?.name || 'Sin nombre',
      nombreFantasia: order.customer_name || order.customers?.name || 'Sin nombre',
      tipoContribuyente: 1,
      documentoTipo: 1,
      documentoNumero: String(order.customer_ruc || '0'),
      direccion: order.customer_address || order.customers?.address || order.address || 'Asuncion',
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
    usuario: buildUsuarioBlock(ctx),
    factura: { presencia: 1 },
    condicion: {
      tipo: order.payment_method === 'cod' ? 1 : 2,
      entregas:
        order.payment_method === 'cod'
          ? [{ tipo: 1, monto: String(total), moneda: 'PYG' }]
          : undefined,
    },
    items: lineItems.map((item: any, index: number) => ({
      codigo: item.sku || String(index + 1),
      descripcion: item.product_name || 'Producto',
      observacion: '',
      unidadMedida: 77,
      cantidad: item.quantity || 1,
      precioUnitario: item.unit_price || 0,
      cambio: 0,
      descuento: 0,
      anticipo: 0,
      ivaTipo: 1,
      ivaBase: 100,
      iva: 10,
      propina: 0,
    })),
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
    logger.error(`[Invoicing] XML generation failed: ${message}`);
    await logInvoiceEvent(storeId, null, 'error', { phase: 'xml_generation', error: message });
    throw new Error(`XML generation failed: ${message}`);
  }

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
    environment: ctx.identity.sifen_environment,
  });

  let sifenResponse: SifenResponse;
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
      const { certPem, privateKeyPem } = await loadCertificateMaterial(ctx.identity.id);
      const { xmlFinal, sifen } = await signInjectSend({
        xmlGenerated,
        docNumber,
        identity: ctx.identity,
        certPem,
        privateKeyPem,
      });
      sifenResponse = sifen;

      await logInvoiceEvent(storeId, invoice.id, 'signed', { cdc });

      const newStatus = sifenResponse.success ? 'approved' : 'rejected';
      const kudeUrl = sifenResponse.success && cdc ? buildKudeUrl(cdc) : null;
      if (sifenResponse.success) emailParams.kudeUrl = kudeUrl;

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

      if (sifenResponse.success) void dispatchInvoiceEmail(emailParams);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown SIFEN error';
      logger.error(`[Invoicing] SIFEN send failed: ${message}`);

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

  await supabaseAdmin
    .from('orders')
    .update({ invoice_id: invoice.id })
    .eq('id', orderId)
    .eq('store_id', storeId);

  logger.info(
    `[Invoicing] Invoice ${invoice.id} created for order ${orderId} (status: ${isDemo ? 'demo' : sifenResponse.success ? 'approved' : 'rejected'})`,
  );

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
  ivaRate: 10 | 5 | 0;
}

export interface ManualInvoiceInput {
  tipoDocumento: 1 | 5 | 6;
  customerName: string;
  customerRuc?: string;
  customerRucDv?: number;
  customerEmail?: string;
  items: ManualInvoiceItem[];
  activityCode?: string;
}

export async function generateManualInvoice(storeId: string, input: ManualInvoiceInput) {
  logger.info(`[Invoicing] Generating manual invoice for store ${storeId}`);

  const ctx = await getFiscalContext(storeId);
  if (!ctx) throw new Error('No hay configuracion fiscal activa para esta tienda.');
  assertInvoicingCountry(ctx);
  assertReadyToEmit(ctx);

  const storeResult = await supabaseAdmin.from('stores').select('name').eq('id', storeId).single();
  const storeName =
    storeResult.data?.name || ctx.identity.razon_social || ctx.identity.nombre_fantasia || 'Tienda';

  const { data: docNumber, error: docErr } = await supabaseAdmin.rpc('get_next_invoice_number', {
    p_store_id: storeId,
  });

  if (docErr || !docNumber) {
    throw new Error(`No se pudo obtener el siguiente numero de documento: ${docErr?.message}`);
  }

  const isDemo = ctx.identity.sifen_environment === 'demo';

  let subtotal = 0;
  let iva10 = 0;
  let iva5 = 0;
  const ivaExento = 0;

  for (const item of input.items) {
    const lineTotal = item.precioUnitario * item.cantidad;
    subtotal += lineTotal;
    if (item.ivaRate === 10) iva10 += Math.round(lineTotal / 11);
    else if (item.ivaRate === 5) iva5 += Math.round(lineTotal / 21);
  }

  const total = subtotal;
  // SIFEN requires the invoice date in local Paraguay time.
  const storeTz = await getStoreTimezone(supabaseAdmin, storeId);
  const params = buildXmlgenParams(ctx, {
    activityCode: input.activityCode,
    storeTimezone: storeTz,
  });
  const today = getTodayInTimezone(storeTz);
  const numeroStr = String(docNumber).padStart(7, '0');
  const estab = ctx.link.establecimiento_codigo || '001';
  const punto = ctx.link.punto_expedicion || '001';

  const hasRuc = !!input.customerRuc;
  const clienteRucFormatted =
    hasRuc && input.customerRucDv !== undefined
      ? `${input.customerRuc}-${input.customerRucDv}`
      : input.customerRuc || undefined;

  const xmlItemsForGen = input.items.map((item, index) => {
    const ivaTipo = item.ivaRate === 0 ? 3 : 1;
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
    tipoTransaccion: 2,
    tipoImpuesto: 1,
    moneda: 'PYG',
    cliente: {
      contribuyente: hasRuc,
      ruc: clienteRucFormatted,
      dvRuc: input.customerRucDv,
      tipoOperacion: hasRuc ? 1 : 2,
      razonSocial: input.customerName,
      nombreFantasia: input.customerName,
      tipoContribuyente: 1,
      documentoTipo: hasRuc ? undefined : 1,
      documentoNumero: hasRuc ? undefined : String(input.customerRuc || '0'),
      direccion: 'Asuncion',
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
    usuario: buildUsuarioBlock(ctx),
    factura: { presencia: 1 },
    condicion: {
      tipo: 1,
      entregas: [{ tipo: 1, monto: String(total), moneda: 'PYG' }],
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
    environment: ctx.identity.sifen_environment,
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
      const { certPem, privateKeyPem } = await loadCertificateMaterial(ctx.identity.id);
      const { xmlFinal, sifen } = await signInjectSend({
        xmlGenerated,
        docNumber,
        identity: ctx.identity,
        certPem,
        privateKeyPem,
      });
      sifenResponse = sifen;

      await logInvoiceEvent(storeId, invoice.id, 'signed', { cdc });

      const newStatus = sifenResponse.success ? 'approved' : 'rejected';
      const kudeUrl = sifenResponse.success && cdc ? buildKudeUrl(cdc) : null;
      if (sifenResponse.success) emailParams.kudeUrl = kudeUrl;

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

      if (sifenResponse.success) void dispatchInvoiceEmail(emailParams);
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

  logger.info(
    `[Invoicing] Manual invoice ${invoice.id} created (status: ${isDemo ? 'demo' : sifenResponse.success ? 'approved' : 'rejected'})`,
  );

  return {
    invoice_id: invoice.id,
    cdc,
    document_number: docNumber,
    status: isDemo ? 'demo' : sifenResponse.success ? 'approved' : 'rejected',
    kude_url: isDemo
      ? cdc
        ? buildKudeUrl(cdc)
        : null
      : sifenResponse.success && cdc
        ? buildKudeUrl(cdc)
        : null,
    response: sifenResponse,
  };
}

// ================================================================
// Invoice Queries
// ================================================================

export async function getInvoice(storeId: string, invoiceId: string) {
  const { data: invoice, error } = await supabaseAdmin
    .from('invoices')
    .select(
      'id, cdc, document_number, tipo_documento, customer_ruc, customer_ruc_dv, customer_name, customer_email, customer_address, subtotal, iva_5, iva_10, iva_exento, total, currency, sifen_status, sifen_response_code, sifen_response_message, kude_url, sent_to_sifen_at, approved_at, created_at, updated_at, order_id',
    )
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

export async function getInvoices(storeId: string, filters: InvoiceFilters = {}) {
  const { status, tipo_documento, from_date, to_date, limit = 50, offset = 0 } = filters;

  let query = supabaseAdmin
    .from('invoices')
    .select(
      'id, cdc, document_number, tipo_documento, customer_ruc, customer_name, total, sifen_status, created_at, order_id',
      { count: 'exact' },
    )
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('sifen_status', status);
  if (tipo_documento) query = query.eq('tipo_documento', tipo_documento);
  if (from_date) query = query.gte('created_at', from_date);
  if (to_date) query = query.lte('created_at', to_date);

  const { data, error, count } = await query;
  if (error) throw new Error(`Error fetching invoices: ${error.message}`);

  return { invoices: data || [], total: count || 0, limit, offset };
}

export async function getInvoiceStats(storeId: string) {
  const { data, error } = await supabaseAdmin
    .from('v_invoice_summary')
    .select('*')
    .eq('store_id', storeId)
    .maybeSingle();

  if (error) {
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

  const ctx = await getFiscalContext(storeId);
  if (!ctx) throw new Error('No hay configuracion fiscal activa para esta tienda.');

  const isDemo = ctx.identity.sifen_environment === 'demo';

  if (isDemo) {
    await supabaseAdmin
      .from('invoices')
      .update({ sifen_status: 'cancelled' })
      .eq('id', invoiceId);

    await logInvoiceEvent(storeId, invoiceId, 'cancelled', { mode: 'demo', motivo });
  } else {
    if (!ctx.identity.has_certificate) {
      throw new Error('Certificado digital no configurado. Cancelacion requiere mTLS.');
    }
    const { certPem, privateKeyPem } = await loadCertificateMaterial(ctx.identity.id);
    const mtls: SifenMtls = { certPem, privateKeyPem };

    const escapedMotivo = motivo
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
      .substring(0, 500);
    const cancelXml = `<gCamEven><mOtEve>${escapedMotivo}</mOtEve></gCamEven>`;

    const response = await sifenClient.sendEvent(
      invoice.cdc,
      2,
      cancelXml,
      ctx.identity.sifen_environment as Exclude<SifenEnv, 'demo'>,
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

    if (!response.success) throw new Error(`SIFEN cancellation failed: ${response.responseMessage}`);
  }

  if (invoice.order_id) {
    await supabaseAdmin
      .from('orders')
      .update({ invoice_id: null })
      .eq('id', invoice.order_id)
      .eq('store_id', storeId);
  }

  return { success: true, message: 'Invoice cancelled' };
}

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

  const ctx = await getFiscalContext(storeId);
  if (!ctx) throw new Error('No hay configuracion fiscal activa para esta tienda.');
  if (ctx.identity.sifen_environment === 'demo') throw new Error('Cannot retry in demo mode');
  if (!ctx.identity.has_certificate) {
    throw new Error('Certificado digital no configurado para re-firmar.');
  }

  const xmlToSend = invoice.xml_signed || invoice.xml_generated;
  if (!xmlToSend) throw new Error('No XML available for retry');

  const { certPem, privateKeyPem } = await loadCertificateMaterial(ctx.identity.id);
  const env = ctx.identity.sifen_environment as 'test' | 'prod';
  const mtls: SifenMtls = { certPem, privateKeyPem };

  let xmlFinal = invoice.xml_signed;
  if (!xmlFinal && invoice.xml_generated) {
    const xmlSigned = await signXML(invoice.xml_generated, privateKeyPem, certPem);
    xmlFinal = await injectQR(
      xmlSigned,
      env,
      ctx.identity.csc_id || SIFEN_TEST_ID_CSC,
      SIFEN_TEST_CSC,
    );
    await supabaseAdmin.from('invoices').update({ xml_signed: xmlFinal }).eq('id', invoiceId);
  }

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
  createdBy?: string,
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
