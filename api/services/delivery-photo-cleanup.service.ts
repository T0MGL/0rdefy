// ================================================================
// DELIVERY PHOTO CLEANUP SERVICE
// ================================================================
// Elimina fotos de entrega del bucket de Supabase Storage
// después de 1 día de haber sido subidas
// ================================================================

import { logger } from '../utils/logger';
import { supabaseAdmin } from '../db/connection';

/**
 * Extrae el path del archivo desde una URL de Supabase Storage
 * @param url - URL completa de Supabase Storage
 * @returns Path del archivo (e.g., "store-id/photo.jpg")
 */
function extractStoragePath(url: string): string | null {
  try {
    // Ejemplo: https://xxx.supabase.co/storage/v1/object/public/delivery-photos/store-id/photo.jpg
    const match = url.match(/delivery-photos\/(.+)$/);
    return match ? match[1] : null;
  } catch (error) {
    logger.error('BACKEND', 'Error extracting storage path:', error);
    return null;
  }
}

/**
 * Elimina físicamente las fotos de entrega de más de 1 día
 * desde el bucket de Supabase Storage
 */
export async function cleanupOldDeliveryPhotos(): Promise<{
  deleted: number;
  errors: number;
  details: string[];
}> {
  const result = {
    deleted: 0,
    errors: 0,
    details: [] as string[],
  };

  try {
    logger.info('BACKEND', '🧹 [CLEANUP] Starting delivery photos cleanup...');

    // 1. Buscar delivery_attempts con fotos de más de 1 día
    const { data: oldAttempts, error: queryError } = await supabaseAdmin
      .from('delivery_attempts')
      .select('id, photo_url, actual_date')
      .not('photo_url', 'is', null)
      .lt('actual_date', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]);

    if (queryError) {
      logger.error('BACKEND', '❌ [CLEANUP] Error querying old attempts:', queryError);
      throw queryError;
    }

    if (!oldAttempts || oldAttempts.length === 0) {
      logger.info('BACKEND', '✅ [CLEANUP] No old photos found');
      return result;
    }

    logger.info('BACKEND', `📋 [CLEANUP] Found ${oldAttempts.length} old photos to delete`);

    // 2. Eliminar cada foto del bucket
    for (const attempt of oldAttempts) {
      const path = extractStoragePath(attempt.photo_url);

      if (!path) {
        logger.warn('BACKEND', `⚠️ [CLEANUP] Could not extract path from: ${attempt.photo_url}`);
        result.errors++;
        result.details.push(`Invalid URL: ${attempt.id}`);
        continue;
      }

      // Eliminar archivo del bucket
      const { error: deleteError } = await supabaseAdmin.storage
        .from('delivery-photos')
        .remove([path]);

      if (deleteError) {
        logger.error('BACKEND', `❌ [CLEANUP] Error deleting file ${path}:`, deleteError);
        result.errors++;
        result.details.push(`Delete failed: ${attempt.id} - ${deleteError.message}`);
        continue;
      }

      // Eliminar URL de la base de datos
      const { error: updateError } = await supabaseAdmin
        .from('delivery_attempts')
        .update({ photo_url: null })
        .eq('id', attempt.id);

      if (updateError) {
        logger.error('BACKEND', `❌ [CLEANUP] Error updating record ${attempt.id}:`, updateError);
        result.errors++;
        result.details.push(`Update failed: ${attempt.id} - ${updateError.message}`);
        continue;
      }

      result.deleted++;
      result.details.push(`Deleted: ${path}`);
      logger.info('BACKEND', `✅ [CLEANUP] Deleted photo: ${path}`);
    }

    logger.info('BACKEND', `🎉 [CLEANUP] Cleanup complete: ${result.deleted} deleted, ${result.errors} errors`);

    return result;
  } catch (error: any) {
    logger.error('BACKEND', '💥 [CLEANUP] Unexpected error:', error);
    throw error;
  }
}

/**
 * Sube una foto de entrega al bucket de Supabase Storage
 * @param file - Buffer del archivo
 * @param storeId - ID de la tienda
 * @param orderId - ID de la orden
 * @param mimeType - Tipo MIME del archivo
 * @returns URL pública del archivo subido
 */
export async function uploadDeliveryPhoto(
  file: Buffer,
  storeId: string,
  orderId: string,
  mimeType: string
): Promise<string> {
  try {
    // Generar nombre único para el archivo
    const timestamp = Date.now();
    const extension = mimeType.split('/')[1] || 'jpg';
    const fileName = `${orderId}-${timestamp}.${extension}`;
    const filePath = `${storeId}/${fileName}`;

    logger.info('BACKEND', `📤 [UPLOAD] Uploading photo: ${filePath}`);

    // Subir archivo al bucket
    const { data, error } = await supabaseAdmin.storage
      .from('delivery-photos')
      .upload(filePath, file, {
        contentType: mimeType,
        upsert: false,
      });

    if (error) {
      logger.error('BACKEND', '❌ [UPLOAD] Error uploading photo:', error);
      throw error;
    }

    // Obtener URL pública
    const { data: urlData } = supabaseAdmin.storage
      .from('delivery-photos')
      .getPublicUrl(filePath);

    logger.info('BACKEND', `✅ [UPLOAD] Photo uploaded: ${urlData.publicUrl}`);

    return urlData.publicUrl;
  } catch (error: any) {
    logger.error('BACKEND', '💥 [UPLOAD] Unexpected error:', error);
    throw error;
  }
}
