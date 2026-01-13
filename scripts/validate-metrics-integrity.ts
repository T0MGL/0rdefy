/**
 * ================================================================
 * METRICS INTEGRITY VALIDATOR
 * ================================================================
 * Real-time validation of all metrics calculations
 * Executes: npx ts-node scripts/validate-metrics-integrity.ts --store-id YOUR_STORE_ID
 * ================================================================
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

interface ValidationResult {
  status: 'PASS' | 'FAIL' | 'WARNING';
  section: string;
  message: string;
  details: any;
}

interface CostBreakdown {
  baseCost: number;
  packagingCost: number;
  additionalCosts: number;
  totalUnitCost: number;
}

interface OrderMetrics {
  orderId: string;
  status: string;
  revenue: number;
  productCosts: number;
  shippingCost: number;
  confirmationFee: number;
  totalCosts: number;
  grossMargin: number;
  netMargin: number;
  validation: string;
}

const results: ValidationResult[] = [];
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

// ================================================================
// HELPERS
// ================================================================

function addResult(
  status: 'PASS' | 'FAIL' | 'WARNING',
  section: string,
  message: string,
  details?: any
) {
  results.push({
    status,
    section,
    message,
    details: details || {},
  });
  console.log(`[${status}] ${section}: ${message}`);
  if (details) {
    console.log(`    Details:`, JSON.stringify(details, null, 2));
  }
}

function calculateOrderMetrics(
  order: any,
  storeConfig: any,
  productCostMap: Map<string, CostBreakdown>
): OrderMetrics {
  let productCosts = 0;

  // Calculate product costs from line_items
  if (order.line_items && Array.isArray(order.line_items)) {
    for (const item of order.line_items) {
      const costBreakdown = productCostMap.get(item.product_id) || {
        baseCost: 0,
        packagingCost: 0,
        additionalCosts: 0,
        totalUnitCost: 0,
      };
      productCosts += costBreakdown.totalUnitCost * (item.quantity || 1);
    }
  }

  const shippingCost = Number(order.shipping_cost) || 0;
  const confirmationFee =
    order.sleeves_status === 'confirmed' ||
    (order.sleeves_status && ['in_preparation', 'ready_to_ship', 'shipped', 'delivered'].includes(order.sleeves_status))
      ? storeConfig.confirmation_fee || 0
      : 0;
  const totalCosts = productCosts + shippingCost + confirmationFee;

  const revenue = Number(order.total_price) || 0;
  const grossProfit = revenue - productCosts;
  const netProfit = revenue - totalCosts;

  const grossMargin = revenue > 0 ? ((grossProfit / revenue) * 100) : 0;
  const netMargin = revenue > 0 ? ((netProfit / revenue) * 100) : 0;

  let validation = 'OK';
  if (revenue === 0) validation = 'ERROR: Zero revenue';
  else if (productCosts > revenue) validation = 'ERROR: Costs > Revenue';
  else if (grossProfit < 0) validation = 'ERROR: Negative gross profit';
  else if (grossMargin > 95) validation = 'WARNING: Unusually high margin';
  else if (netMargin < -50) validation = 'WARNING: Huge loss';

  return {
    orderId: order.id,
    status: order.sleeves_status,
    revenue,
    productCosts,
    shippingCost,
    confirmationFee,
    totalCosts,
    grossMargin: Math.round(grossMargin * 10) / 10,
    netMargin: Math.round(netMargin * 10) / 10,
    validation,
  };
}

// ================================================================
// VALIDATION FUNCTIONS
// ================================================================

async function validateBasicIntegrity(storeId: string) {
  console.log('\n=== BASIC INTEGRITY ===');

  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id, store_id, sleeves_status, deleted_at, is_test')
    .eq('store_id', storeId)
    .gte('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString());

  if (ordersError) {
    addResult('FAIL', 'Basic Integrity', `Failed to fetch orders: ${ordersError.message}`);
    return;
  }

  const totalOrders = orders?.length || 0;
  const validOrders = orders?.filter(o => !o.deleted_at && !o.is_test).length || 0;
  const deliveredOrders = orders?.filter(o => o.sleeves_status === 'delivered').length || 0;
  const testOrders = orders?.filter(o => o.is_test).length || 0;
  const deletedOrders = orders?.filter(o => o.deleted_at).length || 0;

  if (validOrders === 0) {
    addResult('WARNING', 'Basic Integrity', 'No valid orders in last 90 days');
  } else {
    addResult('PASS', 'Basic Integrity', `${validOrders} valid orders (${testOrders} test, ${deletedOrders} deleted)`, {
      totalOrders,
      validOrders,
      deliveredOrders,
      testOrders,
      deletedOrders,
    });
  }
}

async function validateCostFields(storeId: string) {
  console.log('\n=== COST FIELDS ===');

  // Check for NULL shipping_cost
  const { data: nullShipping } = await supabase
    .from('orders')
    .select('id')
    .eq('store_id', storeId)
    .is('shipping_cost', null)
    .in('sleeves_status', ['shipped', 'delivered', 'ready_to_ship', 'returned', 'delivery_failed'])
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  if ((nullShipping?.length || 0) > 0) {
    addResult(
      'WARNING',
      'Cost Fields',
      `${nullShipping?.length} orders with NULL shipping_cost`,
      { affectedOrders: nullShipping?.length }
    );
  } else {
    addResult('PASS', 'Cost Fields', 'All orders have valid shipping_cost');
  }

  // Check for NULL product costs
  const { data: nullProductCosts } = await supabase
    .from('products')
    .select('id')
    .eq('store_id', storeId)
    .is('cost', null)
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  if ((nullProductCosts?.length || 0) > 0) {
    addResult(
      'PASS',
      'Cost Fields',
      `${nullProductCosts?.length} products with NULL cost (treated as 0)`,
      { affectedProducts: nullProductCosts?.length }
    );
  }
}

async function validateRevenueMetrics(storeId: string) {
  console.log('\n=== REVENUE METRICS ===');

  const { data: orders } = await supabase
    .from('orders')
    .select('id, total_price, sleeves_status, deleted_at, is_test')
    .eq('store_id', storeId)
    .is('deleted_at', null)
    .eq('is_test', false)
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  if (!orders || orders.length === 0) {
    addResult('WARNING', 'Revenue', 'No orders to analyze');
    return;
  }

  const projectedRevenue = orders.reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);
  const realRevenue = orders
    .filter(o => o.sleeves_status === 'delivered')
    .reduce((sum, o) => sum + (Number(o.total_price) || 0), 0);

  if (realRevenue > projectedRevenue) {
    addResult('FAIL', 'Revenue', 'Real revenue > Projected revenue (logic error)', {
      projected: projectedRevenue,
      real: realRevenue,
    });
  } else {
    const realizationRate = projectedRevenue > 0 ? ((realRevenue / projectedRevenue) * 100).toFixed(1) : '0';
    addResult('PASS', 'Revenue', `Realization rate: ${realizationRate}%`, {
      projectedRevenue,
      realRevenue,
      realizationRate: `${realizationRate}%`,
    });
  }
}

async function validateMarginCalculations(storeId: string) {
  console.log('\n=== MARGIN CALCULATIONS ===');

  const { data: orders } = await supabase
    .from('orders')
    .select('*, line_items')
    .eq('store_id', storeId)
    .eq('sleeves_status', 'delivered')
    .is('deleted_at', null)
    .eq('is_test', false)
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
    .limit(10);

  if (!orders || orders.length === 0) {
    addResult('WARNING', 'Margins', 'No delivered orders to analyze');
    return;
  }

  // Fetch product costs
  const productIds = new Set<string>();
  for (const order of orders) {
    if (order.line_items) {
      for (const item of order.line_items) {
        if (item.product_id) productIds.add(item.product_id);
      }
    }
  }

  const { data: products } = await supabase
    .from('products')
    .select('id, cost, packaging_cost, additional_costs')
    .in('id', Array.from(productIds));

  const productCostMap = new Map<string, CostBreakdown>();
  for (const product of products || []) {
    productCostMap.set(product.id, {
      baseCost: Number(product.cost) || 0,
      packagingCost: Number(product.packaging_cost) || 0,
      additionalCosts: Number(product.additional_costs) || 0,
      totalUnitCost: (Number(product.cost) || 0) + (Number(product.packaging_cost) || 0) + (Number(product.additional_costs) || 0),
    });
  }

  // Fetch store config
  const { data: storeConfig } = await supabase
    .from('store_config')
    .select('confirmation_fee')
    .eq('store_id', storeId)
    .single();

  // Calculate margins for sample orders
  let errorCount = 0;
  let warningCount = 0;
  const metrics: OrderMetrics[] = [];

  for (const order of orders) {
    const metrics_obj = calculateOrderMetrics(order, storeConfig, productCostMap);
    metrics.push(metrics_obj);

    if (metrics_obj.validation.includes('ERROR')) errorCount++;
    else if (metrics_obj.validation.includes('WARNING')) warningCount++;
  }

  if (errorCount > 0) {
    addResult('FAIL', 'Margins', `${errorCount} orders with errors`, { errorOrders: metrics.filter(m => m.validation.includes('ERROR')) });
  } else if (warningCount > 0) {
    addResult('WARNING', 'Margins', `${warningCount} orders with warnings`, {
      warningOrders: metrics.filter(m => m.validation.includes('WARNING')),
    });
  } else {
    const avgGrossMargin = (metrics.reduce((sum, m) => sum + m.grossMargin, 0) / metrics.length).toFixed(1);
    const avgNetMargin = (metrics.reduce((sum, m) => sum + m.netMargin, 0) / metrics.length).toFixed(1);
    addResult('PASS', 'Margins', `All margins valid. Avg Gross: ${avgGrossMargin}%, Avg Net: ${avgNetMargin}%`, {
      sampleCount: metrics.length,
      avgGrossMargin,
      avgNetMargin,
    });
  }
}

async function validateDeliveryMetrics(storeId: string) {
  console.log('\n=== DELIVERY METRICS ===');

  const { data: orders } = await supabase
    .from('orders')
    .select('sleeves_status, shipped_at')
    .eq('store_id', storeId)
    .is('deleted_at', null)
    .eq('is_test', false)
    .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

  if (!orders || orders.length === 0) {
    addResult('WARNING', 'Delivery', 'No orders to analyze');
    return;
  }

  const dispatched = orders.filter(
    o =>
      ['ready_to_ship', 'shipped', 'delivered', 'returned', 'delivery_failed'].includes(o.sleeves_status) ||
      (o.sleeves_status === 'cancelled' && o.shipped_at)
  ).length;

  const delivered = orders.filter(o => o.sleeves_status === 'delivered').length;
  const deliveryRate = dispatched > 0 ? ((delivered / dispatched) * 100).toFixed(1) : '0';

  if (Number(deliveryRate) < 70) {
    addResult('FAIL', 'Delivery', `Low delivery rate: ${deliveryRate}%`, {
      dispatched,
      delivered,
      deliveryRate,
    });
  } else if (Number(deliveryRate) < 85) {
    addResult('WARNING', 'Delivery', `Delivery rate: ${deliveryRate}% (below target 85%)`, {
      dispatched,
      delivered,
      deliveryRate,
    });
  } else {
    addResult('PASS', 'Delivery', `Healthy delivery rate: ${deliveryRate}%`, {
      dispatched,
      delivered,
      deliveryRate,
    });
  }

  // Check for shipped orders without shipped_at
  const shippedNoTimestamp = orders.filter(o => o.sleeves_status === 'shipped' && !o.shipped_at).length;
  if (shippedNoTimestamp > 0) {
    addResult('WARNING', 'Delivery', `${shippedNoTimestamp} shipped orders without shipped_at timestamp`);
  }
}

async function validateAdditionalValues(storeId: string) {
  console.log('\n=== ADDITIONAL VALUES ===');

  const { data: additionalValues } = await supabase
    .from('additional_values')
    .select('type, amount')
    .eq('store_id', storeId)
    .gte('date', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);

  if (!additionalValues || additionalValues.length === 0) {
    addResult('PASS', 'Additional Values', 'No additional values recorded (optional)');
    return;
  }

  const income = additionalValues
    .filter(av => av.type === 'income')
    .reduce((sum, av) => sum + (Number(av.amount) || 0), 0);
  const expense = additionalValues
    .filter(av => av.type === 'expense')
    .reduce((sum, av) => sum + (Number(av.amount) || 0), 0);

  addResult('PASS', 'Additional Values', `Income: ${income}, Expenses: ${expense}`, { income, expense });
}

// ================================================================
// MAIN
// ================================================================

async function main() {
  const args = process.argv.slice(2);
  const storeIdIndex = args.indexOf('--store-id');

  if (storeIdIndex === -1 || !args[storeIdIndex + 1]) {
    console.error('Usage: npx ts-node validate-metrics-integrity.ts --store-id YOUR_STORE_ID');
    process.exit(1);
  }

  const storeId = args[storeIdIndex + 1];
  console.log(`\n🔍 Starting metrics validation for store: ${storeId}\n`);

  try {
    await validateBasicIntegrity(storeId);
    await validateCostFields(storeId);
    await validateRevenueMetrics(storeId);
    await validateMarginCalculations(storeId);
    await validateDeliveryMetrics(storeId);
    await validateAdditionalValues(storeId);

    // Summary
    console.log('\n=== SUMMARY ===\n');
    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const warned = results.filter(r => r.status === 'WARNING').length;

    console.log(`✅ PASSED: ${passed}`);
    console.log(`⚠️  WARNED: ${warned}`);
    console.log(`❌ FAILED: ${failed}`);

    // Save results
    const reportPath = path.join(
      process.cwd(),
      `metrics-validation-${storeId.substring(0, 8)}-${new Date().toISOString().split('T')[0]}.json`
    );
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    console.log(`\n📄 Report saved to: ${reportPath}`);

    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
