/**
 * Carrier integration routes.
 *
 * Lets a store connect a carrier (Punto a Punto in v1) so orders push
 * automatically when they reach the merchant-chosen status. Gated by:
 *   - module access (Module.CARRIERS)
 *   - store country (provider availableCountries, PY only for Punto a Punto)
 *   - plan feature (has_feature_access 'carrier_integrations', Growth+)
 *
 * Credentials are never returned. Rate limiting is applied app-wide on /api/
 * (writeOperationsLimiter + apiLimiter in index.ts).
 */

import express, { Response } from 'express';
import { z } from 'zod';
import { verifyToken, extractStoreId } from '../middleware/auth';
import { extractUserRole, requireModule, requireRole, PermissionRequest } from '../middleware/permissions';
import { requireFeature } from '../middleware/planLimits';
import { Module, Role } from '../permissions';
import { supabaseAdmin } from '../db/connection';
import { logger } from '../utils/logger';
import {
  connectCarrier,
  testCarrier,
  updateCarrierSettings,
  disconnectCarrier,
  getCarrierStatus,
  CarrierCredentialsError,
} from '../services/carriers/credentials.service';
import { isProviderAvailableInCountry, listProvidersForCountry } from '../services/carriers/registry';

const log = logger.child('CarrierIntegrations');

export const carrierIntegrationsRouter = express.Router();

carrierIntegrationsRouter.use(verifyToken);
carrierIntegrationsRouter.use(extractStoreId);
carrierIntegrationsRouter.use(extractUserRole);
carrierIntegrationsRouter.use(requireModule(Module.CARRIERS));

// Order statuses a merchant may pick as the push trigger. Mirrors the order
// status machine in orders.ts; kept narrow so the dropdown and the gate agree.
const TRIGGER_STATUSES = [
  'confirmed',
  'in_preparation',
  'ready_to_ship',
  'shipped',
] as const;

const ProviderParamSchema = z.object({
  provider: z.string().trim().min(1).max(30),
});

// Punto a Punto has a single production endpoint and no per-account sandbox.
// baseUrl is fixed server-side, never accepted from the client: a merchant
// cannot point the integration at an arbitrary host.
const PUNTO_A_PUNTO_BASE_URL = 'https://rastreo.puntoapunto.com.py/trackerservices';

const CARRIER_BASE_URLS: Record<string, string> = {
  punto_a_punto: PUNTO_A_PUNTO_BASE_URL,
};

function resolveBaseUrl(provider: string): string {
  return CARRIER_BASE_URLS[provider] ?? PUNTO_A_PUNTO_BASE_URL;
}

// Strips unknown keys (Zod default, no .strict()): the frontend also sends a
// `baseUrl` for symmetry, but the server is the source of truth for it and
// drops the client value here, then re-injects the fixed URL in the handler.
// Extra fields never cause a 400; known fields are validated explicitly.
const ConnectSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
  tenantId: z.string().trim().min(1),
  triggerStatus: z.enum(TRIGGER_STATUSES).default('ready_to_ship'),
});

const PatchSchema = z
  .object({
    autoPush: z.boolean().optional(),
    triggerStatus: z.enum(TRIGGER_STATUSES).optional(),
  })
  .refine((v) => v.autoPush !== undefined || v.triggerStatus !== undefined, {
    message: 'Nada para actualizar',
  });

async function getStoreCountry(storeId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('stores')
    .select('country')
    .eq('id', storeId)
    .single();
  if (error || !data) return null;
  return (data.country ?? '').toUpperCase() || null;
}

function handleError(res: Response, route: string, err: unknown): Response {
  if (err instanceof CarrierCredentialsError) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  if (err instanceof z.ZodError) {
    return res.status(400).json({ error: 'Datos invalidos', details: err.flatten() });
  }
  log.error(`${route} failed`, { error: err instanceof Error ? err.message : String(err) });
  return res.status(500).json({ error: 'Error interno' });
}

// GET: connection state for known providers + the trigger statuses for the
// dropdown. Only providers available in the store country are surfaced. Never
// returns credentials.
carrierIntegrationsRouter.get('/', async (req: PermissionRequest, res: Response) => {
  try {
    const storeId = req.storeId!;
    const country = await getStoreCountry(storeId);
    const providers = country ? listProvidersForCountry(country) : [];

    const integrations = await Promise.all(
      providers.map(async (provider) => ({
        provider,
        status: await getCarrierStatus(storeId, provider),
      })),
    );

    res.json({
      country,
      available_trigger_statuses: TRIGGER_STATUSES,
      integrations,
    });
  } catch (err) {
    handleError(res, 'GET /', err);
  }
});

carrierIntegrationsRouter.post(
  '/:provider/connect',
  requireRole(Role.OWNER),
  requireFeature('carrier_integrations'),
  async (req: PermissionRequest, res: Response) => {
    try {
      const storeId = req.storeId!;
      const { provider } = ProviderParamSchema.parse(req.params);

      const country = await getStoreCountry(storeId);
      if (!country || !isProviderAvailableInCountry(provider, country)) {
        return res.status(403).json({
          error: 'Este proveedor no esta disponible para el pais de tu tienda',
          code: 'CARRIER_COUNTRY_UNSUPPORTED',
          country,
        });
      }

      const body = ConnectSchema.parse(req.body);
      const credentials = {
        username: body.username,
        password: body.password,
        tenantId: body.tenantId,
        baseUrl: resolveBaseUrl(provider),
      };
      const status = await connectCarrier(storeId, provider, credentials, body.triggerStatus);
      res.status(201).json({ status });
    } catch (err) {
      handleError(res, 'POST /:provider/connect', err);
    }
  },
);

carrierIntegrationsRouter.post(
  '/:provider/test',
  requireRole(Role.OWNER),
  async (req: PermissionRequest, res: Response) => {
    try {
      const storeId = req.storeId!;
      const { provider } = ProviderParamSchema.parse(req.params);
      const result = await testCarrier(storeId, provider);
      res.json(result);
    } catch (err) {
      handleError(res, 'POST /:provider/test', err);
    }
  },
);

carrierIntegrationsRouter.patch(
  '/:provider',
  requireRole(Role.OWNER),
  async (req: PermissionRequest, res: Response) => {
    try {
      const storeId = req.storeId!;
      const { provider } = ProviderParamSchema.parse(req.params);
      const patch = PatchSchema.parse(req.body);
      const status = await updateCarrierSettings(storeId, provider, patch);
      res.json({ status });
    } catch (err) {
      handleError(res, 'PATCH /:provider', err);
    }
  },
);

carrierIntegrationsRouter.delete(
  '/:provider',
  requireRole(Role.OWNER),
  async (req: PermissionRequest, res: Response) => {
    try {
      const storeId = req.storeId!;
      const { provider } = ProviderParamSchema.parse(req.params);
      await disconnectCarrier(storeId, provider);
      res.status(204).send();
    } catch (err) {
      handleError(res, 'DELETE /:provider', err);
    }
  },
);
