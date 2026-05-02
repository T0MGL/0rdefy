/**
 * Email asset uploader → Supabase Storage.
 *
 * Hosts PNG images publicly so emails can reference them via URL instead of
 * inline CID attachments. This keeps the email HTML body small (under
 * Gmail's 102 KB clipping threshold) and lets clients lazily fetch images
 * from a CDN-cached endpoint.
 *
 * Bucket: `email-assets` (public read).
 */
import { logger } from '../utils/logger';
import { createHash } from 'node:crypto';

const BUCKET = 'email-assets';

let bucketEnsured = false;

async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  const { supabaseAdmin } = await import('../db/connection');

  const { data: buckets } = await supabaseAdmin.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === BUCKET);

  if (!exists) {
    const { error } = await supabaseAdmin.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: 5 * 1024 * 1024, // 5 MB per asset
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    });
    if (error) {
      // Race-safe: another process may have created it concurrently.
      if (!error.message?.toLowerCase().includes('already exists')) {
        throw new Error(`Failed to create bucket ${BUCKET}: ${error.message}`);
      }
    }
    logger.info('EMAIL_ASSETS', `Bucket "${BUCKET}" created (public)`);
  }
  bucketEnsured = true;
}

/**
 * Hash of buffer contents → stable URL when content doesn't change.
 * Lets us upsert without generating dupes if the same milestone PNG is
 * regenerated identically.
 */
function contentHash(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

/**
 * Upload a PNG buffer to Supabase Storage and return a public URL.
 *
 * @param prefix Logical folder, e.g. "milestone/abc123" or "milestone/test"
 * @param filename The actual file name (e.g. "ordefy-100-ordenes.png")
 * @param content PNG buffer
 */
export async function uploadEmailAsset(
  prefix: string,
  filename: string,
  content: Buffer,
): Promise<string> {
  await ensureBucket();
  const { supabaseAdmin } = await import('../db/connection');

  // Path includes content hash so the URL stays stable per identical render
  const hash = contentHash(content);
  const path = `${prefix}/${hash}/${filename}`;

  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, content, {
      contentType: 'image/png',
      cacheControl: '604800', // 7 days CDN cache
      upsert: true,
    });

  if (upErr) {
    throw new Error(`Email asset upload failed (${path}): ${upErr.message}`);
  }

  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) {
    throw new Error(`getPublicUrl returned empty for ${path}`);
  }
  logger.info('EMAIL_ASSETS', `Uploaded ${path} (${content.byteLength} bytes)`);
  return data.publicUrl;
}
