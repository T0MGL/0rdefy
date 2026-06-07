/**
 * Punto a Punto adapter.
 *
 * Auth is ABP token-based: POST /api/TokenAuth/Authenticate with the
 * Abp.TenantId header. Observed token validity is ~30 days; we cache 24h in
 * memory (conservative) keyed by the account identity, so each store reuses its
 * token without re-authenticating on every push.
 *
 * Write path is CreatePaqueteV2 (flat schema). It dispatches a real package and
 * has no cancel endpoint, so callers must guarantee idempotency before invoking
 * createShipment (see carrier-push.service claim_carrier_push).
 */

import crypto from 'crypto';
import { logger } from '../../../utils/logger';
import type {
  CarrierAdapter,
  CarrierCredentials,
  CarrierOrderInput,
  CarrierShipmentResult,
} from '../carrier-adapter';
import {
  AbpErrorSchema,
  AuthResponseSchema,
  ComboboxItemsSchema,
  CreatePaqueteV2RequestSchema,
  CreatePaqueteV2ResponseSchema,
  PaqueteInfoByReferenciaSchema,
  PAQUETE_DEFAULTS,
} from './types';

const log = logger.child('Carrier:PuntoAPunto');

const TOKEN_TTL_MS = 24 * 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 20_000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

// Cache key is derived from the account identity, never the password, so the
// password never lands in a map key or a log line.
function cacheKey(creds: CarrierCredentials): string {
  return crypto
    .createHash('sha256')
    .update(`${creds.baseUrl}|${creds.tenantId}|${creds.username}`)
    .digest('hex');
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

class PuntoAPuntoError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly code?: number,
  ) {
    super(message);
    this.name = 'PuntoAPuntoError';
  }
}

async function request(
  creds: CarrierCredentials,
  path: string,
  init: { method: 'GET' | 'POST'; token?: string; body?: unknown },
): Promise<unknown> {
  const url = `${normalizeBaseUrl(creds.baseUrl)}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: init.method,
      headers: {
        'Content-Type': 'application/json',
        'Abp.TenantId': creds.tenantId,
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new PuntoAPuntoError(`Non-JSON response (HTTP ${res.status})`, res.status);
      }
    }

    if (!res.ok) {
      const abp = AbpErrorSchema.safeParse(parsed);
      const message = abp.success
        ? abp.data.error.message || abp.data.error.details || `HTTP ${res.status}`
        : `HTTP ${res.status}`;
      throw new PuntoAPuntoError(message, res.status, abp.success ? abp.data.error.code : undefined);
    }

    return parsed;
  } catch (err) {
    if (err instanceof PuntoAPuntoError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new PuntoAPuntoError('Punto a Punto request timed out', null);
    }
    throw new PuntoAPuntoError(
      err instanceof Error ? err.message : 'Unknown transport error',
      null,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function authenticate(creds: CarrierCredentials): Promise<string> {
  const key = cacheKey(creds);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const raw = await request(creds, '/api/TokenAuth/Authenticate', {
    method: 'POST',
    body: { usernameOrEmailAddress: creds.username, password: creds.password },
  });

  const parsed = AuthResponseSchema.parse(raw);
  const token = parsed.result.accessToken;
  tokenCache.set(key, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

function mapOrderToPayload(order: CarrierOrderInput) {
  return CreatePaqueteV2RequestSchema.parse({
    nroGuia1: order.orderNumber,
    nombre: order.customerName,
    tipoPaquete: PAQUETE_DEFAULTS.tipoPaquete,
    descripcion: order.description,
    referencia: order.orderNumber,
    tipoEntrega: PAQUETE_DEFAULTS.tipoEntrega,
    prioridadEntrega: PAQUETE_DEFAULTS.prioridadEntrega,
    direccion: order.address,
    vencimiento: null,
    telefono: order.customerPhone,
    nroDoc: order.customerDocument,
    importe: order.codAmount,
    dpto: order.department,
    ciudad: order.city,
    // TODO(gaston): confirm formaPago handling after the live smoke test.
    // CreatePaqueteV2 has no formaPago field, so COD is conveyed by importe>0.
    // V1 CreatePaquete supports formaPago='Efectivo' under a nested cliente
    // object if the courier later requires it explicitly.
  });
}

export const puntoAPuntoAdapter: CarrierAdapter = {
  async validateCredentials(creds) {
    try {
      const token = await authenticate(creds);
      const raw = await request(
        creds,
        '/api/services/app/Lookup/GetDatosComboboxItems?idTabla=TP',
        { method: 'GET', token },
      );
      const parsed = ComboboxItemsSchema.parse(raw);
      if (parsed.result.items.length === 0) {
        return { ok: false, error: 'Catalogo vacio, no se pudo validar la cuenta' };
      }
      return { ok: true };
    } catch (err) {
      const message =
        err instanceof PuntoAPuntoError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Error desconocido';
      // Invalid credentials are an expected outcome of connect, log at warn.
      log.warn('validateCredentials failed', { tenantId: creds.tenantId, message });
      return { ok: false, error: message };
    }
  },

  async findExistingByReference(creds, reference) {
    const token = await authenticate(creds);
    const raw = await request(
      creds,
      `/api/services/app/External/GetPaqueteInfoByReferencia?referencia=${encodeURIComponent(reference)}`,
      { method: 'GET', token },
    );
    const parsed = PaqueteInfoByReferenciaSchema.parse(raw);
    const result = parsed.result;
    if (result && result.id != null) {
      return { externalId: String(result.id), nroGuia: result.nroGuia ?? '' };
    }
    return null;
  },

  async createShipment(creds, order): Promise<CarrierShipmentResult> {
    const token = await authenticate(creds);
    const payload = mapOrderToPayload(order);

    const raw = await request(creds, '/api/services/app/External/CreatePaqueteV2', {
      method: 'POST',
      token,
      body: payload,
    });

    const parsed = CreatePaqueteV2ResponseSchema.parse(raw);
    return {
      externalId: String(parsed.result.id),
      nroGuia: parsed.result.nroGuia,
    };
  },
};

export function __clearTokenCacheForTests(): void {
  tokenCache.clear();
}
