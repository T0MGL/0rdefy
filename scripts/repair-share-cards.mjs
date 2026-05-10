// Repair existing share_cards.private_data with canonical metrics. The old
// milestone-detector wrote delivery_rate from a broken denominator
// (in_transit_at IS NOT NULL) and carrier_count from the wrong column
// (carrier_id instead of courier_id). The detector is fixed for new cards;
// this script repairs the historical ones that were already shared publicly
// via /og/wrapped/:token PNG.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.ORDEFY_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.ORDEFY_SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env vars');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const DISPATCHED = ['ready_to_ship', 'shipped', 'in_transit', 'delivered', 'settled', 'returned', 'delivery_failed', 'not_delivered'];

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

const { data: cards, error } = await supabase
  .from('share_cards')
  .select('id, store_id, milestone_value, private_data, created_at');
if (error) {
  console.error(error); process.exit(1);
}
console.log(`Found ${cards.length} share_cards`);

const byStore = new Map();
for (const c of cards) {
  if (!byStore.has(c.store_id)) byStore.set(c.store_id, []);
  byStore.get(c.store_id).push(c);
}

let repaired = 0;
let skipped = 0;
for (const [storeId, storeCards] of byStore.entries()) {
  console.log(`\nStore ${storeId}: ${storeCards.length} cards`);

  // Pull all live orders for this store
  const orders = await fetchAll(
    supabase.from('orders')
      .select('id, sleeves_status, courier_id, shipped_at, total_price, currency, created_at')
      .eq('store_id', storeId)
      .is('deleted_at', null)
  );

  for (const card of storeCards) {
    // Each card was generated at card.created_at. Recompute the stats as they
    // were at that moment so the historical card matches what the merchant
    // would have seen if the formula had been correct.
    const cutoff = card.created_at;
    const eligible = orders.filter(o => o.created_at <= cutoff);
    const delivered = eligible.filter(o => o.sleeves_status === 'delivered' || o.sleeves_status === 'settled').length;
    const dispatched = eligible.filter(o =>
      DISPATCHED.includes(o.sleeves_status) || (o.sleeves_status === 'cancelled' && o.shipped_at)
    ).length;
    const deliveryRate = dispatched > 0 ? Math.min(100, Math.round((delivered / dispatched) * 100)) : 100;

    const deliveredOrders = eligible.filter(o => o.sleeves_status === 'delivered' || o.sleeves_status === 'settled');
    const carrierCount = new Set(deliveredOrders.map(o => o.courier_id).filter(Boolean)).size;

    const old = card.private_data || {};
    const oldDr = Number(old.delivery_rate);
    const oldCarriers = Number(old.carrier_count);

    if (oldDr === deliveryRate && oldCarriers === carrierCount) {
      skipped++;
      continue;
    }

    const newPrivate = {
      ...old,
      delivery_rate: deliveryRate,
      carrier_count: carrierCount,
    };

    const { error: upErr } = await supabase
      .from('share_cards')
      .update({ private_data: newPrivate })
      .eq('id', card.id);
    if (upErr) {
      console.error(`  card ${card.id}: ${upErr.message}`);
    } else {
      console.log(`  milestone=${card.milestone_value} created=${card.created_at}: dr ${oldDr}->${deliveryRate}, carriers ${oldCarriers}->${carrierCount}`);
      repaired++;
    }
  }
}

console.log(`\nDone: repaired=${repaired} skipped=${skipped}`);
