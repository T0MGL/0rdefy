/**
 * Ordefy email brand tokens (shared by react-email templates).
 *
 * Strategy: light mode is the base palette (premium off-white surface,
 * near-black headings, lime CTA). Dark mode is layered on top via
 * `@media (prefers-color-scheme: dark)` in BaseLayout. Clients that honor
 * the preference (Apple Mail iOS / macOS, Outlook web, Samsung Mail) flip;
 * everyone else stays on the light surface that Gmail mobile would force
 * anyway.
 *
 * Inline styles in template components default to LIGHT tokens. The dark
 * media-query block in BaseLayout overrides via the `ord-*` utility
 * classes on each rendered element.
 */

const PRIMARY = '#b0e636';
const PRIMARY_HOVER = '#9acd2e';

const LIGHT_BG = '#fafafa';
const LIGHT_CARD = '#ffffff';
const LIGHT_CARD_BORDER = '#e5e5e5';
const LIGHT_HEADING = '#0a0a0b';
const LIGHT_BODY = '#52525b';
const LIGHT_SECONDARY = '#71717a';
const LIGHT_MUTED = '#a1a1aa';
const LIGHT_DIVIDER = '#e5e5e5';
const LIGHT_PANEL = '#f4f4f5';

const DARK_BG = '#09090b';
const DARK_CARD = '#131318';
const DARK_CARD_BORDER = '#27272a';
const DARK_HEADING = '#fafafa';
const DARK_BODY = '#a1a1aa';
const DARK_SECONDARY = '#71717a';
const DARK_MUTED = '#52525b';
const DARK_DIVIDER = '#27272a';
const DARK_PANEL = '#0f0f12';

export const BRAND = {
  primary: PRIMARY,
  primaryHover: PRIMARY_HOVER,

  light: {
    bg: LIGHT_BG,
    card: LIGHT_CARD,
    cardBorder: LIGHT_CARD_BORDER,
    heading: LIGHT_HEADING,
    body: LIGHT_BODY,
    secondary: LIGHT_SECONDARY,
    muted: LIGHT_MUTED,
    divider: LIGHT_DIVIDER,
    panel: LIGHT_PANEL,
  },

  dark: {
    bg: DARK_BG,
    card: DARK_CARD,
    cardBorder: DARK_CARD_BORDER,
    heading: DARK_HEADING,
    body: DARK_BODY,
    secondary: DARK_SECONDARY,
    muted: DARK_MUTED,
    divider: DARK_DIVIDER,
    panel: DARK_PANEL,
  },

  ctaText: LIGHT_HEADING,

  white: '#ffffff',
} as const;

// One asset, two URLs. The artwork is the same solid-lime wordmark cropped
// from the production favicon and recolored to brand lime (#b0e636). Solid
// lime reads correctly on both light (#fafafa) and dark (#09090b) surfaces,
// so a single PNG covers both modes. The dark URL is preserved as a stable
// hook in case a future variant ever needs to differ.
export const LOGO_URL = 'https://app.ordefy.io/email/logo.png';
export const LOGO_DARK_URL = 'https://app.ordefy.io/email/logo-on-dark.png';

export const APP_URL =
  process.env.APP_URL || process.env.FRONTEND_URL || 'https://app.ordefy.io';

export const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'soporte@ordefy.io';

export const MARKETING_URL = 'https://ordefy.io';

export const CURRENT_YEAR = new Date().getFullYear();

export const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
