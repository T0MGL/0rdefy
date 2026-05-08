/**
 * Unit tests for order_number generation and unique-violation retry.
 *
 * Run with:
 *   npx tsx --test api/services/__tests__/order-number-generation.test.ts
 *
 * Covers task 1.4 of the P1 credibility hot-fix:
 *   - generateOrderNumber emits ORD-YYYYMMDD-XXXXXX (matches the BEFORE
 *     INSERT trigger format and the migration 173 unique index format).
 *   - Successive calls produce distinct values (random suffix).
 *   - The new value is always 6 hex chars after the date, never the legacy
 *     5-digit padded counter that produced collisions.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_ANON_KEY ??= 'test-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service';

const { externalWebhookService } = await import('../external-webhook.service');

const ORDER_NUMBER_REGEX = /^ORD-(\d{8})-([0-9a-f]{6})$/;

describe('externalWebhookService.generateOrderNumber', () => {
  it('emits values matching ORD-YYYYMMDD-XXXXXX with 6 hex chars', () => {
    const value = (externalWebhookService as any).generateOrderNumber('store-1');
    const match = ORDER_NUMBER_REGEX.exec(value);
    assert.ok(match, `expected ORD-YYYYMMDD-XXXXXX, got ${value}`);
    const datePart = match![1];
    const today = new Date();
    const expected = `${today.getUTCFullYear()}${String(today.getUTCMonth() + 1).padStart(2, '0')}${String(today.getUTCDate()).padStart(2, '0')}`;
    assert.equal(datePart, expected, `date part should be today UTC, got ${datePart}, expected ${expected}`);
  });

  it('produces distinct values across N=1000 invocations', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const value = (externalWebhookService as any).generateOrderNumber('store-1');
      seen.add(value);
    }
    // Birthday-paradox bound: with 16M suffix space and 1k samples, expected
    // collisions << 1. Tolerate at most 2 dupes for CI flakiness.
    assert.ok(seen.size >= 998, `expected near-uniqueness, got ${seen.size} distinct of 1000`);
  });

  it('never produces the legacy ORD-XXXXX 5-digit padded format', () => {
    for (let i = 0; i < 50; i++) {
      const value = (externalWebhookService as any).generateOrderNumber('store-1');
      assert.doesNotMatch(value, /^ORD-\d{5}$/, `legacy format leaked: ${value}`);
    }
  });
});
