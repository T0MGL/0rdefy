/**
 * Delete all orders from Bright Idea store as owner
 * This will hard delete all orders (permanent removal)
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function cleanupBrightIdeaOrders() {
  console.log('🗑️  Cleaning up Bright Idea orders');
  console.log('─'.repeat(60));
  console.log('');

  // Step 1: Get Bright Idea store ID by owner email
  console.log('Step 1: Finding Bright Idea store...');

  const { data: userStore, error: userStoreError } = await supabaseAdmin
    .from('user_stores')
    .select(`
      store_id,
      stores (
        id,
        name
      ),
      users (
        email
      )
    `)
    .eq('users.email', 'gaston@thebrightidea.ai')
    .eq('is_active', true)
    .single();

  if (userStoreError || !userStore) {
    console.log('❌ Error finding store:', userStoreError?.message || 'Store not found');
    console.log('');
    console.log('💡 Make sure gaston@thebrightidea.ai has access to a store');
    return;
  }

  const storeId = userStore.store_id;
  const storeName = userStore.stores.name;

  console.log(`✅ Found store: ${storeName} (${storeId})`);
  console.log('');

  // Step 2: Count orders in the store
  console.log('Step 2: Counting orders...');

  const { count: totalOrders, error: countError } = await supabaseAdmin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId);

  if (countError) {
    console.log('❌ Error counting orders:', countError.message);
    return;
  }

  console.log(`📊 Found ${totalOrders} orders to delete`);
  console.log('');

  if (totalOrders === 0) {
    console.log('✅ No orders to delete. Store is already clean!');
    return;
  }

  // Step 3: Get all order IDs
  console.log('Step 3: Fetching order IDs...');

  const { data: orders, error: fetchError } = await supabaseAdmin
    .from('orders')
    .select('id, order_number, customer_first_name, customer_last_name, sleeves_status, deleted_at')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false });

  if (fetchError || !orders) {
    console.log('❌ Error fetching orders:', fetchError?.message);
    return;
  }

  console.log(`✅ Fetched ${orders.length} orders`);
  console.log('');

  // Step 4: Delete each order (hard delete via trigger)
  console.log('Step 4: Deleting orders (this will trigger cascading cleanup)...');
  console.log('');

  let deleted = 0;
  let failed = 0;
  let stockRestored = 0;

  for (const order of orders) {
    const orderLabel = order.order_number || order.id.substring(0, 12);
    const customerName = `${order.customer_first_name || ''} ${order.customer_last_name || ''}`.trim() || 'Unknown';

    process.stdout.write(`  Deleting ${orderLabel} (${customerName})... `);

    const { error: deleteError } = await supabaseAdmin
      .from('orders')
      .delete()
      .eq('id', order.id)
      .eq('store_id', storeId);

    if (deleteError) {
      console.log(`❌ Failed: ${deleteError.message}`);
      failed++;
    } else {
      // Check if stock was affected
      const wasStockAffected = ['ready_to_ship', 'shipped', 'delivered'].includes(order.sleeves_status);
      if (wasStockAffected) {
        stockRestored++;
        console.log(`✅ Deleted (stock restored)`);
      } else {
        console.log(`✅ Deleted`);
      }
      deleted++;
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('');
  console.log('─'.repeat(60));
  console.log('');
  console.log('📊 Summary:');
  console.log(`   Total orders: ${totalOrders}`);
  console.log(`   ✅ Successfully deleted: ${deleted}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📦 Stock restored: ${stockRestored} orders`);
  console.log('');

  if (deleted > 0) {
    console.log('✅ Cleanup completed successfully!');
    console.log('');
    console.log('🔍 Verification:');
    console.log('   Run: node scripts/check-deleted-orders-fixed.cjs');
    console.log('   Expected: "No soft-deleted orders found" (all should be hard-deleted)');
  } else {
    console.log('⚠️  No orders were deleted');
  }
  console.log('');
}

cleanupBrightIdeaOrders().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
