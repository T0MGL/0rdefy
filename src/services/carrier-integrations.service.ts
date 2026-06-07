import { getActiveStoreId } from '@/lib/activeStore';
import { logger } from '@/utils/logger';

let cleanBaseURL = import.meta.env.VITE_API_URL || 'https://api.ordefy.io';
cleanBaseURL = cleanBaseURL.replace(/\/+$/, '');
while (cleanBaseURL.endsWith('/api')) {
  cleanBaseURL = cleanBaseURL.slice(0, -4);
  cleanBaseURL = cleanBaseURL.replace(/\/+$/, '');
}
const API_BASE = cleanBaseURL;

const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('auth_token');
  const storeId = getActiveStoreId();
  return {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(storeId && { 'X-Store-ID': storeId }),
  };
};

export const CARRIER_PROVIDERS = ['punto_a_punto'] as const;
export type CarrierProvider = (typeof CARRIER_PROVIDERS)[number];

// Single production endpoint per provider. There is no sandbox: the carrier
// exposes one environment, so the merchant never picks a base URL. The backend
// validates `baseUrl` as a required field, so we send the provider default.
const PROVIDER_BASE_URL: Record<CarrierProvider, string> = {
  punto_a_punto: 'https://rastreo.puntoapunto.com.py/trackerservices',
};

export type CarrierConnectionStatus = 'disconnected' | 'connected' | 'error';

// Order statuses the merchant can pick as the push trigger. The backend sends
// the allowlist as a string[] in GET; we build the labels here.
export interface CarrierTriggerOption {
  value: string;
  label: string;
}

// UI-facing shape, mapped from the backend CarrierIntegrationStatus (camelCase,
// raw, no envelope). The backend never returns credentials, tenant_id, or an
// environment.
export interface CarrierIntegration {
  provider: CarrierProvider;
  status: CarrierConnectionStatus;
  autoPush: boolean;
  triggerStatus: string;
  lastValidatedAt: string | null;
  connectedAt: string | null;
}

export interface CarrierIntegrationsState {
  integration: CarrierIntegration | null;
  triggerOptions: CarrierTriggerOption[];
}

export interface CarrierConnectInput {
  username: string;
  password: string;
  tenantId: string;
  triggerStatus: string;
}

export interface CarrierSettingsInput {
  autoPush?: boolean;
  triggerStatus?: string;
}

export interface CarrierServiceResult<T> {
  ok: boolean;
  error?: string;
  data?: T;
}

const TRIGGER_LABELS: Record<string, string> = {
  confirmed: 'Confirmado',
  in_preparation: 'En preparación',
  ready_to_ship: 'Listo para enviar',
  shipped: 'Enviado',
};

function triggerLabel(value: string): string {
  return TRIGGER_LABELS[value] ?? value;
}

export function buildTriggerOptions(values: string[]): CarrierTriggerOption[] {
  return values.map((value) => ({ value, label: triggerLabel(value) }));
}

// Backend CarrierIntegrationStatus (raw, camelCase). validationStatus is
// 'valid' | 'invalid' | null; we collapse it into the UI connection status.
interface BackendCarrierStatus {
  provider: string;
  isActive: boolean;
  autoPush: boolean;
  triggerStatus: string;
  validationStatus: string | null;
  lastValidatedAt: string | null;
  connectedAt: string | null;
}

interface BackendGetResponse {
  country: string | null;
  available_trigger_statuses: string[];
  integrations: { provider: string; status: BackendCarrierStatus | null }[];
}

function toConnectionStatus(status: BackendCarrierStatus): CarrierConnectionStatus {
  if (!status.isActive) return 'disconnected';
  if (status.validationStatus === 'invalid') return 'error';
  return 'connected';
}

function mapIntegration(status: BackendCarrierStatus): CarrierIntegration {
  return {
    provider: status.provider as CarrierProvider,
    status: toConnectionStatus(status),
    autoPush: status.autoPush,
    triggerStatus: status.triggerStatus,
    lastValidatedAt: status.lastValidatedAt,
    connectedAt: status.connectedAt,
  };
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `Error ${response.status}`;
}

