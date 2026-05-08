/**
 * Backfill founder milestone emails for stores that crossed thresholds before
 * the milestone-email feature shipped (commit 8bedeff, 2026-04-30).
 *
 * Why this exists
 *   The milestone detector only fires from the order PATCH path. NOCTE was
 *   already at ~220 delivered orders by the deploy, so transitions made
 *   afterward never hit a clean milestone (1, 10, 50, 100, 250, ...). The
 *   emotional payoff for the early milestones was lost. This script catches
 *   up by emitting the missing milestones in chronological order.
 *
 * Safety
 *   - DRY-RUN BY DEFAULT. Pass --apply explicitly to send.
 *   - Idempotent. Honors founder_emails_sent UNIQUE (store, type, value).
 *     A second run without --force-resend is a no-op.
 *   - Per-store filter via --store-id <uuid> for staged rollouts (NOCTE/Solenne
 *     first, then a full sweep after Gaston signs off).
 *   - Writes a structured plan to stdout in dry-run mode for review.
 *
 * Usage
 *   # See what would be sent for ONE store, do not send
 *   tsx api/scripts/backfill-milestone-emails.ts --store-id <uuid> --dry-run
 *
 *   # Apply for one store after Gaston approves the plan
 *   tsx api/scripts/backfill-milestone-emails.ts --store-id <uuid> --apply
 *
 *   # Full sweep across all stores (only after explicit Gaston OK)
 *   tsx api/scripts/backfill-milestone-emails.ts --all-stores --apply
 *
 *   # Override idempotency (rare, e.g. a partial earlier run)
 *   tsx api/scripts/backfill-milestone-emails.ts --store-id <uuid> --apply --force-resend
 *
 * Exit codes
 *   0   plan generated successfully (dry-run) or send completed (apply)
 *   1   fatal error (bad args, DB unreachable, send failure)
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
import { logger } from '../utils/logger';
import { MILESTONE_VALUES } from '../services/milestone-detector.service';

interface CliArgs {
  mode: 'dry-run' | 'apply';
  storeId?: string;
  allStores: boolean;
  forceResend: boolean;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const args: CliArgs = {
    mode: 'dry-run',
    allStores: false,
    forceResend: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--apply') args.mode = 'apply';
    else if (a === '--dry-run') args.mode = 'dry-run';
    else if (a === '--all-stores') args.allStores = true;
    else if (a === '--force-resend') args.forceResend = true;
    else if (a === '--store-id' && next) {
      args.storeId = next;
      i++;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      printHelp();
      process.exit(1);
    }
  }
  if (!args.storeId && !args.allStores) {
    console.error('ERROR: pass either --store-id <uuid> or --all-stores');
    printHelp();
    process.exit(1);
  }
  return args;
}

function printHelp() {
  console.log('backfill-milestone-emails.ts');
  console.log('  --store-id <uuid>     Restrict to one store');
  console.log('  --all-stores          Sweep every store (mutually exclusive with --store-id)');
  console.log('  --dry-run             (default) Print plan, send nothing');
  console.log('  --apply               Send the emails');
  console.log('  --force-resend        Ignore founder_emails_sent dedupe');
  console.log('  -h, --help            This help');
}

interface StorePlan {
  storeId: string;
  storeName: string;
  ownerEmail: string;
  deliveredCount: number;
  milestonesToSend: number[];
  milestonesAlreadySent: number[];
}

async function fetchStores(args: CliArgs): Promise<Array<{ id: string; name: string }>> {
  let builder = supabaseAdmin
    .from('stores')
    .select('id, name')
    .eq('is_active', true);
  if (args.storeId) builder = builder.eq('id', args.storeId);
  const { data, error } = await builder;
  if (error) throw new Error(`fetchStores failed: ${error.message}`);
  return (data ?? []).map((s) => ({ id: s.id as string, name: (s.name as string) ?? 'Tienda' }));
}

async function countDeliveredOrders(storeId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .eq('sleeves_status', 'delivered')
    .is('deleted_at', null);
  if (error) {
    logger.warn('BACKFILL', `count delivered failed for ${storeId}: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}

async function alreadySentMilestones(storeId: string): Promise<Set<number>> {
  const { data, error } = await supabaseAdmin
    .from('founder_emails_sent')
    .select('milestone_value')
    .eq('store_id', storeId)
    .eq('email_type', 'milestone');
  if (error) {
    logger.warn('BACKFILL', `fetch sent milestones failed for ${storeId}: ${error.message}`);
    return new Set();
  }
  const out = new Set<number>();
  for (const row of data ?? []) {
    if (typeof row.milestone_value === 'number') out.add(row.milestone_value);
  }
  return out;
}

async function resolveOwnerEmail(storeId: string): Promise<string | null> {
  const { data: link } = await supabaseAdmin
    .from('user_stores')
    .select('user_id')
    .eq('store_id', storeId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!link?.user_id) return null;
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('email')
    .eq('id', link.user_id)
    .maybeSingle();
  return (user?.email as string) ?? null;
}

async function buildPlan(args: CliArgs): Promise<StorePlan[]> {
  const stores = await fetchStores(args);
  const plans: StorePlan[] = [];
  for (const s of stores) {
    const delivered = await countDeliveredOrders(s.id);
    if (delivered <= 0) continue;
    const sent = args.forceResend ? new Set<number>() : await alreadySentMilestones(s.id);
    const eligible = MILESTONE_VALUES.filter((m) => m <= delivered && !sent.has(m));
    if (eligible.length === 0) continue;
    const ownerEmail = await resolveOwnerEmail(s.id);
    if (!ownerEmail) {
      logger.warn('BACKFILL', `store ${s.id} (${s.name}) has no owner email, skipping`);
      continue;
    }
    plans.push({
      storeId: s.id,
      storeName: s.name,
      ownerEmail,
      deliveredCount: delivered,
      milestonesToSend: [...eligible],
      milestonesAlreadySent: [...sent].sort((a, b) => a - b),
    });
  }
  return plans;
}

function printPlan(plans: StorePlan[]): void {
  if (plans.length === 0) {
    console.log('Plan: nothing to send. All eligible milestones already sent or no delivered orders.');
    return;
  }
  console.log('Plan');
  console.log('────────────────────────────────────────────────────────────────────');
  let totalEmails = 0;
  for (const p of plans) {
    console.log(`  store_id   : ${p.storeId}`);
    console.log(`  store_name : ${p.storeName}`);
    console.log(`  owner      : ${p.ownerEmail}`);
    console.log(`  delivered  : ${p.deliveredCount}`);
    console.log(`  to_send    : [${p.milestonesToSend.join(', ')}]   (${p.milestonesToSend.length} email${p.milestonesToSend.length === 1 ? '' : 's'})`);
    console.log(`  already    : [${p.milestonesAlreadySent.join(', ')}]`);
    console.log('  ────');
    totalEmails += p.milestonesToSend.length;
  }
  console.log(`Total emails that would be sent: ${totalEmails} across ${plans.length} store${plans.length === 1 ? '' : 's'}`);
}

/**
 * Apply the plan: for each (store, milestone) emit a real email by
 * temporarily forcing the delivered-count to the milestone value via the
 * milestone-detector path, then inserting the founder_emails_sent row.
 *
 * We bypass the count short-circuit by importing the inner helpers directly
 * (re-exported via __backfill below). For each milestone we compute stats
 * "as of right now" rather than as-of historical delivery date. This is a
 * deliberate trade-off: stats reflect today's product/courier diversity,
 * which is more accurate than historical reconstruction and avoids the
 * complexity of point-in-time aggregation. The first-order date is correct
 * because it pulls the earliest order regardless of milestone.
 */
