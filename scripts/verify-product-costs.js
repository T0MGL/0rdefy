// ================================================================
// VERIFICATION SCRIPT: Check Product Costs Configuration
// ================================================================
// Purpose: Diagnose why analytics may show $0 in product costs
// ================================================================

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

console.log('🔍 Starting Product Costs Verification...\n');
console.log('════════════════════════════════════════════════════════════\n');

async function runVerification() {
    try {
        // ================================================================
        // 1. OVERALL PRODUCT COSTS STATISTICS
        // ================================================================
        console.log('📊 1. OVERALL PRODUCT COSTS STATISTICS');
        console.log('────────────────────────────────────────');

        const { data: products, error: productsError } = await supabase
            .from('products')
            .select('id, cost, price');

        if (productsError) throw productsError;

        const totalProducts = products.length;
        const productsWithCost = products.filter(p => p.cost && p.cost > 0).length;
        const productsWithoutCost = products.filter(p => !p.cost || p.cost === 0).length;
        const avgCost = products.reduce((sum, p) => sum + (Number(p.cost) || 0), 0) / totalProducts;
        const costs = products.map(p => Number(p.cost) || 0).filter(c => c > 0);
        const minCost = costs.length > 0 ? Math.min(...costs) : 0;
        const maxCost = costs.length > 0 ? Math.max(...costs) : 0;

        console.log(`Total Products: ${totalProducts}`);
        console.log(`Products WITH cost configured: ${productsWithCost} (${((productsWithCost/totalProducts)*100).toFixed(1)}%)`);
        console.log(`Products WITHOUT cost: ${productsWithoutCost} (${((productsWithoutCost/totalProducts)*100).toFixed(1)}%)`);
        console.log(`Average Product Cost: $${avgCost.toFixed(2)}`);
        console.log(`Min Cost: $${minCost.toFixed(2)}`);
        console.log(`Max Cost: $${maxCost.toFixed(2)}`);
        console.log();

        // ================================================================
        // 2. SAMPLE PRODUCTS WITHOUT COSTS
        // ================================================================
        console.log('📦 2. SAMPLE PRODUCTS WITHOUT COSTS (First 10)');
        console.log('────────────────────────────────────────');

        const { data: productsNoCost, error: noCostError } = await supabase
            .from('products')
            .select('id, name, sku, price, cost, stock, shopify_product_id')
            .or('cost.is.null,cost.eq.0')
            .limit(10);

        if (noCostError) throw noCostError;

        if (productsNoCost.length === 0) {
            console.log('✅ All products have costs configured!');
        } else {
            productsNoCost.forEach((product, idx) => {
                console.log(`${idx + 1}. ${product.name || 'Unnamed'}`);
                console.log(`   SKU: ${product.sku || 'N/A'}`);
                console.log(`   Price: $${product.price || 0}`);
                console.log(`   Cost: $${product.cost || 0} ⚠️`);
                console.log(`   Shopify ID: ${product.shopify_product_id || 'N/A'}`);
                console.log();
            });
        }

        // ================================================================
        // 3. RECENT ORDERS AND CALCULATED COSTS
        // ================================================================
        console.log('🛒 3. RECENT ORDERS COST CALCULATION (Last 7 days)');
        console.log('────────────────────────────────────────');

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const { data: recentOrders, error: ordersError } = await supabase
            .from('orders')
            .select('id, shopify_order_number, total_price, sleeves_status, line_items')
            .gte('created_at', sevenDaysAgo.toISOString())
            .order('created_at', { ascending: false })
            .limit(10);

        if (ordersError) throw ordersError;

        if (recentOrders.length === 0) {
            console.log('ℹ️  No orders found in the last 7 days');
        } else {
            for (const order of recentOrders) {
                let calculatedCost = 0;
                let missingCostCount = 0;

                if (order.line_items && Array.isArray(order.line_items)) {
                    for (const item of order.line_items) {
                        const productId = item.product_id;
                        if (productId) {
                            const { data: product } = await supabase
                                .from('products')
                                .select('cost, shopify_product_id')
                                .eq('shopify_product_id', productId)
                                .single();

                            if (product && product.cost) {
                                calculatedCost += Number(product.cost) * Number(item.quantity || 1);
                            } else {
                                missingCostCount++;
                            }
                        }
                    }
                }

                const orderNum = order.shopify_order_number || order.id.substring(0, 8);
                console.log(`Order #${orderNum}`);
                console.log(`  Revenue: $${order.total_price || 0}`);
                console.log(`  Product Costs: $${calculatedCost.toFixed(2)} ${missingCostCount > 0 ? `⚠️ (${missingCostCount} items missing cost)` : '✅'}`);
                console.log(`  Status: ${order.sleeves_status}`);
                console.log();
            }
        }

        // ================================================================
        // 4. CHECK ORDER_LINE_ITEMS TABLE (Migration 024)
        // ================================================================
        console.log('📋 4. ORDER LINE ITEMS TABLE STATUS');
        console.log('────────────────────────────────────────');

        const { count: lineItemsCount, error: lineItemsCountError } = await supabase
            .from('order_line_items')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', sevenDaysAgo.toISOString());

        if (lineItemsCountError) {
            console.log('⚠️  order_line_items table not found or empty');
            console.log('   → Migration 024 may not be applied yet');
            console.log('   → System is using JSONB line_items from orders table');
        } else {
            const { data: lineItemsWithMapping, error: mappingError } = await supabase
                .from('order_line_items')
                .select('product_id')
                .gte('created_at', sevenDaysAgo.toISOString())
                .not('product_id', 'is', null);

            const withMapping = lineItemsWithMapping?.length || 0;
            const withoutMapping = (lineItemsCount || 0) - withMapping;

            console.log(`Total Line Items (last 7 days): ${lineItemsCount || 0}`);
            console.log(`  With Product Mapping: ${withMapping} (${lineItemsCount ? ((withMapping/lineItemsCount)*100).toFixed(1) : 0}%)`);
            console.log(`  Without Mapping: ${withoutMapping} (${lineItemsCount ? ((withoutMapping/lineItemsCount)*100).toFixed(1) : 0}%)`);
        }
        console.log();

        // ================================================================
        // 5. TOP PRODUCTS IN ORDERS WITHOUT COSTS
        // ================================================================
        console.log('🔥 5. TOP PRODUCTS IN RECENT ORDERS WITHOUT COSTS');
        console.log('────────────────────────────────────────');

        const { data: ordersLast30Days, error: orders30Error } = await supabase
            .from('orders')
            .select('line_items')
            .gte('created_at', new Date(Date.now() - 30*24*60*60*1000).toISOString());

        if (orders30Error) throw orders30Error;

        const productCounts = {};

        for (const order of ordersLast30Days) {
            if (order.line_items && Array.isArray(order.line_items)) {
                for (const item of order.line_items) {
                    const productId = item.product_id;
                    const productName = item.title || item.name || 'Unknown';

                    if (productId) {
                        const key = `${productId}::${productName}`;
                        productCounts[key] = (productCounts[key] || 0) + 1;
                    }
                }
            }
        }

        const sortedProducts = Object.entries(productCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        if (sortedProducts.length === 0) {
            console.log('ℹ️  No products found in recent orders');
        } else {
            for (const [key, count] of sortedProducts) {
                const [shopifyId, productName] = key.split('::');

                const { data: product } = await supabase
                    .from('products')
                    .select('cost, name')
                    .eq('shopify_product_id', shopifyId)
                    .single();

                const hasCost = product && product.cost && product.cost > 0;

                if (!hasCost) {
                    console.log(`❌ ${productName}`);
                    console.log(`   Shopify ID: ${shopifyId}`);
                    console.log(`   Times Ordered: ${count}`);
                    console.log(`   Cost Configured: NO ⚠️`);
                    console.log();
                }
            }
        }

        // ================================================================
        // SUMMARY & RECOMMENDATIONS
        // ================================================================
        console.log('════════════════════════════════════════════════════════════');
        console.log('📝 SUMMARY & RECOMMENDATIONS');
        console.log('════════════════════════════════════════════════════════════\n');

        if (productsWithoutCost > 0) {
            console.log('⚠️  ISSUE DETECTED: Products without costs');
            console.log(`   ${productsWithoutCost} products (${((productsWithoutCost/totalProducts)*100).toFixed(1)}%) don't have costs configured`);
            console.log('\n💡 SOLUTION:');
            console.log('   1. Configure costs for all products in your database');
            console.log('   2. Use the Products page to edit each product');
            console.log('   3. Or run a bulk update SQL script');
            console.log('\n   Example SQL to set default cost (20% of price):');
            console.log('   UPDATE products SET cost = price * 0.20 WHERE cost IS NULL OR cost = 0;');
        } else {
            console.log('✅ All products have costs configured!');
        }

        console.log();

    } catch (error) {
        console.error('❌ Error running verification:', error);
        process.exit(1);
    }
}

runVerification();
