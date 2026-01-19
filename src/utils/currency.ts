// ================================================================
// CURRENCY FORMATTING UTILITIES
// ================================================================
// Centralizes currency formatting based on store configuration
// ================================================================

import { logger } from '@/utils/logger';

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
    const currentStoreId = localStorage.getItem('current_store_id');

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
 * Get just the currency symbol for the current store
 */
export function getCurrencySymbol(currencyCode?: string): string {
  const currency = currencyCode || getCurrentCurrency();
  const config = CURRENCY_CONFIG[currency] || CURRENCY_CONFIG['PYG'];
  return config.symbol;
}

/**
 * Parse a formatted currency string to number
 * @param formattedValue - The formatted currency string
 * @returns Numeric value
 */
export function parseCurrency(formattedValue: string): number {
  // Remove all non-numeric characters except decimal separator
  const cleaned = formattedValue.replace(/[^\d.,]/g, '');

  // Handle different decimal separators
  const normalized = cleaned.replace(/\./g, '').replace(',', '.');

  return parseFloat(normalized) || 0;
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
