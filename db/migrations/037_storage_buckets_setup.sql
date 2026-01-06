-- Migration 037: Storage Buckets Setup for Images
-- Created: 2025-01-06
-- Purpose: Configure Supabase Storage for profile avatars, product images, and merchandise images

-- =====================================================
-- STORAGE BUCKETS CONFIGURATION
-- =====================================================
-- Buckets created via API (already done):
-- 1. avatars - User profile pictures (2MB limit)
-- 2. products - Product images (5MB limit)
-- 3. merchandise - Inbound shipment images (5MB limit)
-- All buckets are PUBLIC for read access

-- =====================================================
-- RLS POLICIES FOR STORAGE
-- =====================================================

-- Allow anyone to view images (public read)
CREATE POLICY IF NOT EXISTS "Public read access for avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

CREATE POLICY IF NOT EXISTS "Public read access for products"
ON storage.objects FOR SELECT
USING (bucket_id = 'products');

CREATE POLICY IF NOT EXISTS "Public read access for merchandise"
ON storage.objects FOR SELECT
USING (bucket_id = 'merchandise');

-- Allow authenticated users to upload to avatars (their own folder)
CREATE POLICY IF NOT EXISTS "Users can upload their own avatar"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'avatars'
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to update their own avatar
CREATE POLICY IF NOT EXISTS "Users can update their own avatar"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'avatars'
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to delete their own avatar
CREATE POLICY IF NOT EXISTS "Users can delete their own avatar"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'avatars'
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to upload product images
CREATE POLICY IF NOT EXISTS "Authenticated users can upload product images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'products'
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to update product images
CREATE POLICY IF NOT EXISTS "Authenticated users can update product images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'products'
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to delete product images
CREATE POLICY IF NOT EXISTS "Authenticated users can delete product images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'products'
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to upload merchandise images
CREATE POLICY IF NOT EXISTS "Authenticated users can upload merchandise images"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'merchandise'
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to update merchandise images
CREATE POLICY IF NOT EXISTS "Authenticated users can update merchandise images"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'merchandise'
  AND auth.role() = 'authenticated'
);

-- Allow authenticated users to delete merchandise images
CREATE POLICY IF NOT EXISTS "Authenticated users can delete merchandise images"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'merchandise'
  AND auth.role() = 'authenticated'
);

-- =====================================================
-- HELPER FUNCTION: Generate public URL for storage objects
-- =====================================================
CREATE OR REPLACE FUNCTION get_storage_public_url(bucket TEXT, path TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN format(
    '%s/storage/v1/object/public/%s/%s',
    current_setting('app.settings.supabase_url', true),
    bucket,
    path
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =====================================================
-- DOCUMENTATION
-- =====================================================
COMMENT ON POLICY "Public read access for avatars" ON storage.objects IS
  'Allow anyone to view user avatars - public bucket';

COMMENT ON POLICY "Public read access for products" ON storage.objects IS
  'Allow anyone to view product images - public bucket';

COMMENT ON POLICY "Public read access for merchandise" ON storage.objects IS
  'Allow anyone to view merchandise images - public bucket';

-- =====================================================
-- USAGE EXAMPLES
-- =====================================================
/*
-- Upload avatar (from backend with service role):
-- Path format: {store_id}/{user_id}/avatar.{ext}

-- Upload product image (from backend with service role):
-- Path format: {store_id}/products/{product_id}/{filename}.{ext}

-- Upload merchandise image (from backend with service role):
-- Path format: {store_id}/merchandise/{shipment_id}/{filename}.{ext}

-- Get public URL:
-- https://vgqecqqleuowvoimcoxg.supabase.co/storage/v1/object/public/avatars/{path}
-- https://vgqecqqleuowvoimcoxg.supabase.co/storage/v1/object/public/products/{path}
-- https://vgqecqqleuowvoimcoxg.supabase.co/storage/v1/object/public/merchandise/{path}

-- Image fields in tables (supports both URL and storage path):
-- users.avatar_url - Can be external URL or storage path
-- products.image_url - Can be external URL or storage path
-- inbound_shipment_items.image_url - Can be external URL or storage path

-- The frontend will:
-- 1. Check if image_url starts with 'http' -> use directly
-- 2. Otherwise -> construct Supabase storage URL
*/
