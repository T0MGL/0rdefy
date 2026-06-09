/**
 * Integration tests for the SIFEN poller consultDE fallback (Bug 2).
 *
 * Bug (observed live): consultLote(protocol) HUNG for the full socket timeout
 * and the poller's cycle abort fired ("SIFEN request aborted") on every
 * attempt for freshly-submitted lotes, even after SET had already approved
 * them. consultDE-by-CDC returned the approved DE in ~1s from the same IP.
 * The poller thus never moved a 'sent' invoice to 'approved' and never fired
 * the approval email.
 *
 * Fix: when consultLote is inconclusive because of a TRANSPORT failure (aborts/
 * times out) or returns 'not_found' while the DE actually exists, fall back to
 * consultDE-per-CDC. If SET reports the DE approved (dEstRes='Aprobado'), the
 * poller moves the invoice to 'approved' and dispatches the email.
 *
 * IMPORTANT (two safety gates exercised here):
 *   1. A clean 'processing' (0361) lote does NOT trigger the fallback. SET said
 *      the lote is still processing; the poller just reschedules with backoff
 *      so it does not hammer SeT with N consultDE calls per poll.
 *   2. consultDE NEVER approves on dCodRes 0422 alone. 0422 only means "CDC
 *      found"; a found-but-Rechazado/Cancelado DE also returns 0422. Approval
 *      is gated on dEstRes='Aprobado'. A found-but-rejected DE must NOT move the
 *      invoice to 'approved' and must NOT fire the customer email.
 *
 * Run with:
 *   npx tsx --test --experimental-test-module-mocks \
 *     api/workers/__tests__/sifen-poller-consultde-fallback.test.ts
 */

