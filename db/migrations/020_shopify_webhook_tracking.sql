-- ================================================================
-- MIGRATION 010: SHOPIFY WEBHOOK REGISTRATION TRACKING
-- ================================================================
-- Purpose: Track webhook registration success/failure during OAuth
-- Date: 2025-11-22
-- ================================================================

-- Add columns to shopify_integrations to track webhook registration
ALTER TABLE shopify_integrations
  ADD COLUMN IF NOT EXISTS webhook_registration_success INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS webhook_registration_failed INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS webhook_registration_errors JSONB,
  ADD COLUMN IF NOT EXISTS last_webhook_attempt TIMESTAMP,
  ADD COLUMN IF NOT EXISTS uninstalled_at TIMESTAMP;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_shopify_integrations_webhook_errors
  ON shopify_integrations(webhook_registration_failed)
  WHERE webhook_registration_failed > 0;

CREATE INDEX IF NOT EXISTS idx_shopify_integrations_last_attempt
  ON shopify_integrations(last_webhook_attempt);

-- Add comments
COMMENT ON COLUMN shopify_integrations.webhook_registration_success IS 'Number of webhooks successfully registered during last OAuth';
COMMENT ON COLUMN shopify_integrations.webhook_registration_failed IS 'Number of webhooks that failed to register during last OAuth';
COMMENT ON COLUMN shopify_integrations.webhook_registration_errors IS 'Array of error messages from failed webhook registrations';
COMMENT ON COLUMN shopify_integrations.last_webhook_attempt IS 'Timestamp of last webhook registration attempt';
COMMENT ON COLUMN shopify_integrations.uninstalled_at IS 'Timestamp when app was uninstalled from Shopify';

-- ================================================================
-- HELPER VIEW: Integrations with webhook issues
-- ================================================================
CREATE OR REPLACE VIEW shopify_integrations_with_webhook_issues AS
SELECT
  id,
  shop_domain,
  shop_name,
  status,
  webhook_registration_success,
  webhook_registration_failed,
  webhook_registration_errors,
  last_webhook_attempt,
  installed_at
FROM shopify_integrations
WHERE webhook_registration_failed > 0
  AND status = 'active'
ORDER BY last_webhook_attempt DESC;

COMMENT ON VIEW shopify_integrations_with_webhook_issues IS 'Active integrations where some webhooks failed to register';
