#!/bin/bash
# Test script for Shopify GDPR Compliance Webhooks
# This script verifies HMAC signature validation and endpoint responses

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

API_URL="${API_URL:-http://localhost:3001}"
SHOP_DOMAIN="${SHOP_DOMAIN:-test-store.myshopify.com}"
SHOPIFY_API_SECRET="${SHOPIFY_API_SECRET:-your-test-secret}"

echo "================================================================"
echo "Shopify GDPR Compliance Webhook Tests"
echo "================================================================"
echo "API URL: $API_URL"
echo "Shop Domain: $SHOP_DOMAIN"
echo "================================================================"
echo ""

# Function to generate HMAC signature
generate_hmac() {
    local body="$1"
    local secret="$2"
    echo -n "$body" | openssl dgst -sha256 -hmac "$secret" -binary | base64
}

# Test 1: Health Check
echo -e "${YELLOW}Test 1: Health Check${NC}"
echo "GET /api/shopify/compliance/health"
response=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$API_URL/api/shopify/compliance/health")
http_code=$(echo "$response" | grep "HTTP_CODE" | cut -d: -f2)
body=$(echo "$response" | sed '/HTTP_CODE/d')

if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✓ PASS${NC} - Health check returned 200"
    echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
else
    echo -e "${RED}✗ FAIL${NC} - Health check returned $http_code"
    echo "$body"
fi
echo ""

# Test 2: customers/data_request - Valid HMAC
echo -e "${YELLOW}Test 2: customers/data_request - Valid HMAC${NC}"
payload='{
  "shop_id": 954889,
  "shop_domain": "'"$SHOP_DOMAIN"'",
  "orders_requested": [299938, 280263],
  "customer": {
    "id": 191167,
    "email": "test@example.com",
    "phone": "555-625-1199"
  },
  "data_request": {
    "id": 9999
  }
}'

hmac=$(generate_hmac "$payload" "$SHOPIFY_API_SECRET")

response=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "X-Shopify-Shop-Domain: $SHOP_DOMAIN" \
    -H "X-Shopify-Hmac-Sha256: $hmac" \
    -d "$payload" \
    "$API_URL/api/shopify/compliance/customers/data_request")

http_code=$(echo "$response" | grep "HTTP_CODE" | cut -d: -f2)
body=$(echo "$response" | sed '/HTTP_CODE/d')

if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✓ PASS${NC} - customers/data_request with valid HMAC returned 200"
    echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
else
    echo -e "${RED}✗ FAIL${NC} - Expected 200, got $http_code"
    echo "$body"
fi
echo ""

# Test 3: customers/data_request - Invalid HMAC
echo -e "${YELLOW}Test 3: customers/data_request - Invalid HMAC${NC}"
invalid_hmac="invalid_hmac_signature"

response=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "X-Shopify-Shop-Domain: $SHOP_DOMAIN" \
    -H "X-Shopify-Hmac-Sha256: $invalid_hmac" \
    -d "$payload" \
    "$API_URL/api/shopify/compliance/customers/data_request")

http_code=$(echo "$response" | grep "HTTP_CODE" | cut -d: -f2)
body=$(echo "$response" | sed '/HTTP_CODE/d')

if [ "$http_code" = "401" ]; then
    echo -e "${GREEN}✓ PASS${NC} - Invalid HMAC correctly rejected with 401"
    echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
else
    echo -e "${RED}✗ FAIL${NC} - Expected 401, got $http_code"
    echo "$body"
fi
echo ""

# Test 4: customers/redact - Valid HMAC
echo -e "${YELLOW}Test 4: customers/redact - Valid HMAC${NC}"
payload='{
  "shop_id": 954889,
  "shop_domain": "'"$SHOP_DOMAIN"'",
  "customer": {
    "id": 191167,
    "email": "customer@example.com",
    "phone": "555-625-1199"
  },
  "orders_to_redact": [299938, 280263]
}'

hmac=$(generate_hmac "$payload" "$SHOPIFY_API_SECRET")

response=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "X-Shopify-Shop-Domain: $SHOP_DOMAIN" \
    -H "X-Shopify-Hmac-Sha256: $hmac" \
    -d "$payload" \
    "$API_URL/api/shopify/compliance/customers/redact")

http_code=$(echo "$response" | grep "HTTP_CODE" | cut -d: -f2)
body=$(echo "$response" | sed '/HTTP_CODE/d')

if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✓ PASS${NC} - customers/redact with valid HMAC returned 200"
    echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
else
    echo -e "${RED}✗ FAIL${NC} - Expected 200, got $http_code"
    echo "$body"
fi
echo ""

# Test 5: shop/redact - Valid HMAC
echo -e "${YELLOW}Test 5: shop/redact - Valid HMAC${NC}"
payload='{
  "shop_id": 954889,
  "shop_domain": "'"$SHOP_DOMAIN"'"
}'

hmac=$(generate_hmac "$payload" "$SHOPIFY_API_SECRET")

response=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "X-Shopify-Shop-Domain: $SHOP_DOMAIN" \
    -H "X-Shopify-Hmac-Sha256: $hmac" \
    -d "$payload" \
    "$API_URL/api/shopify/compliance/shop/redact")

http_code=$(echo "$response" | grep "HTTP_CODE" | cut -d: -f2)
body=$(echo "$response" | sed '/HTTP_CODE/d')

if [ "$http_code" = "200" ]; then
    echo -e "${GREEN}✓ PASS${NC} - shop/redact with valid HMAC returned 200"
    echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
else
    echo -e "${RED}✗ FAIL${NC} - Expected 200, got $http_code"
    echo "$body"
fi
echo ""

# Test 6: Missing HMAC header
echo -e "${YELLOW}Test 6: Missing HMAC Header${NC}"
response=$(curl -s -w "\nHTTP_CODE:%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "X-Shopify-Shop-Domain: $SHOP_DOMAIN" \
    -d "$payload" \
    "$API_URL/api/shopify/compliance/customers/data_request")

http_code=$(echo "$response" | grep "HTTP_CODE" | cut -d: -f2)
body=$(echo "$response" | sed '/HTTP_CODE/d')

if [ "$http_code" = "401" ]; then
    echo -e "${GREEN}✓ PASS${NC} - Missing HMAC correctly rejected with 401"
    echo "$body" | python3 -m json.tool 2>/dev/null || echo "$body"
else
    echo -e "${RED}✗ FAIL${NC} - Expected 401, got $http_code"
    echo "$body"
fi
echo ""

echo "================================================================"
echo "Test Summary"
echo "================================================================"
echo "All tests completed. Check output above for results."
echo ""
echo "NOTE: Some tests may fail if:"
echo "  - The API server is not running"
echo "  - No Shopify integration exists for the test shop domain"
echo "  - SHOPIFY_API_SECRET environment variable is not set correctly"
echo "================================================================"
