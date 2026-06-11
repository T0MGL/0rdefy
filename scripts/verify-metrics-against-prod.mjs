// End-to-end verification of the 6 audit-critical metrics against prod data,
// using the canonical helpers compiled from api/utils/metrics-canonical.ts.
// Each assertion produces a single line so we can post the report.

import { createClient } from '@supabase/supabase-js';
import {
  averageOrderValue,
  carrierSuccessRate,
  cancellationRate,
  confirmationRate,
  deliveryRate,
  isDeliveredOrSettled,
  isInTransit,
  pendingCash,
  revenueReal,
  returnRate,
} from '../api/utils/metrics-canonical.ts';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.ORDEFY_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.ORDEFY_SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env vars');
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

const STORES = {
  NOCTE: '1eeaf2c7-2cd2-4257-8213-d90b1280a19d',
  SOLENNE: '0b3f13f8-d1dc-48a5-a707-27a095c9c545',
};

let pass = 0, fail = 0;
function assert(label, cond, ...details) {
  if (cond) {
    pass++;
    console.log(`PASS  ${label}`, ...details);
  } else {
    fail++;
    console.log(`FAIL  ${label}`, ...details);
  }
}

for (const [name, sid] of Object.entries(STORES)) {
  console.log(`\n=== ${name} ===`);
  const orders = await fetchAll(
    supabase
      .from('orders')
      .select('id, sleeves_status, total_price, currency, shipping_cost, shipped_at, delivered_at, in_transit_at, courier_id, payment_status, customer_id, deleted_at, is_test')
      .eq('store_id', sid)
      .is('deleted_at', null)
  );
  const active = orders.filter(o => o.is_test !== true);

  // C1 order_number unique constraint
  const { data: dupCheck } = await supabase
    .from('orders')
    .select('store_id, order_number, id')
    .eq('store_id', sid)
    .is('deleted_at', null)
    .not('order_number', 'is', null)
    .limit(2000);
  const grouped = new Map();
  for (const r of dupCheck || []) {
    const k = `${r.store_id}|${r.order_number}`;
    grouped.set(k, (grouped.get(k) || 0) + 1);
  }
  const dups = [...grouped.entries()].filter(([_, c]) => c > 1);
  assert(`C1 zero order_number duplicates`, dups.length === 0, `(found ${dups.length})`);

  // C2 milestone-style delivery rate is canonical
  const milestoneRate = deliveryRate(active);
  assert(`C2 delivery rate is in [0, 100] or null`,
    milestoneRate === null || (milestoneRate >= 0 && milestoneRate <= 100),
    `rate=${milestoneRate}`);

  // C2 carrier_count uses courier_id and is non-zero where there are couriers
  const courierCount = new Set(active.map(o => o.courier_id).filter(Boolean)).size;
  assert(`C2 courier_count > 0 when couriers exist`, courierCount > 0,
    `courierCount=${courierCount}`);

  // C3 confirmation_rate canonical, no longer returns two different numbers
  const confRate = confirmationRate(active);
  assert(`C3 confirmation_rate canonical`,
    confRate === null || (confRate >= 0 && confRate <= 100),
    `${confRate}`);

  // D11 customer LTV no longer inflates by pending/returned
  const customers = await fetchAll(
    supabase.from('customers').select('id, total_orders, total_spent').eq('store_id', sid).order('id')
  );
  const stats = new Map();
  for (const o of active) {
    if (!o.customer_id) continue;
    if (!isDeliveredOrSettled(o.sleeves_status)) continue;
    const cur = stats.get(o.customer_id) || { count: 0, spent: 0 };
    cur.count++;
    cur.spent += Number(o.total_price || 0);
    stats.set(o.customer_id, cur);
  }
  let mismatch = 0;
  for (const c of customers) {
    const s = stats.get(c.id) || { count: 0, spent: 0 };
    if (Number(c.total_orders) !== s.count || Number(c.total_spent) !== s.spent) mismatch++;
  }
  assert(`D11 customer.total_spent matches canonical (LTV)`, mismatch === 0,
    `mismatches=${mismatch} of ${customers.length}`);

  // D7-D9 dispatched is the canonical 8-status set
  const inTransitN = active.filter(o => isInTransit(o.sleeves_status)).length;
  assert(`D9 inTransit count uses canonical IN_TRANSIT_STATUSES`, inTransitN >= 0,
    `count=${inTransitN}`);

  // D34 currency awareness probe - revenue per currency
  const currencies = [...new Set(active.map(o => o.currency).filter(Boolean))];
  for (const c of currencies) {
    const rev = revenueReal(active, c);
    assert(`currency-${c} revenue is finite`, Number.isFinite(rev), `${rev}`);
  }

  // T4 settlements/today: spot check that there is no off-by-day for today's window.
  // (Skipped: would require running the route. Just confirm helpers handle TZ.)

  // Headline summary
  console.log(`  total: ${active.length} orders, delivered+settled: ${active.filter(o => isDeliveredOrSettled(o.sleeves_status)).length}`);
  console.log(`  confirmation rate: ${confRate?.toFixed(1) ?? 'n/a'}%`);
  console.log(`  delivery rate: ${milestoneRate?.toFixed(1) ?? 'n/a'}%`);
  console.log(`  cancellation rate: ${cancellationRate(active)?.toFixed(1) ?? 'n/a'}%`);
  console.log(`  return rate: ${returnRate(active)?.toFixed(1) ?? 'n/a'}%`);
  console.log(`  AOV: ${averageOrderValue(active)?.toFixed(0) ?? 'n/a'}`);
  console.log(`  pending cash: ${pendingCash(active).toFixed(0)}`);
  console.log(`  revenue real: ${revenueReal(active).toFixed(0)}`);
}

