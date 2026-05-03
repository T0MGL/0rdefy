/**
 * diag-sifen-emit2.ts
 *
 * Diagnostic: emit a minimal test invoice against SIFEN prod.
 * Reads credentials directly from Supabase (no manual copy-paste).
 *
 * Usage (from ORDEFY root):
 *   SIFEN_ENCRYPTION_KEY=<key> SUPABASE_URL=<url> SUPABASE_SERVICE_ROLE_KEY=<key> \
 *     npx tsx api/scripts/diag-sifen-emit2.ts
 *
 * Or with dotenv (reads api/.env automatically if you call it from root):
 *   npx tsx -r dotenv/config api/scripts/diag-sifen-emit2.ts dotenv_config_path=api/.env
 */

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// ================================================================
// Bootstrap env
// ================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://vgqecqqleuowvoimcoxg.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SIFEN_ENCRYPTION_KEY = process.env.SIFEN_ENCRYPTION_KEY || '';
const IDENTITY_ID = '3d3f8c42-88a2-4b30-9e11-b9d44fd13460';
const STORE_ID = '0b3f13f8-d1dc-48a5-a707-27a095c9c545';

// ================================================================
// Crypto helpers (inline to avoid import resolution issues)
// ================================================================

function decrypt(blob: string): string {
  if (!SIFEN_ENCRYPTION_KEY || SIFEN_ENCRYPTION_KEY.length !== 64) {
    throw new Error('SIFEN_ENCRYPTION_KEY must be a 64-char hex string');
  }
  const key = Buffer.from(SIFEN_ENCRYPTION_KEY, 'hex');
  const raw = Buffer.from(blob, 'base64');
  const IV_BYTES = 12;
  const TAG_BYTES = 16;
  if (raw.length < IV_BYTES + TAG_BYTES + 1) throw new Error('Invalid encrypted blob: too short');
  const iv = raw.subarray(0, IV_BYTES);
  const authTag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ================================================================
// Time helpers
// ================================================================

function getNowPY(): string {
  return new Date()
    .toLocaleString('sv-SE', { timeZone: 'America/Asuncion', hour12: false })
    .replace(' ', 'T');
}

// ================================================================
// Main
// ================================================================

async function main() {
  console.log('\n=== SIFEN PROD DIAGNOSTIC EMIT v2 ===\n');
  console.log(`Timestamp (UTC): ${new Date().toISOString()}`);
  console.log(`Timestamp (PY):  ${getNowPY()}\n`);

  // Validate env
  if (!SIFEN_ENCRYPTION_KEY) {
    console.error('[FATAL] SIFEN_ENCRYPTION_KEY not set');
    process.exit(1);
  }
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[FATAL] SUPABASE_SERVICE_ROLE_KEY not set');
    process.exit(1);
  }

  // 1. Load fiscal identity from Supabase
  console.log('[STEP 1] Loading fiscal identity from Supabase...');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: identity, error: identityErr } = await supabase
    .from('fiscal_identities')
    .select('id, ruc, ruc_dv, razon_social, nombre_fantasia, tipo_contribuyente, tipo_regimen, sifen_environment, csc_id, cert_pem, encrypted_private_key, csc, representante_legal_nombre, representante_legal_documento_tipo, representante_legal_documento_numero, representante_legal_cargo')
    .eq('id', IDENTITY_ID)
    .single();

  if (identityErr || !identity) {
    console.error('[FATAL] Cannot load identity:', identityErr?.message);
    process.exit(1);
  }
  console.log(`[OK] Identity: ${(identity as any).ruc}-${(identity as any).ruc_dv} (${(identity as any).razon_social})`);
  console.log(`     sifen_environment: ${(identity as any).sifen_environment}`);
  console.log(`     csc_id: ${(identity as any).csc_id}`);

  // Try with corrected field name
  const { data: identityFull, error: identityFullErr } = await supabase
    .from('fiscal_identities')
    .select('*')
    .eq('id', IDENTITY_ID)
    .single();

  if (identityFullErr) {
    console.error('[FATAL] Cannot load full identity:', identityFullErr.message);
    process.exit(1);
  }

  const fi = identityFull as any;

  // 2. Load store link
  console.log('\n[STEP 2] Loading store link from Supabase...');
  const { data: link, error: linkErr } = await supabase
    .from('fiscal_identity_stores')
    .select('*')
    .eq('identity_id', IDENTITY_ID)
    .eq('store_id', STORE_ID)
    .single();

  if (linkErr || !link) {
    console.error('[FATAL] Cannot load store link:', linkErr?.message);
    process.exit(1);
  }
  const sl = link as any;
  console.log(`[OK] Link: timbrado=${sl.timbrado}, estab=${sl.establecimiento_codigo}, punto=${sl.punto_expedicion}`);
  console.log(`     timbrado_fecha_inicio: ${sl.timbrado_fecha_inicio}`);

  // 3. Decrypt credentials
  console.log('\n[STEP 3] Decrypting credentials...');
  let certPem: string;
  let privateKeyPem: string;
  let csc: string;

  try {
    if (!fi.cert_pem) throw new Error('cert_pem is null in DB');
    if (!fi.encrypted_private_key) throw new Error('encrypted_private_key is null in DB');
    if (!fi.csc) throw new Error('csc is null in DB');

    certPem = fi.cert_pem as string;
    privateKeyPem = decrypt(fi.encrypted_private_key as string);
    csc = decrypt(fi.csc as string);

    console.log('[OK] cert_pem loaded from DB directly');
    console.log(`[OK] private key decrypted (${privateKeyPem.length} chars)`);
    console.log(`[OK] CSC decrypted (${csc.length} chars)`);
  } catch (err) {
    console.error('[FATAL] Credential decryption failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // 4. Validate cert PEM structure
  console.log('\n[STEP 4] Validating cert PEM...');
  try {
    const x509 = new crypto.X509Certificate(certPem);
    console.log(`[OK] Cert valid. Subject: ${x509.subject}`);
    console.log(`     Issuer: ${x509.issuer}`);
    console.log(`     Valid to: ${x509.validTo}`);
    console.log(`     Fingerprint: ${x509.fingerprint256.slice(0, 40)}...`);
  } catch (err) {
    console.error('[FAIL] cert_pem is not a valid X.509 certificate:');
    console.error(err instanceof Error ? err.message : err);
    console.log('\n--- CERT PEM (first 200 chars) ---');
    console.log(certPem.slice(0, 200));
    console.log('---');
    process.exit(1);
  }

  // 5. Validate private key
  console.log('\n[STEP 5] Validating private key...');
  try {
    const privKeyObj = crypto.createPrivateKey(privateKeyPem);
    console.log(`[OK] Private key loaded. Type: ${privKeyObj.asymmetricKeyType}, size: ${privKeyObj.asymmetricKeyDetails?.modulusLength || 'unknown'}`);
  } catch (err) {
    console.error('[FAIL] Private key PEM is invalid:');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // 6. Build xmlgen params and data
  console.log('\n[STEP 6] Building XML parameters...');

  const nowLocal = getNowPY();
  const docNumber = 9000000 + (Date.now() % 1_000_000);
  const numeroStr = String(docNumber).padStart(7, '0');
  const codigoSeg = String(Math.floor(100_000_000 + Math.random() * 899_999_999));

  const activities = await supabase
    .from('fiscal_identity_activities')
    .select('codigo, descripcion, is_principal')
    .eq('identity_id', IDENTITY_ID);

  const acts = (activities.data || []) as any[];
  console.log(`[OK] Activities loaded: ${acts.length}`);

  const params = {
    version: 150,
    ruc: `${fi.ruc}-${fi.ruc_dv}`,
    razonSocial: fi.razon_social,
    nombreFantasia: fi.nombre_fantasia || fi.razon_social,
    timbradoNumero: sl.timbrado,
    timbradoFecha: `${sl.timbrado_fecha_inicio}T00:00:00`,
    tipoContribuyente: fi.tipo_contribuyente,
    tipoRegimen: fi.tipo_regimen ?? 8,
    establecimientos: [
      {
        codigo: sl.establecimiento_codigo,
        direccion: sl.establecimiento_direccion || 'Asuncion',
        numeroCasa: '0',
        complementoDireccion1: '',
        complementoDireccion2: '',
        departamento: sl.establecimiento_departamento ?? 1,
        departamentoDescripcion: 'CAPITAL',
        distrito: sl.establecimiento_distrito ?? 1,
        distritoDescripcion: 'ASUNCION (DISTRITO)',
        ciudad: sl.establecimiento_ciudad ?? 1,
        ciudadDescripcion: 'ASUNCION (DISTRITO)',
        telefono: sl.establecimiento_telefono || '021000000',
        email: sl.establecimiento_email || 'facturacion@ordefy.io',
        denominacion: fi.nombre_fantasia || 'Casa Central',
      },
    ],
    actividadesEconomicas: acts.map((a: any) => ({
      codigo: a.codigo,
      descripcion: a.descripcion,
    })),
  };

  const AMOUNT = 10000;
  const CUSTOMER_RUC = '5712264';
  const CUSTOMER_DV = 4;

  const data: Record<string, unknown> = {
    tipoDocumento: 1,
    establecimiento: sl.establecimiento_codigo,
    punto: sl.punto_expedicion,
    numero: numeroStr,
    fecha: nowLocal,
    codigoSeguridadAleatorio: codigoSeg,
    tipoEmision: 1,
    tipoTransaccion: 2,
    tipoImpuesto: 1,
    moneda: 'PYG',
    cliente: {
      contribuyente: true,
      ruc: `${CUSTOMER_RUC}-${CUSTOMER_DV}`,
      dvRuc: CUSTOMER_DV,
      tipoOperacion: 1,
      razonSocial: 'Gaston Lopez',
      nombreFantasia: 'Gaston Lopez',
      tipoContribuyente: 1,
      direccion: 'Asuncion',
      numeroCasa: '0',
      departamento: 1,
      departamentoDescripcion: 'CAPITAL',
      distrito: 1,
      distritoDescripcion: 'ASUNCION (DISTRITO)',
      ciudad: 1,
      ciudadDescripcion: 'ASUNCION (DISTRITO)',
      pais: 'PRY',
      paisDescripcion: 'Paraguay',
    },
    usuario: {
      documentoTipo: fi.representante_legal_documento_tipo ?? 1,
      documentoNumero: fi.representante_legal_documento_numero ?? '0',
      nombre: fi.representante_legal_nombre ?? fi.razon_social,
      cargo: fi.representante_legal_cargo ?? 'REPRESENTANTE LEGAL',
    },
    factura: { presencia: 1 },
    condicion: {
      tipo: 1,
      entregas: [{ tipo: 1, monto: String(AMOUNT), moneda: 'PYG' }],
    },
    items: [
      {
        codigo: '1',
        descripcion: 'Productos varios',
        observacion: '',
        unidadMedida: 77,
        cantidad: 1,
        precioUnitario: AMOUNT,
        cambio: 0,
        descuento: 0,
        anticipo: 0,
        ivaTipo: 1,
        ivaBase: 100,
        iva: 10,
        ivaProporcion: 100,
        propina: 0,
      },
    ],
  };

  // 7. Generate XML
  console.log('\n[STEP 7] Generating XML with xmlgen...');
  let xmlGenerated: string;
  let cdc: string | undefined;
  try {
    let xmlgenLib = await import('facturacionelectronicapy-xmlgen');
    xmlgenLib = (xmlgenLib as any).default || xmlgenLib;
    const result = await (xmlgenLib as any).generateXMLDE(params, data);
    xmlGenerated = typeof result === 'string' ? result : (result as any).xml || result;
    const cdcMatch =
      xmlGenerated.match(/\bId="([0-9]{44})"/) ||
      xmlGenerated.match(/<Id>([0-9]{44})<\/Id>/) ||
      xmlGenerated.match(/<dCDC>([0-9]{44})<\/dCDC>/);
    cdc = cdcMatch ? cdcMatch[1] : undefined;
    console.log(`[OK] XML generated. CDC: ${cdc || 'NOT FOUND'}`);
    console.log(`     Document number: ${docNumber} (${numeroStr})`);
  } catch (err) {
    console.error('[FAIL] xmlgen error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // 8. Rewrite dFecFirma to local TZ
  const xmlWithFirma = xmlGenerated.replace(
    /<dFecFirma>[^<]*<\/dFecFirma>/,
    `<dFecFirma>${getNowPY()}</dFecFirma>`,
  );

  // 9. Sign
  console.log('\n[STEP 8] Signing XML...');
  let xmlSigned: string;
  try {
    const { signXML } = await import('../services/sifen/xml-signer');
    xmlSigned = await signXML(xmlWithFirma, privateKeyPem, certPem);
    console.log('[OK] XML signed successfully');
  } catch (err) {
    console.error('[FAIL] Signing error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // 10. Inject QR
  console.log('\n[STEP 9] Injecting QR...');
  let xmlFinal: string;
  try {
    const { injectQR } = await import('../services/sifen/qr-generator');
    xmlFinal = await injectQR(xmlSigned, 'prod', fi.csc_id, csc);
    console.log('[OK] QR injected');
    const qrMatch = xmlFinal.match(/<dCarQR>([\s\S]*?)<\/dCarQR>/);
    if (qrMatch) {
      const qrDecoded = qrMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      console.log(`     QR URL excerpt: ${qrDecoded.slice(0, 150)}...`);
    }
  } catch (err) {
    console.error('[FAIL] QR injection error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // 11. Send to SIFEN
  console.log('\n[STEP 10] Sending to SIFEN PROD...');
  console.log(`         URL: https://sifen.set.gov.py/de/ws/sync/recibe.wsdl`);
  console.log(`         dId: ${docNumber}`);
  try {
    const { sendDE } = await import('../services/sifen/sifen-client');
    const response = await sendDE(String(docNumber), xmlFinal!, 'prod', { certPem, privateKeyPem });

    console.log('\n=== SIFEN RESPONSE ===');
    console.log(`  success:     ${response.success}`);
    console.log(`  dCodRes:     ${response.responseCode}`);
    console.log(`  dMsgRes:     ${response.responseMessage}`);
    console.log(`  cdc:         ${response.cdc || 'none'}`);
    console.log('\n--- RAW XML RESPONSE ---');
    console.log(response.rawResponse);
    console.log('--- END RAW RESPONSE ---');

    if (!response.success) {
      console.log('\n--- GENERATED XML (full, for SIFEN schema validation) ---');
      console.log(xmlGenerated);
      console.log('\n--- SIGNED+QR XML (full) ---');
      console.log(xmlFinal!.slice(0, 5000));
    }
  } catch (err) {
    console.error('\n[FAIL] SIFEN connection/TLS error:');
    if (err instanceof Error) {
      console.error('  message:', err.message);
      console.error('  code:   ', (err as any).code);
    }
    console.log('\n--- GENERATED XML (for offline inspection) ---');
    console.log(xmlGenerated);
    process.exit(1);
  }

  console.log('\n=== DIAGNOSTIC COMPLETE ===\n');
}

main().catch((err) => {
  console.error('Unhandled:', err);
  process.exit(1);
});
