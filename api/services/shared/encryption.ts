/**
 * AES-256-GCM encryption for secrets at rest (SIFEN private keys, carrier
 * credentials). The encryption key lives in Railway env vars, never in the
 * database. Each domain passes its own env var name so keys stay isolated:
 * rotating the carrier key never touches SIFEN material and vice versa.
 *
 * Format stored in DB: base64(iv[12] || authTag[16] || ciphertext)
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_HEX_LENGTH = 64; // 32 bytes

function resolveKey(envVarNames: string[]): Buffer {
  for (const name of envVarNames) {
    const raw = process.env[name];
    if (raw && raw.length === KEY_HEX_LENGTH) {
      return Buffer.from(raw, 'hex');
    }
  }
  throw new Error(
    `${envVarNames[0]} must be a 64-character hex string (32 bytes). ` +
      'Generate with: openssl rand -hex 32',
  );
}

export function encryptWithKey(plaintext: string, ...envVarNames: string[]): string {
  const key = resolveKey(envVarNames);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptWithKey(blob: string, ...envVarNames: string[]): string {
  if (!blob || typeof blob !== 'string') {
    throw new Error('Cannot decrypt: empty or invalid value');
  }

  const key = resolveKey(envVarNames);
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
    // Wrong key, tampered blob, or a blob encrypted under a different key.
    throw new Error(`Decryption failed. The key in ${envVarNames[0]} may not match the one used during setup.`);
  }
}