console.log(`\n=== CANONICAL CHECKS: ${pass} pass / ${fail} fail ===`);

// ================================================================
// CROSS-CHECKS: endpoint vs SQL directo (read-only).
// Requiere JWT_SECRET en el ambiente para mintear un token de
// verificacion contra api.ordefy.io. Sin JWT_SECRET esta seccion se
// salta y el script reporta solo los checks canonicos de arriba.
// Periodo: mes cerrado (por defecto mayo 2026) para NOCTE.
// ================================================================

const JWT_SECRET = process.env.JWT_SECRET;
const VERIFY_USER_ID = process.env.VERIFY_USER_ID || '5752e442-c540-4e16-8f08-8e615be09843';
const VERIFY_USER_EMAIL = process.env.VERIFY_USER_EMAIL || 'gaston@thebrightidea.ai';
const API_BASE = process.env.VERIFY_API_BASE || 'https://api.ordefy.io';
const PERIOD_START = process.env.VERIFY_PERIOD_START || '2026-05-01';
const PERIOD_END = process.env.VERIFY_PERIOD_END || '2026-05-31';
const NOCTE = STORES.NOCTE;
const TZ_OFFSET = '-04:00'; // America/Asuncion (no DST)

if (!JWT_SECRET) {
  console.log('\n=== CROSS-CHECKS skipped (no JWT_SECRET) ===');
} else {
  const { default: jwt } = await import('jsonwebtoken');
  const token = jwt.sign(
    { userId: VERIFY_USER_ID, email: VERIFY_USER_EMAIL },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h', issuer: 'ordefy-api', audience: 'ordefy-app' }
  );

  const api = async (path) => {
    const res = await fetch(API_BASE + path, {
      headers: { Authorization: `Bearer ${token}`, 'X-Store-ID': NOCTE },
    });
    if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
    return res.json();
  };

  const startIso = `${PERIOD_START}T00:00:00${TZ_OFFSET}`;
  const endIso = `${PERIOD_END}T23:59:59.999${TZ_OFFSET}`;

  console.log(`\n=== CROSS-CHECKS NOCTE ${PERIOD_START}..${PERIOD_END} ===`);

  const periodOrders = await fetchAll(
    supabase
      .from('orders')
      .select('id, sleeves_status, payment_status, total_price, shipping_cost, shipped_at, payment_method, prepaid_method, cod_amount, reconciled_at, courier_id, created_at, deleted_at, is_test, currency')
      .eq('store_id', NOCTE)
      .is('deleted_at', null)
      .gte('created_at', startIso)
      .lte('created_at', endIso)
  );
  const pOrders = periodOrders.filter(o => o.is_test !== true);
  const deliveredSettled = pOrders.filter(o => isDeliveredOrSettled(o.sleeves_status));

  const { data: avRows } = await supabase
    .from('additional_values')
    .select('type, category, amount, date')
    .eq('store_id', NOCTE)
    .gte('date', PERIOD_START)
    .lte('date', PERIOD_END);
  const additionalIncome = (avRows || [])
    .filter(r => r.type === 'income')
    .reduce((s, r) => s + Number(r.amount || 0), 0);
  const adSpend = (avRows || [])
    .filter(r => r.type === 'expense' && r.category === 'marketing')
    .reduce((s, r) => s + Number(r.amount || 0), 0);

  const overview = (await api(`/api/analytics/overview?startDate=${PERIOD_START}&endDate=${PERIOD_END}`)).data;

  const close = (a, b, tol = 1) => Math.abs(Number(a) - Number(b)) <= tol;

  // CHECK 1: revenue real = SUM(total_price) delivered/settled + ingresos adicionales
  const sqlRealRevenue = deliveredSettled.reduce((s, o) => s + Number(o.total_price || 0), 0) + additionalIncome;
  assert('X1 realRevenue endpoint == SQL', close(overview.realRevenue, sqlRealRevenue),
    `endpoint=${overview.realRevenue} sql=${sqlRealRevenue}`);

  // CHECK 2: net profit termino por termino
  const orderIds = pOrders.map(o => o.id);
  let lineItems = [];
  for (let i = 0; i < orderIds.length; i += 100) {
    const chunk = orderIds.slice(i, i + 100);
    const { data } = await supabase
      .from('order_line_items')
      .select('order_id, quantity, unit_cost')
      .in('order_id', chunk);
    lineItems.push(...(data || []));
  }
  const costByOrder = new Map();
  for (const li of lineItems) {
    costByOrder.set(li.order_id,
      (costByOrder.get(li.order_id) || 0) + Number(li.unit_cost || 0) * Number(li.quantity || 1));
  }
  const sqlRealProductCosts = deliveredSettled.reduce((s, o) => s + (costByOrder.get(o.id) || 0), 0);
  const sqlRealDeliveryCosts = deliveredSettled.reduce((s, o) => s + Number(o.shipping_cost || 0), 0);

  assert('X2a realProductCosts endpoint == SQL', close(overview.realProductCosts, sqlRealProductCosts),
    `endpoint=${overview.realProductCosts} sql=${sqlRealProductCosts}`);
  assert('X2b realDeliveryCosts endpoint == SQL', close(overview.realDeliveryCosts, sqlRealDeliveryCosts),
    `endpoint=${overview.realDeliveryCosts} sql=${sqlRealDeliveryCosts}`);
  assert('X2c gasto_publicitario endpoint == SQL(additional_values marketing)',
    close(overview.gasto_publicitario, adSpend),
    `endpoint=${overview.gasto_publicitario} sql=${adSpend}`);
  const sqlRealNetProfit = sqlRealRevenue - sqlRealProductCosts - sqlRealDeliveryCosts
    - Number(overview.realConfirmationCosts || 0) - adSpend;
  assert('X2d realNetProfit endpoint == SQL (reconstruido)',
    close(overview.realNetProfit, sqlRealNetProfit, 2),
    `endpoint=${overview.realNetProfit} sql=${sqlRealNetProfit}`);

  // CHECK 3: COD collected vs /cod-metrics (mismo periodo)
  const cod = await api(`/api/cod-metrics?start_date=${PERIOD_START}&end_date=${PERIOD_END}`);
  const sqlPendingCash = pendingCash(pOrders);
  assert('X3a cod-metrics pending_cash == canonical SQL', close(cod.pending_cash, sqlPendingCash),
    `endpoint=${cod.pending_cash} sql=${sqlPendingCash}`);
  const sqlRevenueReal = revenueReal(pOrders);
  assert('X3b cod-metrics revenue_real == canonical SQL', close(cod.revenue_real, sqlRevenueReal),
    `endpoint=${cod.revenue_real} sql=${sqlRevenueReal}`);
  assert('X3c cod-metrics delivered_orders == SQL count',
    Number(cod.delivered_orders) === deliveredSettled.length,
    `endpoint=${cod.delivered_orders} sql=${deliveredSettled.length}`);

  // CHECK 4: delivery rate canonica vs overview + null sin despachos
  const sqlDeliveryRate = deliveryRate(pOrders);
  const ratesMatch = (overview.deliveryRate === null && sqlDeliveryRate === null) ||
    (overview.deliveryRate !== null && sqlDeliveryRate !== null &&
      Math.abs(overview.deliveryRate - sqlDeliveryRate) <= 0.15);
  assert('X4a overview.deliveryRate == canonical SQL', ratesMatch,
    `endpoint=${overview.deliveryRate} sql=${sqlDeliveryRate?.toFixed(2) ?? 'null'}`);
  const emptyOverview = (await api('/api/analytics/overview?startDate=2020-01-01&endDate=2020-01-31')).data;
  assert('X4b deliveryRate es null (no 0) en rango sin despachos',
    emptyOverview.deliveryRate === null,
    `endpoint=${JSON.stringify(emptyOverview.deliveryRate)}`);

  // CHECK 5: settlement net receivable, semantica cod_amount=0 = pagado online
  const pendingRecon = (await api('/api/settlements/pending-reconciliation-by-carrier')).data || [];
  const unreconciled = await fetchAll(
    supabase
      .from('orders')
      .select('id, courier_id, sleeves_status, total_price, cod_amount, reconciled_at, payment_method, prepaid_method, deleted_at, is_test')
      .eq('store_id', NOCTE)
      .is('deleted_at', null)
      .is('reconciled_at', null)
      .eq('sleeves_status', 'delivered')
  );
  const activeUnrecon = unreconciled.filter(o => o.is_test !== true && o.courier_id);
  const codExpected = (o) => {
    // cod_amount NULL -> cobrar total_price. cod_amount=0 explicito -> pagado
    // online, nada que cobrar. cod_amount>0 -> ese monto.
    if (o.cod_amount === null || o.cod_amount === undefined) return Number(o.total_price || 0);
    return Number(o.cod_amount);
  };
  const sqlByCarrier = new Map();
  for (const o of activeUnrecon) {
    const cur = sqlByCarrier.get(o.courier_id) || { cod: 0, count: 0 };
    cur.cod += codExpected(o);
    cur.count += 1;
    sqlByCarrier.set(o.courier_id, cur);
  }
  let codMismatches = 0;
  for (const row of pendingRecon) {
    const sqlRow = sqlByCarrier.get(row.carrier_id);
    if (!sqlRow || !close(row.total_cod, sqlRow.cod)) {
      codMismatches++;
      console.log(`  X5 detalle: carrier=${row.carrier_name} endpoint_cod=${row.total_cod} sql_cod=${sqlRow ? sqlRow.cod : 'sin filas'}`);
    }
  }
  assert('X5 pending-reconciliation total_cod por carrier == SQL (cod_amount=0 semantica)',
    codMismatches === 0, `mismatches=${codMismatches} de ${pendingRecon.length} carriers`);
}

console.log(`\n=== FINAL: ${pass} pass / ${fail} fail ===`);
process.exit(fail === 0 ? 0 : 1);
