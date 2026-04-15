/**
 * require-invoicing-country middleware
 *
 * Gates the invoicing surface to stores whose country code is supported
 * by the backend. Today that means Paraguay only (SIFEN). AR/BR/UY/CL/MX
 * are on the roadmap but their tax engines are not wired in, so the gate
 * is intentionally strict.
 *
 * Applied to:
 *   - /api/fiscal/*  (identity + store-link management)
 *   - /api/invoices/* (invoice CRUD / generation)
 *   - /api/sifen/*   (low-level SIFEN ops)
 *
 * This is a different gate than `requireParaguayStore` inside the legacy
 * invoicing router: this one reads stores.country as a first-class field
 * (after migration 162 made it NOT NULL + CHECK constrained) and returns
 * a structured 403 with a code the frontend uses to render ComingSoon.
 */

import type { Response, NextFunction } from 'express';
import type { PermissionRequest } from './permissions';
import { supabaseAdmin } from '../db/connection';
import { logger } from '../utils/logger';

// Countries whose invoicing backend is implemented. Adding a country here
// without also adding its tax engine is a bug; keep the list short and
// explicit.
const SUPPORTED_INVOICING_COUNTRIES = new Set<string>(['PY']);

export async function requireInvoicingCountry(
  req: PermissionRequest,
  res: Response,
  next: NextFunction,
): Promise<void | Response> {
  const storeId = req.storeId;
  if (!storeId) {
    return res.status(401).json({ error: 'Store ID required', code: 'NO_STORE_ID' });
  }

  try {
    const { data: store, error } = await supabaseAdmin
      .from('stores')
      .select('country')
      .eq('id', storeId)
      .single();

    if (error || !store) {
      logger.warn('BACKEND', `[requireInvoicingCountry] Store not found: ${storeId}`);
      return res.status(404).json({ error: 'Store not found', code: 'STORE_NOT_FOUND' });
    }

    const country = (store.country ?? '').toUpperCase();

    if (!SUPPORTED_INVOICING_COUNTRIES.has(country)) {
      return res.status(403).json({
        error: 'Facturacion electronica no disponible para este pais',
        code: 'INVOICING_COUNTRY_UNSUPPORTED',
        country,
        supported_countries: Array.from(SUPPORTED_INVOICING_COUNTRIES),
      });
    }

    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    logger.error('BACKEND', `[requireInvoicingCountry] Error: ${message}`);
    return res.status(500).json({ error: 'Error validating invoicing country' });
  }
}
