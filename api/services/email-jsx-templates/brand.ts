/**
 * Ordefy email brand tokens (shared by react-email templates).
 *
 *   Primary (lime green): #b0e636
 *   Dark bg:              #09090b
 *   Card bg:              #131318
 *   Card border:          #1f1f26
 *   Text primary:         #f2f2f2
 *   Text secondary:       #9ca3af
 *   Text muted:           #6b7280
 */

export const BRAND = {
  primary: '#b0e636',
  primaryDark: '#9acd2e',
  bg: '#09090b',
  card: '#131318',
  cardBorder: '#1f1f26',
  text: '#f2f2f2',
  textSecondary: '#9ca3af',
  textMuted: '#6b7280',
  white: '#ffffff',
  divider: '#1f1f26',
  footerBg: '#060608',
} as const;

export const LOGO_URL = 'https://app.ordefy.io/favicon.png';

export const APP_URL =
  process.env.APP_URL || process.env.FRONTEND_URL || 'https://app.ordefy.io';

export const CURRENT_YEAR = new Date().getFullYear();
