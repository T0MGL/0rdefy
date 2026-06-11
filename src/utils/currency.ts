// ================================================================
// CURRENCY FORMATTING UTILITIES
// ================================================================
// Centralizes currency formatting based on store configuration
// ================================================================

import { logger } from '@/utils/logger';
import { getActiveStoreId } from '@/lib/activeStore';

/**
 * Currency configuration mapping
 * Maps currency codes to their locale and formatting options
 */
const CURRENCY_CONFIG: Record<string, {
  locale: string;
  symbol: string;
  decimals: number;
}> = {
  'PYG': {
    locale: 'es-PY',
    symbol: 'Gs.',
    decimals: 0,
  },
  'USD': {
    locale: 'en-US',
    symbol: '$',
    decimals: 2,
  },
  'ARS': {
    locale: 'es-AR',
    symbol: '$',
    decimals: 2,
  },
  'BRL': {
    locale: 'pt-BR',
    symbol: 'R$',
    decimals: 2,
  },
  'CLP': {
    locale: 'es-CL',
    symbol: '$',
    decimals: 0,
  },
  'COP': {
    locale: 'es-CO',
    symbol: '$',
    decimals: 0,
  },
  'MXN': {
    locale: 'es-MX',
    symbol: '$',
    decimals: 2,
  },
  'UYU': {
    locale: 'es-UY',
    symbol: '$',
    decimals: 2,
  },
  'EUR': {
    locale: 'es-ES',
    symbol: '€',
    decimals: 2,
  },
};

/**
 * Get currency from current store
 */
export function getCurrentCurrency(): string {
  try {
    const user = localStorage.getItem('user');
    const currentStoreId = getActiveStoreId();

    if (!user || !currentStoreId) {
      return 'PYG'; // Default to Paraguayan Guaraní
    }

    const userData = JSON.parse(user);
    const currentStore = userData.stores?.find((s: any) => s.id === currentStoreId);

    return currentStore?.currency || 'PYG';
  } catch (error) {
    logger.error('Error getting current currency:', error);
    return 'PYG';
  }
}

/**
 * Get currency configuration for the current store
 */
export function getCurrencyConfig() {
  const currency = getCurrentCurrency();
  return CURRENCY_CONFIG[currency] || CURRENCY_CONFIG['PYG'];
}

/**
 * Format a number as currency using the current store's currency
 * @param value - The numeric value to format
 * @param currencyCode - Optional currency code override (defaults to store currency)
 * @returns Formatted currency string
 */
export function formatCurrency(value: number, currencyCode?: string): string {
  // A non-finite amount means the caller computed garbage (NaN division,
  // Infinity overflow) or passed through a failed fetch. Rendering
  // "Gs. NaN" misleads operators into reading it as a real figure.
  if (!Number.isFinite(value)) {
    return 'N/A';
  }

  const currency = currencyCode || getCurrentCurrency();
  const config = CURRENCY_CONFIG[currency] || CURRENCY_CONFIG['PYG'];

  try {
    return new Intl.NumberFormat(config.locale, {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: config.decimals,
      maximumFractionDigits: config.decimals,
    }).format(value);
  } catch (error) {
    // Fallback to manual formatting if Intl fails
    logger.error('Error formatting currency:', error);
    const formatted = value.toLocaleString(config.locale, {
      minimumFractionDigits: config.decimals,
      maximumFractionDigits: config.decimals,
    });
    return `${config.symbol} ${formatted}`;
  }
}

/**
 * Format a nullable amount. Null and undefined mean "not computable"
 * (failed fetch, zero denominator, missing data) and render the fallback
 * instead of a fake zero.
 */
export function formatCurrencyOrFallback(
  value: number | null | undefined,
  fallback: string = 'N/A',
  currencyCode?: string
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return formatCurrency(value, currencyCode);
}

/**
 * Format a rate/ratio as a percentage. Null and undefined mean the rate was
 * not computable (denominator zero, missing data) and render 'N/A', which is
 * different from a real 0%.
 */
export function formatPercent(
  value: number | null | undefined,
  decimals: number = 1
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'N/A';
  }
  return `${value.toFixed(decimals)}%`;
}

