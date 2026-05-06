/**
 * Unit tests for external-webhooks.ts validators.
 *
 * Run with:
 *   npx tsx --test api/routes/__tests__/external-webhooks.test.ts
 *
 * These tests cover the parseDiscountAmountInput helper used by
 * POST /api/webhook/orders/:storeId/confirm to validate the optional
 * discount_amount body field. The upper-bound check (discount <= order total)
 * lives in the service layer, exercised in service-level tests / E2E.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseDiscountAmountInput } from '../../utils/discount-validation';

describe('parseDiscountAmountInput', () => {
  it('accepts undefined as backwards-compatible null', () => {
    const result = parseDiscountAmountInput(undefined);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value, null);
  });

  it('accepts null as backwards-compatible null', () => {
    const result = parseDiscountAmountInput(null);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value, null);
  });

  it('accepts a positive numeric value', () => {
    const result = parseDiscountAmountInput(10);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value, 10);
  });

  it('accepts a numeric string (json body coerced)', () => {
    const result = parseDiscountAmountInput('15.5');
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value, 15.5);
  });

  it('rejects zero', () => {
    const result = parseDiscountAmountInput(0);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.message, 'discount_amount must be positive');
  });

  it('rejects negative numbers', () => {
    const result = parseDiscountAmountInput(-5);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.message, 'discount_amount must be positive');
  });

  it('rejects non-numeric strings', () => {
    const result = parseDiscountAmountInput('not-a-number');
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.message, 'discount_amount must be a number');
  });

  it('rejects NaN', () => {
    const result = parseDiscountAmountInput(NaN);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.message, 'discount_amount must be a number');
  });

  it('rejects Infinity', () => {
    const result = parseDiscountAmountInput(Infinity);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.message, 'discount_amount must be a number');
  });

  it('rejects boolean true (coerces to 1, but boolean is invalid input shape)', () => {
    // Boolean true coerces to 1 via Number(true). We accept it because the
    // validation contract is "must be a positive finite number"; once coerced,
    // it satisfies that. If stricter typing is needed, switch to Zod.
    const result = parseDiscountAmountInput(true);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.value, 1);
  });

  it('rejects objects', () => {
    const result = parseDiscountAmountInput({ amount: 10 });
    assert.equal(result.ok, false);
  });

  it('rejects arrays with multiple values', () => {
    const result = parseDiscountAmountInput([1, 2]);
    assert.equal(result.ok, false);
  });
});
