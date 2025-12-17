-- ================================================================
-- MIGRATION 029: Fix shopify_webhook_idempotency missing columns
-- ================================================================
-- Adds missing created_at and expires_at columns if they don't exist
-- These columns are required for idempotency tracking and cleanup
-- ================================================================

-- Add created_at column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shopify_webhook_idempotency'
    AND column_name = 'created_at'
  ) THEN
    ALTER TABLE shopify_webhook_idempotency
    ADD COLUMN created_at TIMESTAMP DEFAULT NOW();

    RAISE NOTICE 'Added created_at column to shopify_webhook_idempotency';
  ELSE
    RAISE NOTICE 'Column created_at already exists in shopify_webhook_idempotency';
  END IF;
END $$;

-- Add expires_at column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shopify_webhook_idempotency'
    AND column_name = 'expires_at'
  ) THEN
    ALTER TABLE shopify_webhook_idempotency
    ADD COLUMN expires_at TIMESTAMP NOT NULL DEFAULT (NOW() + INTERVAL '24 hours');

    RAISE NOTICE 'Added expires_at column to shopify_webhook_idempotency';
  ELSE
    RAISE NOTICE 'Column expires_at already exists in shopify_webhook_idempotency';
  END IF;
END $$;

-- Create index on expires_at if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_webhook_idempotency_expires
ON shopify_webhook_idempotency(expires_at);

-- Create index on created_at if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_webhook_idempotency_created
ON shopify_webhook_idempotency(created_at DESC);

-- Update existing records to have proper expires_at value
-- Only if created_at column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shopify_webhook_idempotency'
    AND column_name = 'created_at'
  ) THEN
    UPDATE shopify_webhook_idempotency
    SET expires_at = COALESCE(created_at, NOW()) + INTERVAL '24 hours'
    WHERE expires_at < NOW() OR expires_at IS NULL;

    RAISE NOTICE 'Updated expires_at for existing records';
  END IF;
END $$;

COMMENT ON COLUMN shopify_webhook_idempotency.expires_at IS
'Timestamp when this idempotency record expires and can be cleaned up. Default is 24 hours after creation.';

COMMENT ON COLUMN shopify_webhook_idempotency.created_at IS
'Timestamp when this idempotency record was created.';
