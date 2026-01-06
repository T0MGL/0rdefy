/**
 * Upload Service - Frontend Image Upload
 *
 * Supports two modes:
 * 1. File upload to Supabase Storage (recommended for local images)
 * 2. External URL (for linked images - more cost efficient)
 */

import apiClient from './api.client';
import { config } from '@/config';

export interface UploadResult {
  success: boolean;
  url?: string;
  path?: string;
  error?: string;
}

/**
 * Upload avatar for current user
 */
export async function uploadAvatar(file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await apiClient.post('/upload/avatar', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return response.data;
}

/**
 * Upload avatar from base64
 */
export async function uploadAvatarBase64(base64: string): Promise<UploadResult> {
  const response = await apiClient.post('/upload/avatar', { base64 });
  return response.data;
}

/**
 * Upload product image
 */
export async function uploadProductImage(productId: string, file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await apiClient.post(`/upload/product/${productId}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return response.data;
}

/**
 * Upload product image from base64
 */
export async function uploadProductImageBase64(productId: string, base64: string): Promise<UploadResult> {
  const response = await apiClient.post(`/upload/product/${productId}`, { base64 });
  return response.data;
}

/**
 * Upload merchandise/shipment image
 */
export async function uploadMerchandiseImage(shipmentId: string, file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await apiClient.post(`/upload/merchandise/${shipmentId}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return response.data;
}

/**
 * Delete product images
 */
export async function deleteProductImages(productId: string): Promise<{ success: boolean }> {
  const response = await apiClient.delete(`/upload/product/${productId}`);
  return response.data;
}

/**
 * Generic base64 upload
 */
export async function uploadBase64(
  bucket: 'avatars' | 'products' | 'merchandise',
  base64: string,
  entityId: string,
  filename?: string
): Promise<UploadResult> {
  const response = await apiClient.post('/upload/base64', {
    bucket,
    base64,
    entityId,
    filename
  });
  return response.data;
}

/**
 * Check if a URL is external or internal storage path
 */
export function isExternalUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * Convert file to base64
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
}

/**
 * Validate file before upload
 */
export function validateImageFile(file: File): { valid: boolean; error?: string } {
  const maxSize = 5 * 1024 * 1024; // 5MB
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  if (file.size > maxSize) {
    return { valid: false, error: 'El archivo excede el tamaño máximo de 5MB' };
  }

  if (!allowedTypes.includes(file.type)) {
    return { valid: false, error: 'Tipo de archivo no permitido. Use JPEG, PNG, WebP o GIF' };
  }

  return { valid: true };
}

export default {
  uploadAvatar,
  uploadAvatarBase64,
  uploadProductImage,
  uploadProductImageBase64,
  uploadMerchandiseImage,
  deleteProductImages,
  uploadBase64,
  isExternalUrl,
  fileToBase64,
  validateImageFile
};
