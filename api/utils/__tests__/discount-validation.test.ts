/**
 * Unit tests for computeDiscountedTotal, the TS half of the discount guardrail.
 *
 * Run with:
 *   npx tsx --test api/utils/__tests__/discount-validation.test.ts
 *
 * This helper MUST stay equivalent to compute_discounted_total in
 * db/migrations/206. It exists because an operator typed the order subtotal
 * into the discount field on an already-paid order, collapsing total_price to
 * ~0 and under-reporting revenue. The >95%-of-gross guardrail is the fix, so
 * its boundary is the thing most worth testing.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDiscountedTotal,
  FullDiscountBlockedError,
  FULL_DISCOUNT_THRESHOLD,
} from '../discount-validation';

describe('computeDiscountedTotal', () => {
  it('applies a normal partial discount', () => {
    const { effectiveDiscount, newTotal } = computeDiscountedTotal({ gross: 100000, discount: 20000 });
    assert.equal(effectiveDiscount, 20000);
    assert.equal(newTotal, 80000);
  });

  it('allows a discount exactly at the 95% threshold', () => {
    const gross = 100000;
    const { effectiveDiscount, newTotal } = computeDiscountedTotal({ gross, discount: gross * FULL_DISCOUNT_THRESHOLD });
    assert.equal(effectiveDiscount, 95000);
    assert.equal(newTotal, 5000);
  });

  it('blocks a discount above 95% of gross (the original bug)', () => {
    assert.throws(
      () => computeDiscountedTotal({ gross: 100000, discount: 100000 }),
      FullDiscountBlockedError,
    );
  });

  it('allows a full discount when explicitly overridden', () => {
    const { effectiveDiscount, newTotal } = computeDiscountedTotal({
      gross: 100000,
      discount: 100000,
      allowFullDiscount: true,
    });
    assert.equal(effectiveDiscount, 100000);
    assert.equal(newTotal, 0);
  });

  it('clamps an over-cap discount to gross when overridden', () => {
    const { effectiveDiscount, newTotal } = computeDiscountedTotal({
      gross: 100000,
      discount: 250000,
      allowFullDiscount: true,
    });
    assert.equal(effectiveDiscount, 100000);
    assert.equal(newTotal, 0);
  });

  it('never trips the guardrail on a zero gross', () => {
    const { effectiveDiscount, newTotal } = computeDiscountedTotal({ gross: 0, discount: 5000 });
    assert.equal(effectiveDiscount, 0);
    assert.equal(newTotal, 0);
  });

  it('treats negative inputs as zero', () => {
    const { effectiveDiscount, newTotal } = computeDiscountedTotal({ gross: -10, discount: -5 });
    assert.equal(effectiveDiscount, 0);
    assert.equal(newTotal, 0);
  });
});