import { describe, it, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'https://stub.supabase.co';
process.env.SUPABASE_ANON_KEY ??= 'stub-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'stub-service-role-key';

// ---------------------------------------------------------------------------
// Fake `invoices` table (poller only ever filters/updates this one table).
// ---------------------------------------------------------------------------

interface InvoiceRow {
  id: string;
  store_id: string;
  identity_id: string;
  cdc: string | null;
  document_number: number;
  order_id: string | null;
  sifen_status: string;
  sifen_protocol_number: string | null;
  sifen_lote_poll_attempts: number;
  sifen_lote_next_poll_at: string | null;
  sifen_lote_last_error: string | null;
  sifen_response_code: string | null;
  sifen_response_message: string | null;
  approved_at: string | null;
  fiscal_identities: { sifen_environment: string };
}

class FakeInvoicesDb {
  rows: InvoiceRow[] = [];
  seed(rows: InvoiceRow[]): void {
    this.rows = rows;
  }
  from(table: string) {
    assert.equal(table, 'invoices');
    return new FakeQuery(this);
  }
}

type Filter = { col: string; op: 'eq' | 'is' | 'in' | 'lte' | 'not'; val: unknown };

class FakeQuery {
  private mode: 'select' | 'update' = 'select';
  private patch: Record<string, unknown> = {};
  private filters: Filter[] = [];

  constructor(private readonly db: FakeInvoicesDb) {}

  select(): this {
    if (this.mode !== 'update') this.mode = 'select';
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
  lte(col: string, val: unknown): this {
    this.filters.push({ col, op: 'lte', val });
    return this;
  }
  not(col: string, _op: string, val: unknown): this {
    this.filters.push({ col, op: 'not', val });
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
      if (f.op === 'lte' && !(typeof cur === 'string' && cur <= (f.val as string))) return false;
      // `.not(col,'is',null)` => keep rows where col is NOT null
      if (f.op === 'not' && f.val === null && cur === null) return false;
    }
    return true;
  }

  then(resolve: (v: { data: unknown; error: unknown }) => void): void {
    const matched = this.db.rows.filter((r) => this.matches(r));
    if (this.mode === 'update') {
      for (const row of matched) Object.assign(row, this.patch);
      resolve({ data: matched.map((r) => ({ id: r.id })), error: null });
      return;
    }
    const data = matched.map((r) => ({
      id: r.id,
      store_id: r.store_id,
      identity_id: r.identity_id,
      cdc: r.cdc,
      document_number: r.document_number,
      order_id: r.order_id,
      sifen_status: r.sifen_status,
      sifen_protocol_number: r.sifen_protocol_number,
      sifen_lote_poll_attempts: r.sifen_lote_poll_attempts,
      fiscal_identities: r.fiscal_identities,
    }));
    resolve({ data, error: null });
  }
}

// ---------------------------------------------------------------------------
// Mock controls
// ---------------------------------------------------------------------------

const db = new FakeInvoicesDb();
const CDC = '01801678455001001620627322026041418922542658';
const PROTOCOL = '820580922318027570'; // 18-digit prod protocol

let consultLoteBehavior: 'hang' | 'processing' | 'not_found' | 'processed' = 'hang';

/**
 * Pre-built consultDE result the mock returns. Mirrors what the REAL
 * parseConsultaDEResult produces: `approved` is gated on dEstRes, never on
 * dCodRes 0422 alone. Tests pick a scenario via setConsultDEResult().
 */
type ConsultDEScenario = 'approved' | 'found_rejected' | 'found_no_estado' | 'not_found';
let consultDEScenario: ConsultDEScenario = 'approved';
let consultDECalls = 0;
let emailDispatchCalls: string[] = [];

function consultDEResultFor(scenario: ConsultDEScenario) {
  switch (scenario) {
    case 'approved':
      return {
        approved: true,
        responseCode: '0422', // CDC found
        responseMessage: 'CDC encontrado',
        estado: 'Aprobado',
        protocolNumber: PROTOCOL,
      };
    case 'found_rejected':
      // 0422 (found) but the DE state is Rechazado -> NOT approved.
      return {
        approved: false,
        responseCode: '0422',
        responseMessage: 'CDC encontrado',
        estado: 'Rechazado',
      };
    case 'found_no_estado':
      // 0422 (found) but no parseable dEstRes -> INCONCLUSIVE, not approved.
      return {
        approved: false,
        responseCode: '0422',
        responseMessage: 'CDC encontrado',
        estado: undefined,
      };
    case 'not_found':
      return {
        approved: false,
        responseCode: '0420',
        responseMessage: 'CDC inexistente',
      };
  }
}

function makeRow(): InvoiceRow {
  return {
    id: 'inv-1',
    store_id: 'store-1',
    identity_id: 'identity-1',
    cdc: CDC,
    document_number: 42,
    order_id: 'order-1',
    sifen_status: 'sent',
    sifen_protocol_number: PROTOCOL,
    sifen_lote_poll_attempts: 0,
    sifen_lote_next_poll_at: '2026-06-01T00:00:00.000Z', // due
    sifen_lote_last_error: null,
    sifen_response_code: null,
    sifen_response_message: null,
    approved_at: null,
    fiscal_identities: { sifen_environment: 'prod' },
  };
}

describe('SifenPoller consultDE fallback (Bug 2)', () => {
  let SifenPoller: typeof import('../sifen-poller').SifenPoller;

  before(async () => {
    mock.module('../../db/connection', {
      namedExports: {
        supabaseAdmin: { from: (t: string) => db.from(t) },
      },
    });
    mock.module('../../services/sifen/sifen-client', {
      namedExports: {
        consultLote: async (
          _protocol: string,
          _env: string,
          _mtls: unknown,
          signal?: AbortSignal,
        ) => {
          if (consultLoteBehavior === 'hang') {
            // Emulate the OUTCOME of SET holding the connection past the
            // poller's cycle timeout: the real client rejects with
            // "SIFEN request aborted". We reject immediately so the test does
            // not wait the full POLL_TIMEOUT_MS; the poller code path under
            // test (catch -> loteError -> consultDE fallback) is identical.
            void signal; // signal wiring is exercised in production
            throw new Error('SIFEN request aborted');
          }
          if (consultLoteBehavior === 'processing') {
            return { state: 'processing', responseCode: '0361', responseMessage: 'En proceso', entries: [] };
          }
          if (consultLoteBehavior === 'not_found') {
            return { state: 'not_found', responseCode: '0360', responseMessage: 'Lote inexistente', entries: [] };
          }
          return {
            state: 'processed',
            responseCode: '0362',
            responseMessage: 'Procesado',
            entries: [
              {
                cdc: CDC,
                estado: 'Aprobado',
                approved: true,
                protocolNumber: PROTOCOL,
                responseCode: '0260',
                responseMessage: 'Autorizado',
              },
            ],
          };
        },
        consultDEResult: async (cdc: string) => {
          consultDECalls += 1;
          assert.equal(cdc, CDC);
          return consultDEResultFor(consultDEScenario);
        },
      },
    });
    mock.module('../../services/invoicing.service', {
      namedExports: {
        loadCertificateMaterial: async () => ({ certPem: 'CERT', privateKeyPem: 'KEY' }),
        emitOwnerAlert: async () => {},
        logInvoiceEvent: async () => {},
        dispatchApprovedInvoiceEmail: async (_storeId: string, invoiceId: string) => {
          emailDispatchCalls.push(invoiceId);
          return { dispatched: true };
        },
      },
    });

    ({ SifenPoller } = await import('../sifen-poller'));
  });

  beforeEach(() => {
    consultLoteBehavior = 'hang';
    consultDEScenario = 'approved';
    consultDECalls = 0;
    emailDispatchCalls = [];
    db.seed([makeRow()]);
  });

  function newPoller() {
    const fakeListener = { on() {} } as unknown as import('../shared/realtime-listener').SifenRealtimeListener;
    return new SifenPoller(fakeListener);
  }

  // Drive one cycle through the private processPending via start()->scheduleWake.
  // Simpler: call the internal cycle directly through a tiny cast.
  async function runOneCycle(poller: InstanceType<typeof SifenPoller>): Promise<void> {
    // @ts-expect-error access private for a single deterministic cycle
    poller.running = true;
    // @ts-expect-error access private
    await poller.processPending();
  }

  it('approves via consultDE when consultLote HANGS and aborts', { timeout: 5000 }, async () => {
    consultLoteBehavior = 'hang';
    const poller = newPoller();
    await runOneCycle(poller);

    assert.ok(consultDECalls >= 1, 'fallback consultDE was used');
    const inv = db.rows[0];
    assert.equal(inv.sifen_status, 'approved');
    assert.equal(inv.sifen_response_code, '0422');
    assert.ok(inv.approved_at, 'approved_at set');
    assert.equal(inv.sifen_lote_next_poll_at, null, 'polling stopped');
    assert.deepEqual(emailDispatchCalls, ['inv-1'], 'approval email dispatched');
  });

  it('reschedules WITHOUT the fallback when consultLote stays PROCESSING (0361)', async () => {
    // A clean "still processing" lote is not ambiguous: SET answered. We must
    // NOT fire consultDE here (it would hammer SeT N times per poll and the DE
    // has no final state yet). Just reschedule with backoff.
    consultLoteBehavior = 'processing';
    const poller = newPoller();
    await runOneCycle(poller);

    assert.equal(consultDECalls, 0, 'no fallback on a clean processing lote');
    const inv = db.rows[0];
    assert.equal(inv.sifen_status, 'sent', 'still sent');
    assert.equal(inv.sifen_lote_poll_attempts, 1, 'retry scheduled');
    assert.ok(inv.sifen_lote_next_poll_at, 'next_poll_at set for backoff');
    assert.equal(emailDispatchCalls.length, 0, 'no email while processing');
  });

  it('reschedules (does NOT approve) when consultLote hangs AND consultDE does not find the DE', { timeout: 5000 }, async () => {
    consultLoteBehavior = 'hang';
    consultDEScenario = 'not_found';
    const poller = newPoller();
    await runOneCycle(poller);

    assert.ok(consultDECalls >= 1, 'fallback attempted');
    const inv = db.rows[0];
    assert.equal(inv.sifen_status, 'sent', 'still sent, not approved');
    assert.equal(inv.sifen_lote_poll_attempts, 1, 'retry scheduled');
    assert.ok(inv.sifen_lote_next_poll_at, 'next_poll_at set for backoff');
    assert.equal(emailDispatchCalls.length, 0, 'no email on inconclusive');
  });

  // BLOCKER regression: a found-but-rejected DE (dCodRes 0422, dEstRes
  // 'Rechazado') must NEVER be treated as approved. Before the fix, approving
  // on 0422 alone shipped a false fiscal approval email for a rejected DE.
  it('does NOT approve or email when consultDE returns 0422 found-but-Rechazado', { timeout: 5000 }, async () => {
    consultLoteBehavior = 'hang';
    consultDEScenario = 'found_rejected';
    const poller = newPoller();
    await runOneCycle(poller);

    assert.ok(consultDECalls >= 1, 'fallback attempted');
    const inv = db.rows[0];
    assert.equal(inv.sifen_status, 'sent', 'stays sent, NOT approved on 0422+Rechazado');
    assert.equal(inv.approved_at, null, 'approved_at stays null');
    assert.equal(inv.sifen_lote_poll_attempts, 1, 'reschedules as inconclusive');
    assert.ok(inv.sifen_lote_next_poll_at, 'next_poll_at set for backoff');
    assert.equal(emailDispatchCalls.length, 0, 'no fiscal email for a non-approved DE');
  });

  // BLOCKER regression: 0422 found but dEstRes missing/unparseable is
  // INCONCLUSIVE. Must not approve, must not reject: reschedule with backoff.
  it('treats 0422 found-but-missing-dEstRes as inconclusive (reschedule, no email)', { timeout: 5000 }, async () => {
    consultLoteBehavior = 'hang';
    consultDEScenario = 'found_no_estado';
    const poller = newPoller();
    await runOneCycle(poller);

    assert.ok(consultDECalls >= 1, 'fallback attempted');
    const inv = db.rows[0];
    assert.equal(inv.sifen_status, 'sent', 'stays sent on inconclusive 0422');
    assert.equal(inv.approved_at, null, 'approved_at stays null');
    assert.equal(inv.sifen_lote_poll_attempts, 1, 'reschedules');
    assert.ok(inv.sifen_lote_next_poll_at, 'next_poll_at set for backoff');
    assert.equal(emailDispatchCalls.length, 0, 'no email on inconclusive');
  });

  it('on not_found, resolves via consultDE (approved) instead of marking rejected', async () => {
    consultLoteBehavior = 'not_found';
    consultDEScenario = 'approved';
    const poller = newPoller();
    await runOneCycle(poller);

    assert.ok(consultDECalls >= 1);
    assert.equal(db.rows[0].sifen_status, 'approved', 'approved, not rejected');
    assert.deepEqual(emailDispatchCalls, ['inv-1']);
  });

  it('still applies a concrete processed lote result without needing the fallback', async () => {
    consultLoteBehavior = 'processed';
    const poller = newPoller();
    await runOneCycle(poller);

    assert.equal(consultDECalls, 0, 'no fallback when consultLote is conclusive');
    assert.equal(db.rows[0].sifen_status, 'approved');
    assert.deepEqual(emailDispatchCalls, ['inv-1']);
  });
});
