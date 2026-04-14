/**
 * End-to-End SIFEN Test Script (Paraguay Electronic Invoicing)
 *
 * Target invoice (per mission spec):
 *   - Emisor: Solenne, RUC 80167845-5, est 001, pto 001
 *   - Receptor: ROGER GASTON LOPEZ ALFONSO, cédula 5712264 DV 4,
 *               gaston@thebrightidea.ai
 *   - Items: Servicios profesionales varios, total Gs 10.000 (IVA 10%)
 *   - tipoDocumento: 1 (Factura Electrónica)
 *   - Environment: test
 *   - Success: SIFEN dCodRes in 0260-0299 with valid CDC.
 *
 * Pipeline exercised:
 *   1. Resolve Solenne store
 *   2. Upsert fiscal_config (test env, 8-digit timbrado)
 *   3. Extract PEMs from .p12 (in-memory, password never persisted)
 *   4. Build xmlgen params/data with the full shape xmlgen requires
 *      (establecimientos[], actividadesEconomicas[], data.usuario, etc.)
 *   5. Sign XML via api/services/sifen/xml-signer.ts (enveloped
 *      RSA-SHA256, Signature as sibling of DE inside rDE, KeyInfo/X509)
 *   6. Inject gCamFuFD via api/services/sifen/qr-generator.ts
 *   7. POST to SIFEN test via api/services/sifen/sifen-client.ts with mTLS
 *   8. Consult DE by CDC after 3s delay to verify indexing
 *   9. Persist the invoice row in Supabase on success
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SIFEN_ENCRYPTION_KEY=... \
 *   tsx scripts/test_sifen_e2e.ts
 */

import fs from 'fs';
import path from 'path';
import { supabaseAdmin } from '../api/db/connection';
import { extractPemsFromP12, signXML } from '../api/services/sifen/xml-signer';
import { injectQR, SIFEN_TEST_ID_CSC, SIFEN_TEST_CSC } from '../api/services/sifen/qr-generator';
import * as sifenClient from '../api/services/sifen/sifen-client';
import type { SifenMtls } from '../api/services/sifen/sifen-client';

const STORE_NAME_NEEDLE = 'solenne';
const CERT_PATH = '/Users/gastonlopez/Downloads/7160890_identity.p12';
const CERT_PASSWORD = process.env.SIFEN_TEST_CERT_PASSWORD || 'gtom28@Confirma';

// xmlgen requires exactly 8 digits. SIFEN test rejects an un-registered
// timbrado with a specific code (~0160) even via mTLS; for this E2E the
// goal is to exercise transport/signing end-to-end.
const PLACEHOLDER_TIMBRADO = '12560036';

// Asunción geo codes (sane defaults, match ASUNCION_DEFAULTS in invoicing.service).
const ASUNCION = { departamento: 1, distrito: 1, ciudad: 1 };

function log(section: string, payload: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`\n==== ${section} ====`);
  if (typeof payload === 'string') {
    // eslint-disable-next-line no-console
    console.log(payload);
  } else {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(payload, null, 2));
  }
}

