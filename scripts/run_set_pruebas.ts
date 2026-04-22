/**
 * DNIT Set de Pruebas runner
 *
 * Emits multiple Factura Electronica cases against sifen-test.set.gov.py
 * using the EXACT same production pipeline that Ordefy runs:
 *   getFiscalContext -> generateManualInvoice -> signXML (with real CSC)
 *   -> injectQR -> mTLS POST.
 *
 * Each emission persists to the invoices table so the merchant can later
 * show DNIT the CDCs when signing the Declaracion de Cumplimiento in
 * Marangatu.
 *
 * Usage:
 *   npx tsx scripts/run_set_pruebas.ts
 *
 * Required env vars (read from .env):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SIFEN_ENCRYPTION_KEY
 */

import 'dotenv/config';
import { generateManualInvoice, getFiscalContext } from '../api/services/invoicing.service';
import { supabaseAdmin } from '../api/db/connection';

const STORE_ID = '0b3f13f8-d1dc-48a5-a707-27a095c9c545';

interface TestCase {
  name: string;
  build: () => Parameters<typeof generateManualInvoice>[1];
}

const cases: TestCase[] = [
  {
    name: 'FE 01 - B2C consumidor final (cedula)',
    build: () => ({
      tipoDocumento: 1,
      customerName: 'ROGER GASTON LOPEZ ALFONSO',
      customerRuc: '5712264',
      customerEmail: 'gaston@thebrightidea.ai',
      items: [
        {
          descripcion: 'Servicio profesional de consultoria',
          cantidad: 1,
          precioUnitario: 10000,
          ivaRate: 10,
        },
      ],
    }),
  },
  {
    name: 'FE 02 - B2C multi-item IVA 10%',
    build: () => ({
      tipoDocumento: 1,
      customerName: 'ROGER GASTON LOPEZ ALFONSO',
      customerRuc: '5712264',
      customerEmail: 'gaston@thebrightidea.ai',
      items: [
        { descripcion: 'Anteojo de sol modelo A', cantidad: 2, precioUnitario: 150000, ivaRate: 10 },
        { descripcion: 'Estuche rigido', cantidad: 2, precioUnitario: 25000, ivaRate: 10 },
        { descripcion: 'Panio de microfibra', cantidad: 2, precioUnitario: 5000, ivaRate: 10 },
      ],
    }),
  },
  {
    name: 'FE 03 - B2B contribuyente RUC',
    build: () => ({
      tipoDocumento: 1,
      customerName: 'BRIGHT COMMERCE GROUP E.A.S.',
      customerRuc: '80167845',
      customerRucDv: 5,
      customerEmail: 'gaston@thebrightidea.ai',
      items: [
        { descripcion: 'Servicios de diseno grafico', cantidad: 1, precioUnitario: 500000, ivaRate: 10 },
      ],
    }),
  },
  {
    name: 'FE 04 - producto exento IVA',
    build: () => ({
      tipoDocumento: 1,
      customerName: 'ROGER GASTON LOPEZ ALFONSO',
      customerRuc: '5712264',
      items: [
        { descripcion: 'Libro educativo exento', cantidad: 1, precioUnitario: 80000, ivaRate: 0 },
      ],
    }),
  },
  {
    name: 'FE 05 - IVA 5% (canasta familiar)',
    build: () => ({
      tipoDocumento: 1,
      customerName: 'ROGER GASTON LOPEZ ALFONSO',
      customerRuc: '5712264',
      items: [
        { descripcion: 'Producto con IVA 5%', cantidad: 1, precioUnitario: 50000, ivaRate: 5 },
      ],
    }),
  },
];

async function main() {
  // Sanity check env
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SIFEN_ENCRYPTION_KEY']) {
    if (!process.env[k]) throw new Error(`Missing env: ${k}`);
  }

  // Confirm current fiscal config
  const ctx = await getFiscalContext(STORE_ID);
  if (!ctx) throw new Error('No fiscal context for store');
  console.log('========================================');
  console.log('Fiscal context:');
  console.log('  RUC:', `${ctx.identity.ruc}-${ctx.identity.ruc_dv}`);
  console.log('  Razon social:', ctx.identity.razon_social);
  console.log('  Ambiente:', ctx.identity.sifen_environment);
  console.log('  Timbrado:', ctx.link.timbrado);
  console.log('  Est/Punto:', `${ctx.link.establecimiento_codigo}/${ctx.link.punto_expedicion}`);
  console.log('  Cert cargado:', ctx.identity.has_certificate);
  console.log('  idCSC:', ctx.identity.csc_id);
  console.log('========================================');

  if (ctx.identity.sifen_environment !== 'test') {
    throw new Error(
      `Store ambiente = ${ctx.identity.sifen_environment}. Set de pruebas requires ambiente=test.`,
    );
  }

  const results: Array<{ name: string; ok: boolean; cdc?: string; code?: string; msg?: string }> = [];

  for (let i = 0; i < cases.length; i++) {
    const tc = cases[i];
    console.log(`\n[${i + 1}/${cases.length}] ${tc.name}`);
    try {
      const res = await generateManualInvoice(STORE_ID, tc.build());
      const ok = res.status === 'approved' || res.status === 'demo';
      const code = res.response?.responseCode ?? '';
      const msg = res.response?.responseMessage ?? '';
      if (ok) {
        console.log(`  OK  CDC=${res.cdc}  status=${res.status}  (${code} ${msg})`);
      } else {
        console.log(`  FAIL  status=${res.status}  (${code} ${msg})`);
      }
      results.push({ name: tc.name, ok, cdc: res.cdc, code, msg });
    } catch (err: any) {
      console.log(`  ERROR  ${err.message}`);
      results.push({ name: tc.name, ok: false, msg: err.message });
    }

    // Breath between requests to keep SIFEN rate limiter happy.
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log('\n========================================');
  console.log('RESUMEN SET DE PRUEBAS');
  console.log('========================================');
  for (const r of results) {
    const mark = r.ok ? 'OK  ' : 'FAIL';
    console.log(`  [${mark}] ${r.name}${r.cdc ? ` -> ${r.cdc}` : ''}${r.code ? `  (${r.code})` : ''}`);
  }
  const approved = results.filter((r) => r.ok).length;
  console.log(`\n${approved}/${results.length} aprobadas.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
