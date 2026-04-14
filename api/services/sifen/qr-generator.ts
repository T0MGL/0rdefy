/**
 * SIFEN QR Code Injector (gCamFuFD)
 *
 * xmlgen v1.0.280 does not emit the `gCamFuFD` group required by the DE v150
 * schema; omitting it triggers SIFEN response 0160 ("Falta gCamFuFD /
 * dCarQR").
 *
 * IMPORTANT: we cannot delegate to facturacionelectronicapy-qrgen directly.
 * That library uses `xml2js.Builder().buildObject(rebuilt)` which RE-SERIALIZES
 * the entire `<rDE>` tree, altering whitespace, attribute ordering, and
 * namespace prefix placement. Any of those changes invalidates the
 * enveloped signature (SIFEN response 0141, "Valor de la firma diferente
 * del calculado por el PKI").
 *
 * Fix: compute the QR URL using the same algorithm (MT-SIFEN-010 annex Q2)
 * and splice `<gCamFuFD>` in as a sibling of `<Signature>` via string
 * concatenation, leaving the signed `<DE>` bytes untouched.
 *
 * Algorithm (verbatim from SIFEN technical manual, cross-checked against
 * facturacionelectronicapy-qrgen@1.0.9):
 *
 *   base = https://ekuatia.set.gov.py/consultas[-test]/qr?
 *   payload = nVersion=<v>&Id=<CDC>&dFeEmiDE=<hex(utf8)>
 *           &(dRucRec=<ruc> | dNumIDRec=<doc>)
 *           &dTotGralOpe=<total>&dTotIVA=<iva>&cItems=<n>
 *           &DigestValue=<hex(utf8)>&IdCSC=<csc_id>
 *   cHashQR = SHA256(payload + CSC)
 *   dCarQR = base + payload + "&cHashQR=" + cHashQR
 */

import crypto from 'crypto';
import { logger } from '../../utils/logger';

// SIFEN test defaults. Real contribuyentes in production MUST override these
// with the values DNIT issued for their RUC.
export const SIFEN_TEST_ID_CSC = '0001';
export const SIFEN_TEST_CSC = 'ABCD0000000000000000000000000000';

function toHex(utf8: string): string {
  return Buffer.from(utf8, 'utf8').toString('hex');
}

/** Extract a single element's text content by local name (namespace-agnostic). */
function extractTag(xml: string, localName: string): string | null {
  const re = new RegExp(`<(?:[\\w-]+:)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${localName}>`);
  const m = xml.match(re);
  return m ? m[1] : null;
}

/** Count occurrences of a repeating element for cItems. */
function countTag(xml: string, localName: string): number {
  const re = new RegExp(`<(?:[\\w-]+:)?${localName}(?:\\s[^>]*)?>`, 'g');
  return (xml.match(re) || []).length;
}

/**
 * Compute the QR URL per SIFEN MT-SIFEN-010 annex Q2.
 *
 * @param xml    The signed DE XML (must contain <DE>, <Signature>, and the
 *               totals block <gTotSub>).
 * @param env    'test' | 'prod'
 * @param idCSC  IdCSC issued by DNIT (or SIFEN_TEST_ID_CSC for test)
 * @param csc    CSC secret issued by DNIT (or SIFEN_TEST_CSC for test)
 */
export function buildQrUrl(
  xml: string,
  env: 'test' | 'prod',
  idCSC: string,
  csc: string,
): string {
  const base = env === 'test'
    ? 'https://ekuatia.set.gov.py/consultas-test/qr?'
    : 'https://ekuatia.set.gov.py/consultas/qr?';

  // Extract required fields
  const nVersion = extractTag(xml, 'dVerFor') ?? '150';

  const cdcMatch = xml.match(/<(?:[\w-]+:)?DE[^>]*\bId\s*=\s*"(\d{44})"/);
  if (!cdcMatch) {
    throw new Error('QR: could not extract CDC (DE Id) from signed XML');
  }
  const cdc = cdcMatch[1];

  const dFeEmiDE = extractTag(xml, 'dFeEmiDE');
  if (!dFeEmiDE) throw new Error('QR: missing dFeEmiDE in XML');

  const dRucRec = extractTag(xml, 'dRucRec'); // contribuyente
  const dNumIDRec = extractTag(xml, 'dNumIDRec'); // no contribuyente

  const dTotGralOpe = extractTag(xml, 'dTotGralOpe') ?? '0';
  const dTotIVA = extractTag(xml, 'dTotIVA') ?? '0';
  const cItems = countTag(xml, 'gCamItem');

  // DigestValue: first Reference's DigestValue inside SignedInfo.
  // The signature is namespace-agnostic (may be ds:DigestValue or DigestValue).
  const digestMatch = xml.match(/<(?:[\w-]+:)?DigestValue>([^<]+)<\/(?:[\w-]+:)?DigestValue>/);
  if (!digestMatch) {
    throw new Error('QR: could not extract DigestValue from signed XML');
  }
  const digestValue = digestMatch[1];

  let payload = `nVersion=${nVersion}&Id=${cdc}&dFeEmiDE=${toHex(dFeEmiDE)}`;
  if (dRucRec) {
    payload += `&dRucRec=${dRucRec}`;
  } else if (dNumIDRec) {
    payload += `&dNumIDRec=${dNumIDRec}`;
  }
  payload += `&dTotGralOpe=${dTotGralOpe}`;
  payload += `&dTotIVA=${dTotIVA}`;
  payload += `&cItems=${cItems}`;
  payload += `&DigestValue=${toHex(digestValue)}`;
  payload += `&IdCSC=${idCSC}`;

  const cHashQR = crypto
    .createHash('sha256')
    .update(payload + csc, 'utf8')
    .digest('hex');

  return base + payload + `&cHashQR=${cHashQR}`;
}

/**
 * XML-escape text content for injection into an attribute or element value.
 * The QR URL contains `&` heavily; we need it escaped to `&amp;` because the
 * value will sit inside an XML element as character data.
 */
function escapeXmlContent(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Inject `<gCamFuFD><dCarQR>...</dCarQR></gCamFuFD>` into the signed XML
 * without re-serializing the document. The signed `<DE>` bytes are left
 * untouched, preserving the signature.
 *
 * gCamFuFD is a sibling of Signature inside rDE, placed just before the
 * closing </rDE>.
 */
export async function injectQR(
  xmlSigned: string,
  env: 'test' | 'prod',
  idCSC: string = SIFEN_TEST_ID_CSC,
  csc: string = SIFEN_TEST_CSC,
): Promise<string> {
  try {
    const qrUrl = buildQrUrl(xmlSigned, env, idCSC, csc);
    const block = `<gCamFuFD><dCarQR>${escapeXmlContent(qrUrl)}</dCarQR></gCamFuFD>`;

    // Splice before </rDE>, preserving every byte elsewhere. If there's
    // already a gCamFuFD (re-entrant call after retry), replace it.
    const hasExisting = /<gCamFuFD[\s\S]*?<\/gCamFuFD>/.test(xmlSigned);
    if (hasExisting) {
      return xmlSigned.replace(/<gCamFuFD[\s\S]*?<\/gCamFuFD>/, block);
    }

    const closeRDE = xmlSigned.lastIndexOf('</rDE>');
    if (closeRDE < 0) {
      throw new Error('QR: could not locate </rDE> in signed XML');
    }
    return xmlSigned.slice(0, closeRDE) + block + xmlSigned.slice(closeRDE);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown QR injection error';
    logger.error(`[SIFEN:qr] Failed to inject QR: ${message}`);
    throw new Error(`QR injection failed: ${message}`);
  }
}
