BEGIN;

-- ================================================================
-- Migration 136: Add webhook_signing_secret to shopify_oauth_states
-- ================================================================
-- Shopify Custom Apps (Dev Dashboard) use a separate signing secret
-- for webhook HMAC verification, distinct from the client_secret
-- used for OAuth token exchange.
--
-- This column stores the optional signing secret during the OAuth flow
-- so the callback can persist it as webhook_signature in
-- shopify_integrations. When not provided, client_secret is used
-- as fallback (preserving backward compatibility).
-- ================================================================

ALTER TABLE shopify_oauth_states
ADD COLUMN IF NOT EXISTS webhook_signing_secret VARCHAR(255);

COMMENT ON COLUMN shopify_oauth_states.webhook_signing_secret
IS 'Optional Shopify webhook signing secret (separate from client_secret). Used for HMAC verification of inbound webhooks.';

COMMIT;