/**
 * Compact currency for tight layouts (cards, projections): 1,234,567 PYG
 * renders as "Gs. 1.235K". Non-finite or nullable input renders 'N/A',
 * mirroring formatCurrencyOrFallback.
 */
export function formatCompactCurrency(
  value: number | null | undefined,
  currencyCode?: string
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'N/A';
  }

  const currency = currencyCode || getCurrentCurrency();
  const config = CURRENCY_CONFIG[currency] || CURRENCY_CONFIG['PYG'];

  if (Math.abs(value) < 1000) {
    return formatCurrency(value, currency);
  }

  const thousands = value / 1000;
  const formatted = thousands.toLocaleString(config.locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(thousands) < 100 ? 1 : 0,
  });
  return `${config.symbol} ${formatted}K`;
}

/**
 * Get just the currency symbol for the current store
 */
export function getCurrencySymbol(currencyCode?: string): string {
  const currency = currencyCode || getCurrentCurrency();
  const config = CURRENCY_CONFIG[currency] || CURRENCY_CONFIG['PYG'];
  return config.symbol;
}

/**
 * Parse a formatted currency string to number.
 *
 * Returns NaN on empty or non-numeric input (same contract as
 * parseAmountInput). Callers must check Number.isFinite() before using the
 * result. A silent 0 here would turn a typo into a real amount.
 */
export function parseCurrency(formattedValue: string): number {
  if (typeof formattedValue !== 'string') return NaN;

  // Remove all non-numeric characters except decimal separator
  const cleaned = formattedValue.replace(/[^\d.,]/g, '');
  if (cleaned === '') return NaN;

  // Handle different decimal separators
  const normalized = cleaned.replace(/\./g, '').replace(',', '.');

  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * Parse a user-typed monetary amount into a number, respecting the
 * currency's decimal precision.
 *
 * For 0-decimal currencies (PYG/CLP/COP), every separator is treated as a
 * thousands separator and stripped: "150", "150.000", "150,000", "Gs 150.000"
 * all parse to 150000. This is the only safe parse for PY couriers — Number()
 * naively reads "150.000" as 150.
 *
 * For decimal currencies the last separator wins as decimal, the rest are
 * thousands. "150,000.50" (US) and "150.000,50" (PY/AR) both yield 150000.5.
 *
 * Returns NaN on empty or non-numeric input — callers must check
 * Number.isFinite() before persisting. Never returns 0 silently.
 */
export function parseAmountInput(input: string, decimals: number = 0): number {
  if (typeof input !== 'string') return NaN;
  const trimmed = input.trim();
  if (trimmed === '') return NaN;

  if (decimals === 0) {
    const digits = trimmed.replace(/[^\d]/g, '');
    if (digits === '') return NaN;
    return parseInt(digits, 10);
  }

  const cleaned = trimmed.replace(/[^\d.,]/g, '');
  if (cleaned === '') return NaN;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  let normalized: string;
  if (lastComma > lastDot) {
    // Comma is decimal (PY/AR/BR/ES). Strip all dots, replace last comma.
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma) {
    // Dot is decimal (US/EN). Strip all commas. Multiple dots means earlier
    // dots were thousands grouping (Swiss/etc) — strip every dot except the
    // last one. Without this, parseFloat('1.234.567') silently returns 1.234.
    const noCommas = cleaned.replace(/,/g, '');
    const lastDotInNoCommas = noCommas.lastIndexOf('.');
    if ((noCommas.match(/\./g) ?? []).length > 1) {
      normalized =
        noCommas.slice(0, lastDotInNoCommas).replace(/\./g, '') +
        '.' +
        noCommas.slice(lastDotInNoCommas + 1);
    } else {
      normalized = noCommas;
    }
  } else {
    normalized = cleaned;
  }

  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * Hook to use currency formatting in React components
 * Can be used directly or via the formatCurrency function
 */
export function useCurrency() {
  const currency = getCurrentCurrency();
  const config = getCurrencyConfig();

  return {
    currency,
    symbol: config.symbol,
    locale: config.locale,
    decimals: config.decimals,
    format: (value: number) => formatCurrency(value, currency),
  };
}
