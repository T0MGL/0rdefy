#!/bin/bash

# ================================================================
# Comprehensive Rate Limiting Test for All Public Delivery Endpoints
# ================================================================
# Tests all public delivery endpoints to ensure they are properly
# protected against brute force attacks
# ================================================================

echo "🔒 Comprehensive Rate Limiting Test for Public Delivery Endpoints"
echo "=================================================================="
echo ""

# Test endpoints
ENDPOINTS=(
    "GET:/api/orders/token/test-token-123"
    "POST:/api/orders/dummy-id/delivery-confirm"
    "POST:/api/orders/dummy-id/delivery-fail"
    "POST:/api/orders/dummy-id/rate-delivery"
    "POST:/api/orders/dummy-id/cancel"
)

test_endpoint() {
    local method=$1
    local path=$2
    local full_url="http://localhost:3001${path}"

    echo ""
    echo "Testing: ${method} ${path}"
    echo "----------------------------------------"

    local success=0
    local rate_limited=0

    # Make 12 requests rapidly
    for i in {1..12}; do
        if [ "$method" == "POST" ]; then
            response=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${full_url}" \
                -H "Content-Type: application/json" \
                -d '{"test": "data"}')
        else
            response=$(curl -s -o /dev/null -w "%{http_code}" -X GET "${full_url}")
        fi

        if [ "$response" == "429" ]; then
            echo "  Request $i: 🚫 Rate Limited (429) - EXPECTED after 10th request"
            rate_limited=$((rate_limited + 1))
        else
            echo "  Request $i: ✅ Allowed ($response)"
            success=$((success + 1))
        fi

        sleep 0.1
    done

    echo ""
    echo "Results: $success allowed, $rate_limited blocked"

    if [ $success -le 10 ] && [ $rate_limited -ge 2 ]; then
        echo "✅ PASS: Rate limiting working correctly"
        return 0
    else
        echo "❌ FAIL: Rate limiting may not be working"
        return 1
    fi
}

# Track overall results
total_tests=0
passed_tests=0

# Test each endpoint
for endpoint in "${ENDPOINTS[@]}"; do
    IFS=':' read -r method path <<< "$endpoint"
    total_tests=$((total_tests + 1))

    if test_endpoint "$method" "$path"; then
        passed_tests=$((passed_tests + 1))
    fi

    # Wait 61 seconds before next test to reset rate limit window
    if [ $total_tests -lt ${#ENDPOINTS[@]} ]; then
        echo ""
        echo "⏳ Waiting 61 seconds for rate limit window to reset..."
        sleep 61
    fi
done

echo ""
echo "=================================================================="
echo "Final Results: $passed_tests/$total_tests endpoints passed"
echo ""

if [ $passed_tests -eq $total_tests ]; then
    echo "✅ ALL TESTS PASSED - Rate limiting is properly configured!"
    exit 0
else
    echo "❌ SOME TESTS FAILED - Please review rate limiting configuration"
    exit 1
fi
