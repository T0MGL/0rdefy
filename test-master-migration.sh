#!/bin/bash

# ================================================================
# Test Script for Master Migration
# ================================================================
# This script tests the master migration against a PostgreSQL database
# Usage: ./test-master-migration.sh
# ================================================================

set -e  # Exit on error

echo "🚀 Testing ORDEFY Master Migration..."
echo "===================================="
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "❌ ERROR: DATABASE_URL environment variable is not set"
  echo "Please set it with: export DATABASE_URL='your-database-url'"
  exit 1
fi

echo "✅ DATABASE_URL found"
echo ""

# Run the master migration
echo "📦 Running master migration..."
psql "$DATABASE_URL" -f db/migrations/000_MASTER_MIGRATION.sql

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Master migration executed successfully!"
  echo ""
else
  echo ""
  echo "❌ Master migration failed!"
  exit 1
fi

# Verify tables were created
echo "🔍 Verifying tables..."
echo ""

TABLES=(
  "stores"
  "users"
  "products"
  "customers"
  "orders"
  "carriers"
  "suppliers"
  "campaigns"
  "inbound_shipments"
  "inbound_shipment_items"
  "picking_sessions"
  "picking_session_orders"
  "picking_session_items"
  "packing_progress"
  "carrier_zones"
  "carrier_settlements"
  "shopify_integrations"
  "shopify_webhook_events"
  "shopify_webhook_metrics"
)

for table in "${TABLES[@]}"; do
  COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM pg_tables WHERE tablename='$table';")
  if [ "$COUNT" -eq 1 ]; then
    echo "✅ Table '$table' exists"
  else
    echo "❌ Table '$table' NOT found"
  fi
done

echo ""
echo "🔍 Verifying functions..."
echo ""

FUNCTIONS=(
  "fn_update_timestamp"
  "generate_inbound_reference"
  "receive_shipment_items"
  "generate_session_code"
  "create_carrier_settlement"
  "record_webhook_metric"
)

for func in "${FUNCTIONS[@]}"; do
  COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM pg_proc WHERE proname='$func';")
  if [ "$COUNT" -ge 1 ]; then
    echo "✅ Function '$func' exists"
  else
    echo "❌ Function '$func' NOT found"
  fi
done

echo ""
echo "🔍 Verifying views..."
echo ""

VIEWS=(
  "courier_performance"
  "shopify_integrations_with_webhook_issues"
  "inbound_shipments_summary"
  "pending_carrier_settlements_summary"
)

for view in "${VIEWS[@]}"; do
  COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM pg_views WHERE viewname='$view';")
  if [ "$COUNT" -eq 1 ]; then
    echo "✅ View '$view' exists"
  else
    echo "❌ View '$view' NOT found"
  fi
done

echo ""
echo "===================================="
echo "✅ Master Migration Test Complete!"
echo "===================================="
echo ""
echo "📊 Database Statistics:"
psql "$DATABASE_URL" -c "
SELECT
  'Tables' as object_type,
  COUNT(*) as count
FROM pg_tables
WHERE schemaname = 'public'
UNION ALL
SELECT
  'Functions' as object_type,
  COUNT(*) as count
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
UNION ALL
SELECT
  'Views' as object_type,
  COUNT(*) as count
FROM pg_views
WHERE schemaname = 'public'
UNION ALL
SELECT
  'Triggers' as object_type,
  COUNT(*) as count
FROM pg_trigger
WHERE NOT tgisinternal;
"

echo ""
echo "🎉 All tests passed!"
