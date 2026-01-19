/**
 * Storage Service - Supabase Storage for Images
 *
 * Handles image uploads for:
 * - User avatars (profile pictures)
 * - Product images
 * - Merchandise/shipment images
 *
 * Supports hybrid approach:
 * - Direct file upload to Supabase Storage
 * - External URL links (for cost optimization)
 */

import { logger } from '../utils/logger';
import { supabaseAdmin } from '../db/connection';
import { randomUUID } from 'crypto';
import * as path from 'path';

// Bucket configuration
const BUCKETS = {
  avatars: {
    name: 'avatars',
    maxSize: 2 * 1024 * 1024, // 2MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  },
  products: {
    name: 'products',
    maxSize: 5 * 1024 * 1024, // 5MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  },
  merchandise: {
    name: 'merchandise',
    maxSize: 5 * 1024 * 1024, // 5MB
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  }
} as const;

type BucketName = keyof typeof BUCKETS;

interface UploadResult {
  success: boolean;
  url?: string;
  path?: string;
  error?: string;
}

/**
 * Get the public URL for a storage object
 */
export function getPublicUrl(bucket: BucketName, filePath: string): string {
  const supabaseUrl = process.env.SUPABASE_URL;
  return `${supabaseUrl}/storage/v1/object/public/${bucket}/${filePath}`;
}

/**
 * Check if a URL is an external URL or a storage path
 */
export function isExternalUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * Get the display URL for an image (handles both external and storage paths)
 */
export function getImageUrl(
  url: string | null | undefined,
  bucket: BucketName = 'products'
): string | null {
  if (!url) return null;
  if (isExternalUrl(url)) return url;
  return getPublicUrl(bucket, url);
}

/**
 * Validate file before upload
 */
function validateFile(
  buffer: Buffer,
  mimeType: string,
  bucket: BucketName
): { valid: boolean; error?: string } {
  const config = BUCKETS[bucket];

  if (buffer.length > config.maxSize) {
    const maxMB = config.maxSize / (1024 * 1024);
    return {
      valid: false,
      error: `File size exceeds ${maxMB}MB limit`
    };
  }

  if (!config.allowedTypes.includes(mimeType as any)) {
    return {
      valid: false,
      error: `File type ${mimeType} not allowed. Allowed: ${config.allowedTypes.join(', ')}`
    };
  }

  return { valid: true };
}

/**
 * Generate a unique file path for storage
 */
function generateFilePath(
  bucket: BucketName,
  storeId: string,
  entityId: string,
  originalName: string
): string {
  const ext = path.extname(originalName).toLowerCase() || '.jpg';
  const uniqueId = randomUUID().slice(0, 8);

  switch (bucket) {
    case 'avatars':
      // avatars/{store_id}/{user_id}/avatar_{unique}.ext
      return `${storeId}/${entityId}/avatar_${uniqueId}${ext}`;
    case 'products':
      // products/{store_id}/{product_id}/{unique}.ext
      return `${storeId}/${entityId}/${uniqueId}${ext}`;
    case 'merchandise':
      // merchandise/{store_id}/{shipment_id}/{unique}.ext
      return `${storeId}/${entityId}/${uniqueId}${ext}`;
    default:
      return `${storeId}/${entityId}/${uniqueId}${ext}`;
  }
}

/**
 * Upload a file to Supabase Storage
 */
export async function uploadFile(
  bucket: BucketName,
  buffer: Buffer,
  mimeType: string,
  storeId: string,
  entityId: string,
  originalName: string = 'image.jpg'
): Promise<UploadResult> {
  try {
    // Validate file
    const validation = validateFile(buffer, mimeType, bucket);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Generate file path
    const filePath = generateFilePath(bucket, storeId, entityId, originalName);

    // Upload to Supabase Storage
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .upload(filePath, buffer, {
        contentType: mimeType,
        upsert: false // Don't overwrite existing files
      });

    if (error) {
      logger.error('BACKEND', `Storage upload error [${bucket}]:`, error);
      return { success: false, error: error.message };
    }

    // Get public URL
    const publicUrl = getPublicUrl(bucket, filePath);

    logger.info('BACKEND', `✓ Uploaded to ${bucket}/${filePath}`);

    return {
      success: true,
      url: publicUrl,
      path: filePath
    };
  } catch (err: any) {
    logger.error('BACKEND', `Storage upload exception [${bucket}]:`, err);
    return { success: false, error: err.message };
  }
}

/**
 * Upload an avatar for a user
 */
export async function uploadAvatar(
  buffer: Buffer,
  mimeType: string,
  storeId: string,
  userId: string,
  originalName?: string
): Promise<UploadResult> {
  // Delete old avatar first if exists
  await deleteUserAvatars(storeId, userId);

  return uploadFile('avatars', buffer, mimeType, storeId, userId, originalName);
}

/**
 * Upload a product image
 */
export async function uploadProductImage(
  buffer: Buffer,
  mimeType: string,
  storeId: string,
  productId: string,
  originalName?: string
): Promise<UploadResult> {
  return uploadFile('products', buffer, mimeType, storeId, productId, originalName);
}

/**
 * Upload a merchandise/shipment image
 */
export async function uploadMerchandiseImage(
  buffer: Buffer,
  mimeType: string,
  storeId: string,
  shipmentId: string,
  originalName?: string
): Promise<UploadResult> {
  return uploadFile('merchandise', buffer, mimeType, storeId, shipmentId, originalName);
}

/**
 * Delete a file from storage
 */
export async function deleteFile(bucket: BucketName, filePath: string): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.storage
      .from(bucket)
      .remove([filePath]);

    if (error) {
      logger.error('BACKEND', `Storage delete error [${bucket}]:`, error);
      return false;
    }

    logger.info('BACKEND', `✓ Deleted ${bucket}/${filePath}`);
    return true;
  } catch (err: any) {
    logger.error('BACKEND', `Storage delete exception [${bucket}]:`, err);
    return false;
  }
}

