// ================================================================
// ORDEFY COMPREHENSIVE HEALTH CHECK SCRIPT
// Ejecuta verificaciones exhaustivas de integridad de datos
// ================================================================

import { supabaseAdmin } from '../api/db/connection';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ================================================================
// TYPES
// ================================================================

interface HealthCheckResult {
  category: string;
  status: 'OK' | 'WARNING' | 'CRITICAL';
  message: string;
  details?: any;
  count?: number;
}

interface HealthReport {
  timestamp: string;
  store: {
    id: string;
    name: string;
    owner_email: string;
  };
  summary: {
    total_checks: number;
    ok: number;
    warnings: number;
    critical: number;
    overall_status: 'OK' | 'WARNING' | 'CRITICAL';
  };
  checks: HealthCheckResult[];
}

// ================================================================
// CONFIGURATION
// ================================================================

const OWNER_EMAIL = 'gaston@thebrightidea.ai';
const OUTPUT_DIR = path.join(__dirname, '../health-reports');

// ================================================================
// UTILITY FUNCTIONS
// ================================================================

function getStatus(critical: number, warnings: number): 'OK' | 'WARNING' | 'CRITICAL' {
  if (critical > 0) return 'CRITICAL';
  if (warnings > 0) return 'WARNING';
  return 'OK';
}

function logCheck(category: string, status: 'OK' | 'WARNING' | 'CRITICAL', message: string, count?: number) {
  const icon = status === 'OK' ? '✅' : status === 'WARNING' ? '⚠️' : '❌';
  const countStr = count !== undefined ? ` (${count})` : '';
  console.log(`${icon} [${category}] ${message}${countStr}`);
}

// ================================================================
// HEALTH CHECK FUNCTIONS
// ================================================================

async function getStoreInfo(email: string, storeName?: string) {
  const { data: user, error: userError } = await supabaseAdmin
    .from('users')
    .select('id, email')
    .eq('email', email)
    .single();

  if (userError || !user) {
    throw new Error(`Usuario no encontrado: ${email}`);
  }

  const { data: userStores, error: storeError } = await supabaseAdmin
    .from('user_stores')
    .select('store_id, role')
    .eq('user_id', user.id);

  if (storeError || !userStores || userStores.length === 0) {
    throw new Error(`Tienda no encontrada para usuario: ${email}`);
  }

  // Obtener info de todas las stores
  const storeIds = userStores.map(us => us.store_id);
  const { data: stores, error: storesError } = await supabaseAdmin
    .from('stores')
    .select('id, name')
    .in('id', storeIds);

  if (storesError || !stores || stores.length === 0) {
    throw new Error('No se pudo obtener información de las tiendas');
  }

  // Si se especificó un nombre de store, buscarla
  let selectedStore = stores[0];
  if (storeName) {
    const found = stores.find(s => s.name.toLowerCase().includes(storeName.toLowerCase()));
    if (found) {
      selectedStore = found;
    } else {
      console.warn(`⚠️  Store "${storeName}" no encontrada, usando: ${selectedStore.name}`);
    }
  } else if (stores.length > 1) {
    console.log(`ℹ️  Usuario tiene ${stores.length} stores. Usando: ${selectedStore.name}`);
    console.log(`   Otras stores: ${stores.slice(1).map(s => s.name).join(', ')}`);
  }

  return {
    id: selectedStore.id,
    name: selectedStore.name,
    owner_email: email
  };
}

