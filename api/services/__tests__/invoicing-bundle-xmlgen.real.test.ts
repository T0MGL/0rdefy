/**
 * REAL xmlgen integration test for the SIFEN bundle unit-expansion.
 *
 * Unlike invoicing-bundle-expansion.test.ts (which asserts on the pure
 * buildFiscalLineItems output with a local helper), this test runs the expanded
 * fiscal lines through the ACTUAL facturacionelectronicapy-xmlgen v1.0.280
 * library (no mock) and asserts on the emitted XML:
 *   - <dPUniProSer> (unit price) has NO decimal point  -> Guaraní integer only
 *   - <dTotOpeItem> (line total) equals Q x P exactly   -> no drift
 *
 * Run with:
 *   npx tsx --test api/services/__tests__/invoicing-bundle-xmlgen.real.test.ts
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildFiscalLineItems, type RawInvoiceLineItem, type FiscalLineItem } from '../sifen/fiscal-lines';

// Minimal valid emitter params (test-environment timbrado, no fiscal value).
const params = {
  version: 150,
  ruc: '80069563-1',
  razonSocial: 'DE generado en ambiente de prueba - sin valor comercial ni fiscal',
  nombreFantasia: 'ORDEFY TEST',
  actividadesEconomicas: [{ codigo: '1254', descripcion: 'Comercio' }],
  timbradoNumero: '12558946',
  timbradoFecha: '2022-08-25',
  tipoContribuyente: 2,
  tipoRegimen: 8,
  establecimientos: [{
    codigo: '001',
    direccion: 'Barrio Carolina',
    numeroCasa: '0',
    departamento: 11,
    departamentoDescripcion: 'ALTO PARANA',
    distrito: 145,
    distritoDescripcion: 'CIUDAD DEL ESTE',
    ciudad: 3432,
    ciudadDescripcion: 'PUERTO PTE.STROESSNER (MUNIC)',
    telefono: '0973-527155',
    email: 'test@ordefy.io',
    denominacion: 'Sucursal 1',
  }],
};

function mapToXmlgenItems(fiscal: FiscalLineItem[]) {
  return fiscal.map((item) => ({
    codigo: item.codigo,
    descripcion: item.descripcion,
    observacion: '',
    unidadMedida: 77,
    cantidad: item.cantidad,
    precioUnitario: item.precioUnitario,
    cambio: 0,
    descuento: 0,
    anticipo: 0,
    ivaTipo: 1,
    ivaBase: 100,
    iva: 10,
    ivaProporcion: 100,
    propina: 0,
  }));
}

function buildData(items: ReturnType<typeof mapToXmlgenItems>, total: number) {
  return {
    tipoDocumento: 1,
    establecimiento: '001',
    punto: '001',
    numero: '0000001',
    codigoSeguridadAleatorio: '123456',
    fecha: '2026-06-04T10:11:00',
    tipoEmision: 1,
    tipoTransaccion: 1,
    tipoImpuesto: 1,
    moneda: 'PYG',
    condicionAnticipo: 1,
    condicionTipoCambio: 1,
    descuentoGlobal: 0,
    anticipoGlobal: 0,
    cliente: {
      contribuyente: false,
      tipoOperacion: 2,
      razonSocial: 'Consumidor Final',
      nombreFantasia: 'Consumidor Final',
      tipoContribuyente: 1,
      documentoTipo: 1,
      documentoNumero: '2324234',
      direccion: 'Asuncion',
      numeroCasa: '0',
      departamento: 11,
      departamentoDescripcion: 'ALTO PARANA',
      distrito: 145,
      distritoDescripcion: 'CIUDAD DEL ESTE',
      ciudad: 3432,
      ciudadDescripcion: 'PUERTO PTE.STROESSNER (MUNIC)',
      pais: 'PRY',
      paisDescripcion: 'Paraguay',
    },
    usuario: { documentoTipo: 1, documentoNumero: '157264', nombre: 'Test', cargo: 'Vendedor' },
    factura: { presencia: 1 },
    condicion: { tipo: 1, entregas: [{ tipo: 1, monto: String(total), moneda: 'PYG', cambio: 0 }] },
    items,
  };
}

// Pull every <dPUniProSer>...</dPUniProSer> value from the XML.
function unitPrices(xml: string): string[] {
  return [...xml.matchAll(/<dPUniProSer>([^<]*)<\/dPUniProSer>/g)].map((m) => m[1]);
}
// Pull every <dTotOpeItem>...</dTotOpeItem> value as a number.
function lineTotals(xml: string): number[] {
  return [...xml.matchAll(/<dTotOpeItem>([^<]*)<\/dTotOpeItem>/g)].map((m) => Number(m[1]));
}

let generateXMLDE: (p: unknown, d: unknown) => Promise<string>;

before(async () => {
  const mod: any = await import('facturacionelectronicapy-xmlgen');
  const lib = mod.default || mod;
  generateXMLDE = (p, d) => lib.generateXMLDE(p, d).then((r: any) => (typeof r === 'string' ? r : r.xml || r));
});

async function emit(raw: RawInvoiceLineItem[]): Promise<{ xml: string; fiscal: FiscalLineItem[] }> {
  const { items: fiscal } = buildFiscalLineItems(raw);
  const xmlItems = mapToXmlgenItems(fiscal);
  const total = fiscal.reduce((s, l) => s + l.cantidad * l.precioUnitario, 0);
  const xml = await generateXMLDE(params, buildData(xmlItems, total));
  return { xml, fiscal };
}

describe('REAL xmlgen v1.0.280 - bundle expansion emits zero-decimal unit prices, exact totals', () => {
  it('2-pack @349000 -> cant 2, PU 174500, no split, dTotOpeItem 349000, no decimal in dPUniProSer', async () => {
    const { xml } = await emit([{
      sku: 'NOCTE-GLASSES-PAREJA', quantity: 1, unit_price: 349000,
      variant_id: 'v', variant_type: 'bundle',
      products: { fiscal_description: 'Lentes Protector' },
      product_variant: { variant_type: 'bundle', units_per_pack: 2 },
    }]);
    const pus = unitPrices(xml);
    assert.equal(pus.length, 1);
    assert.equal(pus[0], '174500');
    assert.ok(!pus[0].includes('.'), `dPUniProSer "${pus[0]}" must have no decimal point`);
    assert.deepEqual(lineTotals(xml), [349000]);
  });

  it('3-pack @489000 -> cant 3, PU 163000, no split, dTotOpeItem 489000, no decimal', async () => {
    const { xml } = await emit([{
      sku: 'NOCTE-GLASSES-OFICINA', quantity: 1, unit_price: 489000,
      variant_id: 'v', variant_type: 'bundle',
      products: { fiscal_description: 'Lentes Protector' },
      product_variant: { variant_type: 'bundle', units_per_pack: 3 },
    }]);
    const pus = unitPrices(xml);
    assert.equal(pus.length, 1);
    assert.equal(pus[0], '163000');
    assert.ok(!pus[0].includes('.'));
    assert.deepEqual(lineTotals(xml), [489000]);
  });

  it('non-dividing 350000/3 -> TWO lines, PUs 116666 & 116667 (no decimals), totals sum EXACTLY 350000', async () => {
    const { xml } = await emit([{
      sku: 'UGLY-3', quantity: 1, unit_price: 350000,
      variant_id: 'v', variant_type: 'bundle',
      products: { fiscal_description: 'Lentes Protector' },
      product_variant: { variant_type: 'bundle', units_per_pack: 3 },
    }]);
    const pus = unitPrices(xml);
    assert.equal(pus.length, 2);
    for (const pu of pus) {
      assert.ok(!pu.includes('.'), `dPUniProSer "${pu}" must have no decimal point`);
    }
    assert.deepEqual(pus, ['116666', '116667']);
    const totals = lineTotals(xml);
    // 1 x 116666 + 2 x 116667 = 116666 + 233334 = 350000.
    assert.equal(totals.reduce((s, t) => s + t, 0), 350000);
  });

  it('qty 2 of Pareja -> cant 4, PU 174500, dTotOpeItem 698000', async () => {
    const { xml } = await emit([{
      sku: 'NOCTE-GLASSES-PAREJA', quantity: 2, unit_price: 349000,
      variant_id: 'v', variant_type: 'bundle',
      products: { fiscal_description: 'Lentes Protector' },
      product_variant: { variant_type: 'bundle', units_per_pack: 2 },
    }]);
    const pus = unitPrices(xml);
    assert.equal(pus.length, 1);
    assert.equal(pus[0], '174500');
    assert.ok(!pus[0].includes('.'));
    assert.deepEqual(lineTotals(xml), [698000]);
  });

  it('variation (N=1, variant_id null path) -> unchanged, PU integer, total exact', async () => {
    const { xml } = await emit([{
      sku: 'TSHIRT-M', quantity: 3, unit_price: 120000,
      variant_id: 'v', variant_type: 'variation',
      products: { fiscal_description: 'Remera' },
      product_variant: { variant_type: 'variation', units_per_pack: 1 },
    }]);
    const pus = unitPrices(xml);
    assert.equal(pus.length, 1);
    assert.equal(pus[0], '120000');
    assert.ok(!pus[0].includes('.'));
    assert.deepEqual(lineTotals(xml), [360000]);
  });

  it('mixed multi-line doc -> NO dPUniProSer carries a decimal; sum of dTotOpeItem reconciles to order total', async () => {
    const raw: RawInvoiceLineItem[] = [
      { sku: 'A', quantity: 1, unit_price: 349000, variant_id: 'v', variant_type: 'bundle', products: { fiscal_description: 'X' }, product_variant: { variant_type: 'bundle', units_per_pack: 2 } },
      { sku: 'B', quantity: 1, unit_price: 350000, variant_id: 'v', variant_type: 'bundle', products: { fiscal_description: 'X' }, product_variant: { variant_type: 'bundle', units_per_pack: 3 } },
      { sku: 'C', quantity: 2, unit_price: 120000, variant_id: 'v', variant_type: 'variation', products: { fiscal_description: 'X' }, product_variant: { variant_type: 'variation', units_per_pack: 1 } },
    ];
    const orderTotal = raw.reduce((s, l) => s + (l.unit_price || 0) * (l.quantity || 1), 0); // 349000+350000+240000 = 939000
    const { xml } = await emit(raw);
    for (const pu of unitPrices(xml)) {
      assert.ok(!pu.includes('.'), `dPUniProSer "${pu}" must have no decimal point`);
    }
    assert.equal(lineTotals(xml).reduce((s, t) => s + t, 0), orderTotal);
    assert.equal(orderTotal, 939000);
  });
});
