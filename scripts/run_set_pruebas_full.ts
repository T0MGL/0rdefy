/**
 * DNIT Set de Pruebas runner (full cycle: FE + NC + ND)
 *
 * Emits a Factura Electronica, captures its CDC, then emits a Nota de
 * Credito and a Nota de Debito referencing it. All three types must be
 * in the store's timbrado authorization (Factura Electronica, Nota de
 * Credito Electronica, Nota de Debito Electronica).
 *
 * Every CDC returned by SIFEN is written to invoices.cdc and shown on
 * stdout so the merchant can present them when signing the Declaracion
 * de Cumplimiento in Marangatu.
 */

import 'dotenv/config';
import {
  generateManualInvoice,
  getFiscalContext,
} from '../api/services/invoicing.service';
import { supabaseAdmin } from '../api/db/connection';

const STORE_ID = '0b3f13f8-d1dc-48a5-a707-27a095c9c545';

async function emitAndReport(label: string, run: () => ReturnType<typeof generateManualInvoice>) {
  console.log(`\n[${label}]`);
  try {
    const res = await run();
    const ok = res.status === 'approved' || res.status === 'demo';
    const code = res.response?.responseCode ?? '';
    const msg = res.response?.responseMessage ?? '';
    // cdc is not returned when xmlgen emits it as an attribute, pull from DB
    const { data: row } = await supabaseAdmin
      .from('invoices')
      .select('cdc')
      .eq('id', res.invoice_id)
      .single();
    const cdc = row?.cdc ?? res.cdc ?? null;
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  status=${res.status}  cdc=${cdc}  (${code} ${msg})`);
    return { ok, cdc, code, msg, invoiceId: res.invoice_id };
  } catch (err: any) {
    console.log(`  ERROR  ${err.message}`);
    return { ok: false, cdc: null, msg: err.message, invoiceId: null };
  }
}

async function main() {
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SIFEN_ENCRYPTION_KEY']) {
    if (!process.env[k]) throw new Error(`Missing env: ${k}`);
  }

  const ctx = await getFiscalContext(STORE_ID);
  if (!ctx) throw new Error('No fiscal context');
  console.log('========================================');
  console.log(`RUC: ${ctx.identity.ruc}-${ctx.identity.ruc_dv}`);
  console.log(`Razon social: ${ctx.identity.razon_social}`);
  console.log(`Ambiente: ${ctx.identity.sifen_environment}`);
  console.log(`Timbrado: ${ctx.link.timbrado}  Est/Punto: ${ctx.link.establecimiento_codigo}/${ctx.link.punto_expedicion}`);
  console.log(`Cert: ${ctx.identity.has_certificate}  idCSC: ${ctx.identity.csc_id}`);
  console.log('========================================');

  // 1. Emit Factura Electronica -> capture CDC for NC/ND reference
  const fe = await emitAndReport('FE - Factura Electronica (base)', () =>
    generateManualInvoice(STORE_ID, {
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
  );

  if (!fe.ok || !fe.cdc) {
    console.log('\nFactura base fallo. Abortando NC/ND porque necesitan CDC de referencia.');
    process.exit(1);
  }

  await new Promise((r) => setTimeout(r, 2000));

  // 2. Emit Nota de Credito referencing the factura (motivo 1 = Devolucion)
  await emitAndReport('NC - Nota de Credito (devolucion)', () =>
    generateManualInvoice(STORE_ID, {
      tipoDocumento: 5,
      motivoCredito: 1,
      referenciaCdc: fe.cdc!,
      customerName: 'ROGER GASTON LOPEZ ALFONSO',
      customerRuc: '5712264',
      customerEmail: 'gaston@thebrightidea.ai',
      items: [
        {
          descripcion: 'Devolucion - Servicio profesional de consultoria',
          cantidad: 1,
          precioUnitario: 10000,
          ivaRate: 10,
        },
      ],
    }),
  );

  await new Promise((r) => setTimeout(r, 2000));

  // 3. Emit Nota de Debito referencing the factura (motivo 1 = Interes por mora)
  await emitAndReport('ND - Nota de Debito (interes por mora)', () =>
    generateManualInvoice(STORE_ID, {
      tipoDocumento: 6,
      motivoCredito: 1,
      referenciaCdc: fe.cdc!,
      customerName: 'ROGER GASTON LOPEZ ALFONSO',
      customerRuc: '5712264',
      customerEmail: 'gaston@thebrightidea.ai',
      items: [
        {
          descripcion: 'Interes por mora sobre servicio de consultoria',
          cantidad: 1,
          precioUnitario: 1000,
          ivaRate: 10,
        },
      ],
    }),
  );

  console.log('\n========================================');
  console.log('LISTADO DE CDCs APROBADOS (para Declaracion de Cumplimiento)');
  console.log('========================================');
  const { data: approved } = await supabaseAdmin
    .from('invoices')
    .select('tipo_documento, document_number, cdc, sifen_response_code, created_at')
    .eq('store_id', STORE_ID)
    .eq('sifen_status', 'approved')
    .order('created_at', { ascending: false })
    .limit(20);
  const typeLabel: Record<number, string> = { 1: 'FE', 4: 'AUT', 5: 'NC', 6: 'ND', 7: 'NR' };
  for (const row of approved ?? []) {
    console.log(`  [${typeLabel[row.tipo_documento] ?? row.tipo_documento}] #${row.document_number}  ${row.cdc}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
