-- ================================================================
-- MIGRATION 188: Shopify Managed Install (Token Exchange + Auto-provision)
-- ================================================================
-- Purpose: Enable Shopify App Store install flow via Token Exchange.
-- Adds auth_provider/source to users for accounts auto-provisioned
-- from a Shopify install (no password), an auto_provisioned flag and
-- linked_from_direct_user_at audit field on shopify_integrations, and
-- a shopify_install_attempts audit table for QA + future review cycles.
--
-- Backfill of historical leaked tokens is included for safety: any row
-- where status='uninstalled' but access_token still set is forcibly
-- nulled (see commit 97b359a for handler fix going forward).
--
-- Author: Bright Idea
-- Date: 2026-05-16
-- ================================================================

BEGIN;

-- ----------------------------------------------------------------
-- USERS: allow Shopify-provisioned accounts
-- ----------------------------------------------------------------

-- password_hash must be optional for Shopify-provisioned users
ALTER TABLE users
  ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'password'
    CHECK (auth_provider IN ('password', 'shopify', 'google')),
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'direct'
    CHECK (source IN ('direct', 'shopify'));

COMMENT ON COLUMN users.auth_provider IS
  'Authentication mechanism: password (Stripe direct), shopify (managed install), google (future)';
COMMENT ON COLUMN users.source IS
  'Acquisition channel: direct (signup on app.ordefy.io), shopify (auto-provisioned from Shopify App Store install)';

-- ----------------------------------------------------------------
-- SHOPIFY_INTEGRATIONS: provisioning audit fields
-- ----------------------------------------------------------------

ALTER TABLE shopify_integrations
  ADD COLUMN IF NOT EXISTS auto_provisioned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS linked_from_direct_user_at TIMESTAMPTZ;

COMMENT ON COLUMN shopify_integrations.auto_provisioned IS
  'TRUE when integration was created automatically via Shopify managed install (Token Exchange). FALSE for users who connected from app.ordefy.io Settings via legacy OAuth.';
COMMENT ON COLUMN shopify_integrations.linked_from_direct_user_at IS
  'Set when a Shopify install matched an existing direct-signup user by email. Audit trail for merge decisions during install.';

-- Active-only index speeds up auth middleware lookup by shop_domain.
-- Existing idx_shopify_integrations_status covers status alone.
CREATE INDEX IF NOT EXISTS idx_shopify_integrations_shop_domain_active
  ON shopify_integrations(shop_domain)
  WHERE status = 'active';

-- Global uniqueness on shop_domain. Required for Token Exchange flow:
-- a Shopify shop has exactly one Ordefy integration. Pre-existing
-- duplicates (if any) must be resolved manually before applying this
-- migration; the constraint is intentionally NOT VALID-able because we
-- want the migration to fail loudly if data is dirty.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'shopify_integrations_shop_domain_unique'
  ) THEN
    ALTER TABLE shopify_integrations
      ADD CONSTRAINT shopify_integrations_shop_domain_unique
      UNIQUE (shop_domain);
  END IF;
END $$;

-- ----------------------------------------------------------------
-- AUDIT: shopify_install_attempts
-- ----------------------------------------------------------------
-- One row per phase of install. Lets QA + future Shopify reviews
-- trace exactly where an install loop or error happened.
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS shopify_install_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_domain     TEXT NOT NULL,
  attempt_phase   TEXT NOT NULL CHECK (attempt_phase IN (
    'session_token_received',
    'token_exchange',
    'provision',
    'login_redirect',
    'dashboard_loaded',
    'error'
  )),
  user_agent      TEXT,
  request_headers JSONB,
  response_status INT,
  error_message   TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shopify_install_attempts_shop
  ON shopify_install_attempts(shop_domain, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shopify_install_attempts_phase
  ON shopify_install_attempts(attempt_phase, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shopify_install_attempts_errors
  ON shopify_install_attempts(created_at DESC)
  WHERE attempt_phase = 'error';

ALTER TABLE shopify_install_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only_install_attempts"
  ON shopify_install_attempts
  USING (auth.role() = 'service_role');

COMMENT ON TABLE shopify_install_attempts IS
  'Per-phase install diagnostics. Written by /api/shopify/auth/token-exchange and auth middleware. Retain 90d for App Store audit support.';

-- ----------------------------------------------------------------
-- BACKFILL: scrub credentials on historical uninstall rows
-- ----------------------------------------------------------------
-- Pre-fix uninstall handler did a DELETE so most cases are gone, but
-- legacy custom-app integrations or partial flows may have left rows
-- with status='uninstalled' AND access_token NOT NULL. We force-null
-- those credentials. Idempotent: WHERE clause matches nothing once
-- clean.
-- ----------------------------------------------------------------

UPDATE shopify_integrations
SET access_token        = NULL,
    scope               = NULL,
    webhook_signature   = NULL,
    api_secret_key      = NULL,
    updated_at          = NOW()
WHERE status = 'uninstalled'
  AND access_token IS NOT NULL;

COMMIT;

-- ================================================================
-- MIGRATION 188 COMPLETE
-- ================================================================
