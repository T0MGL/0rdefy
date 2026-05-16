/**
 * Unit tests for sku-resolution.ts.
 *
 * Run with:
 *   npx tsx --test api/utils/__tests__/sku-resolution.test.ts
 *
 * These tests cover the bare-parent-SKU bug surfaced in the 2026-05-16
 * Solenne stock reconciliation (SOLENNE-TAPE accepted as parent when the
 * caller should have sent SOLENNE-TAPE-100).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSku,
  resolveSkuMatch,
  type SkuMatch,
  type VariantSummary,
} from '../sku-resolution';

const variantMatch: SkuMatch = {
  entity_type: 'variant',
  product_id: 'p-tape',
  variant_id: 'v-tape-100',
  product_name: 'V-Shaped Face Tape',
  variant_title: '1 Caja',
  sku: 'SOLENNE-TAPE-100',
};

const parentMatch: SkuMatch = {
  entity_type: 'product',
  product_id: 'p-tape',
  variant_id: null,
  product_name: 'V-Shaped Face Tape',
  variant_title: null,
  sku: 'SOLENNE-TAPE',
};

const tapeVariants: VariantSummary[] = [
  { id: 'v-tape-100', sku: 'SOLENNE-TAPE-100', variant_title: '1 Caja', is_active: true },
  { id: 'v-tape-ritual', sku: 'SOLENNE-TAPE-RITUAL', variant_title: 'Pack Ritual', is_active: true },
  { id: 'v-tape-evento', sku: 'SOLENNE-TAPE-EVENTO', variant_title: 'Pack Evento', is_active: true },
];

describe('normalizeSku', () => {
  it('returns null for non-strings', () => {
    assert.equal(normalizeSku(undefined), null);
    assert.equal(normalizeSku(null), null);
    assert.equal(normalizeSku(123), null);
    assert.equal(normalizeSku({}), null);
  });

  it('returns null for blank strings', () => {
    assert.equal(normalizeSku(''), null);
    assert.equal(normalizeSku('   '), null);
  });

  it('trims and uppercases', () => {
    assert.equal(normalizeSku('  solenne-tape-100 '), 'SOLENNE-TAPE-100');
    assert.equal(normalizeSku('SOLENNE-Tape'), 'SOLENNE-TAPE');
  });
});

describe('resolveSkuMatch', () => {
  it('accepts a clean variant match', () => {
    const result = resolveSkuMatch('SOLENNE-TAPE-100', variantMatch, tapeVariants);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.entity_type, 'variant');
      assert.equal(result.product_id, 'p-tape');
      assert.equal(result.variant_id, 'v-tape-100');
    }
  });

  it('rejects parent SKU when product has active variants', () => {
    const result = resolveSkuMatch('SOLENNE-TAPE', parentMatch, tapeVariants);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'AMBIGUOUS_PARENT_SKU');
      assert.deepEqual(result.suggested_skus, [
        'SOLENNE-TAPE-100',
        'SOLENNE-TAPE-RITUAL',
        'SOLENNE-TAPE-EVENTO',
      ]);
      assert.match(result.message, /parent product/i);
    }
  });

  it('accepts parent SKU when product has no active variants', () => {
    const result = resolveSkuMatch('SERVICE-SHIPPING', parentMatch, []);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.entity_type, 'product');
      assert.equal(result.product_id, 'p-tape');
      assert.equal(result.variant_id, null);
    }
  });

  it('accepts parent SKU when all variants are inactive', () => {
    const inactiveOnly: VariantSummary[] = [
      { id: 'v-legacy', sku: 'LEGACY-1', variant_title: 'Legacy', is_active: false },
    ];
    const result = resolveSkuMatch('SOLENNE-TAPE', parentMatch, inactiveOnly);
    assert.equal(result.ok, true);
  });

  it('rejects when SKU did not resolve at all', () => {
    const result = resolveSkuMatch('UNKNOWN-SKU', null, []);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'SKU_NOT_FOUND');
    }
  });

  it('rejects empty SKU input', () => {
    const result = resolveSkuMatch('', null, []);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'INVALID_SKU');
    }
  });

  it('rejects non-string SKU input', () => {
    const result = resolveSkuMatch(42, null, []);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'INVALID_SKU');
    }
  });

  it('strips inactive variants from the suggestion list', () => {
    const mixed: VariantSummary[] = [
      ...tapeVariants,
      { id: 'v-tape-old', sku: 'SOLENNE-TAPE-OLD', variant_title: 'Discontinued', is_active: false },
    ];
    const result = resolveSkuMatch('SOLENNE-TAPE', parentMatch, mixed);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.suggested_skus, [
        'SOLENNE-TAPE-100',
        'SOLENNE-TAPE-RITUAL',
        'SOLENNE-TAPE-EVENTO',
      ]);
    }
  });

  it('preserves the normalized SKU in the error message', () => {
    const result = resolveSkuMatch('  solenne-tape  ', parentMatch, tapeVariants);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message, /SOLENNE-TAPE/);
    }
  });
});
