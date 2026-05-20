/**
 * Phone normalization for tel: and wa.me links.
 *
 * Paraguayan mobile numbers ship in three formats in the wild:
 *   1. Local with leading zero: "0983912902"
 *   2. International, no plus:  "595983912902"
 *   3. International with plus: "+595983912902"
 *
 * And we get plenty of garbage between: "595 0983 912 902" (manual concat
 * where someone glued the country code in front of the local format and left
 * the 0), spaces, dashes, parentheses, etc.
 *
 * wa.me REQUIRES the country code without the "+" and without an extra "0":
 *   https://wa.me/595983912902   ✓
 *   https://wa.me/5950983912902  ✗ (sends to a non-existent number)
 *
 * tel: works either way on local SIMs, but inserting the country code makes
 * the link portable for couriers traveling or callers abroad.
 */

const DEFAULT_COUNTRY = '595'; // Paraguay

/**
 * Strip everything that isn't a digit. Used as the first step everywhere.
 */
function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * Normalize a phone string to a digit-only international format suitable
 * for wa.me. Drops the local-format leading zero that frequently survives
 * when the country code is concatenated by hand.
 *
 * - "0983912902"        -> "595983912902"
 * - "595983912902"      -> "595983912902"
 * - "+595 983 912 902"  -> "595983912902"
 * - "595 0983 912 902"  -> "595983912902"  (drops the spurious 0)
 * - "5950983912902"     -> "595983912902"
 * - ""                  -> ""
 */
export function normalizeWhatsappNumber(
  raw: string | null | undefined,
  countryCode: string = DEFAULT_COUNTRY,
): string {
  if (!raw) return '';
  let digits = digitsOnly(raw);
  if (!digits) return '';

  if (digits.startsWith(countryCode)) {
    const rest = digits.slice(countryCode.length);
    // Strip a leading "0" that snuck in after the country code (typical when
    // someone concatenated the local format onto the country code).
    digits = countryCode + (rest.startsWith('0') ? rest.slice(1) : rest);
  } else if (digits.startsWith('0')) {
    // Local PY format: replace the leading 0 with the country code.
    digits = countryCode + digits.slice(1);
  }

  return digits;
}

/**
 * Normalize for the `tel:` href. Prepends "+" so dialers in any country
 * route the call internationally. If we can't tell, return the raw input
 * (the dialer is usually forgiving with local-only digits).
 */
export function normalizeTelHref(
  raw: string | null | undefined,
  countryCode: string = DEFAULT_COUNTRY,
): string {
  const intl = normalizeWhatsappNumber(raw, countryCode);
  if (!intl) return '';
  return `+${intl}`;
}