async function checkInventoryIntegrity(storeId: string): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  // 1.1 Stock negativo
  const { data: negativeStock, error: e1 } = await supabaseAdmin
    .from('products')
    .select('id, name, sku, stock')
    .eq('store_id', storeId)
    .lt('stock', 0);

  if (!e1) {
    const count = negativeStock?.length || 0;
    const status = count > 0 ? 'CRITICAL' : 'OK';
    results.push({
      category: 'Inventory',
      status,
      message: count > 0 ? `Productos con stock negativo detectados` : 'Stock levels are healthy',
      count,
      details: count > 0 ? negativeStock : undefined
    });
    logCheck('Inventory', status, 'Stock negativo', count);
  }

  // 1.2 Discrepancias en inventory_movements
  let movementDiscrepancies = null;
  try {
    const response = await supabaseAdmin.rpc(
      'check_inventory_discrepancies',
      { p_store_id: storeId }
    );
    movementDiscrepancies = response.data;
  } catch (err) {
    // Graceful fallback si no existe la función
    movementDiscrepancies = null;
  }

  if (movementDiscrepancies && Array.isArray(movementDiscrepancies)) {
    const count = movementDiscrepancies.length;
    const status = count > 5 ? 'CRITICAL' : count > 0 ? 'WARNING' : 'OK';
    results.push({
      category: 'Inventory',
      status,
      message: count > 0 ? `Discrepancias entre inventory_movements y stock actual` : 'Inventory movements match current stock',
      count,
      details: count > 0 ? movementDiscrepancies.slice(0, 10) : undefined
    });
    logCheck('Inventory', status, 'Discrepancias de movimientos', count);
  }

  // 1.3 Órdenes sin deducción de stock
  const { data: ordersWithoutDeduction, error: e3 } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, shopify_order_name, sleeves_status, updated_at')
    .eq('store_id', storeId)
    .in('sleeves_status', ['ready_to_ship', 'shipped', 'delivered', 'in_transit'])
    .limit(50);

  if (!e3 && ordersWithoutDeduction) {
    // Para cada orden, verificar si tiene inventory_movements de tipo order_*
    // El trigger usa 'order_' || sleeves_status como movement_type
    const ordersWithoutStock = [];
    for (const order of ordersWithoutDeduction) {
      const { data: movements } = await supabaseAdmin
        .from('inventory_movements')
        .select('id')
        .eq('order_id', order.id)
        .in('movement_type', ['order_ready_to_ship', 'order_shipped', 'order_delivered', 'order_in_transit'])
        .limit(1);

      if (!movements || movements.length === 0) {
        ordersWithoutStock.push(order);
      }
    }

    const count = ordersWithoutStock.length;
    const status = count > 10 ? 'CRITICAL' : count > 0 ? 'WARNING' : 'OK';
    results.push({
      category: 'Inventory',
      status,
      message: count > 0 ? `Órdenes shipped/delivered sin deducción de stock` : 'All shipped orders have stock deducted',
      count,
      details: count > 0 ? ordersWithoutStock.slice(0, 10) : undefined
    });
    logCheck('Inventory', status, 'Órdenes sin deducción', count);
  }

  return results;
}

