// Migration 181 verification script. Pulls orders + customers via service role,
// computes canonical (delivered+settled) vs legacy (NOT IN cancelled, rejected)
// totals per store and per customer, reports inflation removed.
//
// Trigger function body cannot be read via PostgREST. We verify it indirectly:
// the migration 181 backfill (SQL part 2) is deterministic. If customer.total_spent
// in DB equals canonical recomputed total per customer (within rounding), the
// backfill ran and (by audit notice in migration) the trigger was replaced in
// the same BEGIN/COMMIT. If totals diverge, either the migration did not apply
// or new orders changed status post-migration.
//
// Usage:
//   cd /Users/gastonlopez/Documents/Code/PRODUCTION/ORDEFY
//   node scripts/verify-migration-181.mjs

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), 'api/.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function fetchAll(builder) {
  const all = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await builder.range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

const TERMINAL_SUCCESS = new Set(['delivered', 'settled']);
const LEGACY_EXCLUDED = new Set(['cancelled', 'rejected']);

console.log('=== Migration 181 verification ===\n');

const stores = await fetchAll(supabase.from('stores').select('id, name'));
const storeById = new Map(stores.map((s) => [s.id, s.name]));
console.log(`Stores loaded: ${stores.length}`);

const customers = await fetchAll(
  supabase.from('customers').select('id, store_id, total_spent, total_orders, last_order_at'),
);
console.log(`Customers loaded: ${customers.length}`);

const orders = await fetchAll(
  supabase
    .from('orders')
    .select('id, customer_id, store_id, sleeves_status, total_price, created_at, deleted_at')
    .is('deleted_at', null),
);
console.log(`Orders (deleted_at IS NULL) loaded: ${orders.length}\n`);

// Build per-customer canonical (delivered+settled) and legacy (NOT IN cancelled,rejected) totals.
const canonicalByCustomer = new Map();
const legacyByCustomer = new Map();
const canonicalCountByCustomer = new Map();
const legacyCountByCustomer = new Map();
const canonicalLastOrderByCustomer = new Map();

for (const o of orders) {
  if (!o.customer_id) continue;
  const status = (o.sleeves_status || 'pending').toLowerCase();
  const price = Number(o.total_price || 0);

  if (TERMINAL_SUCCESS.has(status)) {
    canonicalByCustomer.set(
      o.customer_id,
      (canonicalByCustomer.get(o.customer_id) || 0) + price,
    );
    canonicalCountByCustomer.set(
      o.customer_id,
      (canonicalCountByCustomer.get(o.customer_id) || 0) + 1,
    );
    const prev = canonicalLastOrderByCustomer.get(o.customer_id);
    if (!prev || new Date(o.created_at) > new Date(prev)) {
      canonicalLastOrderByCustomer.set(o.customer_id, o.created_at);
    }
  }

  if (!LEGACY_EXCLUDED.has(status)) {
    legacyByCustomer.set(
      o.customer_id,
      (legacyByCustomer.get(o.customer_id) || 0) + price,
    );
    legacyCountByCustomer.set(
      o.customer_id,
      (legacyCountByCustomer.get(o.customer_id) || 0) + 1,
    );
  }
}

// 1. Trigger active check (indirect): for every customer, does DB total_spent
//    match canonical recompute? Tolerance 0.01 (PYG/USD rounding).
let driftCount = 0;
const driftSample = [];
for (const c of customers) {
  const canon = canonicalByCustomer.get(c.id) || 0;
  const dbVal = Number(c.total_spent || 0);
  if (Math.abs(canon - dbVal) > 0.01) {
    driftCount += 1;
    if (driftSample.length < 5) {
      driftSample.push({ id: c.id, db: dbVal, canonical: canon, diff: dbVal - canon });
    }
  }
}

console.log('--- Trigger / backfill verification ---');
console.log(`Customers where DB total_spent matches canonical: ${customers.length - driftCount} / ${customers.length}`);
console.log(`Customers with drift: ${driftCount}`);
if (driftSample.length) {
  console.log('Sample drift rows:', JSON.stringify(driftSample, null, 2));
}
console.log();

