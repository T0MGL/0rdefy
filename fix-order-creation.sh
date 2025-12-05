#!/bin/bash

# ================================================================
# Fix Order Creation COALESCE Type Mismatch
# ================================================================

echo "🔧 Fixing COALESCE type mismatch in generate_order_number function..."
echo ""

# Source .env file if it exists
if [ -f .env ]; then
    source .env
    echo "✅ Loaded environment variables from .env"
fi

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ ERROR: DATABASE_URL environment variable is not set"
    echo "Please set DATABASE_URL in your .env file or export it"
    exit 1
fi

echo ""
echo "📝 Applying migration 026: Fix generate_order_number COALESCE..."
echo ""

# Apply migration
psql "$DATABASE_URL" -f db/migrations/026_fix_generate_order_number_coalesce.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Migration applied successfully!"
    echo ""
    echo "🧪 Verifying function was updated..."
    psql "$DATABASE_URL" -c "\df generate_order_number" -t
    echo ""
    echo "✅ Fix complete! You can now create orders without COALESCE errors."
    echo ""
    echo "📝 Summary of fixes:"
    echo "  - Changed COALESCE(shopify_order_number, ...) to COALESCE(shopify_order_number::TEXT, ...)"
    echo "  - This ensures both arguments to COALESCE are the same type (TEXT)"
    echo ""
else
    echo ""
    echo "❌ Migration failed. Check the error above."
    exit 1
fi
