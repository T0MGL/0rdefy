-- ================================================================
-- Migration 055: Shopify Manual OAuth for Custom Apps (Dev Dashboard 2026)
-- ================================================================
-- Adds support for OAuth flow with merchant's custom app credentials
-- instead of static access tokens (deprecated by Shopify Jan 2026)
--
-- New columns:
-- - custom_client_id: Client ID from merchant's Dev Dashboard app
-- - custom_client_secret: Client Secret from merchant's Dev Dashboard app
-- - is_custom_app: Flag to identify custom app OAuth flows
--
-- Also adds is_custom_app to shopify_integrations to track integration type
-- ================================================================

-- Add columns to shopify_oauth_states for custom app credentials
ALTER TABLE shopify_oauth_states
ADD COLUMN IF NOT EXISTS custom_client_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS custom_client_secret VARCHAR(255),
ADD COLUMN IF NOT EXISTS is_custom_app BOOLEAN DEFAULT FALSE;

-- Add index for custom app OAuth states
CREATE INDEX IF NOT EXISTS idx_oauth_states_custom_app
ON shopify_oauth_states(is_custom_app)
WHERE is_custom_app = true;

-- Add is_custom_app flag to shopify_integrations
-- This helps distinguish between:
-- - OAuth integrations via Ordefy's official app (is_custom_app = false)
-- - Custom app integrations via merchant's Dev Dashboard app (is_custom_app = true)
-- - Legacy manual integrations (is_custom_app = null, has api_key but no scope)
ALTER TABLE shopify_integrations
ADD COLUMN IF NOT EXISTS is_custom_app BOOLEAN DEFAULT FALSE;

-- Add webhook_signature column if it doesn't exist
-- This stores the API secret used for HMAC verification of webhooks
-- For OAuth integrations: uses SHOPIFY_API_SECRET from env
-- For Custom App integrations: uses this column (same as api_secret_key)
ALTER TABLE shopify_integrations
ADD COLUMN IF NOT EXISTS webhook_signature VARCHAR(255);

-- Add index for custom app integrations
CREATE INDEX IF NOT EXISTS idx_shopify_integrations_custom_app
ON shopify_integrations(is_custom_app)
WHERE is_custom_app = true;

-- Comment for documentation
COMMENT ON COLUMN shopify_oauth_states.custom_client_id IS 'Client ID from merchant Dev Dashboard app (for custom OAuth flow)';
COMMENT ON COLUMN shopify_oauth_states.custom_client_secret IS 'Client Secret from merchant Dev Dashboard app (for custom OAuth flow)';
COMMENT ON COLUMN shopify_oauth_states.is_custom_app IS 'True if this OAuth flow uses merchant custom app credentials';
COMMENT ON COLUMN shopify_integrations.is_custom_app IS 'True if integration was created via merchant custom app (Dev Dashboard)';
COMMENT ON COLUMN shopify_integrations.webhook_signature IS 'API Secret Key for HMAC webhook verification (custom apps only)';

-- ================================================================
-- END OF MIGRATION
-- ================================================================