// 2. Inflation removed per store (focus NOCTE + Solenne by name).
const storeAgg = new Map();
for (const c of customers) {
  const storeName = storeById.get(c.store_id) || c.store_id;
  if (!storeAgg.has(storeName)) {
    storeAgg.set(storeName, {
      customers: 0,
      activeCanonical: 0,
      canonicalTotal: 0,
      legacyTotal: 0,
      inflatedCustomers: 0,
      inflationSum: 0,
    });
  }
  const agg = storeAgg.get(storeName);
  agg.customers += 1;
  const canon = canonicalByCustomer.get(c.id) || 0;
  const legacy = legacyByCustomer.get(c.id) || 0;
  if (canon > 0) agg.activeCanonical += 1;
  agg.canonicalTotal += canon;
  agg.legacyTotal += legacy;
  if (legacy > canon) {
    agg.inflatedCustomers += 1;
    agg.inflationSum += legacy - canon;
  }
}

console.log('--- Per-store: canonical vs legacy ---');
const rows = [];
for (const [name, agg] of [...storeAgg.entries()].sort((a, b) => b[1].canonicalTotal - a[1].canonicalTotal)) {
  rows.push({
    store: name,
    customers: agg.customers,
    active_canonical: agg.activeCanonical,
    canonical_total: Math.round(agg.canonicalTotal),
    legacy_total: Math.round(agg.legacyTotal),
    inflation_removed: Math.round(agg.legacyTotal - agg.canonicalTotal),
    inflation_pct:
      agg.legacyTotal > 0
        ? Number((((agg.legacyTotal - agg.canonicalTotal) / agg.legacyTotal) * 100).toFixed(2))
        : 0,
    inflated_customers: agg.inflatedCustomers,
  });
}
console.table(rows);
console.log();

// 3. Top 10 most inflated customers (legacy - canonical).
const inflated = [];
for (const c of customers) {
  const canon = canonicalByCustomer.get(c.id) || 0;
  const legacy = legacyByCustomer.get(c.id) || 0;
  if (legacy > canon) {
    inflated.push({
      customer_id: c.id,
      store: storeById.get(c.store_id) || c.store_id,
      canonical: Math.round(canon),
      legacy: Math.round(legacy),
      inflation: Math.round(legacy - canon),
      inflation_pct: legacy > 0 ? Number((((legacy - canon) / legacy) * 100).toFixed(1)) : 0,
    });
  }
}
inflated.sort((a, b) => b.inflation - a.inflation);
console.log('--- Top 10 customers by inflation amount ---');
console.table(inflated.slice(0, 10));
console.log();

// 4. Distribution of inflation pct.
const buckets = { gt50: 0, b25_50: 0, b10_25: 0, lt10: 0 };
for (const c of customers) {
  const canon = canonicalByCustomer.get(c.id) || 0;
  const legacy = legacyByCustomer.get(c.id) || 0;
  if (legacy <= canon || legacy <= 0) continue;
  const pct = ((legacy - canon) / legacy) * 100;
  if (pct > 50) buckets.gt50 += 1;
  else if (pct >= 25) buckets.b25_50 += 1;
  else if (pct >= 10) buckets.b10_25 += 1;
  else buckets.lt10 += 1;
}
console.log('--- Inflation pct distribution (customers with any inflation) ---');
console.table([buckets]);
console.log();

// 5. Structural check: sample a pending order with customer assigned, show
//    what the new trigger would do (no write).
const pendingWithCustomer = orders.find(
  (o) =>
    o.customer_id &&
    !TERMINAL_SUCCESS.has((o.sleeves_status || '').toLowerCase()) &&
    !LEGACY_EXCLUDED.has((o.sleeves_status || '').toLowerCase()),
);
if (pendingWithCustomer) {
  const c = customers.find((x) => x.id === pendingWithCustomer.customer_id);
  console.log('--- Structural trigger sample (read-only) ---');
  console.log({
    order_id: pendingWithCustomer.id,
    status: pendingWithCustomer.sleeves_status,
    total_price: pendingWithCustomer.total_price,
    customer_total_spent_now: c?.total_spent,
    customer_total_orders_now: c?.total_orders,
    would_increment_on_settle: 'total_spent += total_price, total_orders += 1 (per migration 181 logic)',
  });
} else {
  console.log('No pending order with customer assigned found (unusual).');
}

console.log('\n=== Verification complete ===');
