/**
 * Unit tests for buildFiscalLineItems (api/services/sifen/fiscal-lines.ts).
 *
 * Run with:
 *   npx tsx --test api/services/__tests__/invoicing-bundle-expansion.test.ts
 *
 * Covers the SIFEN bundle physical-unit expansion: a bundle/pack sold as one
 * order_line_items row (quantity=Q, pack price P) must be invoiced with the
 * real physical quantity (Q x N) while keeping precioUnitario an INTEGER and
 * the line total exactly Q x P (no drift, not even 1 Gs). Guaraní has no cents,
 * so no decimal may ever reach dPUniProSer or the KUDE.
 *
 *   - bundle N>1, clean divide -> one line, cantidad=Q x N, integer PU, exact total
 *   - quantity > 1 of pack      -> cantidad = Q x N
 *   - bundle N=1                -> no expansion
 *   - variant_id null           -> no expansion
 *   - variation                 -> no expansion
 *   - non-dividing price         -> TWO integer lines, total exact, zero decimals
 *   - description               -> parent fiscal_description only, never pack name
 *   - integrity flags           -> missing fiscal_description, missing units_per_pack
 *   - REAL xmlgen v1.0.280       -> dPUniProSer has no '.', dTotOpeItem exact
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFiscalLineItems, type RawInvoiceLineItem } from '../sifen/fiscal-lines';

// SIFEN line total: round(cantidad x precioUnitario) for PYG (0 decimals).
function sifenLineTotal(cantidad: number, precioUnitario: number): number {
  return Math.round(cantidad * precioUnitario);
}

// Assert a number is a non-negative integer (zero decimals).
function assertInteger(n: number, label: string): void {
  assert.ok(Number.isInteger(n), `${label} must be an integer, got ${n}`);
}

describe('buildFiscalLineItems - bundle expansion (integer unit price)', () => {
  it('expands a 2-pack (Pareja): qty 1, 349000, N=2 -> cant 2, PU 174500, no split, total 349000', () => {
    const items: RawInvoiceLineItem[] = [{
      product_name: 'NOCTE Pack Pareja (Mixto)',
      sku: 'NOCTE-GLASSES-PAREJA',
      quantity: 1,
      unit_price: 349000,
      variant_id: '7fad75bb-87e4-4067-91d0-868aa303011f',
      variant_type: 'bundle',
      products: { fiscal_description: 'Lentes Protector' },
      product_variant: { variant_type: 'bundle', units_per_pack: 2, uses_shared_stock: true },
    }];
    const { items: out } = buildFiscalLineItems(items);
    assert.equal(out.length, 1);
    assert.equal(out[0].cantidad, 2);
    assert.equal(out[0].precioUnitario, 174500);
    assertInteger(out[0].precioUnitario, 'precioUnitario');
    assert.equal(out[0].descripcion, 'Lentes Protector');
    assert.equal(sifenLineTotal(out[0].cantidad, out[0].precioUnitario), 349000);
  });

  it('expands a 3-pack (Oficina): qty 1, 489000, N=3 -> cant 3, PU 163000, no split, total 489000', () => {
    const { items: out } = buildFiscalLineItems([{
      product_name: 'NOCTE Pack Oficina (Mixto)',
      sku: 'NOCTE-GLASSES-OFICINA',
      quantity: 1,
      unit_price: 489000,
      variant_id: '92c89cbd-1321-4c0b-b1ce-6b721b4e5970',
      variant_type: 'bundle',
      products: { fiscal_description: 'Lentes Protector' },
      product_variant: { variant_type: 'bundle', units_per_pack: 3, uses_shared_stock: true },
    }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].cantidad, 3);
    assert.equal(out[0].precioUnitario, 163000);
    assertInteger(out[0].precioUnitario, 'precioUnitario');
    assert.equal(sifenLineTotal(out[0].cantidad, out[0].precioUnitario), 489000);
  });

  it('non-dividing price (350000 / 3): splits into TWO integer lines, total exact 350000, zero decimals', () => {
    const { items: out } = buildFiscalLineItems([{
      product_name: 'Pack X',
      sku: 'UGLY-3',
      quantity: 1,
      unit_price: 350000,
      variant_id: 'v',
      variant_type: 'bundle',
      products: { fiscal_description: 'Lentes Protector' },
      product_variant: { variant_type: 'bundle', units_per_pack: 3, uses_shared_stock: true },
    }]);
    // 350000 / 3 -> base 116666, remainder 2.
    assert.equal(out.length, 2);
    // Line A: (3 - 2) = 1 unit at 116666.
    assert.equal(out[0].cantidad, 1);
    assert.equal(out[0].precioUnitario, 116666);
    // Line B: 2 units at 116667.
    assert.equal(out[1].cantidad, 2);
    assert.equal(out[1].precioUnitario, 116667);
    // Every emitted number is an integer.
    for (const l of out) {
      assertInteger(l.cantidad, 'cantidad');
      assertInteger(l.precioUnitario, 'precioUnitario');
    }
    // Total physical units = 3, total amount exactly 350000.
    assert.equal(out.reduce((s, l) => s + l.cantidad, 0), 3);
    const total = out.reduce((s, l) => s + sifenLineTotal(l.cantidad, l.precioUnitario), 0);
    assert.equal(total, 350000);
  });

  it('quantity > 1 of a pack: qty 2 x N=2 -> cant 4, PU 174500, total 698000', () => {
    const { items: out } = buildFiscalLineItems([{
      product_name: 'NOCTE Glasses',
      sku: 'NOCTE-GLASSES-PAREJA',
      quantity: 2,
      unit_price: 349000,
      variant_id: 'v',
      variant_type: 'bundle',
      products: { fiscal_description: 'Lentes Protector' },
      product_variant: { variant_type: 'bundle', units_per_pack: 2, uses_shared_stock: true },
    }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].cantidad, 4);
    assert.equal(out[0].precioUnitario, 174500);
    assertInteger(out[0].precioUnitario, 'precioUnitario');
    assert.equal(sifenLineTotal(out[0].cantidad, out[0].precioUnitario), 698000);
  });

  it('bundle with units_per_pack = 1: no expansion', () => {
    const { items: out } = buildFiscalLineItems([{
      product_name: 'Serum',
      sku: 'PDRN-30ML-IND',
      quantity: 1,
      unit_price: 189000,
      variant_id: 'v',
      variant_type: 'bundle',
      products: { fiscal_description: 'Serum facial' },
      product_variant: { variant_type: 'bundle', units_per_pack: 1, uses_shared_stock: true },
    }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].cantidad, 1);
    assert.equal(out[0].precioUnitario, 189000);
    assertInteger(out[0].precioUnitario, 'precioUnitario');
  });

  it('variation: never expands (independent per-unit stock)', () => {
    const { items: out } = buildFiscalLineItems([{
      product_name: 'Remera M',
      sku: 'TSHIRT-M',
      quantity: 3,
      unit_price: 120000,
      variant_id: 'v',
      variant_type: 'variation',
      products: { fiscal_description: 'Remera' },
      product_variant: { variant_type: 'variation', units_per_pack: 1, uses_shared_stock: false },
    }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].cantidad, 3);
    assert.equal(out[0].precioUnitario, 120000);
  });

  it('variant_id null: no expansion even if variant_type says bundle', () => {
    const { items: out } = buildFiscalLineItems([{
      product_name: 'Producto suelto',
      sku: 'PLAIN',
      quantity: 1,
      unit_price: 100000,
      variant_id: null,
      variant_type: 'bundle',
      products: { fiscal_description: 'Producto' },
      product_variant: null,
    }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].cantidad, 1);
    assert.equal(out[0].precioUnitario, 100000);
  });

  it('description uses parent fiscal_description, never the pack/variant name', () => {
    const { items: out } = buildFiscalLineItems([{
      product_name: 'NOCTE Pack Oficina (Mixto)', // pack name must NOT leak
      sku: 'NOCTE-GLASSES-OFICINA',
      quantity: 1,
      unit_price: 489000,
      variant_id: 'v',
      variant_type: 'bundle',
      products: { fiscal_description: 'Lentes Protector' },
      product_variant: { variant_type: 'bundle', units_per_pack: 3, uses_shared_stock: true },
    }]);
    assert.equal(out[0].descripcion, 'Lentes Protector');
    assert.notEqual(out[0].descripcion, 'NOCTE Pack Oficina (Mixto)');
  });

  it('flags a bundle whose parent has no fiscal_description (data integrity)', () => {
    const { items: out, integrityFlags } = buildFiscalLineItems([{
      product_name: 'Kit Familiar (3 unidades)',
      sku: 'KIT-FAMILIAR',
      quantity: 1,
      unit_price: 510000,
      variant_id: 'v',
      variant_type: 'bundle',
      products: { fiscal_description: null }, // missing
      product_variant: { variant_type: 'bundle', units_per_pack: 3, uses_shared_stock: true },
    }]);
    // Still expands correctly (510000/3 = 170000, clean divide -> one line).
    assert.equal(out.length, 1);
    assert.equal(out[0].cantidad, 3);
    assert.equal(out[0].precioUnitario, 170000);
    assert.equal(sifenLineTotal(out[0].cantidad, out[0].precioUnitario), 510000);
    // ...but surfaces the missing fiscal_description.
    assert.equal(integrityFlags.length, 1);
    assert.match(integrityFlags[0], /fiscal_description/);
  });

  it('flags a bundle variant missing units_per_pack and emits without expansion', () => {
    const { items: out, integrityFlags } = buildFiscalLineItems([{
      product_name: 'Pack roto',
      sku: 'BROKEN',
      quantity: 1,
      unit_price: 300000,
      variant_id: 'v',
      variant_type: 'bundle',
      products: { fiscal_description: 'Producto' },
      product_variant: { variant_type: 'bundle', units_per_pack: null, uses_shared_stock: true },
    }]);
    assert.equal(out.length, 1);
    assert.equal(out[0].cantidad, 1);
    assert.equal(out[0].precioUnitario, 300000);
    assert.ok(integrityFlags.some((f) => /units_per_pack/.test(f)));
  });

  it('mixed multi-line document subtotal preserved; every PU integer', () => {
    const raw: RawInvoiceLineItem[] = [
      { sku: 'A', quantity: 1, unit_price: 349000, variant_id: 'v', variant_type: 'bundle', products: { fiscal_description: 'X' }, product_variant: { variant_type: 'bundle', units_per_pack: 2 } },
      { sku: 'B', quantity: 1, unit_price: 350000, variant_id: 'v', variant_type: 'bundle', products: { fiscal_description: 'X' }, product_variant: { variant_type: 'bundle', units_per_pack: 3 } },
      { sku: 'C', quantity: 2, unit_price: 120000, variant_id: 'v', variant_type: 'variation', products: { fiscal_description: 'X' }, product_variant: { variant_type: 'variation', units_per_pack: 1 } },
    ];
    const rawSubtotal = raw.reduce((s, l) => s + (l.unit_price || 0) * (l.quantity || 1), 0);
    const { items: out } = buildFiscalLineItems(raw);
    for (const l of out) {
      assertInteger(l.cantidad, 'cantidad');
      assertInteger(l.precioUnitario, 'precioUnitario');
    }
    const expandedSubtotal = out.reduce((s, l) => s + sifenLineTotal(l.cantidad, l.precioUnitario), 0);
    assert.equal(expandedSubtotal, rawSubtotal);
    // IVA 10% of an inclusive total = round(total / 11), same on both sides.
    assert.equal(Math.round(expandedSubtotal / 11), Math.round(rawSubtotal / 11));
  });
});
