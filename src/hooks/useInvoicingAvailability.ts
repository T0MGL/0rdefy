/**
 * useInvoicingAvailability
 *
 * Tells the UI whether the current store can see / use the invoicing
 * surface. Centralizes the gate so every page / component shows the
 * same Coming Soon state in sync.
 *
 * Gate rules (today, Paraguay-only):
 *   - supported: store.country === 'PY'
 *   - anything else: coming soon
 *
 * Returning a structured flag (rather than throwing) keeps the call site
 * simple: `if (!available) return <ComingSoon/>`.
 */

import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export type InvoicingStatus = 'available' | 'coming_soon' | 'no_store';

export interface InvoicingAvailability {
  available: boolean;
  status: InvoicingStatus;
  country: string | null;
  reason: string | null;
}

const SUPPORTED_COUNTRIES = new Set(['PY']);

export function useInvoicingAvailability(): InvoicingAvailability {
  const { currentStore } = useAuth();

  return useMemo(() => {
    if (!currentStore) {
      return {
        available: false,
        status: 'no_store',
        country: null,
        reason: 'No hay una tienda seleccionada.',
      };
    }

    const country = (currentStore.country || '').toUpperCase();

    if (SUPPORTED_COUNTRIES.has(country)) {
      return { available: true, status: 'available', country, reason: null };
    }

    return {
      available: false,
      status: 'coming_soon',
      country,
      reason: `La facturacion electronica aun no esta disponible en ${country}.`,
    };
  }, [currentStore]);
}
