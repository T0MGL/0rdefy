-- ================================================================
-- MAKE SHOPIFY OAUTH FIELDS NULLABLE
-- ================================================================
-- Makes api_key, api_secret_key, and webhook_signature NULLABLE
-- to support OAuth flow (which doesn't use these fields)
-- ================================================================

-- ================================================================
-- ALTER TABLE: shopify_integrations
-- ================================================================
-- Make Custom App fields nullable for OAuth compatibility
-- ================================================================

-- Make api_key nullable (OAuth uses access_token instead)
ALTER TABLE shopify_integrations
ALTER COLUMN api_key DROP NOT NULL;

-- Make api_secret_key nullable (OAuth uses access_token instead)
ALTER TABLE shopify_integrations
ALTER COLUMN api_secret_key DROP NOT NULL;

-- webhook_signature is already nullable, no change needed

COMMENT ON COLUMN shopify_integrations.api_key IS 'API Key for Custom App integration (NULL for OAuth)';
COMMENT ON COLUMN shopify_integrations.api_secret_key IS 'API Secret for Custom App integration (NULL for OAuth)';
COMMENT ON COLUMN shopify_integrations.access_token IS 'Access token for both OAuth and Custom App integration';

-- ================================================================
-- VALIDATION: Ensure OAuth integrations don't have api_key
-- ================================================================
-- OAuth integrations should have:
--   - access_token (required)
--   - scope (required)
--   - shop/shop_domain (required)
--   - api_key/api_secret_key (NULL or placeholder)
-- Custom App integrations should have:
--   - api_key (required)
--   - api_secret_key (required)
--   - access_token (required)
--   - shop/shop_domain (required)
-- ================================================================

-- No validation trigger needed - application layer handles this
