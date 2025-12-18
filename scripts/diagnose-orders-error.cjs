// Diagnostic script to find the cause of 500 error on /api/orders
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

async function diagnose() {
    try {
        console.log('🔍 Testing the exact query from /api/orders endpoint...\n');

        // Simulate the query from orders.ts:589-621
        const { data, error, count } = await supabase
            .from('orders')
            .select(`
                *,
                customers!orders_customer_id_fkey (
                    first_name,
                    last_name,
                    total_orders
                ),
                order_line_items (
                    id,
                    product_id,
                    product_name,
                    variant_title,
                    sku,
                    quantity,
                    unit_price,
                    total_price,
                    shopify_product_id,
                    shopify_variant_id,
                    products:product_id (
                        id,
                        name,
                        image_url
                    )
                ),
                carriers!orders_courier_id_fkey (
                    id,
                    name
                )
            `, { count: 'exact' })
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) {
            console.error('❌ QUERY ERROR:', error);
            console.error('\nError details:');
            console.error('- Code:', error.code);
            console.error('- Message:', error.message);
            console.error('- Details:', error.details);
            console.error('- Hint:', error.hint);

            // Check if it's a foreign key issue
            if (error.message.includes('foreign key')) {
                console.error('\n⚠️  This is a FOREIGN KEY constraint error!');
                console.error('The relationship between order_line_items and products might be broken.');
            }

            return;
        }

        console.log('✅ Query executed successfully!');
        console.log(`📊 Found ${count} total orders`);
        console.log(`📦 Returned ${data.length} orders in this page\n`);

        // Analyze the data
        for (const order of data.slice(0, 3)) {
            console.log(`\n📋 Order ${order.id}:`);
            console.log(`  - Customer: ${order.customer_first_name} ${order.customer_last_name}`);
            console.log(`  - Status: ${order.sleeves_status}`);
            console.log(`  - Line items count: ${order.order_line_items?.length || 0}`);

            if (order.order_line_items && order.order_line_items.length > 0) {
                console.log(`  - First line item:`);
                const item = order.order_line_items[0];
                console.log(`    * Product: ${item.product_name}`);
                console.log(`    * Quantity: ${item.quantity}`);
                console.log(`    * Has product FK: ${item.product_id ? 'YES' : 'NO'}`);
                console.log(`    * Product data: ${item.products ? 'LOADED' : 'NULL'}`);
            }
        }

        console.log('\n✅ No errors found! The query works correctly.');
        console.log('ℹ️  The 500 error might be happening in the data transformation logic.');

    } catch (error) {
        console.error('❌ Unexpected error:', error.message);
        console.error(error.stack);
    }
}

diagnose();
