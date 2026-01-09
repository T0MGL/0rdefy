-- Migration 037: Storage Buckets Setup for Images
-- Created: 2025-01-06
-- Updated: 2026-01-09
-- Purpose: Configure Supabase Storage for profile avatars, product images, and merchandise images
--
-- IMPORTANT: Buckets must be created via API first!
-- Run: npx ts-node scripts/setup-storage-buckets.ts

-- =====================================================
-- STORAGE BUCKETS CONFIGURATION (Created via API)
-- =====================================================
-- 1. avatars - User profile pictures (2MB limit, public)
-- 2. products - Product images (5MB limit, public)
-- 3. merchandise - Inbound shipment images (5MB limit, public)

-- =====================================================
-- DROP EXISTING POLICIES (idempotent)
-- =====================================================
DO $$
BEGIN
  -- Avatars policies
  DROP POLICY IF EXISTS "Public read access for avatars" ON storage.objects;
  DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
  DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
  DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
  DROP POLICY IF EXISTS "Service role full access avatars" ON storage.objects;

  -- Products policies
  DROP POLICY IF EXISTS "Public read access for products" ON storage.objects;
  DROP POLICY IF EXISTS "Authenticated users can upload product images" ON storage.objects;
  DROP POLICY IF EXISTS "Authenticated users can update product images" ON storage.objects;
  DROP POLICY IF EXISTS "Authenticated users can delete product images" ON storage.objects;
  DROP POLICY IF EXISTS "Service role full access products" ON storage.objects;

  -- Merchandise policies
  DROP POLICY IF EXISTS "Public read access for merchandise" ON storage.objects;
  DROP POLICY IF EXISTS "Authenticated users can upload merchandise images" ON storage.objects;
  DROP POLICY IF EXISTS "Authenticated users can update merchandise images" ON storage.objects;
  DROP POLICY IF EXISTS "Authenticated users can delete merchandise images" ON storage.objects;
  DROP POLICY IF EXISTS "Service role full access merchandise" ON storage.objects;
END $$;

-- =====================================================
-- RLS POLICIES FOR STORAGE
-- =====================================================

-- AVATARS BUCKET
-- Public read access
CREATE POLICY "Public read access for avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

-- Service role can do everything (our backend uses service_role key)
CREATE POLICY "Service role full access avatars"
ON storage.objects
FOR ALL
USING (bucket_id = 'avatars')
WITH CHECK (bucket_id = 'avatars');

-- PRODUCTS BUCKET
-- Public read access
CREATE POLICY "Public read access for products"
ON storage.objects FOR SELECT
USING (bucket_id = 'products');

-- Service role can do everything
CREATE POLICY "Service role full access products"
ON storage.objects
FOR ALL
USING (bucket_id = 'products')
WITH CHECK (bucket_id = 'products');

-- MERCHANDISE BUCKET
-- Public read access
CREATE POLICY "Public read access for merchandise"
ON storage.objects FOR SELECT
USING (bucket_id = 'merchandise');

-- Service role can do everything
CREATE POLICY "Service role full access merchandise"
ON storage.objects
FOR ALL
USING (bucket_id = 'merchandise')
WITH CHECK (bucket_id = 'merchandise');

-- =====================================================
-- HELPER FUNCTION: Generate public URL for storage objects
-- =====================================================
CREATE OR REPLACE FUNCTION get_storage_public_url(bucket TEXT, file_path TEXT)
RETURNS TEXT AS $$
DECLARE
  base_url TEXT;
BEGIN
  -- Get the Supabase URL from environment or use a default pattern
  base_url := current_setting('app.settings.supabase_url', true);

  IF base_url IS NULL OR base_url = '' THEN
    -- Fallback: construct from request headers or use empty
    RETURN NULL;
  END IF;

  RETURN format('%s/storage/v1/object/public/%s/%s', base_url, bucket, file_path);
END;
$$ LANGUAGE plpgsql STABLE;

-- =====================================================
-- DOCUMENTATION
-- =====================================================
COMMENT ON POLICY "Public read access for avatars" ON storage.objects IS
  'Allow anyone to view user avatars - public bucket for profile pictures';

COMMENT ON POLICY "Public read access for products" ON storage.objects IS
  'Allow anyone to view product images - public bucket for e-commerce';

COMMENT ON POLICY "Public read access for merchandise" ON storage.objects IS
  'Allow anyone to view merchandise images - public bucket for inbound shipments';

-- =====================================================
-- USAGE GUIDE
-- =====================================================
/*
SETUP (run once):
  npx ts-node scripts/setup-storage-buckets.ts

FILE PATH CONVENTIONS:
  avatars:     {store_id}/{user_id}/avatar_{uuid}.{ext}
  products:    {store_id}/{product_id}/{uuid}.{ext}
  merchandise: {store_id}/{shipment_id}/{uuid}.{ext}

PUBLIC URLs:
  https://{project}.supabase.co/storage/v1/object/public/avatars/{path}
  https://{project}.supabase.co/storage/v1/object/public/products/{path}
  https://{project}.supabase.co/storage/v1/object/public/merchandise/{path}

API ENDPOINTS:
  POST /api/upload/avatar           - Upload user avatar
  POST /api/upload/product/:id      - Upload product image
  POST /api/upload/merchandise/:id  - Upload merchandise image
  DELETE /api/upload/product/:id    - Delete product images

SUPPORTED FORMATS:
  - JPEG (.jpg, .jpeg)
  - PNG (.png)
  - WebP (.webp)
  - GIF (.gif)

SIZE LIMITS:
  - Avatars: 2MB max
  - Products: 5MB max
  - Merchandise: 5MB max
*/
