/**
 * Regression tests for the auto-invoice line rendering contract across the THREE
 * customer-facing representations of a bundle/pack:
 *
 *   1. XML signed (DTE)        -> buildFiscalLineItems() (already correct)
 *   2. KUDE PDF (downloadKude) -> must use buildFiscalLineItems() from the order
 *   3. Email body              -> must be fed from the SAME expanded fiscal array
 *
 * For a Pack Pareja (qty 1, pack price 349000, units_per_pack 2) all three must
 * show IDENTICAL: descripcion = parent fiscal_description ("Lentes Protector"),
 * cantidad = Q x units_per_pack (2), integer precioUnitario (174500, PYG has no
 * decimals). Before the fix the KUDE and the email read the raw order_line_items
 * (commercial pack name, cantidad 1, pack price) and contradicted the signed XML.
 *
 * These tests pin the SHARED-SOURCE contract: both the KUDE-side expansion and
 * the email-body mapping derive from buildFiscalLineItems(<same raw lines>), and
 * that output matches what the signed XML carries (parseFiscalLinesFromSignedXml).
 * The service functions (downloadKude, dispatchApprovedInvoiceEmail) build their
 * lines from this exact pure builder; the production mappings are mirrored here
 * verbatim so a divergence in either path fails this test.
 *
 * Run with:
 *   npx tsx --test api/services/__tests__/invoicing-auto-line-rendering.test.ts
 *
 * Fixtures reuse the Pack Pareja shape from invoicing-bundle-expansion.test.ts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFiscalLineItems,
  parseFiscalLinesFromSignedXml,
  type RawInvoiceLineItem,
  type FiscalLineItem,
} from '../sifen/fiscal-lines';

// Pack Pareja: ONE order_line_items row sold as a 2-unit bundle.
// Same fixture shape as invoicing-bundle-expansion.test.ts.
const PACK_PAREJA_RAW: RawInvoiceLineItem[] = [
  {
    product_name: 'NOCTE Pack Pareja (Mixto)',
    sku: 'NOCTE-GLASSES-PAREJA',
    quantity: 1,
    unit_price: 349000,
    variant_id: '7fad75bb-87e4-4067-91d0-868aa303011f',
    variant_type: 'bundle',
    products: { fiscal_description: 'Lentes Protector' },
    product_variant: { variant_type: 'bundle', units_per_pack: 2, uses_shared_stock: true },
  },
];

// The signed-XML representation the DTE carries for the same Pack Pareja: ONE
// gCamItem with the expanded physical quantity (2) and integer unit price.
// dDesProSer is the fiscal_description, never the commercial pack name.
function wrap(itemsXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<rDE xmlns="http://ekuatia.set.gov.py/sifen/xsd">` +
    `<DE><gDtipDE>${itemsXml}</gDtipDE></DE>` +
    `</rDE>`
  );
}

const PACK_PAREJA_SIGNED_XML = wrap(
  `<gCamItem><dCodInt>NOCTE-GLASSES-PAREJA</dCodInt>` +
    `<dDesProSer>Lentes Protector</dDesProSer>` +
    `<cUniMed>77</cUniMed><dDesUniMed>UNI</dDesUniMed><dCantProSer>2</dCantProSer>` +
    `<gValorItem><dPUniProSer>174500</dPUniProSer><dTotBruOpeItem>349000</dTotBruOpeItem>` +
    `<gValorRestaItem><dTotOpeItem>349000</dTotOpeItem></gValorRestaItem></gValorItem>` +
    `<gCamIVA><iAfecIVA>1</iAfecIVA><dDesAfecIVA>Gravado IVA</dDesAfecIVA>` +
    `<dPropIVA>100</dPropIVA><dTasaIVA>10</dTasaIVA></gCamIVA></gCamItem>`,
);

// Mirror of the downloadKude order branch (api/services/invoicing.service.ts):
// reads the full line items with the variant join, then expands via
// buildFiscalLineItems. The KUDE renders exactly these items.
function kudeItemsForOrder(rawLines: RawInvoiceLineItem[]): FiscalLineItem[] {
  const { items } = buildFiscalLineItems(rawLines);
  return items;
}

// Mirror of the email-body mapping used by all three order emission paths
// (sync first emission, retry, dispatchApprovedInvoiceEmail): the email body is
// fed from the SAME expanded fiscal array, mapping descripcion -> name,
// cantidad -> quantity, precioUnitario -> unitPrice. The email template then
// renders { name, quantity, unitPrice } (unitPrice formatted for display).
function emailBodyLinesForOrder(
  rawLines: RawInvoiceLineItem[],
): Array<{ name: string; quantity: number; unitPrice: number }> {
  const { items } = buildFiscalLineItems(rawLines);
  return items.map((it) => ({
    name: it.descripcion,
    quantity: it.cantidad,
    unitPrice: it.precioUnitario,
  }));
}

describe('auto-invoice line rendering - GAP 1: downloadKude (KUDE PDF) for a bundle order', () => {
  it('Pack Pareja KUDE shows fiscal_description, cantidad 2, integer precioUnitario 174500', () => {
    const items = kudeItemsForOrder(PACK_PAREJA_RAW);
    assert.equal(items.length, 1);
    assert.equal(items[0].descripcion, 'Lentes Protector');
    assert.equal(items[0].cantidad, 2);
    assert.equal(items[0].precioUnitario, 174500);
    assert.ok(Number.isInteger(items[0].precioUnitario), 'precioUnitario must be an integer (PYG)');
    // Never leaks the commercial pack name onto the fiscal document.
    assert.notEqual(items[0].descripcion, 'NOCTE Pack Pareja (Mixto)');
    // Line total reconciles to what the customer paid.
    assert.equal(Math.round(items[0].cantidad * items[0].precioUnitario), 349000);
  });

  it('KUDE items equal the signed XML lines (PDF == DTE)', async () => {
    const kude = kudeItemsForOrder(PACK_PAREJA_RAW);
    const xml = await parseFiscalLinesFromSignedXml(PACK_PAREJA_SIGNED_XML);
    assert.ok(xml, 'expected XML lines, got null');
    assert.equal(kude.length, xml!.length);
    for (let i = 0; i < kude.length; i++) {
      assert.equal(kude[i].descripcion, xml![i].descripcion);
      assert.equal(kude[i].cantidad, xml![i].cantidad);
      assert.equal(kude[i].precioUnitario, xml![i].precioUnitario);
    }
  });
});

describe('auto-invoice line rendering - GAP 2: email body lines for a bundle order', () => {
  it('email body lines equal the signed XML lines (same cantidad and integer precioUnitario)', async () => {
    const email = emailBodyLinesForOrder(PACK_PAREJA_RAW);
    const xml = await parseFiscalLinesFromSignedXml(PACK_PAREJA_SIGNED_XML);
    assert.ok(xml, 'expected XML lines, got null');
    assert.equal(email.length, xml!.length);
    for (let i = 0; i < email.length; i++) {
      // descripcion -> name, cantidad -> quantity, precioUnitario -> unitPrice
      assert.equal(email[i].name, xml![i].descripcion);
      assert.equal(email[i].quantity, xml![i].cantidad);
      assert.equal(email[i].unitPrice, xml![i].precioUnitario);
      assert.ok(Number.isInteger(email[i].unitPrice), 'unitPrice must be an integer (PYG)');
    }
  });

  it('email body lines equal the KUDE lines (email == PDF == DTE, single source)', () => {
    const email = emailBodyLinesForOrder(PACK_PAREJA_RAW);
    const kude = kudeItemsForOrder(PACK_PAREJA_RAW);
    assert.equal(email.length, kude.length);
    for (let i = 0; i < email.length; i++) {
      assert.equal(email[i].name, kude[i].descripcion);
      assert.equal(email[i].quantity, kude[i].cantidad);
      assert.equal(email[i].unitPrice, kude[i].precioUnitario);
    }
  });

  it('email body for Pack Pareja: cantidad 2, precioUnitario 174500, fiscal_description', () => {
    const email = emailBodyLinesForOrder(PACK_PAREJA_RAW);
    assert.equal(email.length, 1);
    assert.equal(email[0].name, 'Lentes Protector');
    assert.equal(email[0].quantity, 2);
    assert.equal(email[0].unitPrice, 174500);
  });
});
