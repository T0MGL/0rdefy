/**
 * Hook: usePhoneAutoPaste
 *
 * Automatically detects country code and cleans phone numbers when pasted.
 * Handles numbers copied from WhatsApp with spaces, dashes, and other formatting.
 *
 * Usage:
 * ```tsx
 * const handlePhonePaste = usePhoneAutoPaste((countryCode, phoneNumber) => {
 *   setCountryCode(countryCode);
 *   setPhone(phoneNumber);
 * });
 *
 * <Input type="tel" onPaste={handlePhonePaste} />
 * ```
 */

import { logger } from '@/utils/logger';

interface CountryCode {
  code: string;
  length: number;
}

const COUNTRY_CODES: CountryCode[] = [
  { code: '+595', length: 4 }, // Paraguay
  { code: '+598', length: 4 }, // Uruguay
  { code: '+54', length: 3 },  // Argentina
  { code: '+55', length: 3 },  // Brasil
  { code: '+56', length: 3 },  // Chile
  { code: '+51', length: 3 },  // Perú
  { code: '+57', length: 3 },  // Colombia
  { code: '+52', length: 3 },  // México
  { code: '+34', length: 3 },  // España
  { code: '+1', length: 2 },   // USA/Canadá
];

const DEFAULT_COUNTRY_CODE = '+595'; // Paraguay

/**
 * Detects country code from a cleaned phone number string
 */
function detectCountryCode(cleaned: string): { countryCode: string; phoneNumber: string } {
  // Check if the cleaned number starts with a known country code
  for (const { code, length } of COUNTRY_CODES) {
    if (cleaned.startsWith(code)) {
      return {
        countryCode: code,
        phoneNumber: cleaned.slice(length), // Remove country code
      };
    } else if (cleaned.startsWith(code.slice(1))) {
      // Handle case where + is missing (e.g., "595981797794")
      return {
        countryCode: code,
        phoneNumber: cleaned.slice(length - 1),
      };
    }
  }

  // No known country code found, return default
  return {
    countryCode: DEFAULT_COUNTRY_CODE,
    phoneNumber: cleaned,
  };
}

/**
 * Hook that returns a paste handler for phone input fields
 *
 * @param onDetected - Callback function that receives (countryCode, phoneNumber)
 * @returns Paste event handler for Input components
 */
export function usePhoneAutoPaste(
  onDetected: (countryCode: string, phoneNumber: string) => void
) {
  return (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();

    // Get pasted text
    const pastedText = e.clipboardData.getData('text');
    if (!pastedText) return;

    // Remove all non-digit characters except +
    const cleaned = pastedText.replace(/[^\d+]/g, '');

    // Detect country code and extract phone number
    const { countryCode, phoneNumber } = detectCountryCode(cleaned);

    // Call the callback with detected values
    onDetected(countryCode, phoneNumber);

    // Log for debugging
    logger.info(`Auto-detected country code: ${countryCode}, phone: ${phoneNumber}`);
  };
}

/**
 * Simple version for components that only need the phone number (no country code)
 * Returns the full phone number with country code prefix
 */
export function usePhoneAutoPasteSimple(
  onDetected: (fullPhone: string) => void
) {
  return (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();

    // Get pasted text
    const pastedText = e.clipboardData.getData('text');
    if (!pastedText) return;

    // Remove all non-digit characters except +
    const cleaned = pastedText.replace(/[^\d+]/g, '');

    // Detect country code
    const { countryCode, phoneNumber } = detectCountryCode(cleaned);

    // Combine into full phone number
    const fullPhone = `${countryCode}${phoneNumber}`;

    // Call the callback with full phone
    onDetected(fullPhone);

    // Log for debugging
    logger.info(`Auto-formatted phone: ${fullPhone}`);
  };
}
