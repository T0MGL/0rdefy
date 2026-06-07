/**
 * Carrier credential storage.
 *
 * Credentials are validated against the live carrier (read-only) BEFORE they
 * are persisted: connect never stores something that does not authenticate.
 * The blob is AES-256-GCM encrypted with CARRIER_ENCRYPTION_KEY and decrypted
 * only at runtime when a push needs it. The password is never logged and never
 * leaves this module in plaintext.
 */

import { z } from 'zod';
import { supabaseAdmin } from '../../db/connection';
import { logger } from '../../utils/logger';
import { encryptWithKey, decryptWithKey } from '../shared/encryption';
import type { CarrierCredentials } from './carrier-adapter';
import { getCarrier } from './carrier-adapter';

const log = logger.child('Carrier:Credentials');
const KEY_ENV = 'CARRIER_ENCRYPTION_KEY';

const CredentialsSchema = z.object({
  username: z.string().trim().min(1, 'Usuario requerido'),
  password: z.string().min(1, 'Contrasena requerida'),
  tenantId: z.string().trim().min(1, 'TenantId requerido'),
  baseUrl: z.string().trim().url('baseUrl invalida'),
});

export interface CarrierIntegrationStatus {
  provider: string;
  isActive: boolean;
  autoPush: boolean;
  triggerStatus: string;
  validationStatus: string | null;
  lastValidatedAt: string | null;
  connectedAt: string | null;
}

export class CarrierCredentialsError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'CarrierCredentialsError';
  }
}

function encryptCredentials(creds: CarrierCredentials): string {
  return encryptWithKey(JSON.stringify(creds), KEY_ENV);
}

export function decryptCredentials(blob: string): CarrierCredentials {
  const parsed = JSON.parse(decryptWithKey(blob, KEY_ENV));
  return CredentialsSchema.parse(parsed);
}

/**
 * Validate then persist. Returns the public status (no credentials). Throws
 * CarrierCredentialsError(400) when validation fails so the route maps it to a
 * clean client error without leaking transport details.
 */
export async function connectCarrier(
  storeId: string,
  provider: string,
  rawCreds: unknown,
  triggerStatus: string,
): Promise<CarrierIntegrationStatus> {
  const entry = getCarrier(provider);
  if (!entry) {
    throw new CarrierCredentialsError(`Proveedor no soportado: ${provider}`, 400);
  }

  const creds = CredentialsSchema.parse(rawCreds);

  const validation = await entry.adapter.validateCredentials(creds);
  if (!validation.ok) {
    throw new CarrierCredentialsError(
      validation.error || 'Credenciales invalidas',
      400,
    );
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('shipping_integrations')
    .upsert(
      {
        store_id: storeId,
        provider,
        credentials_encrypted: encryptCredentials(creds),
        is_active: true,
        auto_push: true,
        trigger_status: triggerStatus,
        validation_status: 'valid',
        last_validated_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'store_id,provider' },
    )
    .select('provider, is_active, auto_push, trigger_status, validation_status, last_validated_at, created_at')
    .single();

  if (error || !data) {
    log.error('connect persist failed', { storeId, provider, error: error?.message });
    throw new CarrierCredentialsError('No se pudo guardar la conexion', 500);
  }

  return toStatus(data);
}

export async function testCarrier(
  storeId: string,
  provider: string,
): Promise<{ ok: boolean; error?: string }> {
  const entry = getCarrier(provider);
  if (!entry) {
    throw new CarrierCredentialsError(`Proveedor no soportado: ${provider}`, 400);
  }

  const creds = await loadCredentials(storeId, provider);
  if (!creds) {
    throw new CarrierCredentialsError('No hay conexion configurada para este proveedor', 404);
  }

  const result = await entry.adapter.validateCredentials(creds);

  await supabaseAdmin
    .from('shipping_integrations')
    .update({
      validation_status: result.ok ? 'valid' : 'invalid',
      last_validated_at: new Date().toISOString(),
    })
    .eq('store_id', storeId)
    .eq('provider', provider);

  return result;
}

export async function updateCarrierSettings(
  storeId: string,
  provider: string,
  patch: { autoPush?: boolean; triggerStatus?: string },
): Promise<CarrierIntegrationStatus> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.autoPush !== undefined) update.auto_push = patch.autoPush;
  if (patch.triggerStatus !== undefined) update.trigger_status = patch.triggerStatus;

  const { data, error } = await supabaseAdmin
    .from('shipping_integrations')
    .update(update)
    .eq('store_id', storeId)
    .eq('provider', provider)
    .select('provider, is_active, auto_push, trigger_status, validation_status, last_validated_at, created_at')
    .single();

  if (error || !data) {
    throw new CarrierCredentialsError('No hay conexion configurada para este proveedor', 404);
  }

  return toStatus(data);
}

export async function disconnectCarrier(storeId: string, provider: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('shipping_integrations')
    .delete()
    .eq('store_id', storeId)
    .eq('provider', provider);

  if (error) {
    throw new CarrierCredentialsError('No se pudo desconectar el proveedor', 500);
  }
}

export async function getCarrierStatus(
  storeId: string,
  provider: string,
): Promise<CarrierIntegrationStatus | null> {
  const { data, error } = await supabaseAdmin
    .from('shipping_integrations')
    .select('provider, is_active, auto_push, trigger_status, validation_status, last_validated_at, created_at')
    .eq('store_id', storeId)
    .eq('provider', provider)
    .maybeSingle();

  if (error) {
    log.error('status read failed', { storeId, provider, error: error.message });
    return null;
  }
  return data ? toStatus(data) : null;
}

/**
 * Runtime-only decryption. Returns null if no active integration exists. Used
 * by the push service and test endpoint; never exposed through a route.
 */
export async function loadCredentials(
  storeId: string,
  provider: string,
): Promise<CarrierCredentials | null> {
  const { data, error } = await supabaseAdmin
    .from('shipping_integrations')
    .select('credentials_encrypted, is_active')
    .eq('store_id', storeId)
    .eq('provider', provider)
    .maybeSingle();

  if (error || !data || !data.is_active || !data.credentials_encrypted) {
    return null;
  }
  return decryptCredentials(data.credentials_encrypted);
}

interface IntegrationRow {
  provider: string;
  is_active: boolean | null;
  auto_push: boolean | null;
  trigger_status: string | null;
  validation_status: string | null;
  last_validated_at: string | null;
  created_at: string | null;
}

function toStatus(row: IntegrationRow): CarrierIntegrationStatus {
  return {
    provider: row.provider,
    isActive: row.is_active ?? false,
    autoPush: row.auto_push ?? false,
    triggerStatus: row.trigger_status ?? 'ready_to_ship',
    validationStatus: row.validation_status,
    lastValidatedAt: row.last_validated_at,
    connectedAt: row.created_at,
  };
}
