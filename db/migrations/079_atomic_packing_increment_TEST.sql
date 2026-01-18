-- ================================================================
-- TEST SCRIPT for Migration 079: Atomic Packing Increment
-- ================================================================
-- Run this AFTER applying migration 079 to verify correctness
-- ================================================================

BEGIN;

-- Cleanup any test data
DELETE FROM packing_progress WHERE picking_session_id IN (
    SELECT id FROM picking_sessions WHERE code LIKE 'TEST-%'
);
DELETE FROM picking_session_items WHERE picking_session_id IN (
    SELECT id FROM picking_sessions WHERE code LIKE 'TEST-%'
);
DELETE FROM picking_session_orders WHERE picking_session_id IN (
    SELECT id FROM picking_sessions WHERE code LIKE 'TEST-%'
);
DELETE FROM picking_sessions WHERE code LIKE 'TEST-%';
DELETE FROM orders WHERE order_number LIKE 'TEST-%';
DELETE FROM products WHERE name LIKE 'TEST-PRODUCT-%';

-- Get a valid store_id (use first available store)
DO $$
DECLARE
    v_store_id UUID;
    v_session_id UUID;
    v_order_id UUID;
    v_product_id UUID;
    v_progress_id UUID;
    v_result RECORD;
BEGIN
    -- Get or create test store
    SELECT id INTO v_store_id FROM stores LIMIT 1;

    IF v_store_id IS NULL THEN
        RAISE EXCEPTION 'No stores found in database. Create a store first.';
    END IF;

    RAISE NOTICE '✓ Using store_id: %', v_store_id;

    -- Create test product
    INSERT INTO products (store_id, name, sku, price, cost, stock)
    VALUES (v_store_id, 'TEST-PRODUCT-ATOMIC', 'TEST-SKU-001', 100, 50, 100)
    RETURNING id INTO v_product_id;

    RAISE NOTICE '✓ Created test product: %', v_product_id;

    -- Create test order
    INSERT INTO orders (
        store_id,
        order_number,
        sleeves_status,
        customer_name,
        customer_phone,
        shipping_address,
        total_price
    )
    VALUES (
        v_store_id,
        'TEST-ORDER-001',
        'confirmed',
        'Test Customer',
        '0981234567',
        '{"address1": "Test Address 123", "city": "Test City"}'::jsonb,
        100
    )
    RETURNING id INTO v_order_id;

    RAISE NOTICE '✓ Created test order: %', v_order_id;

    -- Create test picking session
    INSERT INTO picking_sessions (store_id, code, status, packing_started_at)
    VALUES (v_store_id, 'TEST-SESSION-001', 'packing', NOW())
    RETURNING id INTO v_session_id;

    RAISE NOTICE '✓ Created test session: %', v_session_id;

    -- Link order to session
    INSERT INTO picking_session_orders (picking_session_id, order_id)
    VALUES (v_session_id, v_order_id);

    -- Add picked items
    INSERT INTO picking_session_items (
        picking_session_id,
        product_id,
        total_quantity_needed,
        quantity_picked
    )
    VALUES (v_session_id, v_product_id, 10, 10);

    RAISE NOTICE '✓ Created 10 picked items (needed: 10, picked: 10)';

    -- Create packing progress
    INSERT INTO packing_progress (
        picking_session_id,
        order_id,
        product_id,
        quantity_needed,
        quantity_packed
    )
    VALUES (v_session_id, v_order_id, v_product_id, 5, 0)
    RETURNING id INTO v_progress_id;

    RAISE NOTICE '✓ Created packing progress (need: 5, packed: 0)';

    -- ================================================================
    -- TEST 1: Basic increment
    -- ================================================================
    RAISE NOTICE '';
    RAISE NOTICE '=== TEST 1: Basic Increment ===';

    SELECT * INTO v_result FROM increment_packing_quantity(
        v_progress_id,
        5,  -- quantity_needed
        10, -- picked_quantity
        v_session_id,
        v_product_id
    );

    IF v_result.quantity_packed = 1 THEN
        RAISE NOTICE '✓ TEST 1 PASSED: quantity_packed incremented to 1';
    ELSE
        RAISE EXCEPTION '✗ TEST 1 FAILED: Expected 1, got %', v_result.quantity_packed;
    END IF;

    -- ================================================================
    -- TEST 2: Multiple increments (simulate concurrent requests)
    -- ================================================================
    RAISE NOTICE '';
    RAISE NOTICE '=== TEST 2: Multiple Increments ===';

    -- Increment 4 more times (should reach 5)
    FOR i IN 2..5 LOOP
        SELECT * INTO v_result FROM increment_packing_quantity(
            v_progress_id,
            5,
            10,
            v_session_id,
            v_product_id
        );
        RAISE NOTICE '  Increment %: quantity_packed = %', i, v_result.quantity_packed;
    END LOOP;

    IF v_result.quantity_packed = 5 THEN
        RAISE NOTICE '✓ TEST 2 PASSED: Successfully incremented to 5';
    ELSE
        RAISE EXCEPTION '✗ TEST 2 FAILED: Expected 5, got %', v_result.quantity_packed;
    END IF;

    -- ================================================================
    -- TEST 3: Prevent over-packing (should raise exception)
    -- ================================================================
    RAISE NOTICE '';
    RAISE NOTICE '=== TEST 3: Prevent Over-Packing ===';

    BEGIN
        SELECT * INTO v_result FROM increment_packing_quantity(
            v_progress_id,
            5,
            10,
            v_session_id,
            v_product_id
        );
        RAISE EXCEPTION '✗ TEST 3 FAILED: Should have raised exception for over-packing';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM LIKE '%already fully packed%' THEN
                RAISE NOTICE '✓ TEST 3 PASSED: Correctly prevented over-packing';
            ELSE
                RAISE EXCEPTION '✗ TEST 3 FAILED: Wrong error: %', SQLERRM;
            END IF;
    END;

    -- ================================================================
    -- TEST 4: Validate basket limit
    -- ================================================================
    RAISE NOTICE '';
    RAISE NOTICE '=== TEST 4: Basket Limit Validation ===';

    -- Update progress to have more space (and already at basket limit)
    UPDATE packing_progress
    SET quantity_needed = 15, quantity_packed = 10  -- Already at limit (10/10 picked)
    WHERE id = v_progress_id;

    -- Try to pack beyond picked quantity (10 total, already packed 10, trying to pack 11th)
    BEGIN
        SELECT * INTO v_result FROM increment_packing_quantity(
            v_progress_id,
            15,   -- quantity_needed
            10,   -- picked_quantity (basket has 10)
            v_session_id,
            v_product_id
        );
        RAISE EXCEPTION '✗ TEST 4 FAILED: Should have raised exception for basket limit';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM LIKE '%No more units available%' THEN
                RAISE NOTICE '✓ TEST 4 PASSED: Correctly enforced basket limit';
            ELSE
                RAISE EXCEPTION '✗ TEST 4 FAILED: Wrong error: %', SQLERRM;
            END IF;
    END;

    -- ================================================================
    -- TEST 5: Validate session status
    -- ================================================================
    RAISE NOTICE '';
    RAISE NOTICE '=== TEST 5: Session Status Validation ===';

    -- Change session to completed
    UPDATE picking_sessions SET status = 'completed' WHERE id = v_session_id;

    -- Reset progress for test
    UPDATE packing_progress SET quantity_packed = 0 WHERE id = v_progress_id;

    BEGIN
        SELECT * INTO v_result FROM increment_packing_quantity(
            v_progress_id,
            15,
            10,
            v_session_id,
            v_product_id
        );
        RAISE EXCEPTION '✗ TEST 5 FAILED: Should have raised exception for wrong session status';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM LIKE '%not in packing status%' THEN
                RAISE NOTICE '✓ TEST 5 PASSED: Correctly validated session status';
            ELSE
                RAISE EXCEPTION '✗ TEST 5 FAILED: Wrong error: %', SQLERRM;
            END IF;
    END;

    -- ================================================================
    -- TEST 6: Validate order status (prevent packing completed orders)
    -- ================================================================
    RAISE NOTICE '';
    RAISE NOTICE '=== TEST 6: Order Status Validation ===';

    -- Fix session status
    UPDATE picking_sessions SET status = 'packing' WHERE id = v_session_id;

    -- Change order to ready_to_ship (stock already decremented)
    UPDATE orders SET sleeves_status = 'ready_to_ship' WHERE id = v_order_id;

    BEGIN
        SELECT * INTO v_result FROM increment_packing_quantity(
            v_progress_id,
            15,
            10,
            v_session_id,
            v_product_id
        );
        RAISE EXCEPTION '✗ TEST 6 FAILED: Should have raised exception for completed order';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM LIKE '%already been completed%' THEN
                RAISE NOTICE '✓ TEST 6 PASSED: Correctly blocked packing of completed order';
            ELSE
                RAISE EXCEPTION '✗ TEST 6 FAILED: Wrong error: %', SQLERRM;
            END IF;
    END;

    -- ================================================================
    -- TEST 7: Validate session activity timestamp update
    -- ================================================================
    RAISE NOTICE '';
    RAISE NOTICE '=== TEST 7: Session Activity Update ===';

    -- Fix order status
    UPDATE orders SET sleeves_status = 'confirmed' WHERE id = v_order_id;

    -- Set old timestamp
    UPDATE picking_sessions
    SET last_activity_at = NOW() - INTERVAL '2 hours'
    WHERE id = v_session_id;

    -- Record old timestamp
    DECLARE
        v_old_activity TIMESTAMPTZ;
        v_new_activity TIMESTAMPTZ;
    BEGIN
        SELECT last_activity_at INTO v_old_activity
        FROM picking_sessions WHERE id = v_session_id;

        -- Pack one item
        SELECT * INTO v_result FROM increment_packing_quantity(
            v_progress_id,
            15,
            10,
            v_session_id,
            v_product_id
        );

        SELECT last_activity_at INTO v_new_activity
        FROM picking_sessions WHERE id = v_session_id;

        IF v_new_activity > v_old_activity THEN
            RAISE NOTICE '✓ TEST 7 PASSED: Session activity timestamp updated';
        ELSE
            RAISE EXCEPTION '✗ TEST 7 FAILED: Timestamp not updated (old: %, new: %)',
                v_old_activity, v_new_activity;
        END IF;
    END;

    -- ================================================================
    -- ALL TESTS COMPLETED
    -- ================================================================
    RAISE NOTICE '';
    RAISE NOTICE '================================================================';
    RAISE NOTICE '✓✓✓ ALL TESTS PASSED ✓✓✓';
    RAISE NOTICE '================================================================';
    RAISE NOTICE 'Function increment_packing_quantity() is production-ready!';
    RAISE NOTICE '================================================================';

END $$;

-- Cleanup test data
DELETE FROM packing_progress WHERE picking_session_id IN (
    SELECT ps.id FROM picking_sessions ps WHERE ps.code LIKE 'TEST-%'
);
DELETE FROM picking_session_items WHERE picking_session_id IN (
    SELECT ps.id FROM picking_sessions ps WHERE ps.code LIKE 'TEST-%'
);
DELETE FROM picking_session_orders WHERE picking_session_id IN (
    SELECT ps.id FROM picking_sessions ps WHERE ps.code LIKE 'TEST-%'
);
DELETE FROM picking_sessions WHERE code LIKE 'TEST-%';
DELETE FROM orders WHERE order_number LIKE 'TEST-%';
DELETE FROM products WHERE name LIKE 'TEST-PRODUCT-%';

ROLLBACK; -- Don't commit test data
