-- ================================================================
-- MIGRATION SCRIPT: Migrate existing Shopify orders to use normalized line items
-- ================================================================
-- This script processes all existing orders that have line_items in JSONB
-- and creates normalized order_line_items records with product mapping
-- ================================================================
-- Usage:
--   psql $DATABASE_URL -f migrate-existing-orders.sql
-- ================================================================

DO $$
DECLARE
    v_order RECORD;
    v_items_created INTEGER;
    v_total_orders INTEGER := 0;
    v_total_items INTEGER := 0;
    v_orders_processed INTEGER := 0;
    v_errors INTEGER := 0;
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Starting migration of existing orders to normalized line items';
    RAISE NOTICE '========================================';

    -- Count total orders with line_items
    SELECT COUNT(*) INTO v_total_orders
    FROM orders
    WHERE line_items IS NOT NULL
      AND jsonb_array_length(line_items) > 0;

    RAISE NOTICE 'Found % orders with line_items to process', v_total_orders;
    RAISE NOTICE '';

    -- Process each order
    FOR v_order IN
        SELECT id, store_id, line_items, shopify_order_id, shopify_order_number
        FROM orders
        WHERE line_items IS NOT NULL
          AND jsonb_array_length(line_items) > 0
        ORDER BY created_at DESC
    LOOP
        BEGIN
            -- Check if this order already has line items
            IF EXISTS (
                SELECT 1 FROM order_line_items WHERE order_id = v_order.id LIMIT 1
            ) THEN
                RAISE NOTICE 'Order % (Shopify #%) already has line items, skipping',
                    v_order.id, COALESCE(v_order.shopify_order_number, 'N/A');
                CONTINUE;
            END IF;

            -- Create line items using the function
            v_items_created := create_line_items_from_shopify(
                v_order.id,
                v_order.store_id,
                v_order.line_items
            );

            v_orders_processed := v_orders_processed + 1;
            v_total_items := v_total_items + v_items_created;

            RAISE NOTICE '[%/%] ✅ Order % (Shopify #%): Created % line items',
                v_orders_processed,
                v_total_orders,
                v_order.id,
                COALESCE(v_order.shopify_order_number, 'N/A'),
                v_items_created;

        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            RAISE WARNING '[%/%] ❌ Error processing order %: %',
                v_orders_processed + 1,
                v_total_orders,
                v_order.id,
                SQLERRM;
        END;
    END LOOP;

    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Migration complete!';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Total orders found: %', v_total_orders;
    RAISE NOTICE 'Orders processed: %', v_orders_processed;
    RAISE NOTICE 'Total line items created: %', v_total_items;
    RAISE NOTICE 'Errors: %', v_errors;
    RAISE NOTICE '';

    IF v_errors > 0 THEN
        RAISE WARNING '⚠️  Some orders had errors. Check the logs above.';
    ELSE
        RAISE NOTICE '✅ All orders migrated successfully!';
    END IF;

END $$;

-- ================================================================
-- Verification queries
-- ================================================================

\echo ''
\echo '========================================';
\echo 'Verification Results';
\echo '========================================';

-- Count orders with and without line items
SELECT
    'Orders with JSONB line_items' as metric,
    COUNT(*) as count
FROM orders
WHERE line_items IS NOT NULL
  AND jsonb_array_length(line_items) > 0

UNION ALL

SELECT
    'Orders with normalized line_items' as metric,
    COUNT(DISTINCT order_id) as count
FROM order_line_items

UNION ALL

SELECT
    'Total normalized line items' as metric,
    COUNT(*) as count
FROM order_line_items

UNION ALL

SELECT
    'Line items with product mapping' as metric,
    COUNT(*) as count
FROM order_line_items
WHERE product_id IS NOT NULL

UNION ALL

SELECT
    'Line items WITHOUT product mapping' as metric,
    COUNT(*) as count
FROM order_line_items
WHERE product_id IS NULL;

\echo ''
\echo 'Sample of unmapped products (line items without product_id):';

SELECT DISTINCT
    shopify_product_id,
    shopify_variant_id,
    sku,
    product_name,
    COUNT(*) as occurrences
FROM order_line_items
WHERE product_id IS NULL
  AND shopify_product_id IS NOT NULL
GROUP BY shopify_product_id, shopify_variant_id, sku, product_name
ORDER BY occurrences DESC
LIMIT 10;

\echo ''
\echo '✅ Migration verification complete!';
