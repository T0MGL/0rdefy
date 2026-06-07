/**
 * SIFEN private-key encryption.
 *
 * The implementation moved to ../shared/encryption.ts so the carrier
 * integration can reuse the exact AES-256-GCM scheme with its own key. This
 * file keeps the original encrypt/decrypt signatures so the SIFEN call sites
 * stay untouched.
 *
 * Key env var: SIFEN_ENCRYPTION_KEY (64-char hex = 32 bytes)
 * Legacy alias: FISCAL_ENCRYPTION_KEY (accepted for backward compatibility)
 */

import { encryptWithKey, decryptWithKey } from '../shared/encryption';

export function encrypt(plaintext: string): string {
  return encryptWithKey(plaintext, 'SIFEN_ENCRYPTION_KEY', 'FISCAL_ENCRYPTION_KEY');
}

export function decrypt(blob: string): string {
  return decryptWithKey(blob, 'SIFEN_ENCRYPTION_KEY', 'FISCAL_ENCRYPTION_KEY');
}
