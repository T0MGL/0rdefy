/**
 * Integration tests for the SIFEN dispatcher lote RESERVE step (Bug 1).
 *
 * Bug: when a lote carried >1 invoice for the same identity, the dispatcher
 * wrote the SAME lote-level dispatch_key to every row, violating the partial
 * UNIQUE index uniq_invoices_sifen_lote_dispatch_key (migration 189) on the
 * second row. The whole reserve UPDATE failed and those invoices never sent.
 *
 * Fix: derive a deterministic dispatch_key PER INVOICE from its own signed
 * XML (sha256(xml_signed)). Within one reserve every invoice gets a distinct
 * key (no UNIQUE collision); on a retry of the same lote each invoice
 * regenerates the SAME key, so the UNIQUE still blocks re-claiming an
 * already-dispatched invoice (per-invoice idempotency preserved).
 *
 * These tests mock ../db/connection (supabaseAdmin) with a fake `invoices`
 * table that ENFORCES the partial UNIQUE on sifen_lote_dispatch_key, plus the
 * SIFEN client + invoicing service, and drive the REAL dispatcher code through
 * dispatchLote (via the public drainOnce path).
 *
 * Run with:
 *   npx tsx --test --experimental-test-module-mocks \
 *     api/workers/__tests__/sifen-dispatcher-reserve.test.ts
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'https://stub.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'stub-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'stub-service-role-key';
// Force the auto-dispatch loop OFF; we drive emission via drainOnce only.
delete process.env.SIFEN_AUTO_DISPATCH;

// ---------------------------------------------------------------------------
// Fake `invoices` table modelling the partial UNIQUE on dispatch_key.
// ---------------------------------------------------------------------------

interface InvoiceRow {
  id: string;
  store_id: string;
  identity_id: string;
  document_number: number;
  tipo_documento: number;
  xml_signed: string | null;
  sifen_status: string;
  sifen_lote_dispatch_key: string | null;
  sifen_lote_submitted_at: string | null;
  sifen_lote_next_poll_at: string | null;
  sifen_lote_poll_attempts: number;
  sifen_protocol_number: string | null;
  sifen_response_code: string | null;
  sifen_response_message: string | null;
  sifen_lote_last_error: string | null;
  sent_to_sifen_at: string | null;
  created_at: string;
  fiscal_identities: { sifen_environment: string };
}

class FakeInvoicesDb {
  rows: InvoiceRow[] = [];
  /** Count of reserve UPDATEs that would have collided on the UNIQUE index. */
  uniqueViolations = 0;

  seed(rows: InvoiceRow[]): void {
    this.rows = rows;
    this.uniqueViolations = 0;
  }

  dispatchKeyTaken(key: string, exceptId?: string): boolean {
    return this.rows.some(
      (r) =>
        r.sifen_lote_dispatch_key === key && r.id !== exceptId,
    );
  }

  from(table: string) {
    assert.equal(table, 'invoices');
    return new FakeQuery(this);
  }
}

type Filter = { col: string; op: 'eq' | 'is' | 'in'; val: unknown };

class FakeQuery {
  private mode: 'select' | 'update' = 'select';
  private patch: Record<string, unknown> = {};
  private filters: Filter[] = [];
  private selectCols = '*';

  constructor(private readonly db: FakeInvoicesDb) {}

  select(cols: string): this {
    if (this.mode !== 'update') this.mode = 'select';
    this.selectCols = cols;
    return this;
  }
  update(patch: Record<string, unknown>): this {
    this.mode = 'update';
    this.patch = patch;
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push({ col, op: 'eq', val });
    return this;
  }
  is(col: string, val: unknown): this {
    this.filters.push({ col, op: 'is', val });
    return this;
  }
  in(col: string, val: unknown[]): this {
    this.filters.push({ col, op: 'in', val });
    return this;
  }
  not(): this {
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }

  private matches(row: InvoiceRow): boolean {
    for (const f of this.filters) {
      const cur = (row as unknown as Record<string, unknown>)[f.col];
      if (f.op === 'eq' && cur !== f.val) return false;
      if (f.op === 'is' && cur !== f.val) return false;
      if (f.op === 'in' && !(f.val as unknown[]).includes(cur)) return false;
    }
    return true;
  }

