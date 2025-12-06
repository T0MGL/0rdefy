#!/bin/bash

# ================================================================
# Ordefy - Order Line Items Migration Script
# ================================================================
# This script applies the order_line_items migration and migrates
# existing Shopify orders to use normalized line items
# ================================================================

set -e  # Exit on error

echo "========================================"
echo "Ordefy - Order Line Items Migration"
echo "========================================"
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ ERROR: DATABASE_URL environment variable is not set"
    echo ""
    echo "Please set it by running:"
    echo "  export DATABASE_URL='your_database_url'"
    echo ""
    exit 1
fi

echo "✅ DATABASE_URL is configured"
echo ""

# Step 1: Apply the schema migration
echo "========================================"
echo "Step 1: Applying schema migration"
echo "========================================"
echo ""
echo "Creating order_line_items table and helper functions..."
echo ""

psql "$DATABASE_URL" -f db/migrations/024_order_line_items.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Schema migration applied successfully"
else
    echo ""
    echo "❌ ERROR: Schema migration failed"
    exit 1
fi

echo ""
echo "========================================"
echo "Step 2: Migrating existing orders"
echo "========================================"
echo ""
echo "Processing existing orders with line_items..."
echo ""

psql "$DATABASE_URL" -f migrate-existing-orders.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Data migration completed successfully"
else
    echo ""
    echo "❌ ERROR: Data migration failed"
    exit 1
fi

echo ""
echo "========================================"
echo "Migration Complete!"
echo "========================================"
echo ""
echo "✅ All migrations applied successfully"
echo ""
echo "What was done:"
echo "  1. Created order_line_items table"
echo "  2. Created helper functions for product mapping"
echo "  3. Updated inventory triggers to use line items"
echo "  4. Migrated existing orders to normalized line items"
echo ""
echo "Next steps:"
echo "  - Restart your backend server to use the new structure"
echo "  - Test creating new orders from Shopify"
echo "  - Verify product mapping in the database"
echo ""
echo "To check unmapped products (products not found in your database):"
echo "  psql \$DATABASE_URL -c \"SELECT DISTINCT shopify_product_id, product_name, COUNT(*) FROM order_line_items WHERE product_id IS NULL GROUP BY shopify_product_id, product_name;\""
echo ""