async function checkOrderIntegrity(storeId: string): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  // 2.1 Órdenes shipped sin transportadora (y que no son pickup)
  const { data: ordersWithoutCarrier, error: e1 } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, shopify_order_name, sleeves_status, courier_id, is_pickup')
    .eq('store_id', storeId)
    .in('sleeves_status', ['shipped', 'delivered'])
    .is('courier_id', null)
    .eq('is_pickup', false);

  if (!e1) {
    const count = ordersWithoutCarrier?.length || 0;
    const status = count > 5 ? 'CRITICAL' : count > 0 ? 'WARNING' : 'OK';
    results.push({
      category: 'Orders',
      status,
      message: count > 0 ? `Órdenes enviadas sin transportadora asignada` : 'All shipped orders have carriers',
      count,
      details: count > 0 ? ordersWithoutCarrier : undefined
    });
    logCheck('Orders', status, 'Shipped sin carrier', count);
  }

  // 2.2 Órdenes pendientes antiguas (>30 días)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: oldPendingOrders, error: e2 } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, shopify_order_name, created_at')
    .eq('store_id', storeId)
    .eq('sleeves_status', 'pending')
    .lt('created_at', thirtyDaysAgo.toISOString());

  if (!e2) {
    const count = oldPendingOrders?.length || 0;
    const status = count > 10 ? 'WARNING' : 'OK';
    results.push({
      category: 'Orders',
      status,
      message: count > 0 ? `Órdenes pendientes por más de 30 días` : 'No old pending orders',
      count,
      details: count > 0 ? oldPendingOrders.slice(0, 10) : undefined
    });
    logCheck('Orders', status, 'Pendientes antiguas', count);
  }

  // 2.3 Órdenes en in_preparation sin sesión de picking activa
  const { data: ordersInPrepWithoutSession, error: e3 } = await supabaseAdmin
    .from('orders')
    .select(`
      id,
      order_number,
      shopify_order_name,
      sleeves_status,
      picking_session_orders!inner(
        session_id,
        picking_sessions!inner(status)
      )
    `)
    .eq('store_id', storeId)
    .eq('sleeves_status', 'in_preparation');

  if (!e3 && ordersInPrepWithoutSession) {
    // Filtrar solo las que no tienen sesión activa
    const problematic = ordersInPrepWithoutSession.filter((order: any) => {
      const sessions = order.picking_session_orders || [];
      return sessions.length === 0 || !sessions.some((pso: any) =>
        pso.picking_sessions?.status && ['in_progress', 'picking', 'packing'].includes(pso.picking_sessions.status)
      );
    });

    const count = problematic.length;
    const status = count > 5 ? 'WARNING' : 'OK';
    results.push({
      category: 'Orders',
      status,
      message: count > 0 ? `Órdenes en preparación sin sesión activa` : 'All in_preparation orders have active sessions',
      count,
      details: count > 0 ? problematic.slice(0, 10) : undefined
    });
    logCheck('Orders', status, 'In prep sin sesión', count);
  }

  return results;
}

async function checkWarehouseIntegrity(storeId: string): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  // 3.1 Sesiones estancadas (>48h)
  const fortyEightHoursAgo = new Date();
  fortyEightHoursAgo.setHours(fortyEightHoursAgo.getHours() - 48);

  const { data: staleSessions, error: e1 } = await supabaseAdmin
    .from('picking_sessions')
    .select('id, session_code, status, last_activity_at')
    .eq('store_id', storeId)
    .in('status', ['in_progress', 'picking', 'packing'])
    .lt('last_activity_at', fortyEightHoursAgo.toISOString());

  if (!e1) {
    const count = staleSessions?.length || 0;
    const status = count > 0 ? 'CRITICAL' : 'OK';
    results.push({
      category: 'Warehouse',
      status,
      message: count > 0 ? `Sesiones de picking estancadas (>48h inactivas)` : 'All picking sessions are active',
      count,
      details: count > 0 ? staleSessions : undefined
    });
    logCheck('Warehouse', status, 'Sesiones estancadas', count);
  }

  // 3.2 Órdenes huérfanas en sesiones (estados incompatibles)
  const { data: orphanedOrders, error: e2 } = await supabaseAdmin
    .from('picking_session_orders')
    .select(`
      session_id,
      order_id,
      picking_sessions!inner(session_code, status),
      orders!inner(order_number, shopify_order_name, sleeves_status)
    `)
    .eq('picking_sessions.store_id', storeId)
    .in('picking_sessions.status', ['in_progress', 'picking', 'packing']);

  if (!e2 && orphanedOrders) {
    // Filtrar órdenes con estados incompatibles
    const problematic = orphanedOrders.filter((item: any) => {
      const orderStatus = item.orders?.sleeves_status;
      return orderStatus && !['confirmed', 'in_preparation', 'ready_to_ship'].includes(orderStatus);
    });

    const count = problematic.length;
    const status = count > 0 ? 'CRITICAL' : 'OK';
    results.push({
      category: 'Warehouse',
      status,
      message: count > 0 ? `Órdenes en sesiones con estados incompatibles (debería auto-limpiarse)` : 'No orphaned orders in sessions',
      count,
      details: count > 0 ? problematic.slice(0, 10) : undefined
    });
    logCheck('Warehouse', status, 'Órdenes huérfanas', count);
  }

  // 3.3 Progreso de empaquetado inconsistente (packed > picked)
  const { data: overpackedItems, error: e3 } = await supabaseAdmin
    .from('packing_progress')
    .select(`
      session_id,
      product_id,
      variant_id,
      quantity_packed,
      picking_sessions!inner(session_code, store_id),
      products!inner(name)
    `)
    .eq('picking_sessions.store_id', storeId);

  if (!e3 && overpackedItems) {
    // Para cada item, verificar contra picking_session_items
    const problematic = [];
    for (const item of overpackedItems.slice(0, 20)) { // Limitar para no hacer demasiadas queries
      const { data: pickingItem } = await supabaseAdmin
        .from('picking_session_items')
        .select('quantity_picked')
        .eq('session_id', item.session_id)
        .eq('product_id', item.product_id)
        .eq('variant_id', item.variant_id || null)
        .single();

      if (pickingItem && item.quantity_packed > pickingItem.quantity_picked) {
        problematic.push({
          ...item,
          quantity_picked: pickingItem.quantity_picked,
          overpacked: item.quantity_packed - pickingItem.quantity_picked
        });
      }
    }

    const count = problematic.length;
    const status = count > 0 ? 'WARNING' : 'OK';
    results.push({
      category: 'Warehouse',
      status,
      message: count > 0 ? `Items con cantidad empaquetada > pickada` : 'Packing quantities are consistent',
      count,
      details: count > 0 ? problematic : undefined
    });
    logCheck('Warehouse', status, 'Overpacking', count);
  }

  return results;
}

