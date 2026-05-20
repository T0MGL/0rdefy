/**
 * Pure input validators for the courier-portal settlements close flow.
 *
 * Lives in api/utils/ (not api/services/) so unit tests can exercise
 * the validation surface without instantiating supabase-js. The
 * service module imports these helpers and re-uses them inside its
 * closeSettlement() handler.
 *
 * Why not inline in the service:
 *   The service imports supabaseAdmin, which throws at import time if
 *   SUPABASE_SERVICE_ROLE_KEY is missing. Tests should run without an
 *   .env so we keep validators standalone.
 */

export const PROOF_MAX_BYTES = 5 * 1024 * 1024;

export const PROOF_ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

export const PAYMENT_METHODS = new Set([
  'transfer',
  'qr',
  'cash_deposit',
  'other',
]);

export const PAYMENT_REFERENCE_MAX_LEN = 200;
export const NOTES_MAX_LEN = 2000;
export const MAX_ORDERS_PER_CLOSE = 1000;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CloseSettlementInput {
  order_ids: string[];
  total_amount_collected: number;
  payment_method: 'transfer' | 'qr' | 'cash_deposit' | 'other';
  payment_reference: string;
  notes?: string | null;
}

export class PortalSettlementsError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'PortalSettlementsError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Sanitize free-text input: trim, strip ASCII controls (keep \n\t),
 * cap to maxLen. Returns null if nothing meaningful remains.
 */
export function sanitizeText(input: unknown, maxLen: number): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // eslint-disable-next-line no-control-regex
  const cleaned = trimmed.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '');
  if (!cleaned) return null;
  return cleaned.slice(0, maxLen);
}

export function extensionFromMime(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'application/pdf':
      return '.pdf';
    default:
      return '';
  }
}

/**
 * Detect the actual file type from the first bytes of the buffer.
 *
 * Multer only validates the `mimetype` HEADER, which is fully under the
 * client's control. A user can set `Content-Type: image/jpeg` on a `.html`
 * payload or a PDF with embedded JS and Multer accepts it. For
 * proof-of-payment receipts we don't want to host arbitrary content under a
 * Supabase signed URL (an iframe of a malicious PDF still executes JS).
 *
 * We don't pull in the `file-type` npm package — for our 4 accepted types
 * a hand-written sniffer is ~20 lines and has no supply-chain surface.
 */
function detectMimeFromBuffer(buffer: Buffer): string | null {
  if (!buffer || buffer.length < 4) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WebP: RIFF....WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && // R
    buffer[1] === 0x49 && // I
    buffer[2] === 0x46 && // F
    buffer[3] === 0x46 && // F
    buffer[8] === 0x57 && // W
    buffer[9] === 0x45 && // E
    buffer[10] === 0x42 && // B
    buffer[11] === 0x50    // P
  ) {
    return 'image/webp';
  }

  // PDF: %PDF
  if (
    buffer[0] === 0x25 && // %
    buffer[1] === 0x50 && // P
    buffer[2] === 0x44 && // D
    buffer[3] === 0x46    // F
  ) {
    return 'application/pdf';
  }

  return null;
}

export function validateProof(file: { buffer: Buffer; mimetype: string }): void {
  if (!PROOF_ALLOWED_MIME.has(file.mimetype)) {
    throw new PortalSettlementsError(
      'Tipo de archivo no permitido. Solo JPEG, PNG, WEBP o PDF.',
      400,
      'INVALID_MIME_TYPE'
    );
  }
  if (!file.buffer || file.buffer.length === 0) {
    throw new PortalSettlementsError('El archivo está vacío.', 400, 'EMPTY_FILE');
  }
  if (file.buffer.length > PROOF_MAX_BYTES) {
    throw new PortalSettlementsError(
      'El archivo excede el límite de 5 MB.',
      413,
      'FILE_TOO_LARGE'
    );
  }

  // Magic-byte check: the declared mime must match the actual file content.
  // This blocks executable / script files masquerading as images and PDFs
  // with mismatched extensions used to bypass downstream renderers.
  const sniffed = detectMimeFromBuffer(file.buffer);
  if (!sniffed || sniffed !== file.mimetype) {
    throw new PortalSettlementsError(
      'El archivo no coincide con su tipo declarado.',
      400,
      'MIME_CONTENT_MISMATCH'
    );
  }
}

export function validateCloseInput(input: CloseSettlementInput): void {
  if (!Array.isArray(input.order_ids) || input.order_ids.length === 0) {
    throw new PortalSettlementsError(
      'Seleccioná al menos un pedido para conciliar.',
      400,
      'NO_ORDERS'
    );
  }
  if (input.order_ids.length > MAX_ORDERS_PER_CLOSE) {
    throw new PortalSettlementsError(
      `No se pueden conciliar más de ${MAX_ORDERS_PER_CLOSE} pedidos en un solo cierre.`,
      400,
      'TOO_MANY_ORDERS'
    );
  }
  for (const id of input.order_ids) {
    if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
      throw new PortalSettlementsError(
        'Lista de pedidos inválida.',
        400,
        'INVALID_ORDER_ID'
      );
    }
  }
  if (
    typeof input.total_amount_collected !== 'number' ||
    !Number.isFinite(input.total_amount_collected) ||
    input.total_amount_collected < 0
  ) {
    throw new PortalSettlementsError(
      'El monto total cobrado debe ser un número no negativo.',
      400,
      'INVALID_AMOUNT'
    );
  }
  if (!PAYMENT_METHODS.has(input.payment_method)) {
    throw new PortalSettlementsError(
      'Método de pago inválido.',
      400,
      'INVALID_PAYMENT_METHOD'
    );
  }
  const ref = sanitizeText(input.payment_reference, PAYMENT_REFERENCE_MAX_LEN);
  if (!ref) {
    throw new PortalSettlementsError(
      'La referencia de pago es requerida.',
      400,
      'MISSING_PAYMENT_REFERENCE'
    );
  }
}
