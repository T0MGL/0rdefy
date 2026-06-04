/**
 * Unit tests for parseFiscalLinesFromSignedXml (api/services/sifen/fiscal-lines.ts).
 *
 * Run with:
 *   npx tsx --test api/services/__tests__/invoicing-xml-line-recovery.test.ts
 *
 * Manual invoices have no order_line_items, so the KUDE/email used to fall back
 * to a synthetic "Productos varios" / cantidad 1 / precio = total line that
 * misrepresented the real items. The signed XML is the legal source of truth;
 * this parser recovers the real lines (descripcion, cantidad, precio unitario,
 * IVA) so the PDF and email match the DTE exactly.
 *
 * The wrapped XML below is a verbatim gCamItem block from a real NOCTE manual
 * invoice (document_number=2, total 489000, 3 units at 163000).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFiscalLinesFromSignedXml } from '../sifen/fiscal-lines';

function wrap(itemsXml: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<rDE xmlns="http://ekuatia.set.gov.py/sifen/xsd">` +
    `<DE><gDtipDE>${itemsXml}</gDtipDE></DE>` +
    `</rDE>`
  );
}

const REAL_ITEM =
  `<gCamItem><dCodInt>1</dCodInt><dDesProSer>Lentes Protector</dDesProSer>` +
  `<cUniMed>77</cUniMed><dDesUniMed>UNI</dDesUniMed><dCantProSer>3</dCantProSer>` +
  `<gValorItem><dPUniProSer>163000</dPUniProSer><dTotBruOpeItem>489000</dTotBruOpeItem>` +
  `<gValorRestaItem><dTotOpeItem>489000</dTotOpeItem></gValorRestaItem></gValorItem>` +
  `<gCamIVA><iAfecIVA>1</iAfecIVA><dDesAfecIVA>Gravado IVA</dDesAfecIVA>` +
  `<dPropIVA>100</dPropIVA><dTasaIVA>10</dTasaIVA></gCamIVA></gCamItem>`;

test('recovers real descripcion, cantidad and precio unitario from a single item', async () => {
  const lines = await parseFiscalLinesFromSignedXml(wrap(REAL_ITEM));
  assert.ok(lines, 'expected lines, got null');
  assert.equal(lines!.length, 1);
  const [li] = lines!;
  assert.equal(li.descripcion, 'Lentes Protector');
  assert.equal(li.cantidad, 3);
  assert.equal(li.precioUnitario, 163000);
  assert.equal(li.ivaRate, 10);
  assert.equal(li.codigo, '1');
  // The damaged fallback would have produced cantidad 1 / precio = total.
  assert.notEqual(li.cantidad, 1);
  assert.notEqual(li.precioUnitario, 489000);
});

test('recovers multiple items in document order', async () => {
  const second =
    `<gCamItem><dCodInt>2</dCodInt><dDesProSer>Estuche</dDesProSer>` +
    `<dCantProSer>1</dCantProSer>` +
    `<gValorItem><dPUniProSer>50000</dPUniProSer></gValorItem>` +
    `<gCamIVA><dTasaIVA>5</dTasaIVA></gCamIVA></gCamItem>`;
  const lines = await parseFiscalLinesFromSignedXml(wrap(REAL_ITEM + second));
  assert.ok(lines);
  assert.equal(lines!.length, 2);
  assert.equal(lines![0].descripcion, 'Lentes Protector');
  assert.equal(lines![1].descripcion, 'Estuche');
  assert.equal(lines![1].cantidad, 1);
  assert.equal(lines![1].precioUnitario, 50000);
  assert.equal(lines![1].ivaRate, 5);
});

test('falls back to ordinal codigo when dCodInt is absent', async () => {
  const noCode =
    `<gCamItem><dDesProSer>Sin codigo</dDesProSer><dCantProSer>2</dCantProSer>` +
    `<gValorItem><dPUniProSer>1000</dPUniProSer></gValorItem></gCamItem>`;
  const lines = await parseFiscalLinesFromSignedXml(wrap(noCode));
  assert.ok(lines);
  assert.equal(lines![0].codigo, '1');
});

test('defaults ivaRate to 10 when dTasaIVA is missing', async () => {
  const noIva =
    `<gCamItem><dCodInt>1</dCodInt><dDesProSer>Sin IVA tag</dDesProSer>` +
    `<dCantProSer>1</dCantProSer>` +
    `<gValorItem><dPUniProSer>1000</dPUniProSer></gValorItem></gCamItem>`;
  const lines = await parseFiscalLinesFromSignedXml(wrap(noIva));
  assert.ok(lines);
  assert.equal(lines![0].ivaRate, 10);
});

test('returns null for empty / nullish XML (caller keeps literal fallback)', async () => {
  assert.equal(await parseFiscalLinesFromSignedXml(null), null);
  assert.equal(await parseFiscalLinesFromSignedXml(undefined), null);
  assert.equal(await parseFiscalLinesFromSignedXml('   '), null);
});

test('returns null for malformed XML', async () => {
  assert.equal(await parseFiscalLinesFromSignedXml('<rDE><not closed'), null);
});

test('returns null when XML has no gCamItem block', async () => {
  const lines = await parseFiscalLinesFromSignedXml(
    `<rDE><DE><gDtipDE><gOpeCom></gOpeCom></gDtipDE></DE></rDE>`,
  );
  assert.equal(lines, null);
});

test('returns null when an item is missing a required field (descripcion)', async () => {
  const noDesc =
    `<gCamItem><dCodInt>1</dCodInt><dCantProSer>1</dCantProSer>` +
    `<gValorItem><dPUniProSer>1000</dPUniProSer></gValorItem></gCamItem>`;
  assert.equal(await parseFiscalLinesFromSignedXml(wrap(noDesc)), null);
});

test('strips namespace prefixes (ns:gCamItem)', async () => {
  const prefixed =
    `<ns2:rDE xmlns:ns2="http://ekuatia.set.gov.py/sifen/xsd">` +
    `<ns2:DE><ns2:gDtipDE><ns2:gCamItem>` +
    `<ns2:dCodInt>1</ns2:dCodInt><ns2:dDesProSer>Con prefijo</ns2:dDesProSer>` +
    `<ns2:dCantProSer>4</ns2:dCantProSer>` +
    `<ns2:gValorItem><ns2:dPUniProSer>2500</ns2:dPUniProSer></ns2:gValorItem>` +
    `<ns2:gCamIVA><ns2:dTasaIVA>10</ns2:dTasaIVA></ns2:gCamIVA>` +
    `</ns2:gCamItem></ns2:gDtipDE></ns2:DE></ns2:rDE>`;
  const lines = await parseFiscalLinesFromSignedXml(prefixed);
  assert.ok(lines);
  assert.equal(lines![0].descripcion, 'Con prefijo');
  assert.equal(lines![0].cantidad, 4);
  assert.equal(lines![0].precioUnitario, 2500);
});