/**
 * Delete all avatars for a user (cleanup before new upload)
 */
async function deleteUserAvatars(storeId: string, userId: string): Promise<void> {
  try {
    const folderPath = `${storeId}/${userId}`;

    // List all files in the user's avatar folder
    const { data: files, error } = await supabaseAdmin.storage
      .from('avatars')
      .list(folderPath);

    if (error || !files || files.length === 0) return;

    // Delete all files
    const filePaths = files.map(f => `${folderPath}/${f.name}`);
    await supabaseAdmin.storage.from('avatars').remove(filePaths);

    logger.info('BACKEND', `✓ Cleaned up ${files.length} old avatar(s) for user ${userId}`);
  } catch (err) {
    // Ignore cleanup errors
  }
}

/**
 * Delete all images for a product
 */
export async function deleteProductImages(storeId: string, productId: string): Promise<void> {
  try {
    const folderPath = `${storeId}/${productId}`;

    const { data: files, error } = await supabaseAdmin.storage
      .from('products')
      .list(folderPath);

    if (error || !files || files.length === 0) return;

    const filePaths = files.map(f => `${folderPath}/${f.name}`);
    await supabaseAdmin.storage.from('products').remove(filePaths);

    logger.info('BACKEND', `✓ Deleted ${files.length} product image(s) for product ${productId}`);
  } catch (err) {
    // Ignore cleanup errors
  }
}

/**
 * Upload from base64 string
 */
export async function uploadFromBase64(
  bucket: BucketName,
  base64Data: string,
  storeId: string,
  entityId: string,
  filename?: string
): Promise<UploadResult> {
  try {
    // Parse base64 data URL
    const matches = base64Data.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      return { success: false, error: 'Invalid base64 data format' };
    }

    const mimeType = matches[1];
    const base64Content = matches[2];
    const buffer = Buffer.from(base64Content, 'base64');

    // Determine extension from mime type
    const extMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif'
    };
    const ext = extMap[mimeType] || '.jpg';
    const originalName = filename || `image${ext}`;

    return uploadFile(bucket, buffer, mimeType, storeId, entityId, originalName);
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export default {
  uploadFile,
  uploadAvatar,
  uploadProductImage,
  uploadMerchandiseImage,
  uploadFromBase64,
  deleteFile,
  deleteProductImages,
  getPublicUrl,
  getImageUrl,
  isExternalUrl,
  BUCKETS
};
