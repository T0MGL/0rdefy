// One-shot backfill script for migration 181's PART 2.
// Computes correct total_orders, total_spent, last_order_at per customer
// using terminal-success filter (delivered + settled), and writes via
// Supabase service role. Does NOT replace the trigger function (that needs
// SQL deployment). After this runs, future stats will still drift until the
// trigger function is updated; this is the immediate cleanup pass.
//
// Usage:
//   ORDEFY_SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-customer-stats.mjs

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.ORDEFY_SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.ORDEFY_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    'Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars. Export them before running.',
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function fetchAll(query) {
  const all = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

console.log('=== Customer stats backfill (terminal-success filter) ===\n');

const allOrders = await fetchAll(
  supabase
    .from('orders')
    .select('id, customer_id, sleeves_status, total_price, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
);
console.log(`Loaded ${allOrders.length} live orders`);

const customers = await fetchAll(
  supabase.from('customers').select('id, total_orders, total_spent, last_order_at').order('id')
);
console.log(`Loaded ${customers.length} customers`);

// Compute stats per customer
const stats = new Map();
for (const o of allOrders) {
  if (!o.customer_id) continue;
  if (!['delivered', 'settled'].includes(o.sleeves_status)) continue;
  const cur = stats.get(o.customer_id) || { count: 0, spent: 0, last: null };
  cur.count++;
  cur.spent += Number(o.total_price || 0);
  if (!cur.last || o.created_at > cur.last) cur.last = o.created_at;
  stats.set(o.customer_id, cur);
}

let updated = 0;
let unchanged = 0;
let errors = 0;
const totalSpentBefore = customers.reduce((s, c) => s + Number(c.total_spent || 0), 0);
let totalSpentAfter = 0;

for (const c of customers) {
  const s = stats.get(c.id) || { count: 0, spent: 0, last: null };
  totalSpentAfter += s.spent;
  const targetOrders = s.count;
  const targetSpent = s.spent;
  const targetLast = s.last;
  if (
    Number(c.total_orders) === targetOrders &&
    Number(c.total_spent) === targetSpent &&
    (c.last_order_at || null) === targetLast
  ) {
    unchanged++;
    continue;
  }
  const { error } = await supabase
    .from('customers')
    .update({
      total_orders: targetOrders,
      total_spent: targetSpent,
      last_order_at: targetLast,
      updated_at: new Date().toISOString(),
    })
    .eq('id', c.id);
  if (error) {
    errors++;
    console.error(`error updating customer ${c.id}: ${error.message}`);
  } else {
    updated++;
  }
}

console.log(`\nDone:`);
console.log(`  updated: ${updated}`);
console.log(`  unchanged: ${unchanged}`);
console.log(`  errors: ${errors}`);
console.log(`  total_spent BEFORE: ${totalSpentBefore.toLocaleString()}`);
console.log(`  total_spent AFTER:  ${totalSpentAfter.toLocaleString()}`);
console.log(`  inflation removed:  ${(totalSpentBefore - totalSpentAfter).toLocaleString()}`);
