-- ================================================================
-- Migration 029: Fix Shopify Integrations - Add user_id and shop
-- ================================================================
-- Problem: Manual Shopify integrations are missing user_id and shop field
-- This prevents proper tracking and webhook processing
--
-- Changes:
-- 1. Add user_id to existing integrations (find from user_stores table)
-- 2. Add shop field (copy from shop_domain, remove .myshopify.com)
-- 3. Make user_id and shop NOT NULL for future inserts
-- ================================================================

-- Step 1: Ensure columns exist (they should, but let's be safe)
DO $$
BEGIN
    -- Add user_id column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'shopify_integrations' AND column_name = 'user_id'
    ) THEN
        ALTER TABLE shopify_integrations ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;
    END IF;

    -- Add shop column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'shopify_integrations' AND column_name = 'shop'
    ) THEN
        ALTER TABLE shopify_integrations ADD COLUMN shop VARCHAR(255);
    END IF;
END $$;

-- Step 2: Populate user_id for existing integrations that are missing it
-- Find the user_id from user_stores table (get the first admin user for each store)
UPDATE shopify_integrations si
SET user_id = (
    SELECT us.user_id
    FROM user_stores us
    WHERE us.store_id = si.store_id
    AND us.role = 'admin'
    LIMIT 1
)
WHERE si.user_id IS NULL;

-- Step 3: Populate shop field (extract shop name from shop_domain)
-- Example: "tienda.myshopify.com" -> "tienda"
UPDATE shopify_integrations
SET shop = REGEXP_REPLACE(shop_domain, '\.myshopify\.com$', '', 'i')
WHERE shop IS NULL OR shop = '';

-- Step 4: Log the changes
DO $$
DECLARE
    updated_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO updated_count FROM shopify_integrations WHERE user_id IS NOT NULL;
    RAISE NOTICE 'Migration 029 completed: % integrations now have user_id and shop', updated_count;
END $$;

-- Step 5: Create index on user_id for better query performance
CREATE INDEX IF NOT EXISTS idx_shopify_integrations_user_id ON shopify_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_shopify_integrations_shop ON shopify_integrations(shop);

-- Note: We're NOT making these columns NOT NULL because:
-- 1. OAuth integrations might not have user_id set initially
-- 2. We want to be flexible for future integration types
-- But the application code should always set these fields
