/**
 * Paraguay phone normalization.
 *
 * Canonical form: E.164 with country code 595 and no extra leading zero
 * after the country code, e.g. `+595983912902`.
 *
 * Safety contract (we ship to Paraguay-based stores but cannot assume
 * every customer is Paraguayan): we ONLY rewrite a number when the input
 * is unambiguously Paraguayan. Anything that could plausibly be a foreign
 * number is returned untouched, even if that means a stored PY number
 * stays in a non-canonical form. Better one ugly +595 string than one
 * corrupted +33 / +54 / +1 string that loses contact with the customer.
 *
 * Inputs we recognise as unambiguously Paraguayan:
 *
 *   `+595983912902`    correct E.164 (12 digits, starts with 595).
 *                      Only Paraguay holds +595, no collision possible.
 *
 *   `+5950983912902`   double-prefix bug, +595 + local-with-leading-0
 *                      (13 digits, starts with 5950). Same: no other
 *                      country code shape produces this.
 *
 *   `0983912902`       local format (10 digits) AND starts with `09`.
 *                      PY mobile is always 09X XXX XXX. We require the
 *                      `09` prefix to avoid colliding with French
 *                      `01 XX XX XX XX` and other countries that also
 *                      use a 10-digit local format starting with 0.
 *
 *   `983912902`        bare mobile (9 digits) AND starts with `9`. PY
 *                      mobile prefixes are 96X, 97X, 98X, 99X. The
 *                      `9` start keeps us off most foreign 9-digit
 *                      local formats (Spain 6XX/7XX, etc.).
 *
 *   `595983912902`     E.164 without the `+` (12 digits, starts with 595).
 *
 * Anything else, including +1XXX (US/CA), +54XXX (AR), +55XXX (BR),
 * +33XXX (FR), +51XXX (PE), +598XXX (UY), 10-digit locals NOT starting
 * with 09, 9-digit locals NOT starting with 9, PY landlines (9 digits
 * starting with 02), or any unrecognised shape, is returned in its
 * original form. The function is idempotent: feeding an already-canonical
 * number back in returns the same string.
 */
export function normalizeParaguayPhone(phone: string | null | undefined): string {
  if (phone == null) return '';
  const original = String(phone).trim();
  if (!original) return '';

  const digits = original.replace(/\D/g, '');
  if (!digits) return original;

  // 1. Double-prefix bug: 595 0 XXXXXXXXX (13 digits, country code + bogus 0).
  //    Only +595 uses 595 as country code, so a 13-digit number starting
  //    with `5950` is unambiguously the malformed Paraguay shape.
  if (digits.length === 13 && digits.startsWith('5950')) {
    return '+595' + digits.slice(4);
  }

  // 2. Correct E.164 Paraguay: 595 XXXXXXXXX (12 digits).
  if (digits.length === 12 && digits.startsWith('595')) {
    return '+' + digits;
  }

  // 3. Local Paraguay mobile: 09X XXX XXX (10 digits, MUST start with `09`).
  //    We deliberately require `09` rather than just `0` to avoid mangling
  //    French local numbers (`01 12 34 56 78`) or any other foreign local
  //    format that happens to be 10 digits with a leading 0.
  if (digits.length === 10 && digits.startsWith('09')) {
    return '+595' + digits.slice(1);
  }

  // 4. Bare Paraguay mobile without any prefix: 9XX XXX XXX (9 digits).
  //    PY mobile blocks all start with 9 (96/97/98/99). A 9-digit number
  //    starting with anything else is not a PY mobile and could be a
  //    foreign local (e.g. Spain 6/7-blocks); leave it alone.
  if (digits.length === 9 && digits.startsWith('9')) {
    return '+595' + digits;
  }

  // 5. Unknown shape: foreign number, PY landline, malformed entry, or
  //    garbage. Return exactly what the caller gave us. We never lose
  //    contact with a customer by silently rewriting a number we are
  //    not sure about.
  return original;
}
