#!/bin/bash

# ================================================================
# SHOPIFY WEBHOOK CLEANUP SCRIPT
# ================================================================
# Purpose: Remove duplicate or incorrect webhooks from Shopify
# Usage: ./cleanup-shopify-webhooks.sh
# ================================================================

API_URL="https://api.ordefy.io"

echo "========================================"
echo "SHOPIFY WEBHOOK CLEANUP"
echo "========================================"
echo ""
echo "⚠️  WARNING: This will delete ALL Ordefy webhooks from Shopify"
echo "   They will be recreated on next OAuth"
echo ""
read -p "Continue? (y/n): " CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "Cancelled."
  exit 0
fi

echo ""
echo "Enter your credentials:"
read -p "JWT Token (from localStorage): " AUTH_TOKEN
read -p "Store ID: " STORE_ID
echo ""

# List current webhooks
echo "1️⃣  Listing current webhooks..."
WEBHOOKS=$(curl -s "${API_URL}/api/shopify/webhooks/list" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "X-Store-ID: ${STORE_ID}")

WEBHOOK_COUNT=$(echo "$WEBHOOKS" | grep -o '"count":[0-9]*' | cut -d':' -f2)

if [ -z "$WEBHOOK_COUNT" ]; then
  echo "❌ Failed to fetch webhooks"
  echo "$WEBHOOKS" | json_pp
  exit 1
fi

echo "✅ Found $WEBHOOK_COUNT webhooks"
echo ""

if [ "$WEBHOOK_COUNT" == "0" ]; then
  echo "No webhooks to clean up"
  exit 0
fi

echo "Current webhooks:"
echo "$WEBHOOKS" | json_pp
echo ""

# Confirm deletion
read -p "Delete all $WEBHOOK_COUNT webhooks? (y/n): " DELETE_CONFIRM

if [ "$DELETE_CONFIRM" != "y" ] && [ "$DELETE_CONFIRM" != "Y" ]; then
  echo "Cancelled."
  exit 0
fi

# Delete all webhooks
echo ""
echo "2️⃣  Deleting all webhooks..."
DELETE_RESULT=$(curl -s -X DELETE "${API_URL}/api/shopify/webhooks/remove-all" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "X-Store-ID: ${STORE_ID}")

echo "$DELETE_RESULT" | json_pp
echo ""

# Verify deletion
echo "3️⃣  Verifying deletion..."
REMAINING=$(curl -s "${API_URL}/api/shopify/webhooks/list" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "X-Store-ID: ${STORE_ID}" | grep -o '"count":[0-9]*' | cut -d':' -f2)

if [ "$REMAINING" == "0" ]; then
  echo "✅ All webhooks deleted successfully"
else
  echo "⚠️  $REMAINING webhooks still remain"
fi

echo ""
echo "========================================"
echo "CLEANUP COMPLETE"
echo "========================================"
echo ""
echo "Next steps:"
echo "1. Go to https://app.ordefy.io/integrations"
echo "2. Disconnect Shopify"
echo "3. Reconnect Shopify (triggers OAuth)"
echo "4. Webhooks will be recreated automatically"
echo ""
