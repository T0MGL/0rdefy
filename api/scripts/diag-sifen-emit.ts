/**
 * diag-sifen-emit.ts
 *
 * Diagnostic: emit a test invoice against SIFEN prod and capture the raw
 * response. No order required. Bypasses the HTTP layer entirely.
 *
 * Usage:
 *   SIFEN_ENCRYPTION_KEY=<key> npx tsx api/scripts/diag-sifen-emit.ts
 *
 * The script does NOT persist any invoice row; it writes directly to SIFEN
 * and prints the full response including dCodRes, dMsgRes, and the generated
 * XML for inspection.
 */

import 'dotenv/config';
import crypto from 'crypto';
import { decrypt } from '../services/sifen/encryption';
import { signXML } from '../services/sifen/xml-signer';
import { injectQR } from '../services/sifen/qr-generator';
import { sendDE } from '../services/sifen/sifen-client';

// ================================================================
// Config pulled from DB query run manually before this script
// ================================================================

const IDENTITY = {
  id: '3d3f8c42-88a2-4b30-9e11-b9d44fd13460',
  ruc: '80167845',
  ruc_dv: 5,
  razon_social: 'Bright Commerce Group E.A.S.',
  nombre_fantasia: 'SOLENNE',
  tipo_contribuyente: 2,
  tipo_regimen: 8,
  sifen_environment: 'prod' as const,
  csc_id: '0001',
  // encrypted blobs from DB - decrypted at runtime using SIFEN_ENCRYPTION_KEY
  encrypted_private_key: process.env.ENCRYPTED_PRIVATE_KEY_OVERRIDE || '<FROM_DB>',
  cert_pem: process.env.CERT_PEM_OVERRIDE || '<FROM_DB>',
  csc_encrypted: process.env.CSC_ENCRYPTED_OVERRIDE || '<FROM_DB>',
  representante_legal_nombre: 'Roger Gaston Lopez Alfonso',
  representante_legal_documento_tipo: 1,
  representante_legal_documento_numero: '5712264',
  representante_legal_cargo: 'Representante Legal',
};

const LINK = {
  timbrado: '18800839',
  timbrado_fecha_inicio: '2026-04-21',
  establecimiento_codigo: '001',
  punto_expedicion: '001',
  establecimiento_direccion: 'Teniente Zenteno y Saavedra',
  establecimiento_departamento: 1,
  establecimiento_distrito: 1,
  establecimiento_ciudad: 1,
  establecimiento_telefono: '0983912902',
  establecimiento_email: 'gaston@thebrightidea.ai',
};

const ACTIVITIES = [
  {
    codigo: '47910',
    descripcion: 'Comercio al por menor a través de empresas de comercio por correo o internet',
  },
];

const CUSTOMER_RUC = '5712264';
const CUSTOMER_RUC_DV = 4;
const CUSTOMER_NAME = 'Gaston Lopez';
const AMOUNT_PYG = 10000;
const DESCRIPTION = 'Productos varios';

// ================================================================
// Helpers
// ================================================================

function getNowPY(): string {
  return new Date().toLocaleString('sv-SE', {
    timeZone: 'America/Asuncion',
    hour12: false,
  }).replace(' ', 'T');
}

function generateCodigoSeguridad(): string {
  return String(Math.floor(100_000_000 + Math.random() * 899_999_999));
}

function buildDocNumber(): number {
  // Use a high number that won't collide with real documents.
  // DIAG prefix: 9000000 + last 6 digits of timestamp.
  return 9000000 + (Date.now() % 1_000_000);
}

// ================================================================
// Main
// ================================================================