  // The dispatcher awaits the builder directly (it is thenable).
  then(resolve: (v: { data: unknown; error: unknown }) => void): void {
    resolve(this.run());
  }

  private run(): { data: unknown; error: unknown } {
    const matched = this.db.rows.filter((r) => this.matches(r));

    if (this.mode === 'update') {
      // Enforce the partial UNIQUE on sifen_lote_dispatch_key for the
      // per-row reserve UPDATEs.
      const newKey = this.patch.sifen_lote_dispatch_key as string | null;
      if (newKey != null) {
        for (const row of matched) {
          if (this.db.dispatchKeyTaken(newKey, row.id)) {
            this.db.uniqueViolations += 1;
            return {
              data: null,
              error: {
                code: '23505',
                message:
                  'duplicate key value violates unique constraint "uniq_invoices_sifen_lote_dispatch_key"',
              },
            };
          }
        }
      }
      for (const row of matched) Object.assign(row, this.patch);
      return { data: matched.map((r) => ({ id: r.id })), error: null };
    }

    // SELECT: hydrate embedded join exactly like supabase-js (array shape).
    const data = matched.map((r) => ({
      id: r.id,
      store_id: r.store_id,
      identity_id: r.identity_id,
      document_number: r.document_number,
      tipo_documento: r.tipo_documento,
      xml_signed: r.xml_signed,
      sifen_lote_poll_attempts: r.sifen_lote_poll_attempts,
      fiscal_identities: r.fiscal_identities,
    }));
    return { data, error: null };
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const IDENTITY = 'id-bright-commerce';
let sendCalls: Array<{ dispatchId: string; signedDEs: string[] }> = [];

function makeRow(id: string, xml: string): InvoiceRow {
  return {
    id,
    store_id: 'store-1',
    identity_id: IDENTITY,
    document_number: Number(id.replace(/\D/g, '')) || 1,
    tipo_documento: 1,
    xml_signed: xml,
    sifen_status: 'queued',
    sifen_lote_dispatch_key: null,
    sifen_lote_submitted_at: null,
    sifen_lote_next_poll_at: null,
    sifen_lote_poll_attempts: 0,
    sifen_protocol_number: null,
    sifen_response_code: null,
    sifen_response_message: null,
    sifen_lote_last_error: null,
    sent_to_sifen_at: null,
    created_at: '2026-06-01T00:00:00.000Z',
    fiscal_identities: { sifen_environment: 'prod' },
  };
}

const db = new FakeInvoicesDb();

describe('SifenDispatcher reserve (Bug 1: per-invoice dispatch_key)', () => {
  let SifenDispatcher: typeof import('../sifen-dispatcher').SifenDispatcher;

  before(async () => {
    mock.module('../../db/connection', {
      namedExports: {
        supabaseAdmin: { from: (t: string) => db.from(t) },
      },
    });
    mock.module('../../services/sifen/sifen-client', {
      namedExports: {
        sendDELote: async (
          dispatchId: string,
          signedDEs: string[],
        ) => {
          sendCalls.push({ dispatchId, signedDEs });
          return {
            success: true,
            responseCode: '0300',
            responseMessage: 'Lote recibido',
            protocolNumber: '820580922318027570',
            processingTimeSeconds: 60,
          };
        },
      },
    });
    mock.module('../../services/invoicing.service', {
      namedExports: {
        loadCertificateMaterial: async () => ({
          certPem: 'CERT',
          privateKeyPem: 'KEY',
        }),
      },
    });

    ({ SifenDispatcher } = await import('../sifen-dispatcher'));
  });

  beforeEach(() => {
    sendCalls = [];
  });

  function newDispatcher() {
    const fakeListener = { on() {} } as unknown as import('../shared/realtime-listener').SifenRealtimeListener;
    return new SifenDispatcher(fakeListener);
  }

  it('reserves a 3-invoice same-identity lote with DISTINCT keys, no UNIQUE violation', async () => {
    db.seed([
      makeRow('inv-1', '<rDE>ONE</rDE>'),
      makeRow('inv-2', '<rDE>TWO</rDE>'),
      makeRow('inv-3', '<rDE>THREE</rDE>'),
    ]);

    await newDispatcher().drainOnce();

    // No UNIQUE collisions occurred during reserve.
    assert.equal(db.uniqueViolations, 0, 'reserve must not violate the UNIQUE');

    // All three reserved with a NON-null, DISTINCT dispatch_key.
    const keys = db.rows.map((r) => r.sifen_lote_dispatch_key);
    assert.ok(keys.every((k) => typeof k === 'string' && k.length > 0));
    assert.equal(new Set(keys).size, 3, 'each invoice gets its own key');

    // All three were sent in ONE lote (one send call, three DEs).
    assert.equal(sendCalls.length, 1, 'still a single grouped lote send');
    assert.equal(sendCalls[0].signedDEs.length, 3);

    // All three transitioned to 'sent'.
    assert.ok(db.rows.every((r) => r.sifen_status === 'sent'));
  });

  it('derives the key deterministically from each invoice xml_signed', async () => {
    const crypto = await import('crypto');
    const expected = (xml: string) =>
      crypto.createHash('sha256').update(xml).digest('hex').slice(0, 40);

    db.seed([
      makeRow('inv-1', '<rDE>ONE</rDE>'),
      makeRow('inv-2', '<rDE>TWO</rDE>'),
    ]);

    await newDispatcher().drainOnce();

    const byId = new Map(db.rows.map((r) => [r.id, r.sifen_lote_dispatch_key]));
    assert.equal(byId.get('inv-1'), expected('<rDE>ONE</rDE>'));
    assert.equal(byId.get('inv-2'), expected('<rDE>TWO</rDE>'));
  });

  it('blocks re-reserving an already-claimed invoice (per-invoice idempotency)', async () => {
    const crypto = await import('crypto');
    const keyFor = (xml: string) =>
      crypto.createHash('sha256').update(xml).digest('hex').slice(0, 40);

    // inv-1 already claimed by a prior dispatch (same deterministic key it
    // would regenerate), still 'queued' but with dispatch_key set. inv-2 is
    // fresh. Simulates a worker that crashed after claiming inv-1.
    const claimed = makeRow('inv-1', '<rDE>ONE</rDE>');
    claimed.sifen_lote_dispatch_key = keyFor('<rDE>ONE</rDE>');
    const fresh = makeRow('inv-2', '<rDE>TWO</rDE>');
    db.seed([claimed, fresh]);

    await newDispatcher().drainOnce();

    // fetchQueuedInvoices only picks rows with dispatch_key IS NULL, so inv-1
    // is never re-fetched: it stays claimed and is NOT re-sent.
    assert.equal(db.rows.find((r) => r.id === 'inv-1')!.sifen_lote_dispatch_key, keyFor('<rDE>ONE</rDE>'));

    // Only the fresh invoice was sent.
    assert.equal(sendCalls.length, 1);
    assert.deepEqual(sendCalls[0].signedDEs, ['<rDE>TWO</rDE>']);
  });

  it('skips (does not double-send) an invoice whose key collides at reserve time', async () => {
    const crypto = await import('crypto');
    const keyFor = (xml: string) =>
      crypto.createHash('sha256').update(xml).digest('hex').slice(0, 40);

    // Two queued invoices share the SAME signed XML (degenerate but possible
    // on a buggy re-sign). They derive the SAME key, so the second reserve
    // UPDATE hits the UNIQUE: it must be skipped, not abort the whole lote.
    const a = makeRow('inv-dupe-a', '<rDE>SAME</rDE>');
    const b = makeRow('inv-dupe-b', '<rDE>SAME</rDE>');
    // Pre-claim `a` so `b` collides on the shared key during this reserve.
    a.sifen_lote_dispatch_key = null;
    db.seed([a, b]);

    await newDispatcher().drainOnce();

    // Exactly one of them was reserved+sent; the colliding one was skipped.
    const sentCount = db.rows.filter((r) => r.sifen_status === 'sent').length;
    assert.equal(sentCount, 1, 'one reserved, the UNIQUE-colliding one skipped');
    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0].signedDEs.length, 1);
    assert.ok(db.uniqueViolations >= 1, 'the collision was observed and handled');
  });
});
