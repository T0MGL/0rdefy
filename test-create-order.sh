#!/bin/bash

# Test: Create manual order
# This script tests the creation of a manual order through the API

echo "🧪 Testing manual order creation..."
echo "=================================="

# Configuration
API_URL="${API_URL:-http://localhost:3001}"
USER_EMAIL="${1:-gaston@thebrightidea.ai}"
USER_PASSWORD="${2:-rorito28}"

# Step 1: Login to get auth token
echo ""
echo "Step 1: Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$USER_EMAIL\",\"password\":\"$USER_PASSWORD\"}")

echo "Login response: $LOGIN_RESPONSE"

TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.token // empty')
STORE_ID=$(echo "$LOGIN_RESPONSE" | jq -r '.user.stores[0].id // empty')

if [ -z "$TOKEN" ] || [ "$TOKEN" == "null" ]; then
  echo "❌ Login failed. Check credentials."
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi

echo "✅ Login successful"
echo "Token: ${TOKEN:0:20}..."
echo "Store ID: $STORE_ID"

# Step 2: Get a product to use in the order
echo ""
echo "Step 2: Fetching products..."
PRODUCTS_RESPONSE=$(curl -s -X GET "$API_URL/api/products?limit=1" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Store-ID: $STORE_ID")

echo "Products response: $PRODUCTS_RESPONSE"

PRODUCT_ID=$(echo "$PRODUCTS_RESPONSE" | jq -r '.data[0].id // empty')
PRODUCT_NAME=$(echo "$PRODUCTS_RESPONSE" | jq -r '.data[0].name // empty')
PRODUCT_PRICE=$(echo "$PRODUCTS_RESPONSE" | jq -r '.data[0].price // 100000')

if [ -z "$PRODUCT_ID" ] || [ "$PRODUCT_ID" == "null" ]; then
  echo "❌ No products found. Please create a product first."
  exit 1
fi

echo "✅ Product found:"
echo "  ID: $PRODUCT_ID"
echo "  Name: $PRODUCT_NAME"
echo "  Price: $PRODUCT_PRICE"

# Step 3: Get a carrier to use in the order
echo ""
echo "Step 3: Fetching carriers..."
CARRIERS_RESPONSE=$(curl -s -X GET "$API_URL/api/carriers?limit=1" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Store-ID: $STORE_ID")

echo "Carriers response: $CARRIERS_RESPONSE"

CARRIER_ID=$(echo "$CARRIERS_RESPONSE" | jq -r '.data[0].id // empty')
CARRIER_NAME=$(echo "$CARRIERS_RESPONSE" | jq -r '.data[0].name // empty')

if [ -z "$CARRIER_ID" ] || [ "$CARRIER_ID" == "null" ]; then
  echo "⚠️ No carriers found. Order will be created without carrier."
  CARRIER_ID=""
fi

if [ -n "$CARRIER_ID" ]; then
  echo "✅ Carrier found:"
  echo "  ID: $CARRIER_ID"
  echo "  Name: $CARRIER_NAME"
fi

# Step 4: Create the order
echo ""
echo "Step 4: Creating order..."

ORDER_PAYLOAD=$(cat <<EOF
{
  "customer_first_name": "Test",
  "customer_last_name": "Customer",
  "customer_phone": "+595981234567",
  "customer_email": "test@example.com",
  "customer_address": "Calle Test 123, Asunción",
  "line_items": [{
    "product_id": "$PRODUCT_ID",
    "product_name": "$PRODUCT_NAME",
    "quantity": 2,
    "price": $PRODUCT_PRICE
  }],
  "total_price": $(echo "$PRODUCT_PRICE * 2" | bc),
  "subtotal_price": $(echo "$PRODUCT_PRICE * 2" | bc),
  "total_tax": 0,
  "total_shipping": 0,
  "currency": "PYG",
  "financial_status": "pending",
  "payment_status": "pending",
  "payment_method": "cash",
  "courier_id": "$CARRIER_ID"
}
EOF
)

echo "Order payload:"
echo "$ORDER_PAYLOAD" | jq '.'

CREATE_RESPONSE=$(curl -s -X POST "$API_URL/api/orders" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Store-ID: $STORE_ID" \
  -d "$ORDER_PAYLOAD")

echo ""
echo "Create order response:"
echo "$CREATE_RESPONSE" | jq '.'

ORDER_ID=$(echo "$CREATE_RESPONSE" | jq -r '.data.id // empty')

if [ -z "$ORDER_ID" ] || [ "$ORDER_ID" == "null" ]; then
  echo "❌ Order creation failed"
  echo "Response: $CREATE_RESPONSE"
  exit 1
fi

echo ""
echo "✅ Order created successfully!"
echo "Order ID: $ORDER_ID"

# Step 5: Verify order was created
echo ""
echo "Step 5: Verifying order..."
VERIFY_RESPONSE=$(curl -s -X GET "$API_URL/api/orders/$ORDER_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Store-ID: $STORE_ID")

echo "Verify response:"
echo "$VERIFY_RESPONSE" | jq '.'

echo ""
echo "=================================="
echo "✅ Test completed successfully!"
echo "=================================="
