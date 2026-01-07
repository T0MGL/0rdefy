#!/bin/bash
# ================================================================
# Apply All Pending Migrations to Supabase
# ================================================================
# This script combines migrations 027, 039, and 040 for sequential execution
# ================================================================

echo ""
echo "🔄 PENDING MIGRATIONS TO APPLY"
echo "================================"
echo ""
echo "Migration 027: Shipments System (create_shipments_batch function)"
echo "Migration 039: Cascade Delete Orders (fixing orphaned records)"
echo "Migration 040: Auto-Complete Warehouse Sessions"
echo ""
echo "⚠️  IMPORTANT: Copy the SQL below and execute in Supabase SQL Editor"
echo "URL: https://supabase.com/dashboard/project/vgqecqqleuowvoimcoxg/sql/new"
echo ""
echo "Press ENTER to copy SQL to clipboard..."
read

# Combine all migrations
cat > /tmp/combined_migrations.sql << 'EOF'
-- ================================================================
-- COMBINED MIGRATIONS: 027, 039, 040
-- Execute in Supabase SQL Editor
-- ================================================================

-- ================================================================
-- MIGRATION 027: Shipments System
-- ================================================================
EOF

cat db/migrations/027_shipments_system.sql >> /tmp/combined_migrations.sql

cat >> /tmp/combined_migrations.sql << 'EOF'

-- ================================================================
-- MIGRATION 039: Cascade Delete Orders
-- ================================================================
EOF

cat db/migrations/039_fix_cascade_delete_orders.sql >> /tmp/combined_migrations.sql

cat >> /tmp/combined_migrations.sql << 'EOF'

-- ================================================================
-- MIGRATION 040: Auto-Complete Warehouse Sessions
-- ================================================================
EOF

cat db/migrations/040_auto_complete_warehouse_sessions.sql >> /tmp/combined_migrations.sql

# Copy to clipboard
cat /tmp/combined_migrations.sql | pbcopy

echo ""
echo "✅ Combined migrations SQL copied to clipboard!"
echo ""
echo "📋 Next steps:"
echo "1. Open Supabase SQL Editor"
echo "2. Paste SQL (Cmd+V)"
echo "3. Click 'Run' button"
echo "4. Verify: 'Success. No rows returned'"
echo ""
echo "🎯 After applying:"
echo "  ✅ Shipment dispatch will work"
echo "  ✅ Deleting orders will clean up related records"
echo "  ✅ Warehouse sessions will auto-complete"
echo ""
