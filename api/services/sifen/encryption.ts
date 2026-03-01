/**
 * AES-256-CBC Encryption Service for SIFEN certificates
 *
 * Encrypts certificate passwords before storing in database.
 * Uses FISCAL_ENCRYPTION_KEY env var (32-byte hex string).
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.FISCAL_ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error('FISCAL_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(key, 'hex');
}

/**
 * Encrypt a plaintext string.
 * Returns "iv:ciphertext" in hex format.
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt an "iv:ciphertext" hex string back to plaintext.
 */
export function decrypt(encrypted: string): string {
  if (!encrypted || typeof encrypted !== 'string') {
    throw new Error('No se puede descifrar: valor vacío o inválido');
  }

  const key = getEncryptionKey();
  const parts = encrypted.split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('Formato de cifrado inválido');
  }

  const [ivHex, ciphertextHex] = parts;

  // Validate IV length (16 bytes = 32 hex chars)
  if (ivHex.length !== 32) {
    throw new Error('Formato de cifrado inválido: IV corrupto');
  }

  try {
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    // Sanitize error - never expose crypto internals
    throw new Error('Error al descifrar la contraseña del certificado. Verifique la clave de cifrado.');
  }
}