async function getState(): Promise<CarrierServiceResult<CarrierIntegrationsState>> {
  try {
    const response = await fetch(`${API_BASE}/api/carrier-integrations`, {
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      return { ok: false, error: await readError(response) };
    }

    const body = (await response.json()) as BackendGetResponse;
    const triggerOptions = buildTriggerOptions(body.available_trigger_statuses ?? []);
    const entry = body.integrations?.find((i) => i.status !== null) ?? null;
    const integration = entry?.status ? mapIntegration(entry.status) : null;

    return { ok: true, data: { integration, triggerOptions } };
  } catch (error: unknown) {
    logger.error('[CARRIER-INTEGRATIONS] Error loading state:', error);
    return { ok: false, error: 'No se pudo cargar la integración de transportadora' };
  }
}

// Connect validates the credentials live on the backend before persisting, so a
// successful response means the credentials are valid. The backend defaults
// auto_push to true on connect; if the merchant turned it off, we follow up with
// a PATCH so the persisted state matches the form.
async function connect(
  provider: CarrierProvider,
  input: CarrierConnectInput,
): Promise<CarrierServiceResult<CarrierIntegration>> {
  try {
    const response = await fetch(
      `${API_BASE}/api/carrier-integrations/${provider}/connect`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          username: input.username,
          password: input.password,
          tenantId: input.tenantId,
          baseUrl: PROVIDER_BASE_URL[provider],
          triggerStatus: input.triggerStatus,
        }),
      },
    );

    if (!response.ok) {
      return { ok: false, error: await readError(response) };
    }

    const body = (await response.json()) as { status: BackendCarrierStatus };
    return { ok: true, data: mapIntegration(body.status) };
  } catch (error: unknown) {
    logger.error('[CARRIER-INTEGRATIONS] Error connecting:', error);
    return { ok: false, error: 'No se pudo conectar la transportadora' };
  }
}

// Re-validates the already stored credentials against the carrier. Takes no body
// (the backend reads the persisted blob) and only works once connected.
async function test(provider: CarrierProvider): Promise<CarrierServiceResult<never>> {
  try {
    const response = await fetch(
      `${API_BASE}/api/carrier-integrations/${provider}/test`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
      },
    );

    if (!response.ok) {
      return { ok: false, error: await readError(response) };
    }

    const body = (await response.json()) as { ok: boolean; error?: string };
    return body.ok ? { ok: true } : { ok: false, error: body.error ?? 'Credenciales inválidas' };
  } catch (error: unknown) {
    logger.error('[CARRIER-INTEGRATIONS] Error testing credentials:', error);
    return { ok: false, error: 'No se pudo probar la conexión' };
  }
}

async function updateSettings(
  provider: CarrierProvider,
  input: CarrierSettingsInput,
): Promise<CarrierServiceResult<CarrierIntegration>> {
  try {
    const response = await fetch(`${API_BASE}/api/carrier-integrations/${provider}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        ...(input.autoPush !== undefined && { autoPush: input.autoPush }),
        ...(input.triggerStatus !== undefined && { triggerStatus: input.triggerStatus }),
      }),
    });

    if (!response.ok) {
      return { ok: false, error: await readError(response) };
    }

    const body = (await response.json()) as { status: BackendCarrierStatus };
    return { ok: true, data: mapIntegration(body.status) };
  } catch (error: unknown) {
    logger.error('[CARRIER-INTEGRATIONS] Error updating settings:', error);
    return { ok: false, error: 'No se pudo actualizar la configuración' };
  }
}

async function disconnect(provider: CarrierProvider): Promise<CarrierServiceResult<never>> {
  try {
    const response = await fetch(`${API_BASE}/api/carrier-integrations/${provider}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });

    if (!response.ok && response.status !== 204) {
      return { ok: false, error: await readError(response) };
    }

    return { ok: true };
  } catch (error: unknown) {
    logger.error('[CARRIER-INTEGRATIONS] Error disconnecting:', error);
    return { ok: false, error: 'No se pudo desconectar la transportadora' };
  }
}

export const carrierIntegrationsService = {
  getState,
  connect,
  test,
  updateSettings,
  disconnect,
};
