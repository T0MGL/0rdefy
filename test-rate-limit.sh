#!/bin/bash

# ================================================================
# Rate Limiting Test for Public Delivery Endpoints
# ================================================================
# This script tests that the delivery token endpoints are properly
# rate limited to prevent brute force attacks
# Expected: 10 requests/minute maximum, then 429 Too Many Requests
# ================================================================

echo "🔒 Testing Rate Limiting for Public Delivery Endpoints"
echo "========================================================"
echo ""

# Test with a random token (should fail gracefully)
TEST_TOKEN="test-token-123"
ENDPOINT="http://localhost:3001/api/orders/token/${TEST_TOKEN}"

echo "Testing endpoint: ${ENDPOINT}"
echo "Rate limit: 10 requests per minute"
echo ""

SUCCESS_COUNT=0
RATE_LIMITED_COUNT=0

# Make 15 requests (should allow 10, then block 5)
for i in {1..15}; do
    echo -n "Request $i: "

    RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${ENDPOINT}")
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)

    if [ "$HTTP_CODE" == "404" ] || [ "$HTTP_CODE" == "200" ]; then
        echo "✅ Success (HTTP $HTTP_CODE)"
        SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    elif [ "$HTTP_CODE" == "429" ]; then
        echo "🚫 Rate Limited (HTTP 429) - EXPECTED"
        RATE_LIMITED_COUNT=$((RATE_LIMITED_COUNT + 1))
    else
        echo "❓ Unexpected (HTTP $HTTP_CODE)"
    fi

    # Small delay between requests
    sleep 0.1
done

echo ""
echo "========================================================"
echo "Test Results:"
echo "  ✅ Successful requests: $SUCCESS_COUNT"
echo "  🚫 Rate limited requests: $RATE_LIMITED_COUNT"
echo ""

if [ $SUCCESS_COUNT -le 10 ] && [ $RATE_LIMITED_COUNT -ge 5 ]; then
    echo "✅ PASS: Rate limiting is working correctly!"
    echo "   First ~10 requests succeeded, remaining were blocked."
else
    echo "❌ FAIL: Rate limiting may not be working properly."
    echo "   Expected: ~10 successful, ~5 rate limited"
fi

echo "========================================================"
