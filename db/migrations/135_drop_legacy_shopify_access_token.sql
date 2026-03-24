-- Migration 135: Drop legacy shopify_access_token column from store_config
-- This column was used for Private App tokens (deprecated by Shopify Jan 2024).
-- The OAuth flow now stores tokens in shopify_integrations.access_token.
-- The endpoint that wrote to this column was removed in commit a6ffdbf.

BEGIN;

ALTER TABLE store_config
  DROP COLUMN IF EXISTS shopify_access_token;

COMMIT;
