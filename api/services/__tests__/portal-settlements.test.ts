/**
 * Unit tests for portal-settlements.service validation.
 *
 * Run with:
 *   npx tsx --test api/services/__tests__/portal-settlements.test.ts
 *
 * These tests cover the input-validation surface of closeSettlement,
 * which throws PortalSettlementsError before any Supabase call. No DB
 * fixtures needed. The happy path is covered by the integration test
 * harness that hits a running API with real settlement_payment_proofs
 * fixtures (out of scope for this file).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PortalSettlementsError,
  PROOF_ALLOWED_MIME,
  PROOF_MAX_BYTES,
  validateCloseInput,
  validateProof,
  type CloseSettlementInput,
} from '../../utils/portal-settlements-validators';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const VALID_ORDER_ID = '44444444-4444-4444-4444-444444444444';
const SMALL_JPEG_BUFFER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function baseProof(): { buffer: Buffer; mimetype: string } {
  return { buffer: SMALL_JPEG_BUFFER, mimetype: 'image/jpeg' };
}

function baseCloseInput(): CloseSettlementInput {
  return {
    order_ids: [VALID_ORDER_ID],
    total_amount_collected: 100000,
    payment_method: 'transfer',
    payment_reference: 'TX-2026051712345',
    notes: null,
  };
}

function expectError(
  fn: () => void,
  status: number,
  code: string
): void {
  try {
    fn();
    assert.fail('Expected PortalSettlementsError but got success');
  } catch (err) {
    assert.ok(
      err instanceof PortalSettlementsError,
      `Expected PortalSettlementsError, got ${err instanceof Error ? err.constructor.name : typeof err}`
    );
    assert.equal((err as PortalSettlementsError).status, status, 'status mismatch');
    assert.equal((err as PortalSettlementsError).code, code, 'code mismatch');
  }
}

// ----------------------------------------------------------------------------
// PROOF_ALLOWED_MIME shape sanity
// ----------------------------------------------------------------------------

describe('PROOF_ALLOWED_MIME', () => {
  it('accepts the 4 documented types', () => {
    assert.ok(PROOF_ALLOWED_MIME.has('image/jpeg'));
    assert.ok(PROOF_ALLOWED_MIME.has('image/png'));
    assert.ok(PROOF_ALLOWED_MIME.has('image/webp'));
    assert.ok(PROOF_ALLOWED_MIME.has('application/pdf'));
  });

  it('rejects unknown types', () => {
    assert.ok(!PROOF_ALLOWED_MIME.has('image/gif'));
    assert.ok(!PROOF_ALLOWED_MIME.has('text/plain'));
    assert.ok(!PROOF_ALLOWED_MIME.has('application/octet-stream'));
  });

  it('PROOF_MAX_BYTES is 5 MB', () => {
    assert.equal(PROOF_MAX_BYTES, 5 * 1024 * 1024);
  });
});

// ----------------------------------------------------------------------------
// File validation
// ----------------------------------------------------------------------------

describe('validateProof: file validation', () => {
  it('rejects empty buffer', () => {
    const proof = baseProof();
    proof.buffer = Buffer.alloc(0);
    expectError(() => validateProof(proof), 400, 'EMPTY_FILE');
  });

  it('rejects unsupported mime type', () => {
    const proof = baseProof();
    proof.mimetype = 'image/gif';
    expectError(() => validateProof(proof), 400, 'INVALID_MIME_TYPE');
  });

  it('rejects text/plain', () => {
    const proof = baseProof();
    proof.mimetype = 'text/plain';
    expectError(() => validateProof(proof), 400, 'INVALID_MIME_TYPE');
  });

  it('rejects file larger than 5 MB', () => {
    const proof = baseProof();
    proof.buffer = Buffer.alloc(PROOF_MAX_BYTES + 1);
    proof.mimetype = 'image/jpeg';
    expectError(() => validateProof(proof), 413, 'FILE_TOO_LARGE');
  });

  it('accepts a file at exactly 5 MB', () => {
    const proof = baseProof();
    proof.buffer = Buffer.alloc(PROOF_MAX_BYTES);
    proof.mimetype = 'image/jpeg';
    assert.doesNotThrow(() => validateProof(proof));
  });

  it('accepts the 4 supported mime types', () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
      const proof = { buffer: SMALL_JPEG_BUFFER, mimetype: mime };
      assert.doesNotThrow(() => validateProof(proof), `expected ${mime} to pass`);
    }
  });
});

// ----------------------------------------------------------------------------
// Input validation
// ----------------------------------------------------------------------------

describe('validateCloseInput: input validation', () => {
  it('rejects empty order_ids', () => {
    const input = baseCloseInput();
    input.order_ids = [];
    expectError(() => validateCloseInput(input), 400, 'NO_ORDERS');
  });

  it('rejects order_ids array with more than 1000 items', () => {
    const input = baseCloseInput();
    input.order_ids = Array(1001).fill(VALID_ORDER_ID);
    expectError(() => validateCloseInput(input), 400, 'TOO_MANY_ORDERS');
  });

  it('rejects invalid UUID in order_ids', () => {
    const input = baseCloseInput();
    input.order_ids = ['not-a-uuid'];
    expectError(() => validateCloseInput(input), 400, 'INVALID_ORDER_ID');
  });

  it('rejects empty-string UUID in order_ids', () => {
    const input = baseCloseInput();
    input.order_ids = [''];
    expectError(() => validateCloseInput(input), 400, 'INVALID_ORDER_ID');
  });

  it('rejects negative total_amount_collected', () => {
    const input = baseCloseInput();
    input.total_amount_collected = -1;
    expectError(() => validateCloseInput(input), 400, 'INVALID_AMOUNT');
  });

  it('rejects NaN total_amount_collected', () => {
    const input = baseCloseInput();
    input.total_amount_collected = Number.NaN;
    expectError(() => validateCloseInput(input), 400, 'INVALID_AMOUNT');
  });

  it('rejects unknown payment_method', () => {
    const input = baseCloseInput();
    // @ts-expect-error - intentionally invalid
    input.payment_method = 'bitcoin';
    expectError(() => validateCloseInput(input), 400, 'INVALID_PAYMENT_METHOD');
  });

  it('rejects empty payment_reference', () => {
    const input = baseCloseInput();
    input.payment_reference = '';
    expectError(() => validateCloseInput(input), 400, 'MISSING_PAYMENT_REFERENCE');
  });

  it('rejects whitespace-only payment_reference', () => {
    const input = baseCloseInput();
    input.payment_reference = '    ';
    expectError(() => validateCloseInput(input), 400, 'MISSING_PAYMENT_REFERENCE');
  });

  it('rejects control-char-only payment_reference', () => {
    const input = baseCloseInput();
    input.payment_reference = '\x00\x01\x02';
    expectError(() => validateCloseInput(input), 400, 'MISSING_PAYMENT_REFERENCE');
  });

  it('accepts a valid input', () => {
    const input = baseCloseInput();
    assert.doesNotThrow(() => validateCloseInput(input));
  });

  it('accepts all 4 payment methods', () => {
    for (const method of ['transfer', 'qr', 'cash_deposit', 'other'] as const) {
      const input = baseCloseInput();
      input.payment_method = method;
      assert.doesNotThrow(() => validateCloseInput(input), `expected ${method}`);
    }
  });
});

// ----------------------------------------------------------------------------
// PortalSettlementsError shape
// ----------------------------------------------------------------------------

describe('PortalSettlementsError', () => {
  it('exposes status, code, and message', () => {
    const err = new PortalSettlementsError('Test message', 418, 'TEST_CODE');
    assert.equal(err.status, 418);
    assert.equal(err.code, 'TEST_CODE');
    assert.equal(err.message, 'Test message');
    assert.equal(err.name, 'PortalSettlementsError');
  });

  it('is instanceof Error', () => {
    const err = new PortalSettlementsError('m', 500, 'C');
    assert.ok(err instanceof Error);
  });
});
