/**
 * Script: cleanup-behipnos-test-data.ts
 *
 * Purpose:
 * Clean ALL test data from BEHIPNOS store (user: hanselechague6@gmail.com)
 * This includes: orders, customers, dispatch sessions, warehouse sessions, returns, etc.
 *
 * PRESERVES: Store config, products, carriers, suppliers, Shopify integration
 *
 * Run: npx ts-node api/scripts/cleanup-behipnos-test-data.ts
 */

import { supabaseAdmin } from '../db/connection';

const TARGET_EMAIL = 'hanselechague6@gmail.com';

async function main() {
  console.log('🚀 Starting BEHIPNOS complete cleanup script...\n');
  console.log('⚠️  This will delete ALL test data (orders, customers, dispatch, warehouse)');
  console.log('✅ Products, carriers, suppliers, and store config will be PRESERVED\n');

  try {
    // Step 1: Find user by email
    console.log(`📧 Looking for user: ${TARGET_EMAIL}`);
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, name')
      .eq('email', TARGET_EMAIL)
      .single();

    if (userError || !user) {
      console.error('❌ User not found:', userError?.message);
      process.exit(1);
    }

    console.log(`✅ Found user: ${user.name} (${user.id})`);

    // Step 2: Find user's stores
    console.log('\n📦 Finding user stores...');
    const { data: userStores, error: storesError } = await supabaseAdmin
      .from('user_stores')
      .select('store_id, role, stores(id, name)')
      .eq('user_id', user.id);

    if (storesError || !userStores?.length) {
      console.error('❌ No stores found for user:', storesError?.message);
      process.exit(1);
    }

    console.log(`✅ Found ${userStores.length} store(s):`);
    userStores.forEach((us: any) => {
      console.log(`   - ${us.stores?.name} (${us.store_id}) - Role: ${us.role}`);
    });

    // Step 3: Clean data for each store
    for (const userStore of userStores) {
      const storeId = userStore.store_id;
      const storeName = (userStore as any).stores?.name || 'Unknown';

      console.log(`\n${'='.repeat(60)}`);
      console.log(`🏪 Cleaning store: ${storeName}`);
      console.log(`${'='.repeat(60)}`);

      // ==========================================
      // PHASE 1: Dispatch Sessions
      // ==========================================
      console.log('\n📦 PHASE 1: Dispatch Sessions');

      // Get dispatch session IDs
      const { data: dispatchSessions } = await supabaseAdmin
        .from('dispatch_sessions')
        .select('id')
        .eq('store_id', storeId);

      const dispatchSessionIds = dispatchSessions?.map(s => s.id) || [];
      console.log(`   Found ${dispatchSessionIds.length} dispatch session(s)`);

      if (dispatchSessionIds.length > 0) {
        // Delete dispatch_session_orders
        const { error: dsoError } = await supabaseAdmin
          .from('dispatch_session_orders')
          .delete()
          .in('dispatch_session_id', dispatchSessionIds);
        console.log(dsoError ? `   ⚠️  dispatch_session_orders: ${dsoError.message}` : '   ✅ Deleted dispatch_session_orders');

        // Delete dispatch_sessions
        const { error: dsError } = await supabaseAdmin
          .from('dispatch_sessions')
          .delete()
          .eq('store_id', storeId);
        console.log(dsError ? `   ⚠️  dispatch_sessions: ${dsError.message}` : '   ✅ Deleted dispatch_sessions');
      }

      // ==========================================
      // PHASE 2: Warehouse Sessions (Picking & Packing)
      // ==========================================
      console.log('\n🏭 PHASE 2: Warehouse Sessions');

      // Get picking session IDs
      const { data: pickingSessions } = await supabaseAdmin
        .from('picking_sessions')
        .select('id')
        .eq('store_id', storeId);

      const pickingSessionIds = pickingSessions?.map(s => s.id) || [];
      console.log(`   Found ${pickingSessionIds.length} picking session(s)`);

      if (pickingSessionIds.length > 0) {
        // Delete packing_progress
        const { error: ppError } = await supabaseAdmin
          .from('packing_progress')
          .delete()
          .in('picking_session_id', pickingSessionIds);
        console.log(ppError ? `   ⚠️  packing_progress: ${ppError.message}` : '   ✅ Deleted packing_progress');

        // Delete picking_session_items
        const { error: psiError } = await supabaseAdmin
          .from('picking_session_items')
          .delete()
          .in('picking_session_id', pickingSessionIds);
        console.log(psiError ? `   ⚠️  picking_session_items: ${psiError.message}` : '   ✅ Deleted picking_session_items');

        // Delete picking_session_orders
        const { error: psoError } = await supabaseAdmin
          .from('picking_session_orders')
          .delete()
          .in('picking_session_id', pickingSessionIds);
        console.log(psoError ? `   ⚠️  picking_session_orders: ${psoError.message}` : '   ✅ Deleted picking_session_orders');

        // Delete picking_sessions
        const { error: psError } = await supabaseAdmin
          .from('picking_sessions')
          .delete()
          .eq('store_id', storeId);
        console.log(psError ? `   ⚠️  picking_sessions: ${psError.message}` : '   ✅ Deleted picking_sessions');
      }

      // ==========================================
      // PHASE 3: Return Sessions
      // ==========================================
      console.log('\n🔄 PHASE 3: Return Sessions');

      // Get return session IDs
      const { data: returnSessions } = await supabaseAdmin
        .from('return_sessions')
        .select('id')
        .eq('store_id', storeId);

      const returnSessionIds = returnSessions?.map(s => s.id) || [];
      console.log(`   Found ${returnSessionIds.length} return session(s)`);

      if (returnSessionIds.length > 0) {
        // Delete return_session_items
        const { error: rsiError } = await supabaseAdmin
          .from('return_session_items')
          .delete()
          .in('return_session_id', returnSessionIds);
        console.log(rsiError ? `   ⚠️  return_session_items: ${rsiError.message}` : '   ✅ Deleted return_session_items');

        // Delete return_session_orders
        const { error: rsoError } = await supabaseAdmin
          .from('return_session_orders')
          .delete()
          .in('return_session_id', returnSessionIds);
        console.log(rsoError ? `   ⚠️  return_session_orders: ${rsoError.message}` : '   ✅ Deleted return_session_orders');

        // Delete return_sessions
        const { error: rsError } = await supabaseAdmin
          .from('return_sessions')
          .delete()
          .eq('store_id', storeId);
        console.log(rsError ? `   ⚠️  return_sessions: ${rsError.message}` : '   ✅ Deleted return_sessions');
      }

      // ==========================================
      // PHASE 4: Orders and Related Data
      // ==========================================
      console.log('\n📋 PHASE 4: Orders');

      // Get order count
      const { count: orderCount } = await supabaseAdmin
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', storeId);

      console.log(`   Found ${orderCount || 0} order(s)`);

      if (orderCount && orderCount > 0) {
        // Get order IDs
        const { data: orders } = await supabaseAdmin
          .from('orders')
          .select('id')
          .eq('store_id', storeId);

        const orderIds = orders?.map(o => o.id) || [];

        if (orderIds.length > 0) {
          // Delete order_line_items
          const { error: oliError } = await supabaseAdmin
            .from('order_line_items')
            .delete()
            .in('order_id', orderIds);
          console.log(oliError ? `   ⚠️  order_line_items: ${oliError.message}` : '   ✅ Deleted order_line_items');

          // Delete order_status_history
          const { error: oshError } = await supabaseAdmin
            .from('order_status_history')
            .delete()
            .in('order_id', orderIds);
          console.log(oshError ? `   ⚠️  order_status_history: ${oshError.message}` : '   ✅ Deleted order_status_history');

          // Delete follow_up_log
          const { error: fulError } = await supabaseAdmin
            .from('follow_up_log')
            .delete()
            .in('order_id', orderIds);
          console.log(fulError ? `   ⚠️  follow_up_log: ${fulError.message}` : '   ✅ Deleted follow_up_log');

          // Delete delivery_attempts
          const { error: daError } = await supabaseAdmin
            .from('delivery_attempts')
            .delete()
            .in('order_id', orderIds);
          console.log(daError ? `   ⚠️  delivery_attempts: ${daError.message}` : '   ✅ Deleted delivery_attempts');

          // Delete inventory_movements (order related)
          const { error: imError } = await supabaseAdmin
            .from('inventory_movements')
            .delete()
            .in('order_id', orderIds);
          console.log(imError ? `   ⚠️  inventory_movements (orders): ${imError.message}` : '   ✅ Deleted inventory_movements (order related)');

          // Delete settlement_orders
          const { error: soError } = await supabaseAdmin
            .from('settlement_orders')
            .delete()
            .in('order_id', orderIds);
          console.log(soError ? `   ⚠️  settlement_orders: ${soError.message}` : '   ✅ Deleted settlement_orders');
        }

        // Delete the orders themselves
        const { error: ordersError } = await supabaseAdmin
          .from('orders')
          .delete()
          .eq('store_id', storeId);
        console.log(ordersError ? `   ❌ orders: ${ordersError.message}` : `   ✅ Deleted ${orderCount} orders`);
      }

      // ==========================================
      // PHASE 5: Customers
      // ==========================================
      console.log('\n👥 PHASE 5: Customers');

      const { count: customerCount } = await supabaseAdmin
        .from('customers')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', storeId);

      console.log(`   Found ${customerCount || 0} customer(s)`);

      if (customerCount && customerCount > 0) {
        const { error: custError } = await supabaseAdmin
          .from('customers')
          .delete()
          .eq('store_id', storeId);
        console.log(custError ? `   ❌ customers: ${custError.message}` : `   ✅ Deleted ${customerCount} customers`);
      }

      // ==========================================
      // PHASE 6: Daily Settlements
      // ==========================================
      console.log('\n💰 PHASE 6: Daily Settlements');

      const { count: settlementCount } = await supabaseAdmin
        .from('daily_settlements')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', storeId);

      console.log(`   Found ${settlementCount || 0} settlement(s)`);

      if (settlementCount && settlementCount > 0) {
        const { error: settError } = await supabaseAdmin
          .from('daily_settlements')
          .delete()
          .eq('store_id', storeId);
        console.log(settError ? `   ⚠️  daily_settlements: ${settError.message}` : `   ✅ Deleted ${settlementCount} daily_settlements`);
      }

      // ==========================================
      // PHASE 7: Inventory Movements (non-order related)
      // ==========================================
      console.log('\n📊 PHASE 7: Remaining Inventory Movements');

      const { count: invMovCount } = await supabaseAdmin
        .from('inventory_movements')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', storeId);

      console.log(`   Found ${invMovCount || 0} remaining movement(s)`);

      if (invMovCount && invMovCount > 0) {
        const { error: imError } = await supabaseAdmin
          .from('inventory_movements')
          .delete()
          .eq('store_id', storeId);
        console.log(imError ? `   ⚠️  inventory_movements: ${imError.message}` : `   ✅ Deleted ${invMovCount} inventory_movements`);
      }

      // ==========================================
      // PHASE 8: Products - PRESERVED (no changes)
      // ==========================================
      console.log('\n📦 PHASE 8: Products');
      console.log('   ⏭️  Products preserved (no changes to stock or data)');

      // ==========================================
      // PHASE 9: Inbound Shipments (Merchandise)
      // ==========================================
      console.log('\n📥 PHASE 9: Inbound Shipments');

      const { data: inboundShipments } = await supabaseAdmin
        .from('inbound_shipments')
        .select('id')
        .eq('store_id', storeId);

      const inboundShipmentIds = inboundShipments?.map(s => s.id) || [];
      console.log(`   Found ${inboundShipmentIds.length} inbound shipment(s)`);

      if (inboundShipmentIds.length > 0) {
        // Delete inbound_shipment_items
        const { error: isiError } = await supabaseAdmin
          .from('inbound_shipment_items')
          .delete()
          .in('shipment_id', inboundShipmentIds);
        console.log(isiError ? `   ⚠️  inbound_shipment_items: ${isiError.message}` : '   ✅ Deleted inbound_shipment_items');

        // Delete inbound_shipments
        const { error: isError } = await supabaseAdmin
          .from('inbound_shipments')
          .delete()
          .eq('store_id', storeId);
        console.log(isError ? `   ⚠️  inbound_shipments: ${isError.message}` : '   ✅ Deleted inbound_shipments');
      }

      // ==========================================
      // PHASE 10: Onboarding Progress Reset
      // ==========================================
      console.log('\n🎯 PHASE 10: Reset Onboarding');

      const { error: onbError } = await supabaseAdmin
        .from('onboarding_progress')
        .delete()
        .eq('store_id', storeId);
      console.log(onbError ? `   ⚠️  onboarding_progress: ${onbError.message}` : '   ✅ Reset onboarding_progress');

      // ==========================================
      // Summary
      // ==========================================
      console.log(`\n${'='.repeat(60)}`);
      console.log(`✅ Store ${storeName} cleaned successfully!`);
      console.log(`${'='.repeat(60)}`);
    }

    console.log('\n\n🎉 ===== ALL CLEANUP COMPLETED =====');
    console.log(`\n📊 Summary for ${TARGET_EMAIL}:`);
    console.log('   ✅ Dispatch sessions deleted');
    console.log('   ✅ Warehouse sessions deleted');
    console.log('   ✅ Return sessions deleted');
    console.log('   ✅ Orders deleted');
    console.log('   ✅ Customers deleted');
    console.log('   ✅ Daily settlements deleted');
    console.log('   ✅ Inventory movements deleted');
    console.log('   ✅ Inbound shipments deleted');
    console.log('   ✅ Onboarding progress reset');
    console.log('\n📦 PRESERVED:');
    console.log('   ✅ Products (unchanged)');
    console.log('   ✅ Carriers');
    console.log('   ✅ Suppliers');
    console.log('   ✅ Store configuration');
    console.log('   ✅ Shopify integration');
    console.log('   ✅ User account & permissions');

  } catch (error) {
    console.error('\n❌ Script failed with error:', error);
    process.exit(1);
  }

  process.exit(0);
}

main();
