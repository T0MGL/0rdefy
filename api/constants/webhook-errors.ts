/**
 * Standardized Webhook Error Messages
 *
 * SECURITY: These generic error messages prevent information disclosure
 * to external callers (OWASP A01:2021 - Broken Access Control).
 *
 * Internal details are logged server-side but never exposed to clients.
 */

export const WEBHOOK_ERRORS = {
  // Generic errors that don't reveal implementation details
  VERIFICATION_FAILED: 'Webhook verification failed',
  INTERNAL_ERROR: 'Error interno del servidor',
  INVALID_PAYLOAD: 'Invalid webhook payload',
  UNAUTHORIZED: 'Unauthorized',
  NOT_FOUND: 'Not found',

  // Configuration errors (still generic)
  SERVER_CONFIGURATION_ERROR: 'Error interno del servidor',
  SECRET_NOT_CONFIGURED: 'Error interno del servidor',

  // Processing errors
  PROCESSING_FAILED: 'Webhook processing failed',
  RETRY_LATER: 'Internal error - will retry',
} as const;

export type WebhookErrorType = typeof WEBHOOK_ERRORS[keyof typeof WEBHOOK_ERRORS];
