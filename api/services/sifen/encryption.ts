/**
 * AES-256-GCM Encryption for SIFEN private keys
 *
 * The private key is encrypted at upload time and never stored in plaintext.
 * The encryption key lives in Railway env vars, never in the database.
 * Key env var: SIFEN_ENCRYPTION_KEY (64-char hex = 32 bytes)
 * Legacy alias: FISCAL_ENCRYPTION_KEY (accepted for backward compatibility)
 *
 * Format stored in DB: base64(iv[12] || authTag[16] || ciphertext)
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;   // 96-bit IV (recommended for GCM)
const TAG_BYTES = 16;  // 128-bit auth tag

function getEncryptionKey(): Buffer {
  const raw = process.env.SIFEN_ENCRYPTION_KEY ?? process.env.FISCAL_ENCRYPTION_KEY;
  if (!raw || raw.length !== 64) {
    throw new Error(
      'SIFEN_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). ' +
      'Generate with: openssl rand -hex 32'
    );
  }
  return Buffer.from(raw, 'hex');
}

/**
 * Encrypt a plaintext string (intended for PEM private keys).
 * Returns a base64-encoded blob: IV (12B) || AuthTag (16B) || Ciphertext.
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

/**
 * Decrypt a base64 blob produced by encrypt().
 */
export function decrypt(blob: string): string {
  if (!blob || typeof blob !== 'string') {
    throw new Error('Cannot decrypt: empty or invalid value');
  }

  const key = getEncryptionKey();
  let raw: Buffer;

  try {
    raw = Buffer.from(blob, 'base64');
  } catch {
    throw new Error('Invalid encrypted blob: not valid base64');
  }

  if (raw.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error('Invalid encrypted blob: too short');
  }

  const iv = raw.subarray(0, IV_BYTES);
  const authTag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error(
      'Decryption failed. The SIFEN_ENCRYPTION_KEY may not match the one used during setup.'
    );
  }
}
