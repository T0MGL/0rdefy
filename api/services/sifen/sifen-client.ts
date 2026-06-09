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
 * Sync vs Async (Manual Tecnico v150 secciones 7.10, 8, 9.1-9.3):
 *   - Sync (sendDE / consultDE / sendEvent): SIFEN responde resultado en la
 *     misma request. SIFEN PROD restringe el sync de recepcion DE por
 *     politica de seguridad (clausula 7.10 final) y rechaza el envio. Solo
 *     queda viable para eventos y consulta DE individual.
 *   - Async (sendDELote / consultLote): unico path soportado en SIFEN prod
 *     para recepcion. El cliente arma un XML <rLoteDE> con 1..50 DEs
 *     firmados, lo COMPRIME en ZIP, lo codifica Base64 y lo envia dentro
 *     de <rEnvioLote>. SIFEN responde con dProtConsLote (numero de lote);
 *     el resultado individual por CDC se obtiene despues con consultLote.
 *
 * Protocol notes (extracted from recibe.wsdl.xsd y SiRecepLoteDE_v150.xsd):
 *   - sync xDE: signed DE XML INLINE (xs:any processContents="skip"),
 *     NO base64.
 *   - async xDE: ZIP de un XML <rLoteDE> conteniendo los <rDE>, encoded
 *     en Base64. Schema XML 5 marca el tipo como `B` (Base64).
 *   - rEnviDe / rEnviConsDeRequest / rEnviEventoDe / rEnvioLote /
 *     rEnviConsLoteDe estan en el namespace SIFEN xsd:
 *     xmlns="http://ekuatia.set.gov.py/sifen/xsd".
 *   - SOAP 1.2 envelope, content-type application/soap+xml.
 */

import https from 'https';
import { parseStringPromise } from 'xml2js';
import JSZip from 'jszip';
import { logger } from '../../utils/logger';

// Per-request agent: keep-alive sockets to sifen.set.gov.py end up in a
// weird state on the F5 load balancer in front of SIFEN; reused sockets
// hang for the full timeout (90s) without ever returning a response.
// A clean curl/Node probe without any agent reuse returns 0300 in <700ms
// against the same endpoint, cert, and payload. Until we have a working
// keep-alive setup, use a fresh agent per request: TLS handshake cost
// per call (~200-500ms) is fine for our volume.
function freshAgent(): https.Agent {
  return new https.Agent({ keepAlive: false });
}

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

