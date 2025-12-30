#!/bin/bash

# Script para ejecutar la migración 030 en Supabase
# Requiere: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env

set -e

# Cargar variables de entorno
source .env

if [ -z "$VITE_SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "❌ Error: Missing environment variables"
  echo "   Required: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
  exit 1
fi

echo "🔄 Applying Migration 030: Add order_status_url to orders table..."
echo ""

# SQL a ejecutar
SQL=$(cat << 'EOF'
-- Step 1: Add order_status_url column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'order_status_url'
    ) THEN
        ALTER TABLE orders ADD COLUMN order_status_url TEXT;
        RAISE NOTICE '✅ Added order_status_url column to orders table';
    ELSE
        RAISE NOTICE 'ℹ️  order_status_url column already exists in orders table';
    END IF;
END $$;

-- Step 2: Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_orders_order_status_url
ON orders(order_status_url)
WHERE order_status_url IS NOT NULL;

-- Step 3: Add comment for documentation
COMMENT ON COLUMN orders.order_status_url IS 'Shopify order status URL for customer order tracking. Example: https://store.myshopify.com/account/orders/1234567890';
EOF
)

# Ejecutar usando curl y la REST API de Supabase
RESPONSE=$(curl -s -X POST \
  "${VITE_SUPABASE_URL}/rest/v1/rpc/exec" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"query\": \"${SQL}\"}")

if echo "$RESPONSE" | grep -q "error"; then
  echo "❌ Migration failed:"
  echo "$RESPONSE"
  echo ""
  echo "📋 Please run this SQL manually in Supabase SQL Editor:"
  echo "---------------------------------------------------"
  cat db/migrations/030_add_order_status_url.sql
  echo "---------------------------------------------------"
  exit 1
else
  echo "✅ Migration 030 applied successfully!"
  echo ""
  echo "📋 Summary:"
  echo "   - Added order_status_url column to orders table"
  echo "   - Added index idx_orders_order_status_url"
  echo "   - Shopify webhooks can now create orders with order_status_url"
  echo ""
fi
