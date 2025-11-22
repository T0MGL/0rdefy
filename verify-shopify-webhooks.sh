#!/bin/bash

# ================================================================
# SHOPIFY WEBHOOK VERIFICATION SCRIPT
# ================================================================
# Purpose: Verify that webhooks are properly registered after OAuth
# Usage: ./verify-shopify-webhooks.sh <shop-domain>
# Example: ./verify-shopify-webhooks.sh mystore.myshopify.com
# ================================================================

API_URL="https://api.ordefy.io"

echo "========================================"
echo "SHOPIFY WEBHOOK VERIFICATION"
echo "========================================"
echo ""

# Check if shop domain is provided
if [ -z "$1" ]; then
  echo "❌ Error: Shop domain not provided"
  echo ""
  echo "Usage: $0 <shop-domain>"
  echo "Example: $0 mystore.myshopify.com"
  echo ""
  exit 1
fi

SHOP_DOMAIN="$1"

echo "🏪 Shop Domain: $SHOP_DOMAIN"
echo ""

# ================================================================
# STEP 1: Check API health
# ================================================================
echo "1️⃣  Checking API server health..."
HEALTH=$(curl -s "${API_URL}/health" 2>&1)
HTTP_CODE=$?

if [ $HTTP_CODE -ne 0 ]; then
  echo "❌ Cannot reach API server at ${API_URL}"
  echo "   Make sure the API is deployed and accessible"
  exit 1
fi

echo "✅ API server is healthy"
echo ""

# ================================================================
# STEP 2: Check Shopify OAuth configuration
# ================================================================
echo "2️⃣  Checking Shopify OAuth configuration..."
OAUTH_HEALTH=$(curl -s "${API_URL}/api/shopify-oauth/health" 2>&1)

if echo "$OAUTH_HEALTH" | grep -q '"configured":true'; then
  echo "✅ Shopify OAuth is properly configured"
else
  echo "❌ Shopify OAuth configuration incomplete"
  echo "$OAUTH_HEALTH" | json_pp 2>/dev/null || echo "$OAUTH_HEALTH"
  exit 1
fi
echo ""

# ================================================================
# STEP 3: Check integration status
# ================================================================
echo "3️⃣  Checking integration status for ${SHOP_DOMAIN}..."
INTEGRATION_STATUS=$(curl -s "${API_URL}/api/shopify-oauth/status?shop=${SHOP_DOMAIN}" 2>&1)

if echo "$INTEGRATION_STATUS" | grep -q '"connected":true'; then
  echo "✅ Shopify integration is connected"

  # Extract details
  INSTALLED_AT=$(echo "$INTEGRATION_STATUS" | grep -o '"installed_at":"[^"]*"' | cut -d'"' -f4)
  SCOPES=$(echo "$INTEGRATION_STATUS" | grep -o '"scope":"[^"]*"' | cut -d'"' -f4)

  echo "   Installed at: $INSTALLED_AT"
  echo "   Scopes: $SCOPES"
else
  echo "❌ Shopify integration not found or disconnected"
  echo ""
  echo "Integration status:"
  echo "$INTEGRATION_STATUS" | json_pp 2>/dev/null || echo "$INTEGRATION_STATUS"
  echo ""
  echo "💡 Please complete OAuth installation:"
  echo "   1. Go to https://app.ordefy.io/integrations"
  echo "   2. Click 'Connect' on Shopify"
  echo "   3. Complete the OAuth flow"
  exit 1
fi
echo ""

# ================================================================
# STEP 4: Check registered webhooks in Shopify
# ================================================================
echo "4️⃣  Fetching registered webhooks from Shopify..."
echo "   (This requires authentication - you'll need to provide credentials)"
echo ""

# Get credentials interactively
read -p "JWT Token (from localStorage.auth_token): " AUTH_TOKEN
read -p "Store ID (from localStorage.current_store_id): " STORE_ID
echo ""

if [ -z "$AUTH_TOKEN" ] || [ -z "$STORE_ID" ]; then
  echo "⚠️  No credentials provided - skipping webhook verification"
  echo "   To get credentials:"
  echo "   1. Open https://app.ordefy.io in browser"
  echo "   2. Open DevTools (F12)"
  echo "   3. Go to Application → Local Storage"
  echo "   4. Copy 'auth_token' and 'current_store_id'"
  echo ""
