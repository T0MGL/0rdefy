/**
 * Pure validators for discount-related inputs on order confirmation endpoints.
 * Kept side-effect free so they can be unit tested without booting db/env.
 */

export type DiscountParseResult =
  | { ok: true; value: number | null }
  | { ok: false; message: string };

/**
 * Parses and validates an optional discount_amount input from a webhook body.
 *
 * Returns:
 *   - { ok: true, value: null }   when input is undefined/null (backwards compatible)
 *   - { ok: true, value: number } when input is a finite positive number
 *   - { ok: false, message }      otherwise
 *
 * Upper-bound validation against the order total is enforced downstream in the
 * service after the order lookup (we only know the total once the order is resolved).
 */
export function parseDiscountAmountInput(input: unknown): DiscountParseResult {
  if (input === undefined || input === null) {
    return { ok: true, value: null };
  }
  const numeric = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(numeric)) {
    return { ok: false, message: 'discount_amount must be a number' };
  }
  if (numeric <= 0) {
    return { ok: false, message: 'discount_amount must be positive' };
  }
  return { ok: true, value: numeric };
}
