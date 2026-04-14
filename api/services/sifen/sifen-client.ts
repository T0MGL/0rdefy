/**
 * SIFEN SOAP 1.2 Client (mTLS)
 *
 * Communicates with Paraguay's SET (Subsecretaría de Estado de Tributación)
 * electronic invoicing system via SOAP 1.2 web services.
 *
 * SIFEN requires mutual TLS: the client MUST present its X.509 certificate and
 * private key during the TLS handshake. Without it, SIFEN responds with HTTP
 * 302 to its F5 APM portal (not an SOAP error).
 *
 * Endpoints:
 *   Test: https://sifen-test.set.gov.py/de/ws/
 *   Prod: https://sifen.set.gov.py/de/ws/
 *
 * Protocol notes (vs. agent-level assumptions, extracted from recibe.wsdl.xsd):
 *   - `xDE` contains the signed DE XML INLINE (xs:any processContents="skip").
 *     NOT base64-encoded.
 *   - rEnviDe / rEnviConsDeRequest / rEnviEventoDe MUST be in the SIFEN xsd
 *     namespace: xmlns="http://ekuatia.set.gov.py/sifen/xsd".
 *   - SOAP 1.2 envelope is required, content-type application/soap+xml.
 */

import https from 'https';
import { parseStringPromise } from 'xml2js';
import { logger } from '../../utils/logger';

export type SifenEnv = 'demo' | 'test' | 'prod';

export interface SifenResponse {
  success: boolean;
  responseCode: string;
  responseMessage: string;
  cdc?: string;
  rawResponse?: string;
}

/**
 * mTLS material required by SIFEN. PEM strings, never paths, never buffers
 * cached on disk. Decrypt the private key in memory at call time and pass it
 * in here; do not persist.
 */
export interface SifenMtls {
  certPem: string;
  privateKeyPem: string;
}

const ENDPOINTS: Record<Exclude<SifenEnv, 'demo'>, string> = {
  test: 'https://sifen-test.set.gov.py/de/ws/',
  prod: 'https://sifen.set.gov.py/de/ws/',
};

const TIMEOUT_MS = 30_000;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5 MB
const SIFEN_XSD_NS = 'http://ekuatia.set.gov.py/sifen/xsd';

/**
 * Escape XML special characters for attribute / text content.
 * IDs and CDCs are validated to be digits-only and therefore do not need to
 * pass through this, but any caller-supplied free-text would.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** CDC must be exactly 44 digits. Anything else is rejected before egress. */
function validateCDC(cdc: string): void {
  if (!/^\d{44}$/.test(cdc)) {
    throw new Error('Invalid CDC format: must be exactly 44 digits');
  }
}

/** Numeric-only ID (SIFEN dId). */
function validateNumericId(id: string): void {
  if (!/^\d+$/.test(id)) {
    throw new Error('Invalid ID format: must be numeric');
  }
}

/**
 * Strip the `<?xml ... ?>` prolog from an XML string. SIFEN's xDE wrapper
 * expects the root element inline, not a nested XML document declaration.
 */
function stripXmlProlog(xml: string): string {
  return xml.replace(/^\s*<\?xml[^?]*\?>\s*/, '');
}

/**
 * Low-level SOAP 1.2 POST with mutual TLS. The certificate/key are attached
 * to the TLS context; they never appear in logs or request bodies.
 */
async function soapRequestMtls(
  url: string,
  body: string,
  mtls: SifenMtls,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const envelope = buildSoapEnvelope(body);

    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      cert: mtls.certPem,
      key: mtls.privateKeyPem,
      rejectUnauthorized: true,
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(envelope),
      },
      timeout: TIMEOUT_MS,
    };

    const req = https.request(options, (res) => {
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        let errData = '';
        res.on('data', (chunk) => {
          errData += chunk;
          if (errData.length > 4096) errData = errData.slice(0, 4096);
        });
        res.on('end', () => {
          reject(new Error(`SIFEN HTTP ${res.statusCode}: ${errData.substring(0, 500)}`));
        });
        return;
      }

      let data = '';
      let totalSize = 0;
      res.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > MAX_RESPONSE_SIZE) {
          req.destroy();
          reject(new Error(`SIFEN response exceeded ${MAX_RESPONSE_SIZE} bytes`));
          return;
        }
        data += chunk;
      });
      res.on('end', () => resolve(data));
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`SIFEN request timeout after ${TIMEOUT_MS}ms`));
    });

    req.write(envelope);
    req.end();
  });
}

