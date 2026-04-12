/**
 * Backfill delivered -> settled + sleeves_status -> status
 *
 * Standalone script. Run with:
 *   tsx scripts/backfill_settled_status.ts --dry-run
 *   tsx scripts/backfill_settled_status.ts --phase=1 --chunk-size=5000
 *   tsx scripts/backfill_settled_status.ts --phase=both
 *
 * Phases:
 *   1 = sleeves_status -> status (only rows where status IS NULL).
 *       Mapping mirrors db/migrations/148c_sleeves_status_cleanup.sql so that
 *       if code is rolled out before 148c, the runtime data is already
 *       consistent with the enum column.
 *   2 = delivered -> settled (orders with reconciled_at and a paid settlement).
 *       Mirrors the SQL backfill inside 148b but runs idempotently from the
 *       app layer in case 148b needed to be chunked across multiple windows.
 *
 * Safety:
 *   - Idempotent: re-runs are a no-op (WHERE filters exclude already migrated
 *     rows).
 *   - Resumable: chunks of 5000 by default, loops until zero rows updated.
 *   - Dry run: --dry-run prints the count that WOULD be updated per chunk
 *     without mutating.
 *
 * Auth:
 *   Uses SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env (bypasses RLS,
 *   required for system-level backfill).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

type Phase = '1' | '2' | 'both';

interface CliArgs {
  dryRun: boolean;
  chunkSize: number;
  phase: Phase;
}

function parseArgs(): CliArgs {
  const args: CliArgs = {
    dryRun: false,
    chunkSize: 5000,
    phase: 'both',
  };

  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg.startsWith('--chunk-size=')) {
      const parsed = Number.parseInt(arg.slice('--chunk-size='.length), 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        throw new Error(`Invalid --chunk-size: ${arg}`);
      }
      args.chunkSize = parsed;
      continue;
    }
    if (arg.startsWith('--phase=')) {
      const value = arg.slice('--phase='.length);
      if (value !== '1' && value !== '2' && value !== 'both') {
        throw new Error(`Invalid --phase: ${value}. Must be 1, 2, or both.`);
      }
      args.phase = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function buildClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('FATAL: SUPABASE_URL env var is required');
  }
  if (!key) {
    throw new Error('FATAL: SUPABASE_SERVICE_ROLE_KEY env var is required');
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const LEGACY_TO_ENUM: Record<string, string> = {
  pending: 'pending',
  contacted: 'pending',
  awaiting_carrier: 'pending',
  confirmed: 'confirmed',
  in_preparation: 'in_preparation',
  ready_to_ship: 'ready_to_ship',
  shipped: 'in_transit',
  in_transit: 'in_transit',
  delivered: 'delivered',
  incident: 'delivered',
  settled: 'settled',
  cancelled: 'cancelled',
  rejected: 'rejected',
  returned: 'returned',
};

function formatNow(): string {
  return new Date().toISOString();
}

async function runPhaseOne(
  client: SupabaseClient,
  chunkSize: number,
  dryRun: boolean,
): Promise<number> {
  console.log(`[${formatNow()}] phase 1: sleeves_status -> status`);

  let total = 0;
  let iteration = 0;
  const maxIterations = 200;

  while (iteration < maxIterations) {
    iteration += 1;

    const { data: rows, error: selectError } = await client
      .from('orders')
      .select('id, sleeves_status')
      .is('status', null)
      .not('sleeves_status', 'is', null)
      .limit(chunkSize);

    if (selectError) {
      throw new Error(`phase 1 select failed: ${selectError.message}`);
    }
    if (!rows || rows.length === 0) {
      break;
    }

    if (dryRun) {
      console.log(
        `[${formatNow()}] phase 1 dry-run iter=${iteration} would update ${rows.length} rows`,
      );
      total += rows.length;
      if (rows.length < chunkSize) {
        break;
      }
      continue;
    }

    const updates = rows.map((row) => {
      const legacy = (row.sleeves_status ?? 'pending') as string;
      const mapped = LEGACY_TO_ENUM[legacy] ?? 'pending';
      return client
        .from('orders')
        .update({ status: mapped })
        .eq('id', row.id)
        .is('status', null);
    });

    const results = await Promise.all(updates);
    const failed = results.filter((r) => r.error !== null);
    if (failed.length > 0) {
      const first = failed[0].error;
      throw new Error(`phase 1 update failed: ${first?.message ?? 'unknown'}`);
    }

    total += rows.length;
    console.log(
      `[${formatNow()}] phase 1 iter=${iteration} updated=${rows.length} total=${total}`,
    );

    if (rows.length < chunkSize) {
      break;
    }
  }

  if (iteration >= maxIterations) {
    throw new Error(`phase 1 exceeded max iterations (${maxIterations})`);
  }

  console.log(`[${formatNow()}] phase 1 complete: migrated ${total} rows`);
  return total;
}

interface PendingSettledRow {
  id: string;
  reconciled_at: string | null;
}

async function runPhaseTwo(
  client: SupabaseClient,
  chunkSize: number,
  dryRun: boolean,
): Promise<number> {
  console.log(`[${formatNow()}] phase 2: delivered -> settled`);

  let total = 0;
  let iteration = 0;
  const maxIterations = 200;

  while (iteration < maxIterations) {
    iteration += 1;

    const { data, error: rpcError } = await client.rpc(
      'select_orders_pending_settle',
      { p_limit: chunkSize },
    );

    let rows: PendingSettledRow[] = [];
    if (rpcError) {
      // Fallback: inline query. The RPC is optional and may not exist. Use a
      // plain select against the indexed partial view set up in 148b.
      const { data: selectRows, error: selectError } = await client
        .from('orders')
        .select('id, reconciled_at, status, settled_at')
        .eq('status', 'delivered')
        .is('settled_at', null)
        .not('reconciled_at', 'is', null)
        .limit(chunkSize);

      if (selectError) {
        throw new Error(`phase 2 select failed: ${selectError.message}`);
      }
      rows = (selectRows ?? []).map((r) => ({
        id: r.id as string,
        reconciled_at: r.reconciled_at as string | null,
      }));
    } else {
      rows = (data ?? []) as PendingSettledRow[];
    }

    if (rows.length === 0) {
      break;
    }

    if (dryRun) {
      console.log(
        `[${formatNow()}] phase 2 dry-run iter=${iteration} would update ${rows.length} rows`,
      );
      total += rows.length;
      if (rows.length < chunkSize) {
        break;
      }
      continue;
    }

    // Note: phase 2 only promotes orders that are linked to a paid settlement.
    // The SQL WHERE filter for that is complex, so we delegate to the
    // promote_orders_to_settled() SQL function per settlement. At the app
    // layer we simply iterate unique settlement ids via the linking tables.
    const promoted = await promoteViaRpc(client, rows.map((r) => r.id));
    total += promoted;

    console.log(
      `[${formatNow()}] phase 2 iter=${iteration} promoted=${promoted} total=${total}`,
    );

    if (rows.length < chunkSize) {
      break;
    }
  }

  if (iteration >= maxIterations) {
    throw new Error(`phase 2 exceeded max iterations (${maxIterations})`);
  }

  console.log(`[${formatNow()}] phase 2 complete: promoted ${total} orders`);
  return total;
}

async function promoteViaRpc(
  client: SupabaseClient,
  orderIds: string[],
): Promise<number> {
  if (orderIds.length === 0) {
    return 0;
  }

  // Find distinct settlement ids linked to these orders (dispatch session path
  // and external carrier path). Call promote_orders_to_settled() per settlement.
  const settlementIds = new Set<string>();

  const { data: dispatchRows, error: dispatchError } = await client
    .from('dispatch_session_orders')
    .select('dispatch_session_id, order_id')
    .in('order_id', orderIds);

  if (dispatchError) {
    throw new Error(`phase 2 dispatch lookup failed: ${dispatchError.message}`);
  }

  const dispatchSessionIds = Array.from(
    new Set((dispatchRows ?? []).map((r) => r.dispatch_session_id as string)),
  );

  if (dispatchSessionIds.length > 0) {
    const { data: sessions, error: sessionsError } = await client
      .from('dispatch_sessions')
      .select('daily_settlement_id')
      .in('id', dispatchSessionIds)
      .not('daily_settlement_id', 'is', null);

    if (sessionsError) {
      throw new Error(`phase 2 session lookup failed: ${sessionsError.message}`);
    }

    for (const row of sessions ?? []) {
      if (row.daily_settlement_id) {
        settlementIds.add(row.daily_settlement_id as string);
      }
    }
  }

  const { data: carrierRows, error: carrierError } = await client
    .from('orders')
    .select('carrier_settlement_id')
    .in('id', orderIds)
    .not('carrier_settlement_id', 'is', null);

  if (carrierError) {
    throw new Error(`phase 2 carrier lookup failed: ${carrierError.message}`);
  }

  for (const row of carrierRows ?? []) {
    if (row.carrier_settlement_id) {
      settlementIds.add(row.carrier_settlement_id as string);
    }
  }

  let promoted = 0;
  for (const settlementId of settlementIds) {
    const { data, error } = await client.rpc('promote_orders_to_settled', {
      p_settlement_id: settlementId,
    });
    if (error) {
      throw new Error(
        `promote_orders_to_settled(${settlementId}) failed: ${error.message}`,
      );
    }
    if (typeof data === 'number') {
      promoted += data;
    }
  }

  return promoted;
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(
    `[${formatNow()}] backfill start: phase=${args.phase} chunkSize=${args.chunkSize} dryRun=${args.dryRun}`,
  );

  const client = buildClient();

  let phaseOneCount = 0;
  let phaseTwoCount = 0;

  if (args.phase === '1' || args.phase === 'both') {
    phaseOneCount = await runPhaseOne(client, args.chunkSize, args.dryRun);
  }
  if (args.phase === '2' || args.phase === 'both') {
    phaseTwoCount = await runPhaseTwo(client, args.chunkSize, args.dryRun);
  }

  console.log('============================================');
  console.log(`backfill complete`);
  console.log(`  phase 1 rows: ${phaseOneCount}`);
  console.log(`  phase 2 rows: ${phaseTwoCount}`);
  console.log(`  mode: ${args.dryRun ? 'dry-run' : 'applied'}`);
  console.log('============================================');
}

main().catch((error) => {
  console.error(`[${formatNow()}] FATAL:`, error);
  process.exit(1);
});
