#!/bin/bash
# ================================================================
# Script: Apply Migration 064 - Fix Product Duplicates
# ================================================================
# This script applies the migration to fix Shopify webhook errors
# caused by duplicate products
# ================================================================

set -e  # Exit on error

echo "================================================================"
echo "🔧 Applying Migration 064: Fix Product Duplicates"
echo "================================================================"

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ ERROR: DATABASE_URL environment variable is not set"
    echo ""
    echo "Please set it in your .env file or export it:"
    echo "  export DATABASE_URL='postgresql://...'"
    exit 1
fi

# Get the database URL (mask password in output)
DB_URL_MASKED=$(echo "$DATABASE_URL" | sed 's/:[^:]*@/:***@/')
echo "📊 Database: $DB_URL_MASKED"
echo ""

# Step 1: Apply main migration
echo "Step 1/3: Cleaning duplicates and creating index..."
psql "$DATABASE_URL" -f db/migrations/064_fix_product_duplicates_constraint.sql

if [ $? -eq 0 ]; then
    echo "✅ Step 1 completed successfully"
    echo ""
else
    echo "❌ Step 1 failed"
    exit 1
fi

# Step 2: Verify no duplicates remain
echo "Step 2/3: Verifying no duplicates remain..."
DUPLICATE_COUNT=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*)
    FROM (
        SELECT shopify_product_id, store_id, COUNT(*) as cnt
        FROM products
        WHERE shopify_product_id IS NOT NULL
        GROUP BY shopify_product_id, store_id
        HAVING COUNT(*) > 1
    ) duplicates;
")

DUPLICATE_COUNT=$(echo $DUPLICATE_COUNT | xargs)  # Trim whitespace

if [ "$DUPLICATE_COUNT" = "0" ]; then
    echo "✅ No duplicates found - database is clean"
    echo ""
else
    echo "⚠️  WARNING: Still found $DUPLICATE_COUNT duplicate product groups"
    echo "   Please review manually"
    echo ""
fi

# Step 3: Verify index was created
echo "Step 3/3: Verifying index was created..."
INDEX_EXISTS=$(psql "$DATABASE_URL" -t -c "
    SELECT COUNT(*)
    FROM pg_indexes
    WHERE indexname = 'idx_products_unique_shopify_product_store';
")

INDEX_EXISTS=$(echo $INDEX_EXISTS | xargs)

if [ "$INDEX_EXISTS" = "1" ]; then
    echo "✅ Index created successfully: idx_products_unique_shopify_product_store"
    echo ""
else
    echo "❌ Index was not created - may need to run 064b manually"
    echo ""
fi

echo "================================================================"
echo "✅ Migration 064 Applied Successfully"
echo "================================================================"
echo ""
echo "Next steps:"
echo "1. Update api_secret_key for bright-idea (run scripts/fix-bright-idea-api-secret.sql)"
echo "2. Deploy code changes (git push)"
echo "3. Monitor webhooks for 24-48h"
echo ""
echo "To verify webhooks are working:"
echo "  psql \$DATABASE_URL -c \"SELECT shop_domain, shopify_topic, processing_error FROM shopify_webhook_events WHERE created_at > NOW() - INTERVAL '1 day' AND processing_error IS NOT NULL;\""
echo ""
