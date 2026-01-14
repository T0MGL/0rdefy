-- ================================================================
-- Script: Fix bright-idea-6816 Shopify Integration API Secret
-- ================================================================
-- This script updates the api_secret_key for bright-idea-6816
-- which is currently NULL causing HMAC verification to fail
-- ================================================================

-- 1. Check current status
SELECT
    id,
    shop_domain,
    api_secret_key IS NOT NULL as has_api_secret,
    access_token IS NOT NULL as has_access_token,
    status,
    created_at
FROM shopify_integrations
WHERE shop_domain = 'bright-idea-6816.myshopify.com';

-- 2. UPDATE api_secret_key (REPLACE 'YOUR_API_SECRET_HERE' with the actual value)
--
-- To get the API secret:
-- 1. Go to Shopify Partner Dashboard
-- 2. Click on your app "Ordefy"
-- 3. Go to "App Setup" or "App Credentials"
-- 4. Copy the "API secret key" (NOT the API key)
--
-- IMPORTANT: This is the API secret from your Shopify app configuration
-- NOT the access token, and NOT from the .env file

-- UNCOMMENT AND RUN THIS AFTER REPLACING THE SECRET:
/*
UPDATE shopify_integrations
SET
    api_secret_key = 'YOUR_API_SECRET_HERE',  -- REPLACE THIS
    updated_at = NOW()
WHERE shop_domain = 'bright-idea-6816.myshopify.com';
*/

-- 3. Verify the update
SELECT
    id,
    shop_domain,
    api_secret_key IS NOT NULL as has_api_secret,
    LENGTH(api_secret_key) as secret_length,
    access_token IS NOT NULL as has_access_token,
    status,
    updated_at
FROM shopify_integrations
WHERE shop_domain = 'bright-idea-6816.myshopify.com';

-- ================================================================
-- Expected Result:
-- - has_api_secret: true
-- - secret_length: ~32-64 characters
-- - has_access_token: true
-- - status: active
-- ================================================================

-- ================================================================
-- Alternative: Use .env value if this is an OAuth app
-- ================================================================
-- If bright-idea is using the same OAuth app as your other stores,
-- you can copy the api_secret_key from another integration:
/*
UPDATE shopify_integrations
SET
    api_secret_key = (
        SELECT api_secret_key
        FROM shopify_integrations
        WHERE api_secret_key IS NOT NULL
        LIMIT 1
    ),
    updated_at = NOW()
WHERE shop_domain = 'bright-idea-6816.myshopify.com';
*/
-- ================================================================
