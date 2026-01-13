/**
 * Data Integrity Check Script
 *
 * Run this script periodically to identify and report data integrity issues:
 * - Orders with unmapped products (won't decrement stock)
 * - Stock discrepancies between products and inventory_movements
 * - Orders with inconsistent totals
 * - Orphaned picking sessions
 * - Duplicate SKUs per store
 *
 * Usage: npx ts-node scripts/check-data-integrity.ts
 *
 * For production, set up as a cron job:
 * 0 6 * * * cd /path/to/ordefy && npx ts-node scripts/check-data-integrity.ts >> /var/log/ordefy-integrity.log 2>&1
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface IntegrityIssue {
    category: string;
    severity: 'critical' | 'warning' | 'info';
    count: number;
    details: any[];
    action: string;
}

async function checkUnmappedProducts(): Promise<IntegrityIssue | null> {
    console.log('\n🔍 Checking for orders with unmapped products...');

    const { data, error } = await supabase
        .from('order_line_items')
        .select(`
            order_id,
            product_name,
            shopify_product_id,
            shopify_variant_id,
            sku,
            orders!inner (
                order_number,
                sleeves_status,
                created_at,
                store_id,
                deleted_at
            )
        `)
        .is('product_id', null)
        .in('orders.sleeves_status', ['pending', 'confirmed', 'in_preparation', 'ready_to_ship', 'shipped'])
        .is('orders.deleted_at', null)
        .limit(100);

    if (error) {
        console.error('  Error querying unmapped products:', error.message);
        return null;
    }

    if (!data || data.length === 0) {
        console.log('  ✅ No unmapped products found');
        return null;
    }

    console.log(`  ⚠️  Found ${data.length} line items with unmapped products`);

    return {
        category: 'Unmapped Products',
        severity: 'critical',
        count: data.length,
        details: data.slice(0, 10).map((item: any) => ({
            order_number: item.orders?.order_number,
            product_name: item.product_name,
            shopify_product_id: item.shopify_product_id,
            sku: item.sku,
            status: item.orders?.sleeves_status
        })),
        action: 'Import products from Shopify or manually map product_id in order_line_items table'
    };
}

async function checkStockDiscrepancies(): Promise<IntegrityIssue | null> {
    console.log('\n🔍 Checking for stock discrepancies...');

    // This query compares current stock with calculated stock from movements
    const { data, error } = await supabase.rpc('check_stock_discrepancies');

    // If RPC doesn't exist, fall back to direct query
    if (error?.code === 'PGRST202') {
        console.log('  ℹ️  Using fallback query (RPC not available)');

        const { data: products, error: productsError } = await supabase
            .from('products')
            .select('id, name, sku, stock, store_id')
            .gt('stock', 0)
            .limit(500);

        if (productsError || !products) {
            console.error('  Error querying products:', productsError?.message);
            return null;
        }

        // For each product, sum movements and compare
        const discrepancies: any[] = [];

        for (const product of products.slice(0, 50)) {
            const { data: movements } = await supabase
                .from('inventory_movements')
                .select('quantity_change')
                .eq('product_id', product.id);

            if (movements) {
                const calculatedStock = movements.reduce((sum, m) => sum + (m.quantity_change || 0), 0);
                const diff = product.stock - calculatedStock;

                if (Math.abs(diff) > 0) {
                    discrepancies.push({
                        product_id: product.id,
                        product_name: product.name,
                        sku: product.sku,
                        current_stock: product.stock,
                        calculated_stock: calculatedStock,
                        discrepancy: diff
                    });
                }
            }
        }

        if (discrepancies.length === 0) {
            console.log('  ✅ No stock discrepancies found (checked 50 products)');
            return null;
        }

        console.log(`  ⚠️  Found ${discrepancies.length} products with stock discrepancies`);

        return {
            category: 'Stock Discrepancies',
            severity: 'warning',
            count: discrepancies.length,
            details: discrepancies.slice(0, 10),
            action: 'Review inventory_movements for missing records. Run recalculate_stock() if needed.'
        };
    }

    if (error) {
        console.error('  Error checking stock:', error.message);
        return null;
    }

    if (!data || data.length === 0) {
        console.log('  ✅ No stock discrepancies found');
        return null;
    }

    return {
        category: 'Stock Discrepancies',
        severity: 'warning',
        count: data.length,
        details: data.slice(0, 10),
        action: 'Review inventory_movements for missing records'
    };
}

async function checkDuplicateSKUs(): Promise<IntegrityIssue | null> {
    console.log('\n🔍 Checking for duplicate SKUs per store...');

    const { data, error } = await supabase
        .from('products')
        .select('store_id, sku, name')
        .not('sku', 'is', null)
        .neq('sku', '');

    if (error) {
        console.error('  Error querying SKUs:', error.message);
        return null;
    }

    if (!data) {
        console.log('  ✅ No products found');
        return null;
    }

    // Group by store_id + sku and find duplicates
    const skuMap = new Map<string, { count: number; names: string[] }>();

    for (const product of data) {
        const key = `${product.store_id}:${product.sku}`;
        const existing = skuMap.get(key);
        if (existing) {
            existing.count++;
            existing.names.push(product.name);
        } else {
            skuMap.set(key, { count: 1, names: [product.name] });
        }
    }

    const duplicates = Array.from(skuMap.entries())
        .filter(([_, v]) => v.count > 1)
        .map(([key, v]) => {
            const [storeId, sku] = key.split(':');
            return {
                store_id: storeId,
                sku,
                count: v.count,
                product_names: v.names
            };
        });

    if (duplicates.length === 0) {
        console.log('  ✅ No duplicate SKUs found');
        return null;
    }

    console.log(`  ⚠️  Found ${duplicates.length} duplicate SKU groups`);

    return {
        category: 'Duplicate SKUs',
        severity: 'warning',
        count: duplicates.length,
        details: duplicates.slice(0, 10),
        action: 'Merge or rename duplicate SKUs to ensure unique product mapping'
    };
}

async function checkOrphanedPickingSessions(): Promise<IntegrityIssue | null> {
    console.log('\n🔍 Checking for orphaned picking sessions...');

    // Find picking sessions with no orders (all orders were deleted/cancelled)
    const { data, error } = await supabase
        .from('picking_sessions')
        .select(`
            id,
            code,
            status,
            created_at,
            store_id,
            picking_session_orders!inner (
                order_id,
                orders!inner (
                    sleeves_status,
                    deleted_at
                )
            )
        `)
        .in('status', ['picking', 'packing']);

    if (error) {
        console.error('  Error querying picking sessions:', error.message);
        return null;
    }

    if (!data) {
        console.log('  ✅ No active picking sessions');
        return null;
    }

    // Find sessions where all orders are cancelled/deleted
    const orphaned = data.filter((session: any) => {
        const orders = session.picking_session_orders || [];
        return orders.every((pso: any) =>
            pso.orders?.sleeves_status === 'cancelled' ||
            pso.orders?.sleeves_status === 'rejected' ||
            pso.orders?.deleted_at !== null
        );
    });

    if (orphaned.length === 0) {
        console.log('  ✅ No orphaned picking sessions');
        return null;
    }

    console.log(`  ⚠️  Found ${orphaned.length} orphaned picking sessions`);

    return {
        category: 'Orphaned Picking Sessions',
        severity: 'info',
        count: orphaned.length,
        details: orphaned.slice(0, 10).map((s: any) => ({
            code: s.code,
            status: s.status,
            created_at: s.created_at
        })),
        action: 'Cancel or complete these sessions manually'
    };
}

async function checkInconsistentTotals(): Promise<IntegrityIssue | null> {
    console.log('\n🔍 Checking for orders with inconsistent totals...');

    // Get orders with their line item sums
    const { data: orders, error } = await supabase
        .from('orders')
        .select(`
            id,
            order_number,
            total_price,
            sleeves_status,
            order_line_items (
                total_price
            )
        `)
        .is('deleted_at', null)
        .limit(500);

    if (error) {
        console.error('  Error querying orders:', error.message);
        return null;
    }

    if (!orders) {
        console.log('  ✅ No orders found');
        return null;
    }

    const inconsistent = orders
        .map((order: any) => {
            const lineItemsTotal = (order.order_line_items || [])
                .reduce((sum: number, li: any) => sum + (parseFloat(li.total_price) || 0), 0);
            const orderTotal = parseFloat(order.total_price) || 0;
            const difference = Math.abs(orderTotal - lineItemsTotal);

            return {
                order_id: order.id,
                order_number: order.order_number,
                status: order.sleeves_status,
                recorded_total: orderTotal,
                calculated_total: lineItemsTotal,
                difference
            };
        })
        .filter((o: any) => o.difference > 1); // Tolerance of 1 for rounding

    if (inconsistent.length === 0) {
        console.log('  ✅ No orders with inconsistent totals');
        return null;
    }

    console.log(`  ⚠️  Found ${inconsistent.length} orders with inconsistent totals`);

    return {
        category: 'Inconsistent Order Totals',
        severity: 'info',
        count: inconsistent.length,
        details: inconsistent.slice(0, 10),
        action: 'May be caused by manual adjustments, discounts, or shipping. Review if necessary.'
    };
}

async function main() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('                 ORDEFY DATA INTEGRITY CHECK                    ');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Timestamp: ${new Date().toISOString()}`);

    const issues: IntegrityIssue[] = [];

    // Run all checks
    const checks = [
        checkUnmappedProducts,
        checkStockDiscrepancies,
        checkDuplicateSKUs,
        checkOrphanedPickingSessions,
        checkInconsistentTotals
    ];

    for (const check of checks) {
        try {
            const issue = await check();
            if (issue) {
                issues.push(issue);
            }
        } catch (err) {
            console.error(`  Error running check:`, err);
        }
    }

    // Summary
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('                         SUMMARY                                ');
    console.log('═══════════════════════════════════════════════════════════════');

    if (issues.length === 0) {
        console.log('\n✅ All checks passed! No data integrity issues found.\n');
    } else {
        const critical = issues.filter(i => i.severity === 'critical');
        const warnings = issues.filter(i => i.severity === 'warning');
        const info = issues.filter(i => i.severity === 'info');

        console.log(`\nFound ${issues.length} issue(s):`);
        console.log(`  🔴 Critical: ${critical.length}`);
        console.log(`  🟠 Warning:  ${warnings.length}`);
        console.log(`  🔵 Info:     ${info.length}`);

        console.log('\n--- DETAILED ISSUES ---\n');

        for (const issue of issues) {
            const icon = issue.severity === 'critical' ? '🔴' : issue.severity === 'warning' ? '🟠' : '🔵';
            console.log(`${icon} ${issue.category.toUpperCase()} (${issue.count} items)`);
            console.log(`   Action: ${issue.action}`);
            console.log('   Sample:', JSON.stringify(issue.details.slice(0, 3), null, 2));
            console.log('');
        }
    }

    console.log('═══════════════════════════════════════════════════════════════\n');

    // Exit with error code if critical issues found
    const hasCritical = issues.some(i => i.severity === 'critical');
    process.exit(hasCritical ? 1 : 0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
