#!/bin/bash

# ================================================================
# Apply Customer Stats COALESCE Fix
# ================================================================

echo "🔧 Applying customer stats COALESCE type fix..."
echo ""

# Source .env file if it exists
if [ -f .env ]; then
    source .env
fi

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ ERROR: DATABASE_URL environment variable is not set"
    exit 1
fi

# Apply migration
echo "📝 Updating fn_update_customer_stats function..."
psql "$DATABASE_URL" -f db/migrations/025_fix_customer_stats_coalesce.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Migration applied successfully!"
    echo ""
    echo "🧪 Testing order creation..."
    echo ""

    # Verify the function was updated
    psql "$DATABASE_URL" -c "\df fn_update_customer_stats" -t

    echo ""
    echo "✅ Fix complete! You can now create orders without COALESCE errors."
else
    echo ""
    echo "❌ Migration failed. Check the error above."
    exit 1
fi