async function main() {
  console.log('\n=== SIFEN DIAGNOSTIC EMIT ===\n');

  // 1. Decrypt credentials from env-supplied blobs or use real DB values.
  let certPem: string;
  let privateKeyPem: string;
  let csc: string;

  try {
    // These are read from the process at runtime. The caller must set
    // SIFEN_ENCRYPTION_KEY in their shell before running this script.
    const dbCertPem = process.env.CERT_PEM_DIRECT;
    const dbEncryptedKey = process.env.ENCRYPTED_PRIVATE_KEY_DIRECT;
    const dbEncryptedCsc = process.env.CSC_ENCRYPTED_DIRECT;

    if (!dbCertPem || !dbEncryptedKey || !dbEncryptedCsc) {
      throw new Error(
        'Missing env vars. Export:\n' +
        '  CERT_PEM_DIRECT       (full PEM from fiscal_identities.cert_pem)\n' +
        '  ENCRYPTED_PRIVATE_KEY_DIRECT (from fiscal_identities.encrypted_private_key)\n' +
        '  CSC_ENCRYPTED_DIRECT  (from fiscal_identities.csc)\n' +
        '  SIFEN_ENCRYPTION_KEY  (from .env)',
      );
    }

    certPem = dbCertPem;
    privateKeyPem = decrypt(dbEncryptedKey);
    csc = decrypt(dbEncryptedCsc);
    console.log('[OK] Credentials decrypted successfully.');
    console.log(`     cert subject excerpt: ${certPem.slice(0, 80).replace(/\n/g, ' ')}...`);
    console.log(`     csc length: ${csc.length}`);
  } catch (err) {
    console.error('[FAIL] Credential setup:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // 2. Build xmlgen params.
  const docNumber = buildDocNumber();
  const nowLocal = getNowPY();
  const numeroStr = String(docNumber).padStart(7, '0');

  const params = {
    version: 150,
    ruc: `${IDENTITY.ruc}-${IDENTITY.ruc_dv}`,
    razonSocial: IDENTITY.razon_social,
    nombreFantasia: IDENTITY.nombre_fantasia || IDENTITY.razon_social,
    timbradoNumero: LINK.timbrado,
    timbradoFecha: `${LINK.timbrado_fecha_inicio}T00:00:00`,
    tipoContribuyente: IDENTITY.tipo_contribuyente,
    tipoRegimen: IDENTITY.tipo_regimen,
    establecimientos: [
      {
        codigo: LINK.establecimiento_codigo,
        direccion: LINK.establecimiento_direccion,
        numeroCasa: '0',
        complementoDireccion1: '',
        complementoDireccion2: '',
        departamento: LINK.establecimiento_departamento,
        departamentoDescripcion: 'CAPITAL',
        distrito: LINK.establecimiento_distrito,
        distritoDescripcion: 'ASUNCION (DISTRITO)',
        ciudad: LINK.establecimiento_ciudad,
        ciudadDescripcion: 'ASUNCION (DISTRITO)',
        telefono: LINK.establecimiento_telefono,
        email: LINK.establecimiento_email,
        denominacion: IDENTITY.nombre_fantasia || 'Casa Central',
      },
    ],
    actividadesEconomicas: ACTIVITIES,
  };

  const iva10 = Math.round(AMOUNT_PYG / 11);

  const data = {
    tipoDocumento: 1,
    establecimiento: LINK.establecimiento_codigo,
    punto: LINK.punto_expedicion,
    numero: numeroStr,
    fecha: nowLocal,
    codigoSeguridadAleatorio: generateCodigoSeguridad(),
    tipoEmision: 1,
    tipoTransaccion: 2,
    tipoImpuesto: 1,
    moneda: 'PYG',
    cliente: {
      contribuyente: true,
      ruc: `${CUSTOMER_RUC}-${CUSTOMER_RUC_DV}`,
      dvRuc: CUSTOMER_RUC_DV,
      tipoOperacion: 1,
      razonSocial: CUSTOMER_NAME,
      nombreFantasia: CUSTOMER_NAME,
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
      documentoTipo: IDENTITY.representante_legal_documento_tipo,
      documentoNumero: IDENTITY.representante_legal_documento_numero,
      nombre: IDENTITY.representante_legal_nombre,
      cargo: IDENTITY.representante_legal_cargo,
    },
    factura: { presencia: 1 },
    condicion: {
      tipo: 1,
      entregas: [{ tipo: 1, monto: String(AMOUNT_PYG), moneda: 'PYG' }],
    },
    items: [
      {
        codigo: '1',
        descripcion: DESCRIPTION,
        observacion: '',
        unidadMedida: 77,
        cantidad: 1,
        precioUnitario: AMOUNT_PYG,
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

  // 3. Generate XML.
  let xmlGenerated: string;
  let cdc: string | undefined;

  console.log('\n[STEP 1] Generating XML with xmlgen...');
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

    console.log(`[OK] XML generated. CDC: ${cdc || 'NOT FOUND IN XML'}`);
    console.log('\n--- GENERATED XML (first 2000 chars) ---');
    console.log(xmlGenerated.slice(0, 2000));
    console.log('--- END XML EXCERPT ---\n');
  } catch (err) {
    console.error('[FAIL] XML generation error:');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // 4. Rewrite dFecFirma to local TZ (Railway runs UTC, SIFEN needs PY time).
  const nowLocalForFirma = getNowPY();
  const xmlWithLocalFirma = xmlGenerated.replace(
    /<dFecFirma>[^<]*<\/dFecFirma>/,
    `<dFecFirma>${nowLocalForFirma}</dFecFirma>`,
  );

  // 5. Sign XML.
  console.log('[STEP 2] Signing XML with RSA-SHA256...');
  let xmlSigned: string;
  try {
    xmlSigned = await signXML(xmlWithLocalFirma, privateKeyPem, certPem);
    console.log('[OK] XML signed.');
  } catch (err) {
    console.error('[FAIL] XML signing error:');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // 6. Inject QR (gCamFuFD).
  console.log('[STEP 3] Injecting QR (gCamFuFD)...');
  let xmlFinal: string;
  try {
    xmlFinal = await injectQR(xmlSigned, 'prod', IDENTITY.csc_id, csc);
    console.log('[OK] QR injected.');

    const qrMatch = xmlFinal.match(/<dCarQR>([\s\S]*?)<\/dCarQR>/);
    if (qrMatch) {
      console.log(`     QR URL (first 120): ${qrMatch[1].slice(0, 120)}...`);
    } else {
      console.warn('[WARN] dCarQR not found in final XML after injection.');
    }
  } catch (err) {
    console.error('[FAIL] QR injection error:');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // 7. Send to SIFEN prod.
  console.log('\n[STEP 4] Sending to SIFEN PROD (sifen.set.gov.py)...');
  try {
    const mtls = { certPem, privateKeyPem };
    const response = await sendDE(String(docNumber), xmlFinal, 'prod', mtls);

    console.log('\n=== SIFEN RESPONSE ===');
    console.log(`  success:         ${response.success}`);
    console.log(`  dCodRes:         ${response.responseCode}`);
    console.log(`  dMsgRes:         ${response.responseMessage}`);
    console.log(`  cdc (returned):  ${response.cdc || 'none'}`);
    console.log('\n--- RAW RESPONSE ---');
    console.log(response.rawResponse);
    console.log('--- END RAW RESPONSE ---');
  } catch (err) {
    console.error('\n[FAIL] SIFEN submission error (pre-response):');
    if (err instanceof Error) {
      console.error('  message:', err.message);
      console.error('  stack:  ', err.stack);
    } else {
      console.error(err);
    }
    process.exit(1);
  }

  console.log('\n=== DIAGNOSTIC COMPLETE ===\n');
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
