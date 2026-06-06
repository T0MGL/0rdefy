/**
 * Unit tests for the Shopify host parameter helpers.
 *
 * Run with:
 *   npx tsx --test src/utils/__tests__/shopifyHost.test.ts
 *
 * Goal: lock the parsing rules used by ShopifyAppBridgeProvider when
 * deciding whether to send `?shop=` to the Token Exchange route. A
 * regression here would either leak the wrong shop to the backend or
 * skip the guard entirely.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { decodeHostShop } from '../shopifyHost';

function encode(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64');
}

describe('decodeHostShop', () => {
  it('returns null for empty / nullish input', () => {
    assert.equal(decodeHostShop(null), null);
    assert.equal(decodeHostShop(undefined), null);
    assert.equal(decodeHostShop(''), null);
  });

  it('returns null for non-base64 garbage', () => {
    assert.equal(decodeHostShop('not-base64!!!'), null);
  });

  it('extracts shop from legacy iframe host format', () => {
    const host = encode('dev-store-abc.myshopify.com/admin');
    assert.equal(decodeHostShop(host), 'dev-store-abc.myshopify.com');
  });

  it('returns null for unified-admin host format', () => {
    // admin.shopify.com is NOT a shop domain; the canonical shop must
    // come from the `?shop=` query param or the session token.
    const host = encode('admin.shopify.com/store/dev-store-abc');
    assert.equal(decodeHostShop(host), null);
  });

  it('rejects malformed shop domain with bad characters', () => {
    const host = encode('not a shop.myshopify.com/admin');
    assert.equal(decodeHostShop(host), null);
  });

  it('preserves hyphen support in real dev-store names', () => {
    const host = encode('my-fancy-store-001.myshopify.com/admin');
    assert.equal(decodeHostShop(host), 'my-fancy-store-001.myshopify.com');
  });
});
