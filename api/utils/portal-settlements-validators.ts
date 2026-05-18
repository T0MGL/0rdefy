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
