#!/bin/bash

# ================================================================
# Stock Concurrency Test
# ================================================================
# Tests the fixed stock management system with concurrent updates
# Verifies that race conditions are prevented and stock validation works
# ================================================================

set -e

source .env

echo "========================================"
echo "Stock Concurrency Test"
echo "========================================"
echo

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ================================================================
# Setup: Create test product with limited stock
# ================================================================

echo "1. Creating test product with stock=5..."
PRODUCT_RESULT=$(psql "$DATABASE_URL" -t -c "
INSERT INTO products (store_id, name, price, cost, stock, sku)
SELECT
    id as store_id,
    'Test Product - Concurrency' as name,
    100 as price,
    50 as cost,
    5 as stock,
    'TEST-CONC-001' as sku
FROM stores LIMIT 1
RETURNING id, stock;
")

PRODUCT_ID=$(echo "$PRODUCT_RESULT" | awk '{print $1}' | tr -d ' ')
INITIAL_STOCK=$(echo "$PRODUCT_RESULT" | awk '{print $3}' | tr -d ' ')

echo -e "${GREEN}✓ Product created: $PRODUCT_ID (stock: $INITIAL_STOCK)${NC}"
echo

# ================================================================
# Create two orders that will compete for stock
# ================================================================

echo "2. Creating two orders with competing stock requirements..."

# Order 1: Needs 4 units (should succeed)
ORDER1_RESULT=$(psql "$DATABASE_URL" -t -c "
INSERT INTO orders (store_id, customer_id, sleeves_status, line_items, total_price, subtotal)
SELECT
    s.id as store_id,
    (SELECT id FROM customers WHERE store_id = s.id LIMIT 1) as customer_id,
    'in_preparation' as sleeves_status,
    jsonb_build_array(
        jsonb_build_object(
            'product_id', '$PRODUCT_ID',
            'quantity', 4,
            'unit_price', 100,
            'subtotal', 400
        )
    ) as line_items,
    400 as total_price,
    400 as subtotal
FROM stores s LIMIT 1
RETURNING id;
")

ORDER1_ID=$(echo "$ORDER1_RESULT" | tr -d ' ')

# Order 2: Needs 3 units (should fail due to insufficient stock)
ORDER2_RESULT=$(psql "$DATABASE_URL" -t -c "
INSERT INTO orders (store_id, customer_id, sleeves_status, line_items, total_price, subtotal)
SELECT
    s.id as store_id,
    (SELECT id FROM customers WHERE store_id = s.id LIMIT 1) as customer_id,
    'in_preparation' as sleeves_status,
    jsonb_build_array(
        jsonb_build_object(
            'product_id', '$PRODUCT_ID',
            'quantity', 3,
            'unit_price', 100,
            'subtotal', 300
        )
    ) as line_items,
    300 as total_price,
    300 as subtotal
FROM stores s LIMIT 1
RETURNING id;
")

ORDER2_ID=$(echo "$ORDER2_RESULT" | tr -d ' ')

echo -e "${GREEN}✓ Order 1 created: $ORDER1_ID (needs 4 units)${NC}"
echo -e "${GREEN}✓ Order 2 created: $ORDER2_ID (needs 3 units)${NC}"
echo

# ================================================================
# Test concurrent updates
# ================================================================

echo "3. Testing concurrent stock updates..."
echo -e "${YELLOW}Attempting to move both orders to ready_to_ship simultaneously...${NC}"
echo

# Function to update order status
update_order() {
    local order_id=$1
    local order_num=$2

    echo "[$order_num] Updating order $order_id..."

    if psql "$DATABASE_URL" -c "
        UPDATE orders
        SET sleeves_status = 'ready_to_ship'
        WHERE id = '$order_id';
    " 2>&1; then
        echo -e "[$order_num] ${GREEN}✓ Success${NC}"
        return 0
    else
        echo -e "[$order_num] ${RED}✗ Failed${NC}"
        return 1
    fi
}

# Run both updates in parallel
update_order "$ORDER1_ID" "Order1" &
PID1=$!

update_order "$ORDER2_ID" "Order2" &
PID2=$!

# Wait for both to complete
wait $PID1
RESULT1=$?

wait $PID2
RESULT2=$?

echo

# ================================================================
# Check results
# ================================================================

echo "4. Verification Results:"
echo "----------------------------------------"

# Check current stock
CURRENT_STOCK=$(psql "$DATABASE_URL" -t -c "
    SELECT stock FROM products WHERE id = '$PRODUCT_ID';
" | tr -d ' ')

echo "Initial stock: $INITIAL_STOCK"
echo "Current stock: $CURRENT_STOCK"
echo

# Check order statuses
echo "Order statuses:"
psql "$DATABASE_URL" -c "
    SELECT
        id,
        sleeves_status,
        (line_items->0->>'quantity')::INT as quantity_ordered,
        total_price
    FROM orders
    WHERE id IN ('$ORDER1_ID', '$ORDER2_ID')
    ORDER BY created_at;
"
echo

# Check inventory movements
echo "Inventory movements log:"
psql "$DATABASE_URL" -c "
    SELECT
        movement_type,
        quantity_change,
        stock_before,
        stock_after,
        order_id,
        notes,
        created_at
    FROM inventory_movements
    WHERE product_id = '$PRODUCT_ID'
    ORDER BY created_at DESC;
"
echo

# ================================================================
# Analysis
# ================================================================

echo "========================================"
echo "Analysis:"
echo "========================================"

SUCCESSFUL_ORDERS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*)
    FROM orders
    WHERE id IN ('$ORDER1_ID', '$ORDER2_ID')
    AND sleeves_status = 'ready_to_ship';
" | tr -d ' ')

echo "• Orders that reached ready_to_ship: $SUCCESSFUL_ORDERS"
echo "• Stock decremented: $((INITIAL_STOCK - CURRENT_STOCK)) units"

if [ "$SUCCESSFUL_ORDERS" -eq 1 ] && [ "$CURRENT_STOCK" -eq 1 ]; then
    echo -e "\n${GREEN}✓ TEST PASSED${NC}"
    echo "Concurrency control working correctly:"
    echo "  - Only one order succeeded (the first one)"
    echo "  - Stock was decremented once (5 → 1)"
    echo "  - Second order was rejected due to insufficient stock"
else
    echo -e "\n${RED}✗ TEST FAILED${NC}"
    echo "Expected: 1 order successful, stock = 1"
    echo "Got: $SUCCESSFUL_ORDERS orders successful, stock = $CURRENT_STOCK"
fi

echo

# ================================================================
# Test stock availability check function
# ================================================================

echo "========================================"
echo "Testing stock availability checker:"
echo "========================================"
echo

# Create a new test order
ORDER3_RESULT=$(psql "$DATABASE_URL" -t -c "
INSERT INTO orders (store_id, customer_id, sleeves_status, line_items, total_price, subtotal)
SELECT
    s.id as store_id,
    (SELECT id FROM customers WHERE store_id = s.id LIMIT 1) as customer_id,
    'in_preparation' as sleeves_status,
    jsonb_build_array(
        jsonb_build_object(
            'product_id', '$PRODUCT_ID',
            'quantity', 2,
            'unit_price', 100,
            'subtotal', 200
        )
    ) as line_items,
    200 as total_price,
    200 as subtotal
FROM stores s LIMIT 1
RETURNING id, store_id;
")

ORDER3_ID=$(echo "$ORDER3_RESULT" | awk '{print $1}' | tr -d ' ')
STORE_ID=$(echo "$ORDER3_RESULT" | awk '{print $3}' | tr -d ' ')

echo "Testing with order $ORDER3_ID (needs 2 units, available: $CURRENT_STOCK)"
echo

psql "$DATABASE_URL" -c "
    SELECT
        product_name,
        required_quantity,
        available_stock,
        CASE
            WHEN is_sufficient THEN '✓ Sufficient'
            ELSE '✗ Insufficient'
        END as status
    FROM check_order_stock_availability('$ORDER3_ID', '$STORE_ID');
"

echo

# ================================================================
# Cleanup
# ================================================================

echo "========================================"
echo "Cleanup"
echo "========================================"

read -p "Delete test data? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    psql "$DATABASE_URL" -c "
        DELETE FROM orders WHERE id IN ('$ORDER1_ID', '$ORDER2_ID', '$ORDER3_ID');
        DELETE FROM inventory_movements WHERE product_id = '$PRODUCT_ID';
        DELETE FROM products WHERE id = '$PRODUCT_ID';
    "
    echo -e "${GREEN}✓ Test data cleaned up${NC}"
else
    echo "Test data preserved for manual inspection"
fi

echo
echo "========================================"
echo "Test Complete"
echo "========================================"
