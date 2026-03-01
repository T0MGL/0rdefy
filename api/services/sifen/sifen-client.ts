/**
 * SIFEN SOAP 1.2 Client
 *
 * Communicates with Paraguay's SET (Subsecretaría de Estado de Tributación)
 * electronic invoicing system via SOAP 1.2 web services.
 *
 * Endpoints:
 * - Test: https://sifen-test.set.gov.py/de/ws/
 * - Production: https://sifen.set.gov.py/de/ws/
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

const ENDPOINTS: Record<Exclude<SifenEnv, 'demo'>, string> = {
  test: 'https://sifen-test.set.gov.py/de/ws/',
  prod: 'https://sifen.set.gov.py/de/ws/',
};

const TIMEOUT_MS = 30_000;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB max response

/**
 * Escape XML special characters to prevent injection.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Validate that a CDC is exactly 44 digits (no injection possible).
 */
function validateCDC(cdc: string): void {
  if (!/^\d{44}$/.test(cdc)) {
    throw new Error(`Invalid CDC format: must be exactly 44 digits`);
  }
}

/**
 * Validate that an ID is numeric only.
 */
function validateNumericId(id: string): void {
  if (!/^\d+$/.test(id)) {
    throw new Error(`Invalid ID format: must be numeric`);
  }
}

/**
 * Make a SOAP 1.2 request to SIFEN.
 */
async function soapRequest(url: string, action: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = buildSoapEnvelope(action, body);

    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname,
      method: 'POST',
      rejectUnauthorized: true, // Explicit TLS verification
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: TIMEOUT_MS,
    };

    const req = https.request(options, (res) => {
      // Check for non-2xx status
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        let errData = '';
        res.on('data', (chunk) => { errData += chunk; });
        res.on('end', () => {
          reject(new Error(`SIFEN HTTP ${res.statusCode}: ${errData.substring(0, 500)}`));
        });
        return;
      }

      let data = '';
      let totalSize = 0;
      res.on('data', (chunk) => {
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

    req.write(postData);
    req.end();
  });
}

function buildSoapEnvelope(action: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope">
  <env:Header/>
  <env:Body>
    ${body}
  </env:Body>
</env:Envelope>`;
}

/**
 * Parse SIFEN SOAP response to extract result code and message.
 */
async function parseResponse(rawXml: string): Promise<SifenResponse> {
  try {
    const parsed = await parseStringPromise(rawXml, {
      explicitArray: false,
      ignoreAttrs: false,
      tagNameProcessors: [(name: string) => name.replace(/.*:/, '')], // strip namespace prefixes
    });

    const body = parsed?.Envelope?.Body;
    if (!body) {
      return {
        success: false,
        responseCode: 'PARSE_ERROR',
        responseMessage: 'Could not parse SOAP response body',
      };
    }

    // Look for rRetEnviDe (send response) or rRetConsDe (consult response)
    const result = body.rRetEnviDe || body.rRetConsDe || body.rRetEnviEventoDe || {};
    const header = result.rProtDe?.gResProc || result.gResProc || {};

    const responseCode = header.dCodRes || result.dCodRes || 'UNKNOWN';
    const responseMessage = header.dMsgRes || result.dMsgRes || 'No message';
    const cdc = result.rProtDe?.gResProc?.dCDC || header.id || undefined;

    // Codes 0260-0299 are approval codes
    const codeNum = parseInt(responseCode, 10);
    const success = codeNum >= 260 && codeNum <= 299;

    return {
      success,
      responseCode: String(responseCode),
      responseMessage: String(responseMessage),
      cdc,
    };
  } catch (err: any) {
    return {
      success: false,
      responseCode: 'PARSE_ERROR',
      responseMessage: `Failed to parse SIFEN response: ${err.message}`,
    };
  }
}

/**
 * Send a signed DE (Documento Electrónico) to SIFEN.
 */
export async function sendDE(id: string, xmlSigned: string, env: SifenEnv): Promise<SifenResponse> {
  if (env === 'demo') {
    throw new Error('sendDE should not be called in demo mode');
  }

  validateNumericId(id);

  const url = `${ENDPOINTS[env]}sync/recibe.wsdl`;
  const body = `<rEnviDe>
    <dId>${escapeXml(id)}</dId>
    <xDE>${Buffer.from(xmlSigned).toString('base64')}</xDE>
  </rEnviDe>`;

  logger.info(`[SIFEN] Sending DE ${id} to ${env} environment`);

  const rawResponse = await soapRequest(url, 'recibe', body);
  return parseResponse(rawResponse);
}

/**
 * Consult a DE by its CDC.
 */
export async function consultDE(cdc: string, env: SifenEnv): Promise<SifenResponse> {
  if (env === 'demo') {
    throw new Error('consultDE should not be called in demo mode');
  }

  validateCDC(cdc);

  const url = `${ENDPOINTS[env]}consulta/consulta.wsdl`;
  const body = `<rContDe>
    <dCDC>${cdc}</dCDC>
  </rContDe>`;

  logger.info(`[SIFEN] Consulting CDC in ${env} environment`);

  const rawResponse = await soapRequest(url, 'consulta', body);
  return parseResponse(rawResponse);
}

/**
 * Send a SIFEN event (cancellation, etc.).
 */
export async function sendEvent(
  cdc: string,
  eventType: number,
  xmlEvent: string,
  env: SifenEnv
): Promise<SifenResponse> {
  if (env === 'demo') {
    throw new Error('sendEvent should not be called in demo mode');
  }

  validateCDC(cdc);
  if (!Number.isInteger(eventType) || eventType < 1 || eventType > 99) {
    throw new Error(`Invalid event type: ${eventType}`);
  }

  const url = `${ENDPOINTS[env]}evento/evento.wsdl`;
  const body = `<rEnviEventoDe>
    <dId>1</dId>
    <dCDC>${cdc}</dCDC>
    <iTiEvento>${eventType}</iTiEvento>
    <xEvento>${Buffer.from(xmlEvent).toString('base64')}</xEvento>
  </rEnviEventoDe>`;

  logger.info(`[SIFEN] Sending event type ${eventType} for CDC in ${env}`);

  const rawResponse = await soapRequest(url, 'evento', body);
  return parseResponse(rawResponse);
}