// SIFEN async (siRecepLoteDE) cold-start with mTLS handshake can land
// in the 30-60s range on a fresh socket; sync receives are faster but
// share the same client. 90s gives the lote endpoint room to respond
// before the dispatcher gives up and treats it as a transient failure.
const TIMEOUT_MS = 90_000;
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
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('SIFEN request aborted before dispatch'));
      return;
    }

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
      agent: freshAgent(),
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

    const onAbort = () => {
      req.destroy(new Error('SIFEN request aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    req.on('close', () => signal?.removeEventListener('abort', onAbort));
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
 * Resultado estructurado de una consulta DE por CDC (siConsDE).
 *
 * A diferencia de {@link SifenResponse} (que usa la banda 0260-0299 de la
 * RECEPCION sync), la CONSULTA de un DE individual responde con su propia
 * tabla de codigos. OJO: dCodRes solo indica si el CDC fue HALLADO, NO si el
 * DE quedo aprobado:
 *   - 0422 = CDC encontrado (el documento existe; su estado fiscal puede ser
 *            Aprobado, Rechazado, Cancelado o Inutilizado)
 *   - 0420 = CDC inexistente
 *   - 0421 = RUC sin permiso para consultar ese CDC
 * El estado fiscal real vive en rProtDe/gResProc -> dEstRes ('Aprobado',
 * 'Aprobado con observacion', 'Rechazado', 'Cancelado', 'Inutilizado'). Por
 * eso `approved` se deriva UNICAMENTE de dEstRes via isApprovedEstado, igual
 * que {@link parseLoteResultResponse}. NUNCA se aprueba por dCodRes=0422 a
 * secas: un DE hallado-pero-Rechazado tambien devuelve 0422.
 *
 * Se usa como FALLBACK del poller cuando consultLote (siResultLoteDE) cuelga
 * o queda inconcluso: la consulta por CDC contesta en ~1s desde una IP que
 * alcanza a SET, mientras que el resultado de lote puede mantener la conexion
 * abierta mientras el lote sigue procesando.
 */
export interface SifenConsultaDEResult {
  /**
   * True solo si dEstRes empieza con "Aprobado". NUNCA se deriva de
   * dCodRes=0422 (eso solo dice que el CDC fue hallado, no que este aprobado).
   */
  approved: boolean;
  /** dCodRes de la consulta (0422 = CDC encontrado, 0420 = inexistente, 0421 = sin permiso). */
  responseCode: string;
  /** dMsgRes. */
  responseMessage: string;
  /**
   * dEstRes literal cuando SET lo incluye ('Aprobado', 'Rechazado',
   * 'Cancelado', etc.). Si la respuesta es 0422 (hallado) pero dEstRes esta
   * ausente o no se puede parsear, queda undefined y el resultado es
   * INCONCLUSO (ni approved ni rejected): el poller reprograma con backoff.
   */
  estado?: string;
  /**
   * dProtAut: protocolo de autorizacion. Solo presente en DEs aprobados, asi
   * que sirve como senal corroborante, pero el gate autoritativo es dEstRes.
   */
  protocolNumber?: string;
  rawResponse?: string;
}

/**
 * Codigo de la consulta DE que indica "CDC HALLADO" (NO aprobado).
 * Manual v150 (consulta de DE / siConsDE): 0422 = "CDC encontrado". El estado
 * fiscal real se lee de dEstRes, NO de este codigo: un DE Rechazado o
 * Cancelado tambien responde 0422.
 */
const CONSULTA_DE_FOUND_CODE = '0422';

/**
 * Consulta un DE por CDC y devuelve un resultado estructurado con la
 * semantica de aprobacion correcta: `approved` SOLO si dEstRes='Aprobado*'.
 * Es el fallback robusto del poller: consultLote puede colgar en lotes recien
 * enviados, pero la consulta individual por CDC resuelve el estado real de
 * forma confiable. Un CDC hallado (0422) sin un dEstRes aprobado queda
 * inconcluso, nunca aprobado.
 */
export async function consultDEResult(
  cdc: string,
  env: Exclude<SifenEnv, 'demo'>,
  mtls: SifenMtls,
  signal?: AbortSignal,
): Promise<SifenConsultaDEResult> {
  validateCDC(cdc);

  const url = `${ENDPOINTS[env]}consultas/consulta.wsdl`;
  const body = `<rEnviConsDeRequest xmlns="${SIFEN_XSD_NS}">
    <dId>${Date.now() % 1_000_000_000}</dId>
    <dCDC>${cdc}</dCDC>
  </rEnviConsDeRequest>`;

  logger.info(`[SIFEN] Consulting DE result by CDC env=${env}`);
  const rawResponse = await soapRequestMtls(url, body, mtls, signal);
  return parseConsultaDEResult(rawResponse);
}

/**
 * Parse de la respuesta de siConsDE. Extrae dCodRes/dMsgRes del header y el
 * estado/protocolo del rProtDe.
 *
 * GATE DE APROBACION (critico): `approved` se deriva UNICAMENTE de
 * isApprovedEstado(dEstRes), igual que {@link parseLoteResultResponse}. dCodRes
 * NO participa del gate: 0422 solo significa "CDC hallado", y un DE
 * Rechazado/Cancelado/Inutilizado tambien responde 0422. Aprobar por 0422 a
 * secas despacharia el email fiscal de un DE no aprobado.
 *
 * Estados posibles del resultado:
 *   - dEstRes='Aprobado*'                  -> approved=true
 *   - dEstRes='Rechazado'/'Cancelado'/etc. -> approved=false (no aprobado)
 *   - 0422 hallado pero dEstRes ausente    -> approved=false, estado=undefined
 *                                             (INCONCLUSO: el poller reprograma)
 */
async function parseConsultaDEResult(
  rawXml: string,
): Promise<SifenConsultaDEResult> {
  try {
    const parsed = await parseStringPromise(rawXml, {
      explicitArray: false,
      ignoreAttrs: false,
      tagNameProcessors: [(name: string) => name.replace(/.*:/, '')],
    });

    const body = parsed?.Envelope?.Body;
    if (!body) {
      return {
        approved: false,
        responseCode: 'PARSE_ERROR',
        responseMessage: 'SOAP body missing in SIFEN consulta DE result',
        rawResponse: rawXml,
      };
    }

    const result = body.rEnviConsDeResponse || body.rRetConsDe || body.rResEnviConsDe || {};
    const prot = result.rProtDe || {};
    const gResProc = prot.gResProc || result.gResProc || {};

    const responseCode = String(gResProc.dCodRes ?? result.dCodRes ?? 'UNKNOWN');
    const responseMessage = String(
      gResProc.dMsgRes ?? result.dMsgRes ?? 'No message',
    );
    const estado = prot.dEstRes ? String(prot.dEstRes) : undefined;
    const protocolNumber = prot.dProtAut ? String(prot.dProtAut) : undefined;

    // Gate autoritativo: SOLO dEstRes. responseCode (incl. 0422 = CDC hallado)
    // nunca aprueba por si solo; un DE Rechazado/Cancelado tambien es 0422.
    const approved = isApprovedEstado(estado);

    // 0422 (CDC hallado) sin dEstRes parseable: resultado INCONCLUSO. Lo
    // dejamos como no-aprobado/no-rechazado (estado=undefined) para que el
    // poller reprograme con backoff en vez de aprobar a ciegas. Lo logueamos
    // porque suele indicar un layout de respuesta no contemplado.
    if (responseCode === CONSULTA_DE_FOUND_CODE && !estado) {
      logger.warn(
        `[SIFEN] consultDE 0422 (CDC hallado) sin dEstRes: resultado inconcluso, no se aprueba`,
      );
    }

    return {
      approved,
      responseCode,
      responseMessage,
      estado,
      protocolNumber,
      rawResponse: rawXml,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown parse error';
    return {
      approved: false,
      responseCode: 'PARSE_ERROR',
      responseMessage: `Failed to parse SIFEN consulta DE result: ${message}`,
      rawResponse: rawXml,
    };
  }
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

// ================================================================
// ASYNC LOTE FLOW (Manual Tecnico SIFEN v150 secciones 9.2 y 9.3)
// ================================================================
// SIFEN prod no acepta sync de recepcion. Toda emision pasa por aqui.
//
// Flow:
//   1. dispatcher arma XML <rLoteDE> con 1..50 <rDE> firmados
//   2. sendDELote zipea + base64 + envia
//   3. SIFEN responde dCodRes=0300 + dProtConsLote (numero de lote)
//   4. tras dTpoProces segundos, poller llama consultLote(dProtConsLote)
//   5. respuesta trae lista de DEs procesados con resultado individual
// ================================================================

/**
 * Resultado del envio de un lote (siRecepLoteDE).
 *
 * `success` indica que SIFEN acepto el lote para procesamiento (dCodRes
 * = 0300). NO implica que los DEs internos quedaron aprobados; eso se
 * resuelve mas tarde via {@link consultLote}.
 */
export interface SifenLoteResponse {
  success: boolean;
  responseCode: string;
  responseMessage: string;
  /** dProtConsLote, presente cuando success=true. Numerico, ~18 digitos en prod. */
  protocolNumber?: string;
  /** dTpoProces: tiempo promedio de procesamiento en SEGUNDOS reportado
   *  por SIFEN. El poller lo usa para programar la primera consulta. */
  processingTimeSeconds?: number;
  /** dFecProc en formato AAAA-MM-DDTHH:MM:SS. */
  receivedAt?: string;
  rawResponse?: string;
}

/** Resultado individual por DE devuelto por siResultLoteDE. */
export interface SifenLoteResultEntry {
  /** CDC de 44 digitos. */
  cdc: string;
  /** dEstRes literal: 'Aprobado' | 'Aprobado con observacion' | 'Rechazado'. */
  estado: string;
  /** True si dEstRes empieza con "Aprobado" (cubre Aprobado y Aprobado con observacion). */
  approved: boolean;
  /** dProtAut: numero de transaccion del DE individual. */
  protocolNumber?: string;
  /** Primer dCodRes del grupo gResProc. */
  responseCode: string;
  /** Primer dMsgRes del grupo gResProc. */
  responseMessage: string;
}

/** Resultado de la consulta de un lote (siResultLoteDE). */
export interface SifenLoteResultResponse {
  /** 'processing' si dCodResLot=0361, 'processed' si 0362, 'not_found' si 0360. */
  state: 'processing' | 'processed' | 'not_found' | 'unknown';
  /** dCodResLot. */
  responseCode: string;
  /** dMsgResLot. */
  responseMessage: string;
  /** Entries presentes solo cuando state='processed'. */
  entries: SifenLoteResultEntry[];
  rawResponse?: string;
}

/**
 * Estados de aprobacion en respuesta a consulta de lote. SIFEN escribe el
 * literal en castellano dentro de dEstRes (Schema XML 8, CRSch051):
 *   - 'Aprobado'
 *   - 'Aprobado con observacion'
 *   - 'Rechazado'
 * Cualquier prefijo "Aprobado" cuenta como aprobado para nuestro flow.
 */
function isApprovedEstado(estado: string | undefined): boolean {
  if (!estado) return false;
  return estado.trim().toLowerCase().startsWith('aprobado');
}

/**
 * Construye el XML interno del lote (Schema XML 5A: rLoteDE) que va
 * comprimido en ZIP y enviado dentro del request rEnvioLote.
 *
 * @param signedDEs DEs firmados individualmente, en orden de envio.
 *                  Cada uno debe ser un <rDE>...</rDE> con su firma
 *                  enveloped lista. Sin prologo XML (lo strippea el caller).
 */
function buildLoteInnerXml(signedDEs: string[]): string {
  if (signedDEs.length === 0 || signedDEs.length > 50) {
    throw new Error(
      `Lote debe tener entre 1 y 50 DEs, recibidos: ${signedDEs.length}`,
    );
  }
  const inner = signedDEs.map((de) => stripXmlProlog(de)).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rLoteDE xmlns="${SIFEN_XSD_NS}">${inner}</rLoteDE>`;
}

/**
 * Empaqueta el XML del lote como archivo ZIP y devuelve el Base64. SIFEN
 * solo acepta ZIP (Manual v150 seccion 9.2 "Particularidad: Archivo
 * comprimido .zip"); no acepta gzip ni plain XML.
 *
 * Internamente el zip contiene un unico archivo llamado `lote.xml` con
 * el contenido del rLoteDE. El nombre interno no esta normado por SIFEN,
 * pero usamos un slug estable para que las pruebas sean reproducibles.
 */
async function buildLoteZipBase64(loteXml: string): Promise<string> {
  const zip = new JSZip();
  zip.file('lote.xml', loteXml);
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  if (buffer.byteLength > 1_000_000) {
    // Manual v150 9.2.1: tamano max del archivo enviado = 1000 KB.
    throw new Error(
      `Lote ZIP excede 1000 KB (${buffer.byteLength} bytes). Reduci la cantidad de DEs por lote.`,
    );
  }
  return buffer.toString('base64');
}

/**
 * Parse de la respuesta de siRecepLoteDE (Schema XML 6, resRecepLoteDE_v150).
 */
async function parseLoteResponse(rawXml: string): Promise<SifenLoteResponse> {
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
        responseMessage: 'SOAP body missing in SIFEN response',
        rawResponse: rawXml,
      };
    }

    const result = body.rResEnviLoteDe || body.rRetEnviLoteDe || {};
    const responseCode = String(result.dCodRes ?? 'UNKNOWN');
    const responseMessage = String(result.dMsgRes ?? 'No message');
    const protocolNumber = result.dProtConsLote
      ? String(result.dProtConsLote)
      : undefined;
    const dTpoProces = result.dTpoProces ? Number(result.dTpoProces) : undefined;

    return {
      success: responseCode === '0300' && Boolean(protocolNumber),
      responseCode,
      responseMessage,
      protocolNumber,
      processingTimeSeconds: Number.isFinite(dTpoProces) ? dTpoProces : undefined,
      receivedAt: result.dFecProc ? String(result.dFecProc) : undefined,
      rawResponse: rawXml,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown parse error';
    return {
      success: false,
      responseCode: 'PARSE_ERROR',
      responseMessage: `Failed to parse SIFEN lote response: ${message}`,
      rawResponse: rawXml,
    };
  }
}

/**
 * Parse de la respuesta de siResultLoteDE (Schema XML 8, resResultLoteDE_v150).
 *
 * Codigos posibles (Tabla F seccion 9.3.2):
 *   - 0360 = Numero de lote inexistente
 *   - 0361 = Lote en procesamiento
 *   - 0362 = Procesamiento de lote concluido (trae gResProcLote)
 */
async function parseLoteResultResponse(
  rawXml: string,
): Promise<SifenLoteResultResponse> {
  try {
    const parsed = await parseStringPromise(rawXml, {
      explicitArray: false,
      ignoreAttrs: false,
      tagNameProcessors: [(name: string) => name.replace(/.*:/, '')],
    });

    const body = parsed?.Envelope?.Body;
    if (!body) {
      return {
        state: 'unknown',
        responseCode: 'PARSE_ERROR',
        responseMessage: 'SOAP body missing in SIFEN lote result',
        entries: [],
        rawResponse: rawXml,
      };
    }

    const result =
      body.rResEnviConsLoteDe ||
      body.rRetEnviConsLoteDe ||
      body.rRetEnviConsLote ||
      {};
    const responseCode = String(result.dCodResLot ?? 'UNKNOWN');
    const responseMessage = String(result.dMsgResLot ?? 'No message');

    let state: SifenLoteResultResponse['state'];
    if (responseCode === '0360') state = 'not_found';
    else if (responseCode === '0361') state = 'processing';
    else if (responseCode === '0362') state = 'processed';
    else state = 'unknown';

    const entries: SifenLoteResultEntry[] = [];
    if (state === 'processed') {
      const rawEntries = result.gResProcLote
        ? Array.isArray(result.gResProcLote)
          ? result.gResProcLote
          : [result.gResProcLote]
        : [];

      for (const entry of rawEntries) {
        const cdc = String(entry.id ?? '');
        const estado = String(entry.dEstRes ?? '');
        const protocolNumber = entry.dProtAut ? String(entry.dProtAut) : undefined;

        const messages = entry.gResProc
          ? Array.isArray(entry.gResProc)
            ? entry.gResProc
            : [entry.gResProc]
          : [];
        const firstMsg = messages[0] ?? {};

        entries.push({
          cdc,
          estado,
          approved: isApprovedEstado(estado),
          protocolNumber,
          responseCode: String(firstMsg.dCodRes ?? ''),
          responseMessage: String(firstMsg.dMsgRes ?? ''),
        });
      }
    }

    return {
      state,
      responseCode,
      responseMessage,
      entries,
      rawResponse: rawXml,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown parse error';
    return {
      state: 'unknown',
      responseCode: 'PARSE_ERROR',
      responseMessage: `Failed to parse SIFEN lote result: ${message}`,
      entries: [],
      rawResponse: rawXml,
    };
  }
}

/**
 * Envia un lote de DEs firmados a SIFEN (siRecepLoteDE, modo asincrono).
 *
 * @param dispatchId numero secuencial (dId) del envio. 1..15 digitos. El
 *                   contribuyente es responsable de generarlo. El
 *                   dispatcher usa un hash truncado del lote para que
 *                   reintentos generen el mismo dId (idempotencia SIFEN).
 * @param signedDEs  array de XMLs <rDE> firmados, 1..50, mismo tipo y RUC.
 * @param env        'test' | 'prod'.
 * @param mtls       cert + private key PEM ya descifrados.
 * @param signal     AbortSignal opcional para cancelar el request en curso.
 */
export async function sendDELote(
  dispatchId: string,
  signedDEs: string[],
  env: Exclude<SifenEnv, 'demo'>,
  mtls: SifenMtls,
  signal?: AbortSignal,
): Promise<SifenLoteResponse> {
  validateNumericId(dispatchId);
  if (dispatchId.length > 15) {
    throw new Error(`dispatchId excede 15 digitos: ${dispatchId.length}`);
  }
  if (signedDEs.length === 0 || signedDEs.length > 50) {
    throw new Error(
      `sendDELote requiere entre 1 y 50 DEs, recibidos: ${signedDEs.length}`,
    );
  }

  const loteXml = buildLoteInnerXml(signedDEs);
  const xDEBase64 = await buildLoteZipBase64(loteXml);

  const url = `${ENDPOINTS[env]}async/recibe-lote.wsdl`;
  const body = `<rEnvioLote xmlns="${SIFEN_XSD_NS}">
    <dId>${escapeXml(dispatchId)}</dId>
    <xDE>${xDEBase64}</xDE>
  </rEnvioLote>`;

  logger.info(
    `[SIFEN] Sending lote dispatchId=${dispatchId} count=${signedDEs.length} env=${env} bytes=${xDEBase64.length}`,
  );
  const rawResponse = await soapRequestMtls(url, body, mtls, signal);
  return parseLoteResponse(rawResponse);
}

/**
 * Consulta el resultado de un lote enviado previamente con
 * {@link sendDELote} (siResultLoteDE).
 *
 * @param protocolNumber dProtConsLote devuelto por sendDELote. Solo numerico;
 *                       SIFEN prod usa ~18 digitos, sin limite fijo de longitud.
 * @param env            'test' | 'prod'.
 * @param mtls           cert + private key PEM.
 * @param signal         AbortSignal opcional.
 */
export async function consultLote(
  protocolNumber: string,
  env: Exclude<SifenEnv, 'demo'>,
  mtls: SifenMtls,
  signal?: AbortSignal,
): Promise<SifenLoteResultResponse> {
  // dProtConsLote lo asigna SIFEN, no nosotros. En produccion devuelve
  // numeros de 18 digitos (no 15 como el dId que generamos). Solo validamos
  // que sea numerico; cualquier limite de longitud aca cuelga el poll y deja
  // la factura en 'sent' para siempre.
  validateNumericId(protocolNumber);

  const url = `${ENDPOINTS[env]}consultas/consulta-lote.wsdl`;
  const dispatchId = String(Date.now() % 1_000_000_000);
  const body = `<rEnviConsLoteDe xmlns="${SIFEN_XSD_NS}">
    <dId>${dispatchId}</dId>
    <dProtConsLote>${escapeXml(protocolNumber)}</dProtConsLote>
  </rEnviConsLoteDe>`;

  logger.info(
    `[SIFEN] Consulting lote protocol=${protocolNumber} env=${env}`,
  );
  const rawResponse = await soapRequestMtls(url, body, mtls, signal);
  return parseLoteResultResponse(rawResponse);
}
