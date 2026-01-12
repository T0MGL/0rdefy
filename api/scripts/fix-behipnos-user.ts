/**
 * Script: fix-behipnos-user.ts
 *
 * Purpose:
 * 1. Delete all orders for BEHIPNOS store (user: hanselechague6@gmail.com)
 * 2. Set user as owner with professional plan (full permissions)
 *
 * Run: npx ts-node api/scripts/fix-behipnos-user.ts
 */

import { supabaseAdmin } from '../db/connection';

const TARGET_EMAIL = 'hanselechague6@gmail.com';

async function main() {
  console.log('🚀 Starting BEHIPNOS user fix script...\n');

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

    // Step 3: Delete orders for each store
    console.log('\n🗑️  Deleting orders for all stores...');

    for (const userStore of userStores) {
      const storeId = userStore.store_id;
      const storeName = (userStore as any).stores?.name || 'Unknown';

      // First, get order count
      const { count: orderCount } = await supabaseAdmin
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('store_id', storeId);

      console.log(`\n   Store: ${storeName}`);
      console.log(`   Orders to delete: ${orderCount || 0}`);

      if (orderCount && orderCount > 0) {
        // Delete related records first (cascading manually for safety)

        // Get order IDs first
        const { data: orders } = await supabaseAdmin
          .from('orders')
          .select('id')
          .eq('store_id', storeId);

        const orderIds = orders?.map(o => o.id) || [];

        if (orderIds.length > 0) {
          // Delete order_line_items
          const { error: lineItemsError } = await supabaseAdmin
            .from('order_line_items')
            .delete()
            .in('order_id', orderIds);

          if (lineItemsError) {
            console.log(`   ⚠️  order_line_items: ${lineItemsError.message}`);
          } else {
            console.log(`   ✅ Deleted order_line_items`);
          }

          // Delete order_status_history
          const { error: historyError } = await supabaseAdmin
            .from('order_status_history')
            .delete()
            .in('order_id', orderIds);

          if (historyError) {
            console.log(`   ⚠️  order_status_history: ${historyError.message}`);
          } else {
            console.log(`   ✅ Deleted order_status_history`);
          }

          // Delete follow_up_log
          const { error: followUpError } = await supabaseAdmin
            .from('follow_up_log')
            .delete()
            .in('order_id', orderIds);

          if (followUpError) {
            console.log(`   ⚠️  follow_up_log: ${followUpError.message}`);
          } else {
            console.log(`   ✅ Deleted follow_up_log`);
          }

          // Delete delivery_attempts
          const { error: deliveryError } = await supabaseAdmin
            .from('delivery_attempts')
            .delete()
            .in('order_id', orderIds);

          if (deliveryError) {
            console.log(`   ⚠️  delivery_attempts: ${deliveryError.message}`);
          } else {
            console.log(`   ✅ Deleted delivery_attempts`);
          }

          // Delete inventory_movements related to orders
          const { error: invMovError } = await supabaseAdmin
            .from('inventory_movements')
            .delete()
            .in('order_id', orderIds);

          if (invMovError) {
            console.log(`   ⚠️  inventory_movements: ${invMovError.message}`);
          } else {
            console.log(`   ✅ Deleted inventory_movements`);
          }
        }

        // Now delete the orders themselves
        const { error: deleteError } = await supabaseAdmin
          .from('orders')
          .delete()
          .eq('store_id', storeId);

        if (deleteError) {
          console.error(`   ❌ Failed to delete orders: ${deleteError.message}`);
        } else {
          console.log(`   ✅ Deleted ${orderCount} orders`);
        }
      }

      // Step 4: Update user role to owner for this store
      console.log(`\n   📝 Updating role to 'owner'...`);
      const { error: roleError } = await supabaseAdmin
        .from('user_stores')
        .update({ role: 'owner' })
        .eq('user_id', user.id)
        .eq('store_id', storeId);

      if (roleError) {
        console.error(`   ❌ Failed to update role: ${roleError.message}`);
      } else {
        console.log(`   ✅ Role updated to owner`);
      }

      // Step 5: Update store subscription to professional
      console.log(`   📝 Updating subscription to 'professional'...`);
      const { error: subError } = await supabaseAdmin
        .from('stores')
        .update({
          subscription_plan: 'professional',
          max_users: 999  // Unlimited for professional
        })
        .eq('id', storeId);

      if (subError) {
        console.error(`   ❌ Failed to update subscription: ${subError.message}`);
      } else {
        console.log(`   ✅ Subscription updated to professional`);
      }

      // Step 6: Create/update subscription record
      console.log(`   📝 Creating/updating subscription record...`);
      const { error: subscriptionError } = await supabaseAdmin
        .from('subscriptions')
        .upsert({
          store_id: storeId,
          plan: 'professional',
          status: 'active',
          billing_cycle: 'annual',
          current_period_start: new Date().toISOString(),
          current_period_end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'store_id'
        });

      if (subscriptionError) {
        console.log(`   ⚠️  Subscription record: ${subscriptionError.message}`);
      } else {
        console.log(`   ✅ Subscription record created/updated`);
      }
    }

    console.log('\n✅ ===== COMPLETED SUCCESSFULLY =====');
    console.log(`\n📊 Summary for ${TARGET_EMAIL}:`);
    console.log(`   - All orders deleted`);
    console.log(`   - Role: owner`);
    console.log(`   - Plan: professional (full permissions)`);
    console.log(`   - Features: ALL enabled`);

  } catch (error) {
    console.error('\n❌ Script failed with error:', error);
    process.exit(1);
  }

  process.exit(0);
}

main();