async function checkSettlementsIntegrity(storeId: string): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  // 4.1 Cálculos de net_receivable
  const { data: settlements, error: e1 } = await supabaseAdmin
    .from('dispatch_sessions')
    .select('id, session_code, total_cod_collected, carrier_fees_cod, carrier_fees_prepaid, failed_attempt_fees, net_receivable')
    .eq('store_id', storeId)
    .in('status', ['processing', 'settled']);

  if (!e1 && settlements) {
    const problematic = settlements.filter(s => {
      const calculated = (s.total_cod_collected || 0) - (s.carrier_fees_cod || 0) - (s.carrier_fees_prepaid || 0) - (s.failed_attempt_fees || 0);
      const discrepancy = Math.abs((s.net_receivable || 0) - calculated);
      return discrepancy > 100; // Tolerancia de 100 Gs
    });

    const count = problematic.length;
    const status = count > 0 ? 'CRITICAL' : 'OK';
    results.push({
      category: 'Settlements',
      status,
      message: count > 0 ? `Sesiones de despacho con cálculos incorrectos de net_receivable` : 'Settlement calculations are correct',
      count,
      details: count > 0 ? problematic : undefined
    });
    logCheck('Settlements', status, 'Cálculos incorrectos', count);
  }

  // 4.2 Órdenes duplicadas en sesiones de despacho
  let duplicateOrders = null;
  try {
    const response = await supabaseAdmin.rpc(
      'find_duplicate_dispatch_orders',
      { p_store_id: storeId }
    );
    duplicateOrders = response.data;
  } catch (err) {
    // Graceful fallback
    duplicateOrders = null;
  }

  if (duplicateOrders && Array.isArray(duplicateOrders)) {
    const count = duplicateOrders.length;
    const status = count > 0 ? 'CRITICAL' : 'OK';
    results.push({
      category: 'Settlements',
      status,
      message: count > 0 ? `Órdenes en múltiples sesiones de despacho activas` : 'No duplicate orders in dispatch sessions',
      count,
      details: count > 0 ? duplicateOrders : undefined
    });
    logCheck('Settlements', status, 'Órdenes duplicadas', count);
  }

  return results;
}

