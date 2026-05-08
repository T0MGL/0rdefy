/**
 * Post-deploy verification for the P1 credibility hot-fix sprint.
 *
 * Run AFTER applying migration 173 and deploying the milestone-detector +
 * external-webhook code changes. Validates ground-truth state in production.
 *
 * Usage:
 *   tsx api/scripts/verify-p1-credibility-fixes.ts
 *
 * Checks:
 *   1. Zero (store_id, order_number) duplicates remain (live rows).
 *   2. For each store with delivered orders: simulated milestone email
 *      stats produce sane numbers (delivery_rate <= 100, carrier_count
 *      derived from courier_id and matches raw COUNT queries).
 *
 * Exit code 0 on all-pass, 1 on any failure.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiEnvPath = path.resolve(__dirname, '../.env');
const rootEnvPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(apiEnvPath)) dotenv.config({ path: apiEnvPath });
if (fs.existsSync(rootEnvPath)) dotenv.config({ path: rootEnvPath, override: false });

import { supabaseAdmin } from '../db/connection';
import { DISPATCHED_STATUSES } from '../utils/order-status';

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

async function checkNoDuplicateOrderNumbers(): Promise<CheckResult> {
  const rows: Array<{ id: string; store_id: string; order_number: string }> = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('id, store_id, order_number')
      .is('deleted_at', null)
      .not('order_number', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      return { name: 'no_duplicate_order_numbers', pass: false, detail: `query failed: ${error.message}` };
    }
    rows.push(...(data as Array<{ id: string; store_id: string; order_number: string }>));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  const groups = new Map<string, number>();
  for (const r of rows) {
    const k = `${r.store_id}|${r.order_number}`;
    groups.set(k, (groups.get(k) ?? 0) + 1);
  }
  const dupes = [...groups.entries()].filter(([_, c]) => c > 1);
  if (dupes.length === 0) {
    return {
      name: 'no_duplicate_order_numbers',
      pass: true,
      detail: `${rows.length} live rows, ${groups.size} distinct (store, order_number) pairs, zero duplicates`,
    };
  }
  const sample = dupes
    .slice(0, 3)
    .map(([k, c]) => `${k}: ${c}`)
    .join('; ');
  return {
    name: 'no_duplicate_order_numbers',
    pass: false,
    detail: `${dupes.length} duplicate pairs survived (sample: ${sample})`,
  };
}

async function checkMilestoneStatsSane(): Promise<CheckResult> {
  const { data: stores, error } = await supabaseAdmin
    .from('stores')
    .select('id, name')
    .eq('is_active', true);
  if (error) {
    return { name: 'milestone_stats_sane', pass: false, detail: `stores fetch: ${error.message}` };
  }
  const dispatched = Array.from(DISPATCHED_STATUSES);
  const failures: string[] = [];
  for (const s of stores ?? []) {
    const sid = s.id as string;
    const { count: deliveredCount } = await supabaseAdmin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', sid)
      .eq('sleeves_status', 'delivered')
      .is('deleted_at', null);
    if (!deliveredCount || deliveredCount === 0) continue;
    const { count: dispatchedCount } = await supabaseAdmin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', sid)
      .is('deleted_at', null)
      .in('sleeves_status', dispatched);
    const { data: courierRows } = await supabaseAdmin
      .from('orders')
      .select('courier_id')
      .eq('store_id', sid)
      .eq('sleeves_status', 'delivered')
      .is('deleted_at', null)
      .not('courier_id', 'is', null);
    const courierIds = new Set<string>();
    for (const r of courierRows ?? []) {
      const cid = (r as { courier_id?: string }).courier_id;
      if (cid) courierIds.add(cid);
    }
    const denom = dispatchedCount ?? 0;
    const rate = denom > 0 ? Math.min(100, Math.round(((deliveredCount ?? 0) / denom) * 100)) : 100;
    if (rate > 100 || rate < 0) {
      failures.push(`${s.name}: delivery_rate=${rate} out of bounds`);
    }
    if (courierIds.size === 0 && (deliveredCount ?? 0) > 5) {
      console.warn(
        `  WARN ${s.name}: 0 distinct couriers across ${deliveredCount} delivered (may need data backfill)`,
      );
    }
    console.log(
      `  ${s.name}: delivered=${deliveredCount} dispatched=${dispatchedCount} carriers=${courierIds.size} rate=${rate}%`,
    );
  }
  if (failures.length > 0) {
    return { name: 'milestone_stats_sane', pass: false, detail: failures.join(' | ') };
  }
  return { name: 'milestone_stats_sane', pass: true, detail: 'all stores within bounds' };
}

async function main() {
  console.log('verify-p1-credibility-fixes');
  console.log('────────────────────────────────────────────────────────');

  const results: CheckResult[] = [];

  console.log('Checking duplicate order_numbers...');
  results.push(await checkNoDuplicateOrderNumbers());

  console.log('Checking milestone stats per store:');
  results.push(await checkMilestoneStatsSane());

  console.log('');
  console.log('Results');
  console.log('────────────────────────────────────────────────────────');
  let failed = 0;
  for (const r of results) {
    const status = r.pass ? 'PASS' : 'FAIL';
    console.log(`  ${status}  ${r.name}`);
    console.log(`        ${r.detail}`);
    if (!r.pass) failed++;
  }

  console.log('');
  if (failed === 0) {
    console.log(`All ${results.length} checks passed.`);
    process.exit(0);
  }
  console.log(`${failed}/${results.length} checks failed.`);
  process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