function buildSoapEnvelope(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope">
  <env:Header/>
  <env:Body>
    ${body}
  </env:Body>
</env:Envelope>`;
}

/**
 * Parse SIFEN SOAP response and extract response code / message / CDC.
 * Codes 0260-0299 are the approval band per SIFEN's manual técnico.
 */
async function parseResponse(rawXml: string): Promise<SifenResponse> {
  try {
    const parsed = await parseStringPromise(rawXml, {
      explicitArray: false,
      ignoreAttrs: false,
      tagNameProcessors: [(name: string) => name.replace(/.*:/, '')],
    });

    const body = parsed?.Envelope?.Body;
    if (!body) {
      return {
        success: false,
        responseCode: 'PARSE_ERROR',
        responseMessage: 'Could not parse SOAP response body',
        rawResponse: rawXml,
      };
    }

    const result = body.rRetEnviDe || body.rRetConsDe || body.rRetEnviEventoDe || {};
    const header = result.rProtDe?.gResProc || result.gResProc || {};

    const responseCode = header.dCodRes || result.dCodRes || 'UNKNOWN';
    const responseMessage = header.dMsgRes || result.dMsgRes || 'No message';
    const cdc = result.rProtDe?.gResProc?.dCDC || header.id || undefined;

    const codeNum = parseInt(String(responseCode), 10);
    const success = codeNum >= 260 && codeNum <= 299;

    return {
      success,
      responseCode: String(responseCode),
      responseMessage: String(responseMessage),
      cdc,
      rawResponse: rawXml,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown parse error';
    return {
      success: false,
      responseCode: 'PARSE_ERROR',
      responseMessage: `Failed to parse SIFEN response: ${message}`,
      rawResponse: rawXml,
    };
  }
}

/**
 * Send a signed DE (Documento Electrónico) to SIFEN.
 *
 * @param id        numeric request ID (SIFEN dId)
 * @param xmlSigned the signed DE XML (with ds:Signature and, ideally, gCamFuFD)
 * @param env       'test' | 'prod'
 * @param mtls      client certificate + private key PEMs
 */
export async function sendDE(
  id: string,
  xmlSigned: string,
  env: Exclude<SifenEnv, 'demo'>,
  mtls: SifenMtls,
): Promise<SifenResponse> {
  validateNumericId(id);

  const url = `${ENDPOINTS[env]}sync/recibe.wsdl`;
  const deInner = stripXmlProlog(xmlSigned);
  const body = `<rEnviDe xmlns="${SIFEN_XSD_NS}">
    <dId>${escapeXml(id)}</dId>
    <xDE>${deInner}</xDE>
  </rEnviDe>`;

  logger.info(`[SIFEN] Sending DE id=${id} env=${env}`);
  const rawResponse = await soapRequestMtls(url, body, mtls);
  return parseResponse(rawResponse);
}

/**
 * Consult a DE by its CDC. Required to confirm SIFEN indexed the document.
 */
export async function consultDE(
  cdc: string,
  env: Exclude<SifenEnv, 'demo'>,
  mtls: SifenMtls,
): Promise<SifenResponse> {
  validateCDC(cdc);

  const url = `${ENDPOINTS[env]}consultas/consulta.wsdl`;
  const body = `<rEnviConsDeRequest xmlns="${SIFEN_XSD_NS}">
    <dId>${Date.now() % 1_000_000_000}</dId>
    <dCDC>${cdc}</dCDC>
  </rEnviConsDeRequest>`;

  logger.info(`[SIFEN] Consulting CDC env=${env}`);
  const rawResponse = await soapRequestMtls(url, body, mtls);
  return parseResponse(rawResponse);
}

/**
 * Send a SIFEN event (cancellation, etc.).
 */
export async function sendEvent(
  cdc: string,
  eventType: number,
  xmlEvent: string,
  env: Exclude<SifenEnv, 'demo'>,
  mtls: SifenMtls,
): Promise<SifenResponse> {
  validateCDC(cdc);
  if (!Number.isInteger(eventType) || eventType < 1 || eventType > 99) {
    throw new Error(`Invalid event type: ${eventType}`);
  }

  const url = `${ENDPOINTS[env]}evento/evento.wsdl`;
  const eventInner = stripXmlProlog(xmlEvent);
  const body = `<rEnviEventoDe xmlns="${SIFEN_XSD_NS}">
    <dId>1</dId>
    <dCDC>${cdc}</dCDC>
    <iTiEvento>${eventType}</iTiEvento>
    <xEvento>${eventInner}</xEvento>
  </rEnviEventoDe>`;

  logger.info(`[SIFEN] Sending event type=${eventType} env=${env}`);
  const rawResponse = await soapRequestMtls(url, body, mtls);
  return parseResponse(rawResponse);
}