async function checkShopifySyncStatus(storeId: string): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  // 6.1 Productos con sync_status error
  const { data: errorProducts, error: e1 } = await supabaseAdmin
    .from('products')
    .select('id, name, sku, sync_status, sync_error')
    .eq('store_id', storeId)
    .eq('sync_status', 'error')
    .not('shopify_product_id', 'is', null);

  if (!e1) {
    const count = errorProducts?.length || 0;
    const status = count > 5 ? 'WARNING' : count > 0 ? 'OK' : 'OK';
    results.push({
      category: 'Shopify Sync',
      status,
      message: count > 0 ? `Productos con errores de sincronización` : 'All products synced successfully',
      count,
      details: count > 0 ? errorProducts : undefined
    });
    logCheck('Shopify Sync', status, 'Productos con error', count);
  }

  // 6.2 Productos con sync pendiente por mucho tiempo (>1h)
  const oneHourAgo = new Date();
  oneHourAgo.setHours(oneHourAgo.getHours() - 1);

  const { data: stalePending, error: e2 } = await supabaseAdmin
    .from('products')
    .select('id, name, sku, updated_at')
    .eq('store_id', storeId)
    .eq('sync_status', 'pending')
    .not('shopify_product_id', 'is', null)
    .lt('updated_at', oneHourAgo.toISOString());

  if (!e2) {
    const count = stalePending?.length || 0;
    const status = count > 10 ? 'WARNING' : 'OK';
    results.push({
      category: 'Shopify Sync',
      status,
      message: count > 0 ? `Productos con sync pendiente por más de 1 hora` : 'No stale pending syncs',
      count,
      details: count > 0 ? stalePending.slice(0, 10) : undefined
    });
    logCheck('Shopify Sync', status, 'Sync pendiente antiguo', count);
  }

  return results;
}

async function checkProductVariants(storeId: string): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  // 7.1 Bundles con available_packs inconsistente
  const { data: bundles, error: e1 } = await supabaseAdmin
    .from('product_variants')
    .select(`
      id,
      name,
      units_per_pack,
      stock,
      products!inner(id, name, stock)
    `)
    .eq('products.store_id', storeId)
    .eq('variant_type', 'bundle')
    .eq('uses_shared_stock', true)
    .gt('units_per_pack', 0);

  if (!e1 && bundles) {
    const problematic = bundles.filter((v: any) => {
      const parentStock = v.products?.stock || 0;
      const unitsPerPack = v.units_per_pack || 1;
      const calculatedPacks = Math.floor(parentStock / unitsPerPack);
      return v.stock !== calculatedPacks;
    });

    const count = problematic.length;
    const status = count > 0 ? 'WARNING' : 'OK';
    results.push({
      category: 'Product Variants',
      status,
      message: count > 0 ? `Bundles con available_packs mal calculado` : 'All bundle stocks are correct',
      count,
      details: count > 0 ? problematic : undefined
    });
    logCheck('Product Variants', status, 'Bundles incorrectos', count);
  }

  // 7.2 Variations con uses_shared_stock = TRUE (debería ser FALSE)
  const { data: incorrectVariations, error: e2 } = await supabaseAdmin
    .from('product_variants')
    .select('id, name, variant_type, uses_shared_stock')
    .eq('variant_type', 'variation')
    .eq('uses_shared_stock', true);

  if (!e2) {
    const count = incorrectVariations?.length || 0;
    const status = count > 0 ? 'WARNING' : 'OK';
    results.push({
      category: 'Product Variants',
      status,
      message: count > 0 ? `Variations con uses_shared_stock = TRUE (debería ser FALSE)` : 'All variations configured correctly',
      count,
      details: count > 0 ? incorrectVariations : undefined
    });
    logCheck('Product Variants', status, 'Variations incorrectas', count);
  }

  return results;
}

async function checkCarrierCoverage(storeId: string): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  // 8.1 Transportadoras activas sin coverage
  const { data: carriersWithoutCoverage, error: e1 } = await supabaseAdmin
    .from('carriers')
    .select(`
      id,
      name,
      is_active,
      carrier_coverage(city)
    `)
    .eq('store_id', storeId)
    .eq('is_active', true);

  if (!e1 && carriersWithoutCoverage) {
    const problematic = carriersWithoutCoverage.filter(c => {
      const coverage = c.carrier_coverage || [];
      return coverage.length === 0;
    });

    const count = problematic.length;
    const status = count > 0 ? 'WARNING' : 'OK';
    results.push({
      category: 'Carrier Coverage',
      status,
      message: count > 0 ? `Transportadoras activas sin coverage configurado` : 'All carriers have coverage',
      count,
      details: count > 0 ? problematic : undefined
    });
    logCheck('Carrier Coverage', status, 'Sin coverage', count);
  }

  return results;
}