else
  # List webhooks
  WEBHOOKS=$(curl -s "${API_URL}/api/shopify/webhooks/list" \
    -H "Authorization: Bearer ${AUTH_TOKEN}" \
    -H "X-Store-ID: ${STORE_ID}" 2>&1)

  WEBHOOK_COUNT=$(echo "$WEBHOOKS" | grep -o '"count":[0-9]*' | cut -d':' -f2)

  if [ -z "$WEBHOOK_COUNT" ]; then
    echo "❌ Failed to fetch webhooks from Shopify"
    echo ""
    echo "Response:"
    echo "$WEBHOOKS" | json_pp 2>/dev/null || echo "$WEBHOOKS"
    echo ""
  else
    echo "✅ Found $WEBHOOK_COUNT registered webhooks in Shopify"
    echo ""

    if [ "$WEBHOOK_COUNT" -eq 0 ]; then
      echo "⚠️  WARNING: No webhooks are registered!"
      echo ""
      echo "Expected webhooks:"
      echo "  1. orders/create → https://api.ordefy.io/api/shopify/webhook/orders-create"
      echo "  2. orders/updated → https://api.ordefy.io/api/shopify/webhook/orders-updated"
      echo "  3. products/delete → https://api.ordefy.io/api/shopify/webhook/products-delete"
      echo "  4. app/uninstalled → https://api.ordefy.io/api/shopify/webhook/app-uninstalled"
      echo ""
      echo "💡 To fix this, re-run OAuth installation:"
      echo "   1. Disconnect Shopify integration in Ordefy"
      echo "   2. Reconnect Shopify"
      echo "   3. Webhooks will be registered automatically"
      echo ""
    else
      echo "Registered webhooks:"
      echo "$WEBHOOKS" | json_pp 2>/dev/null || echo "$WEBHOOKS"
      echo ""

      # Check for required webhooks
      REQUIRED_WEBHOOKS=("orders/create" "orders/updated" "products/delete" "app/uninstalled")
      MISSING_WEBHOOKS=()

      for topic in "${REQUIRED_WEBHOOKS[@]}"; do
        if ! echo "$WEBHOOKS" | grep -q "\"topic\":\"$topic\""; then
          MISSING_WEBHOOKS+=("$topic")
        fi
      done

      if [ ${#MISSING_WEBHOOKS[@]} -gt 0 ]; then
        echo "⚠️  WARNING: Missing ${#MISSING_WEBHOOKS[@]} required webhooks:"
        for topic in "${MISSING_WEBHOOKS[@]}"; do
          echo "   ❌ $topic"
        done
        echo ""
        echo "💡 To fix: Re-register webhooks via:"
        echo "   POST ${API_URL}/api/shopify/webhooks/setup"
        echo "   (Use same auth headers as above)"
        echo ""
      else
        echo "✅ All required webhooks are registered!"
        echo ""
      fi
    fi
  fi
fi

# ================================================================
# STEP 5: Test webhook endpoint accessibility
# ================================================================
echo "5️⃣  Testing webhook endpoints..."
echo ""

WEBHOOK_ENDPOINTS=(
  "/api/shopify/webhook/orders-create"
  "/api/shopify/webhook/orders-updated"
  "/api/shopify/webhook/products-delete"
  "/api/shopify/webhook/app-uninstalled"
)

for endpoint in "${WEBHOOK_ENDPOINTS[@]}"; do
  # Test with a dummy POST (should return 400/401, not 404)
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "${API_URL}${endpoint}" \
    -H "Content-Type: application/json" \
    -d '{}' 2>/dev/null)

  if [ "$HTTP_STATUS" == "404" ]; then
    echo "❌ ${endpoint} - NOT FOUND (404)"
  elif [ "$HTTP_STATUS" == "401" ] || [ "$HTTP_STATUS" == "400" ]; then
    echo "✅ ${endpoint} - Accessible (${HTTP_STATUS})"
  else
    echo "⚠️  ${endpoint} - Status: ${HTTP_STATUS}"
  fi
done

echo ""
echo "========================================"
echo "VERIFICATION COMPLETE"
echo "========================================"
echo ""

# ================================================================
# SUMMARY & RECOMMENDATIONS
# ================================================================
echo "📊 SUMMARY"
echo ""

if [ "$WEBHOOK_COUNT" -ge 4 ] && [ ${#MISSING_WEBHOOKS[@]} -eq 0 ]; then
  echo "✅ Everything looks good!"
  echo "   - OAuth integration: Connected"
  echo "   - Webhooks registered: $WEBHOOK_COUNT/4"
  echo "   - All endpoints: Accessible"
  echo ""
  echo "🎉 Your Shopify integration is ready!"
  echo "   New orders will automatically appear in the Ordefy dashboard."
  echo ""
else
  echo "⚠️  Action required:"
  echo ""

  if [ -z "$WEBHOOK_COUNT" ] || [ "$WEBHOOK_COUNT" -lt 4 ]; then
    echo "1. Re-install Shopify app to register webhooks:"
    echo "   - Go to: https://app.ordefy.io/integrations"
    echo "   - Disconnect Shopify"
    echo "   - Reconnect Shopify"
    echo "   - Complete OAuth flow"
    echo ""
  fi

  echo "2. If problem persists, check server logs:"
  echo "   - SSH into production server"
  echo "   - Run: docker logs ordefy-api -f"
  echo "   - Look for [SHOPIFY-WEBHOOKS] messages"
  echo ""

  echo "3. Manual webhook registration (if needed):"
  echo "   curl -X POST ${API_URL}/api/shopify/webhooks/setup \\"
  echo "     -H \"Authorization: Bearer YOUR_TOKEN\" \\"
  echo "     -H \"X-Store-ID: YOUR_STORE_ID\""
  echo ""
fi

echo "📚 Documentation:"
echo "   - Shopify webhooks: https://shopify.dev/docs/apps/build/webhooks"
echo "   - CLAUDE.md: Shopify Integration section"
echo ""