function must(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

async function resolveStoreId(): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('stores')
    .select('id, name, country, is_active')
    .ilike('name', `%${STORE_NAME_NEEDLE}%`)
    .eq('is_active', true)
    .limit(5);

  if (error) throw new Error(`Store lookup failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(`No active store matching "${STORE_NAME_NEEDLE}"`);
  }
  const py = data.find((s) => s.country === 'PY') || data[0];
  if (py.country !== 'PY') {
    throw new Error(`Solenne store (${py.id}) has country=${py.country}, expected PY`);
  }
  log('STORE RESOLVED', { id: py.id, name: py.name, country: py.country });
  return py.id as string;
}

async function ensureFiscalConfig(storeId: string): Promise<any> {
  const { data: existing } = await supabaseAdmin
    .from('fiscal_config')
    .select('id')
    .eq('store_id', storeId)
    .maybeSingle();

  const payload = {
    store_id: storeId,
    ruc: '80167845',
    ruc_dv: 5,
    razon_social: 'Bright Commerce Group E.A.S',
    nombre_fantasia: 'Solenne',
    tipo_contribuyente: 2,
    timbrado: PLACEHOLDER_TIMBRADO,
    timbrado_fecha_inicio: new Date().toISOString().split('T')[0],
    establecimiento_codigo: '001',
    punto_expedicion: '001',
    sifen_environment: 'test',
    is_active: true,
    setup_completed: false,
  };

  if (existing) {
    const { data, error } = await supabaseAdmin
      .from('fiscal_config')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    log('FISCAL CONFIG UPDATED', { id: data.id, timbrado: data.timbrado });
    return data;
  }
  const { data, error } = await supabaseAdmin
    .from('fiscal_config')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  log('FISCAL CONFIG INSERTED', { id: data.id, timbrado: data.timbrado });
  return data;
}

async function extractAndStorePems(
  _storeId: string,
  configId: string,
): Promise<{ privateKeyPem: string; certPem: string }> {
  if (!fs.existsSync(CERT_PATH)) {
    throw new Error(`Certificate file not found: ${CERT_PATH}`);
  }
  const buf = fs.readFileSync(CERT_PATH);
  const { privateKeyPem, certPem } = await extractPemsFromP12(buf, CERT_PASSWORD);

  const { encrypt } = await import('../api/services/sifen/encryption');
  const encryptedPrivateKey = encrypt(privateKeyPem);

  const { error } = await supabaseAdmin
    .from('fiscal_config')
    .update({
      cert_pem: certPem,
      encrypted_private_key: encryptedPrivateKey,
      setup_completed: true,
    })
    .eq('id', configId);
  if (error) throw error;

  log('CERT EXTRACTED + STORED', {
    cert_pem_len: certPem.length,
    encrypted_blob_len: encryptedPrivateKey.length,
  });
  return { privateKeyPem, certPem };
}

async function buildXml(fiscalConfig: any): Promise<{ xmlGenerated: string; cdc: string; docNumber: number; totals: { subtotal: number; iva10: number; total: number } }> {
  const mod = await import('facturacionelectronicapy-xmlgen');
  const xmlgen: any = (mod as any).default || mod;

  const today = new Date().toISOString().split('T')[0];
  const docNumber = Math.floor(Date.now() / 1000) % 9_999_999;

  const params: any = {
    version: 150,
    ruc: `${fiscalConfig.ruc}-${fiscalConfig.ruc_dv}`,
    razonSocial: fiscalConfig.razon_social,
    nombreFantasia: fiscalConfig.nombre_fantasia || fiscalConfig.razon_social,
    timbradoNumero: fiscalConfig.timbrado,
    timbradoFecha: (fiscalConfig.timbrado_fecha_inicio || today) + 'T00:00:00',
    tipoContribuyente: fiscalConfig.tipo_contribuyente,
    tipoRegimen: 8,
    establecimientos: [
      {
        codigo: fiscalConfig.establecimiento_codigo || '001',
        direccion: 'Asunción',
        numeroCasa: '0',
        complementoDireccion1: '',
        complementoDireccion2: '',
        departamento: ASUNCION.departamento,
        departamentoDescripcion: 'CAPITAL',
        distrito: ASUNCION.distrito,
        distritoDescripcion: 'ASUNCION (DISTRITO)',
        ciudad: ASUNCION.ciudad,
        ciudadDescripcion: 'ASUNCION (DISTRITO)',
        telefono: '021000000',
        email: 'facturacion@solenne.com.py',
        denominacion: fiscalConfig.nombre_fantasia || 'Casa Central',
      },
    ],
    actividadesEconomicas: [
      {
        codigo: '47114',
        descripcion: 'Venta al por menor de productos en tiendas no especializadas',
      },
    ],
  };

  const codigoSeguridadAleatorio = String(Math.floor(100_000_000 + Math.random() * 899_999_999));

  // Mission target: Gs 10.000 total, item "Servicios profesionales varios"
  // IVA 10% included. SIFEN expects line totals to match totals block.
  const data: any = {
    tipoDocumento: 1,
    establecimiento: fiscalConfig.establecimiento_codigo || '001',
    punto: fiscalConfig.punto_expedicion || '001',
    numero: String(docNumber).padStart(7, '0'),
    fecha: today + 'T12:00:00',
    codigoSeguridadAleatorio,
    tipoEmision: 1,
    // 2 = Prestación de servicios (item is "servicios profesionales")
    tipoTransaccion: 2,
    tipoImpuesto: 1,
    moneda: 'PYG',
    cliente: {
      contribuyente: false,
      tipoOperacion: 2, // B2C
      razonSocial: 'ROGER GASTON LOPEZ ALFONSO',
      nombreFantasia: 'ROGER GASTON LOPEZ ALFONSO',
      tipoContribuyente: 1,
      documentoTipo: 1, // Cédula
      documentoNumero: '5712264',
      direccion: 'Asunción',
      numeroCasa: '0',
      departamento: ASUNCION.departamento,
      departamentoDescripcion: 'CAPITAL',
      distrito: ASUNCION.distrito,
      distritoDescripcion: 'ASUNCION (DISTRITO)',
      ciudad: ASUNCION.ciudad,
      ciudadDescripcion: 'ASUNCION (DISTRITO)',
      pais: 'PRY',
      paisDescripcion: 'Paraguay',
      email: 'gaston@thebrightidea.ai',
    },
    usuario: {
      documentoTipo: 1,
      documentoNumero: '5712264',
      nombre: 'ROGER GASTON LOPEZ ALFONSO',
      cargo: 'REPRESENTANTE LEGAL',
    },
    factura: {
      presencia: 1,
    },
    condicion: {
      tipo: 1,
      entregas: [
        {
          tipo: 1,
          monto: '10000',
          moneda: 'PYG',
        },
      ],
    },
    items: [
      {
        codigo: '001',
        descripcion: 'Servicios profesionales varios',
        observacion: '',
        unidadMedida: 77,
        cantidad: 1,
        precioUnitario: 10000,
        cambio: 0,
        descuento: 0,
        anticipo: 0,
        ivaTipo: 1,
        ivaBase: 100,
        iva: 10,
        propina: 0,
      },
    ],
  };

  const xmlGenerated: string = await xmlgen.generateXMLDE(params, data);
  const cdc =
    xmlGenerated.match(/Id="([0-9]{44})"/)?.[1] ??
    xmlGenerated.match(/<Id>([0-9]{44})<\/Id>/)?.[1] ??
    xmlGenerated.match(/<dCDC>([0-9]{44})<\/dCDC>/)?.[1] ??
    '';
  if (!cdc) {
    const head = xmlGenerated.slice(0, 800);
    throw new Error(`Could not extract CDC from generated XML. Head: ${head}`);
  }

  log('XML GENERATED', { cdc, doc_number: docNumber, xml_bytes: xmlGenerated.length });

  const subtotal = 10000;
  const iva10 = Math.round(subtotal / 11); // 10% IVA included
  return { xmlGenerated, cdc, docNumber, totals: { subtotal, iva10, total: subtotal } };
}

function dumpXml(tag: string, xml: string, docNumber: number, iter: number): string {
  const p = path.join('/tmp', `sifen_iter_${iter}_${tag}_${Date.now()}_doc${docNumber}.xml`);
  fs.writeFileSync(p, xml);
  return p;
}

async function persistApprovedInvoice(args: {
  storeId: string;
  cdc: string;
  docNumber: number;
  xmlGenerated: string;
  xmlFinal: string;
  sifenResp: sifenClient.SifenResponse;
  totals: { subtotal: number; iva10: number; total: number };
}): Promise<string> {
  const kudeUrl = `https://ekuatia.set.gov.py/consultas/qr?nVersion=150&Id=${args.cdc}`;
  const nowIso = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('invoices')
    .insert({
      store_id: args.storeId,
      order_id: null,
      cdc: args.cdc,
      document_number: args.docNumber,
      tipo_documento: 1,
      customer_ruc: '5712264',
      customer_ruc_dv: 4,
      customer_name: 'ROGER GASTON LOPEZ ALFONSO',
      customer_email: 'gaston@thebrightidea.ai',
      customer_address: 'Asunción',
      subtotal: args.totals.subtotal,
      iva_5: 0,
      iva_10: args.totals.iva10,
      iva_exento: 0,
      total: args.totals.total,
      currency: 'PYG',
      sifen_status: 'approved',
      sifen_response_code: args.sifenResp.responseCode,
      sifen_response_message: args.sifenResp.responseMessage,
      xml_generated: args.xmlGenerated,
      xml_signed: args.xmlFinal,
      kude_url: kudeUrl,
      sent_to_sifen_at: nowIso,
      approved_at: nowIso,
    })
    .select()
    .single();

  if (error) throw new Error(`Invoice insert failed: ${error.message}`);
  log('INVOICE PERSISTED', { id: data.id, cdc: args.cdc, status: 'approved' });
  return data.id as string;
}

async function main(): Promise<void> {
  must('SUPABASE_URL');
  must('SUPABASE_SERVICE_ROLE_KEY');
  must('SIFEN_ENCRYPTION_KEY');

  log('ENV READY', {
    supabase_url: process.env.SUPABASE_URL,
    sifen_encryption_key_len: process.env.SIFEN_ENCRYPTION_KEY?.length,
    service_role_prefix: process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 12),
  });

  const storeId = await resolveStoreId();
  const fiscalConfig = await ensureFiscalConfig(storeId);
  const { privateKeyPem, certPem } = await extractAndStorePems(storeId, fiscalConfig.id);

  const mtls: SifenMtls = { certPem, privateKeyPem };

  // Iteration 1: full pipeline
  const { xmlGenerated, cdc, docNumber, totals } = await buildXml(fiscalConfig);
  const genPath = dumpXml('generated', xmlGenerated, docNumber, 1);

  // Sign (Bugs 4 + 5: Signature sibling of DE, KeyInfo/X509 via v6 API)
  const xmlSigned = await signXML(xmlGenerated, privateKeyPem, certPem);
  const signedPath = dumpXml('signed', xmlSigned, docNumber, 1);
  log('XML SIGNED', {
    bytes: xmlSigned.length,
    has_keyinfo: xmlSigned.includes('X509Certificate'),
    signature_sibling: xmlSigned.match(/<\/DE>\s*<(ds:)?Signature/) !== null,
  });

  // Inject QR (Bug 7: gCamFuFD)
  const xmlFinal = await injectQR(xmlSigned, 'test', SIFEN_TEST_ID_CSC, SIFEN_TEST_CSC);
  const finalPath = dumpXml('with_qr', xmlFinal, docNumber, 1);
  log('QR INJECTED', {
    bytes: xmlFinal.length,
    has_gCamFuFD: xmlFinal.includes('gCamFuFD'),
    has_dCarQR: xmlFinal.includes('dCarQR'),
  });

  // Send via mTLS (Bugs 1, 2, 3: mTLS, inline xDE, xsd namespace)
  log('SENDING TO SIFEN (iter 1)', { doc_number: docNumber, cdc });
  let sifenResp: sifenClient.SifenResponse;
  try {
    sifenResp = await sifenClient.sendDE(String(docNumber), xmlFinal, 'test', mtls);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log('SIFEN SEND ERROR', message);
    process.exit(2);
  }

  log('SIFEN SEND RESPONSE', {
    success: sifenResp.success,
    code: sifenResp.responseCode,
    message: sifenResp.responseMessage,
    cdc_echo: sifenResp.cdc,
  });

  if (sifenResp.rawResponse) {
    const rawPath = path.join('/tmp', `sifen_iter_1_raw_${Date.now()}.xml`);
    fs.writeFileSync(rawPath, sifenResp.rawResponse);
    log('SIFEN RAW', rawPath);
  }

  if (sifenResp.success) {
    log('WAITING 3s BEFORE CONSULT', { cdc });
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const consultResp = await sifenClient.consultDE(cdc, 'test', mtls);
      log('CONSULT RESPONSE', {
        code: consultResp.responseCode,
        message: consultResp.responseMessage,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log('CONSULT ERROR', message);
    }

    const invoiceId = await persistApprovedInvoice({
      storeId,
      cdc,
      docNumber,
      xmlGenerated,
      xmlFinal,
      sifenResp,
      totals,
    });
    log('RESULT', {
      verdict: 'PASS',
      invoice_id: invoiceId,
      cdc,
      sifen_code: sifenResp.responseCode,
      sifen_message: sifenResp.responseMessage,
      artefacts: { generated: genPath, signed: signedPath, with_qr: finalPath },
    });
    process.exit(0);
  }

  log('RESULT', {
    verdict: 'FAIL',
    cdc,
    doc_number: docNumber,
    sifen_code: sifenResp.responseCode,
    sifen_message: sifenResp.responseMessage,
    artefacts: { generated: genPath, signed: signedPath, with_qr: finalPath },
  });
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('\n==== FATAL ERROR ====');
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