async function checkReturnsIntegrity(storeId: string): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  // 9.1 Sesiones completadas con processed_orders incorrecto
  const { data: returnSessions, error: e1 } = await supabaseAdmin
    .from('return_sessions')
    .select(`
      id,
      session_code,
      status,
      processed_orders,
      return_session_orders(order_id)
    `)
    .eq('store_id', storeId)
    .eq('status', 'completed');

  if (!e1 && returnSessions) {
    const problematic = returnSessions.filter((rs: any) => {
      const actualOrders = rs.return_session_orders?.length || 0;
      return rs.processed_orders !== actualOrders;
    });

    const count = problematic.length;
    const status = count > 0 ? 'WARNING' : 'OK';
    results.push({
      category: 'Returns',
      status,
      message: count > 0 ? `Sesiones de devolución con conteo incorrecto de órdenes procesadas` : 'Return sessions have correct counts',
      count,
      details: count > 0 ? problematic : undefined
    });
    logCheck('Returns', status, 'Conteo incorrecto', count);
  }

  // 9.2 Órdenes en múltiples sesiones de devolución activas
  let duplicateReturns = null;
  try {
    const response = await supabaseAdmin.rpc(
      'find_duplicate_return_orders',
      { p_store_id: storeId }
    );
    duplicateReturns = response.data;
  } catch (err) {
    // Graceful fallback
    duplicateReturns = null;
  }

  if (duplicateReturns && Array.isArray(duplicateReturns)) {
    const count = duplicateReturns.length;
    const status = count > 0 ? 'CRITICAL' : 'OK';
    results.push({
      category: 'Returns',
      status,
      message: count > 0 ? `Órdenes en múltiples sesiones de devolución activas` : 'No duplicate orders in return sessions',
      count,
      details: count > 0 ? duplicateReturns : undefined
    });
    logCheck('Returns', status, 'Órdenes duplicadas', count);
  }

  return results;
}

async function checkAnalyticsCalculations(storeId: string): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // 5.1 Revenue
  const { data: orders, error: e1 } = await supabaseAdmin
    .from('orders')
    .select('total_price, sleeves_status')
    .eq('store_id', storeId)
    .gte('created_at', sevenDaysAgo.toISOString())
    .not('sleeves_status', 'in', '(cancelled,rejected)');

  if (!e1 && orders) {
    const totalRevenue = orders.reduce((sum, o) => sum + (o.total_price || 0), 0);
    results.push({
      category: 'Analytics',
      status: 'OK',
      message: `Revenue (últimos 7 días): ${totalRevenue.toLocaleString()} Gs`,
      details: {
        total_revenue: totalRevenue,
        order_count: orders.length,
        avg_order_value: orders.length > 0 ? totalRevenue / orders.length : 0
      }
    });
    logCheck('Analytics', 'OK', `Revenue: ${totalRevenue.toLocaleString()} Gs`);
  }

  // 5.2 Delivery Rate
  const { data: allOrders, error: e2 } = await supabaseAdmin
    .from('orders')
    .select('sleeves_status')
    .eq('store_id', storeId)
    .gte('created_at', sevenDaysAgo.toISOString());

  if (!e2 && allOrders) {
    const delivered = allOrders.filter(o => o.sleeves_status === 'delivered').length;
    const total = allOrders.length;
    const deliveryRate = total > 0 ? (delivered / total * 100).toFixed(2) : 0;

    const status = Number(deliveryRate) < 70 ? 'WARNING' : 'OK';
    results.push({
      category: 'Analytics',
      status,
      message: `Delivery Rate (últimos 7 días): ${deliveryRate}%`,
      details: {
        delivered_orders: delivered,
        total_orders: total,
        delivery_rate: deliveryRate
      }
    });
    logCheck('Analytics', status, `Delivery Rate: ${deliveryRate}%`);
  }

  return results;
}

