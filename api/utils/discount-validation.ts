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

/**
 * Fraction of gross above which a discount is treated as an operator error.
 * Mirrors compute_discounted_total in db/migrations/206. An operator once typed
 * the order subtotal into the discount field on an already-paid order, zeroing
 * total_price and under-reporting revenue. A discount above this share of gross
 * is blocked unless allowFullDiscount is set.
 */
export const FULL_DISCOUNT_THRESHOLD = 0.95;

export class FullDiscountBlockedError extends Error {
  readonly code = 'FULL_DISCOUNT_BLOCKED';
  constructor(public readonly gross: number, public readonly discount: number) {
    super(
      `discount ${discount} exceeds ${FULL_DISCOUNT_THRESHOLD * 100}% of gross ${gross} (pass allowFullDiscount to override)`,
    );
    this.name = 'FullDiscountBlockedError';
  }
}

interface DiscountInput {
  gross: number;
  discount: number;
  allowFullDiscount?: boolean;
}

interface DiscountResult {
  effectiveDiscount: number;
  newTotal: number;
}

/**
 * Single source of truth for the discount math + guardrail on the TS side.
 * Kept equivalent to compute_discounted_total (migration 206, raises P0012) so
 * the webhook path A and the SQL paths cannot diverge.
 *
 * Clamps the discount to gross and returns the resulting total. Throws
 * FullDiscountBlockedError when the discount exceeds 95% of a positive gross
 * and allowFullDiscount is not set.
 */
export function computeDiscountedTotal({ gross, discount, allowFullDiscount = false }: DiscountInput): DiscountResult {
  const g = Math.max(0, Number(gross) || 0);
  const d = Math.max(0, Number(discount) || 0);

  if (!allowFullDiscount && g > 0 && d > g * FULL_DISCOUNT_THRESHOLD) {
    throw new FullDiscountBlockedError(g, d);
  }

  const effectiveDiscount = Math.min(d, g);
  return { effectiveDiscount, newTotal: Math.max(0, g - effectiveDiscount) };
}
