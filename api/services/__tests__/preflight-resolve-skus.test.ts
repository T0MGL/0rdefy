/**
 * Integration-level tests for ExternalWebhookService.preflightResolveSkus.
 *
 * Run with:
 *   npx tsx --test api/services/__tests__/preflight-resolve-skus.test.ts
 *
 * Strategy mirrors find-order-by-number.test.ts: stub supabaseAdmin.from and
 * .rpc so we can drive the preflight without a live database. We exercise the
 * three real production scenarios surfaced by the 2026-05-16 Solenne stock
 * reconciliation:
 *   1. SKU resolves cleanly to a variant -> accept.
 *   2. SKU is the bare parent of a product that has active variants ->
 *      REJECT with AMBIGUOUS_PARENT_SKU and a non-empty suggested_skus list.
 *   3. SKU does not resolve at all -> REJECT with SKU_NOT_FOUND.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_ANON_KEY ??= 'test-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service';

const connectionModule = await import('../../db/connection');
const { externalWebhookService } = await import('../external-webhook.service');

const supabaseAdmin = connectionModule.supabaseAdmin;
const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
const originalRpc = supabaseAdmin.rpc.bind(supabaseAdmin);

const STORE_ID = '0b3f13f8-d1dc-48a5-a707-27a095c9c545'; // Solenne store

interface VariantRow {
  id: string;
  sku: string;
  variant_title: string;
  is_active: boolean;
  variant_type: string | null;
  uses_shared_stock: boolean;
}

function stubRpcReturning(rows: any[] | null): void {
  (supabaseAdmin as any).rpc = (fnName: string, args: any) => {
    if (fnName === 'find_product_or_variant_by_sku') {
      return Promise.resolve({ data: rows, error: null });
    }
    return originalRpc(fnName, args);
  };
}

function stubProductVariantsQuery(rowsForProductId: Map<string, VariantRow[]>): void {
  (supabaseAdmin as any).from = (table: string) => {
    if (table !== 'product_variants') return originalFrom(table);
    let pendingProductId: string | null = null;
    const builder: any = {
      select() { return this; },
      eq(col: string, value: string) {
        if (col === 'product_id') pendingProductId = value;
        return this;
      },
      then(resolve: (v: any) => any) {
        const rows = pendingProductId ? rowsForProductId.get(pendingProductId) ?? [] : [];
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return builder;
  };
}

function buildPayload(skus: Array<string | undefined>) {
  return {
    customer: { name: 'Test', phone: '+595981000000' },
    shipping_address: { address: 'X', city: 'Asuncion' },
    items: skus.map((sku, i) => ({
      name: `Item ${i}`,
      sku,
      quantity: 1,
      price: 100,
    })),
    totals: { total: 100 * skus.length },
    payment_method: 'cash_on_delivery' as const,
  };
}

describe('preflightResolveSkus', () => {
  afterEach(() => {
    (supabaseAdmin as any).from = originalFrom;
    (supabaseAdmin as any).rpc = originalRpc;
  });

  it('passes through items without an SKU (legacy behaviour preserved)', async () => {
    stubRpcReturning(null);
    stubProductVariantsQuery(new Map());

    const result = await (externalWebhookService as any).preflightResolveSkus(
      buildPayload([undefined, undefined]),
      STORE_ID,
    );

    assert.equal(result.ok, true);
    assert.equal(result.entries.length, 2);
    for (const e of result.entries) {
      assert.equal(e.product_id, null);
      assert.equal(e.variant_id, null);
    }
  });

  it('accepts a clean variant SKU', async () => {
    stubRpcReturning([
      {
        entity_type: 'variant',
        product_id: 'p-tape',
        variant_id: 'v-tape-100',
        product_name: 'V-Shaped Face Tape',
        variant_title: '1 Caja',
        sku: 'SOLENNE-TAPE-100',
        image_url: 'https://img/tape.png',
      },
    ]);
    stubProductVariantsQuery(new Map([
      ['p-tape', [
        { id: 'v-tape-100', sku: 'SOLENNE-TAPE-100', variant_title: '1 Caja', is_active: true, variant_type: 'variation', uses_shared_stock: true },
        { id: 'v-tape-rit', sku: 'SOLENNE-TAPE-RITUAL', variant_title: 'Ritual', is_active: true, variant_type: 'bundle', uses_shared_stock: true },
      ]],
    ]));

    const result = await (externalWebhookService as any).preflightResolveSkus(
      buildPayload(['SOLENNE-TAPE-100']),
      STORE_ID,
    );

    assert.equal(result.ok, true);
    assert.equal(result.entries[0].product_id, 'p-tape');
    assert.equal(result.entries[0].variant_id, 'v-tape-100');
    assert.equal(result.entries[0].variant_type, 'variation');
    assert.equal(result.entries[0].image_url, 'https://img/tape.png');
  });

  it('rejects a bare parent SKU when the product has active variants', async () => {
    stubRpcReturning([
      {
        entity_type: 'product',
        product_id: 'p-tape',
        variant_id: null,
        product_name: 'V-Shaped Face Tape',
        variant_title: null,
        sku: 'SOLENNE-TAPE',
        image_url: 'https://img/tape.png',
      },
    ]);
    stubProductVariantsQuery(new Map([
      ['p-tape', [
        { id: 'v-tape-100', sku: 'SOLENNE-TAPE-100', variant_title: '1 Caja', is_active: true, variant_type: 'variation', uses_shared_stock: true },
        { id: 'v-tape-rit', sku: 'SOLENNE-TAPE-RITUAL', variant_title: 'Ritual', is_active: true, variant_type: 'bundle', uses_shared_stock: true },
        { id: 'v-tape-evt', sku: 'SOLENNE-TAPE-EVENTO', variant_title: 'Evento', is_active: true, variant_type: 'bundle', uses_shared_stock: true },
      ]],
    ]));

    const result = await (externalWebhookService as any).preflightResolveSkus(
      buildPayload(['SOLENNE-TAPE']),
      STORE_ID,
    );

    assert.equal(result.ok, false);
    assert.equal(result.code, 'AMBIGUOUS_PARENT_SKU');
    assert.equal(result.item_index, 0);
    assert.equal(result.sku, 'SOLENNE-TAPE');
    assert.deepEqual(result.suggested_skus, [
      'SOLENNE-TAPE-100',
      'SOLENNE-TAPE-RITUAL',
      'SOLENNE-TAPE-EVENTO',
    ]);
  });

  it('rejects when SKU does not resolve at all', async () => {
    stubRpcReturning([]);
    stubProductVariantsQuery(new Map());

    const result = await (externalWebhookService as any).preflightResolveSkus(
      buildPayload(['DOES-NOT-EXIST']),
      STORE_ID,
    );

    assert.equal(result.ok, false);
    assert.equal(result.code, 'SKU_NOT_FOUND');
    assert.equal(result.item_index, 0);
  });

  it('reports the first failing item index when multiple items are bad', async () => {
    let callCount = 0;
    (supabaseAdmin as any).rpc = (fnName: string) => {
      if (fnName !== 'find_product_or_variant_by_sku') return originalRpc(fnName);
      callCount += 1;
      if (callCount === 1) {
        return Promise.resolve({
          data: [{
            entity_type: 'variant',
            product_id: 'p-tape',
            variant_id: 'v-tape-100',
            product_name: 'V-Shaped Face Tape',
            variant_title: '1 Caja',
            sku: 'SOLENNE-TAPE-100',
            image_url: null,
          }],
          error: null,
        });
      }
      // Second call: parent match with active variants
      return Promise.resolve({
        data: [{
          entity_type: 'product',
          product_id: 'p-tape',
          variant_id: null,
          product_name: 'V-Shaped Face Tape',
          variant_title: null,
          sku: 'SOLENNE-TAPE',
          image_url: null,
        }],
        error: null,
      });
    };
    stubProductVariantsQuery(new Map([
      ['p-tape', [
        { id: 'v-tape-100', sku: 'SOLENNE-TAPE-100', variant_title: '1 Caja', is_active: true, variant_type: 'variation', uses_shared_stock: true },
        { id: 'v-tape-rit', sku: 'SOLENNE-TAPE-RITUAL', variant_title: 'Ritual', is_active: true, variant_type: 'bundle', uses_shared_stock: true },
      ]],
    ]));

    const result = await (externalWebhookService as any).preflightResolveSkus(
      buildPayload(['SOLENNE-TAPE-100', 'SOLENNE-TAPE']),
      STORE_ID,
    );

    assert.equal(result.ok, false);
    assert.equal(result.item_index, 1);
    assert.equal(result.code, 'AMBIGUOUS_PARENT_SKU');
  });

  it('accepts a parent SKU when the product has no active variants', async () => {
    stubRpcReturning([
      {
        entity_type: 'product',
        product_id: 'p-shipping',
        variant_id: null,
        product_name: 'Envio Prioritario VIP',
        variant_title: null,
        sku: 'SOLENNE-ENVIO-PRIORITARIO',
        image_url: null,
      },
    ]);
    stubProductVariantsQuery(new Map([
      ['p-shipping', []], // service product, no variants
    ]));

    const result = await (externalWebhookService as any).preflightResolveSkus(
      buildPayload(['SOLENNE-ENVIO-PRIORITARIO']),
      STORE_ID,
    );

    assert.equal(result.ok, true);
    assert.equal(result.entries[0].product_id, 'p-shipping');
    assert.equal(result.entries[0].variant_id, null);
  });
});