// ================================================================
// MAIN EXECUTION
// ================================================================

async function runHealthCheck() {
  console.log('🏥 ORDEFY HEALTH CHECK');
  console.log('='.repeat(60));
  console.log(`📅 Timestamp: ${new Date().toISOString()}`);
  console.log(`👤 Owner Email: ${OWNER_EMAIL}\n`);

  try {
    // Get store info
    console.log('🔍 Buscando tienda...');
    const store = await getStoreInfo(OWNER_EMAIL, 'NOCTE');
    console.log(`✅ Tienda encontrada: ${store.name} (${store.id})\n`);

    // Run all health checks
    console.log('🏥 Ejecutando verificaciones de salud...\n');

    const allResults: HealthCheckResult[] = [];

    console.log('📦 1. INVENTORY INTEGRITY');
    console.log('-'.repeat(60));
    const inventoryResults = await checkInventoryIntegrity(store.id);
    allResults.push(...inventoryResults);

    console.log('\n📋 2. ORDER INTEGRITY');
    console.log('-'.repeat(60));
    const orderResults = await checkOrderIntegrity(store.id);
    allResults.push(...orderResults);

    console.log('\n🏭 3. WAREHOUSE INTEGRITY');
    console.log('-'.repeat(60));
    const warehouseResults = await checkWarehouseIntegrity(store.id);
    allResults.push(...warehouseResults);

    console.log('\n💰 4. SETTLEMENTS INTEGRITY');
    console.log('-'.repeat(60));
    const settlementsResults = await checkSettlementsIntegrity(store.id);
    allResults.push(...settlementsResults);

    console.log('\n🛍️ 5. SHOPIFY SYNC STATUS');
    console.log('-'.repeat(60));
    const shopifyResults = await checkShopifySyncStatus(store.id);
    allResults.push(...shopifyResults);

    console.log('\n🎁 6. PRODUCT VARIANTS');
    console.log('-'.repeat(60));
    const variantsResults = await checkProductVariants(store.id);
    allResults.push(...variantsResults);

    console.log('\n🚚 7. CARRIER COVERAGE');
    console.log('-'.repeat(60));
    const carrierResults = await checkCarrierCoverage(store.id);
    allResults.push(...carrierResults);

    console.log('\n🔄 8. RETURNS INTEGRITY');
    console.log('-'.repeat(60));
    const returnsResults = await checkReturnsIntegrity(store.id);
    allResults.push(...returnsResults);

    console.log('\n📊 9. ANALYTICS CALCULATIONS');
    console.log('-'.repeat(60));
    const analyticsResults = await checkAnalyticsCalculations(store.id);
    allResults.push(...analyticsResults);

    // Generate summary
    const critical = allResults.filter(r => r.status === 'CRITICAL').length;
    const warnings = allResults.filter(r => r.status === 'WARNING').length;
    const ok = allResults.filter(r => r.status === 'OK').length;

    const report: HealthReport = {
      timestamp: new Date().toISOString(),
      store,
      summary: {
        total_checks: allResults.length,
        ok,
        warnings,
        critical,
        overall_status: getStatus(critical, warnings)
      },
      checks: allResults
    };

    // Save report
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = path.join(OUTPUT_DIR, `health-report-${timestamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

    // Generate HTML report
    const htmlPath = path.join(OUTPUT_DIR, `health-report-${timestamp}.html`);
    const html = generateHTMLReport(report);
    fs.writeFileSync(htmlPath, html);

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMEN DE SALUD');
    console.log('='.repeat(60));
    console.log(`Total de verificaciones: ${report.summary.total_checks}`);
    console.log(`✅ OK: ${ok}`);
    console.log(`⚠️  Warnings: ${warnings}`);
    console.log(`❌ Critical: ${critical}`);
    console.log(`\n🏆 Status general: ${report.summary.overall_status}`);
    console.log(`\n📁 Reporte guardado en:`);
    console.log(`   JSON: ${jsonPath}`);
    console.log(`   HTML: ${htmlPath}`);
    console.log('='.repeat(60));

  } catch (error: any) {
    console.error('❌ Error ejecutando health check:', error.message);
    process.exit(1);
  }
}

function generateHTMLReport(report: HealthReport): string {
  const statusColor = {
    'OK': '#10b981',
    'WARNING': '#f59e0b',
    'CRITICAL': '#ef4444'
  };

  const statusIcon = {
    'OK': '✅',
    'WARNING': '⚠️',
    'CRITICAL': '❌'
  };

  const checksHTML = report.checks.map(check => `
    <div class="check-item" style="border-left: 4px solid ${statusColor[check.status]}">
      <div class="check-header">
        <span class="check-icon">${statusIcon[check.status]}</span>
        <span class="check-category">${check.category}</span>
        ${check.count !== undefined ? `<span class="check-count">${check.count}</span>` : ''}
      </div>
      <div class="check-message">${check.message}</div>
      ${check.details ? `<details><summary>Ver detalles</summary><pre>${JSON.stringify(check.details, null, 2)}</pre></details>` : ''}
    </div>
  `).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Ordefy Health Check - ${report.store.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f3f4f6;
      padding: 2rem;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 6px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 2rem;
    }
    .header h1 { font-size: 2rem; margin-bottom: 0.5rem; }
    .header p { opacity: 0.9; }
    .summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      padding: 2rem;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
    }
    .summary-card {
      background: white;
      padding: 1.5rem;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    .summary-card h3 { font-size: 0.875rem; color: #6b7280; margin-bottom: 0.5rem; }
    .summary-card p { font-size: 2rem; font-weight: bold; }
    .checks {
      padding: 2rem;
    }
    .check-item {
      background: #f9fafb;
      padding: 1rem;
      margin-bottom: 1rem;
      border-radius: 8px;
      border-left-width: 4px;
    }
    .check-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .check-icon { font-size: 1.25rem; }
    .check-category {
      font-weight: 600;
      color: #1f2937;
      flex: 1;
    }
    .check-count {
      background: #ef4444;
      color: white;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.875rem;
      font-weight: 600;
    }
    .check-message {
      color: #4b5563;
      margin-left: 2rem;
    }
    details {
      margin-top: 1rem;
      margin-left: 2rem;
    }
    summary {
      cursor: pointer;
      color: #667eea;
      font-weight: 500;
    }
    pre {
      background: #1f2937;
      color: #f9fafb;
      padding: 1rem;
      border-radius: 6px;
      overflow-x: auto;
      margin-top: 0.5rem;
      font-size: 0.875rem;
    }
    .footer {
      padding: 1rem 2rem;
      background: #f9fafb;
      border-top: 1px solid #e5e7eb;
      color: #6b7280;
      font-size: 0.875rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🏥 Ordefy Health Check</h1>
      <p>${report.store.name} • ${new Date(report.timestamp).toLocaleString()}</p>
    </div>

    <div class="summary">
      <div class="summary-card">
        <h3>Total Checks</h3>
        <p>${report.summary.total_checks}</p>
      </div>
      <div class="summary-card">
        <h3>✅ OK</h3>
        <p style="color: ${statusColor.OK}">${report.summary.ok}</p>
      </div>
      <div class="summary-card">
        <h3>⚠️ Warnings</h3>
        <p style="color: ${statusColor.WARNING}">${report.summary.warnings}</p>
      </div>
      <div class="summary-card">
        <h3>❌ Critical</h3>
        <p style="color: ${statusColor.CRITICAL}">${report.summary.critical}</p>
      </div>
      <div class="summary-card" style="grid-column: span 2;">
        <h3>Overall Status</h3>
        <p style="color: ${statusColor[report.summary.overall_status]}">${report.summary.overall_status}</p>
      </div>
    </div>

    <div class="checks">
      ${checksHTML}
    </div>

    <div class="footer">
      Generated by Ordefy Health Check System • ${report.timestamp}
    </div>
  </div>
</body>
</html>
  `;
}

// Run the health check
runHealthCheck();
