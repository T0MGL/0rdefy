#!/bin/bash

# Quick verification script for warehouse endpoints
API_URL="http://localhost:3001"

echo "🔍 Verifying Warehouse Setup..."
echo ""

# Login with user credentials
echo "1. Logging in..."
LOGIN=$(curl -s -X POST "$API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"gaston@thebrightidea.ai","password":"rorito28"}')

TOKEN=$(echo "$LOGIN" | python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))" 2>/dev/null)
STORE=$(echo "$LOGIN" | python3 -c "import sys, json; stores=json.load(sys.stdin).get('user', {}).get('stores', []); print(stores[0]['id'] if stores else '')" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "❌ Login failed"
  exit 1
fi
echo "✅ Logged in successfully"
echo ""

# Test confirmed orders endpoint
echo "2. Testing /api/warehouse/orders/confirmed..."
ORDERS=$(curl -s -X GET "$API_URL/api/warehouse/orders/confirmed" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Store-ID: $STORE")

if echo "$ORDERS" | grep -q "error"; then
  echo "❌ Error fetching orders:"
  echo "$ORDERS" | python3 -m json.tool | head -10
  exit 1
fi

COUNT=$(echo "$ORDERS" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
echo "✅ Found $COUNT confirmed orders"
echo ""

# Test active sessions endpoint
echo "3. Testing /api/warehouse/sessions/active..."
SESSIONS=$(curl -s -X GET "$API_URL/api/warehouse/sessions/active" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Store-ID: $STORE")

if echo "$SESSIONS" | grep -q "error"; then
  echo "❌ Error fetching sessions:"
  echo "$SESSIONS" | python3 -m json.tool | head -10
  exit 1
fi

SESSION_COUNT=$(echo "$SESSIONS" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
echo "✅ Found $SESSION_COUNT active sessions"
echo ""

echo "================================================================"
echo "✅ Warehouse endpoints are working correctly!"
echo "================================================================"
echo ""
echo "You can now:"
echo "  1. Open https://app.ordefy.io/warehouse"
echo "  2. Create picking sessions from confirmed orders"
echo "  3. Test the full picking & packing flow"
echo ""