async function applyPlan(plans: StorePlan[]): Promise<{ ok: number; failed: number }> {
  const detector = await import('../services/milestone-detector.service');
  const sendMilestone = (detector as any).__sendBackfillMilestone as
    | ((args: { storeId: string; milestoneValue: number }) => Promise<{ ok: boolean; reason?: string }>)
    | undefined;
  if (!sendMilestone) {
    throw new Error('milestone-detector.service.__sendBackfillMilestone is not exported. Did you run on the right branch?');
  }
  let ok = 0;
  let failed = 0;
  for (const p of plans) {
    for (const m of p.milestonesToSend) {
      const result = await sendMilestone({ storeId: p.storeId, milestoneValue: m });
      if (result.ok) {
        console.log(`  SENT     store=${p.storeName} value=${m}`);
        ok++;
      } else {
        console.log(`  FAILED   store=${p.storeName} value=${m} reason=${result.reason}`);
        failed++;
      }
    }
  }
  return { ok, failed };
}

async function main() {
  const args = parseArgs();
  console.log('backfill-milestone-emails');
  console.log(`  mode          : ${args.mode}`);
  console.log(`  store-id      : ${args.storeId ?? '(all stores)'}`);
  console.log(`  force-resend  : ${args.forceResend}`);
  console.log('');

  const plans = await buildPlan(args);
  printPlan(plans);

  if (args.mode === 'dry-run') {
    console.log('');
    console.log('Dry-run only. To send these emails, re-run with --apply.');
    return;
  }

  console.log('');
  console.log(`Applying plan (${plans.reduce((acc, p) => acc + p.milestonesToSend.length, 0)} emails)...`);
  const summary = await applyPlan(plans);
  console.log('');
  console.log(`Done. ok=${summary.ok} failed=${summary.failed}`);
  if (summary.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
