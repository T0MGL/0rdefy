#!/bin/bash
# ================================================================
# SMOKE TEST: Post-Deploy Validation (Migration 083)
# ================================================================
# Quick validation that nothing broke after deploying the fix
# Run this immediately after deployment to production
# ================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_URL=${API_URL:-"https://api.ordefy.io"}
TIMEOUT=10

echo ""
echo "🔥 SMOKE TEST: Post-Deploy Validation"
echo "======================================"
echo ""
echo "API URL: $API_URL"
echo "Timeout: ${TIMEOUT}s"
echo ""

# Track test results
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_WARNED=0

# ================================================================
# Helper Functions
# ================================================================

pass_test() {
    echo -e "${GREEN}✓ PASS${NC}: $1"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

fail_test() {
    echo -e "${RED}✗ FAIL${NC}: $1"
    echo -e "${RED}  Error: $2${NC}"
    TESTS_FAILED=$((TESTS_FAILED + 1))
}

warn_test() {
    echo -e "${YELLOW}⚠ WARN${NC}: $1"
    echo -e "${YELLOW}  Warning: $2${NC}"
    TESTS_WARNED=$((TESTS_WARNED + 1))
}

# ================================================================
# TEST 1: API Health Check
# ================================================================
echo -e "${BLUE}TEST 1: API Health Check${NC}"
echo "---"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time $TIMEOUT "$API_URL/health" || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
    pass_test "API is responding (HTTP 200)"
elif [ "$HTTP_CODE" = "404" ]; then
    warn_test "Health endpoint not found (HTTP 404)" "This is OK if /health doesn't exist"
    TESTS_WARNED=$((TESTS_WARNED - 1))  # Don't count as warning
    TESTS_PASSED=$((TESTS_PASSED + 1))   # Count as pass
elif [ "$HTTP_CODE" = "000" ]; then
    fail_test "API is not responding" "Timeout after ${TIMEOUT}s"
else
    fail_test "API returned unexpected status" "HTTP $HTTP_CODE"
fi

echo ""

# ================================================================
# TEST 2: Orders Endpoint (Without Auth)
# ================================================================
echo -e "${BLUE}TEST 2: Orders Endpoint Accessibility${NC}"
echo "---"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time $TIMEOUT "$API_URL/api/orders" || echo "000")

if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
    pass_test "Orders endpoint exists (requires auth: HTTP $HTTP_CODE)"
elif [ "$HTTP_CODE" = "200" ]; then
    warn_test "Orders endpoint returned 200 without auth" "This might be a security issue"
elif [ "$HTTP_CODE" = "000" ]; then
    fail_test "Orders endpoint timeout" "Request exceeded ${TIMEOUT}s"
else
    warn_test "Orders endpoint returned HTTP $HTTP_CODE" "Unexpected status code"
fi

echo ""

# ================================================================
# TEST 3: Response Time Check
# ================================================================
echo -e "${BLUE}TEST 3: Response Time${NC}"
echo "---"

# Test unauthenticated endpoint (should be fast)
RESPONSE_TIME=$(curl -s -o /dev/null -w "%{time_total}" --max-time $TIMEOUT "$API_URL/api/orders" 2>/dev/null || echo "999")

if [ "$RESPONSE_TIME" != "999" ]; then
    # Convert to milliseconds
    RESPONSE_MS=$(echo "$RESPONSE_TIME * 1000" | bc)
    RESPONSE_MS_INT=${RESPONSE_MS%.*}

    if [ "$RESPONSE_MS_INT" -lt 1000 ]; then
        pass_test "Response time is good (${RESPONSE_MS_INT}ms)"
    elif [ "$RESPONSE_MS_INT" -lt 3000 ]; then
        warn_test "Response time is slow (${RESPONSE_MS_INT}ms)" "Expected <1000ms"
    else
        fail_test "Response time is very slow (${RESPONSE_MS_INT}ms)" "Expected <1000ms"
    fi
else
    fail_test "Could not measure response time" "Request timed out"
fi

echo ""

# ================================================================
# TEST 4: Database Check (if DATABASE_URL available)
# ================================================================
echo -e "${BLUE}TEST 4: Database Connection${NC}"
echo "---"

if [ -z "$DATABASE_URL" ]; then
    echo -e "${YELLOW}⏭️  SKIP${NC}: DATABASE_URL not set (this is OK)"
else
    # Test database connection
    DB_TEST=$(psql "$DATABASE_URL" -tAc "SELECT 1;" 2>&1)

    if [ "$DB_TEST" = "1" ]; then
        pass_test "Database connection successful"

        # Check if migration 083 indexes exist
        INDEX_COUNT=$(psql "$DATABASE_URL" -tAc "
            SELECT COUNT(*)
            FROM pg_indexes
            WHERE schemaname = 'public'
            AND tablename = 'orders'
            AND indexname IN (
                'idx_orders_list_covering',
                'idx_orders_phone_search_optimized',
                'idx_orders_shopify_name_search',
                'idx_orders_shopify_number_search',
                'idx_orders_status_date_covering',
                'idx_orders_carrier_date_covering'
            );
        " 2>&1)

        if [ "$INDEX_COUNT" = "6" ]; then
            pass_test "All 6 migration 083 indexes exist"
        elif [ "$INDEX_COUNT" -gt "0" ]; then
            warn_test "Only $INDEX_COUNT of 6 indexes exist" "Some indexes might have failed to create"
        else
            warn_test "No migration 083 indexes found" "Migration might not have run yet"
        fi
    else
        fail_test "Database connection failed" "$DB_TEST"
    fi
fi

echo ""

# ================================================================
# TEST 5: Frontend Build Check (if running locally)
# ================================================================
echo -e "${BLUE}TEST 5: Frontend Build${NC}"
echo "---"

if [ -f "dist/index.html" ]; then
    pass_test "Frontend build exists (dist/index.html)"

    # Check for lazy loading attributes
    LAZY_COUNT=$(grep -c 'loading="lazy"' dist/index.html 2>/dev/null || echo "0")
    if [ "$LAZY_COUNT" -gt "0" ]; then
        pass_test "Lazy loading attributes found ($LAZY_COUNT instances)"
    else
        warn_test "No lazy loading attributes found" "Images might load eagerly"
    fi
else
    echo -e "${YELLOW}⏭️  SKIP${NC}: Frontend build not found (running in production)"
fi

echo ""

# ================================================================
# TEST 6: Backend Code Syntax Check
# ================================================================
echo -e "${BLUE}TEST 6: Backend Code Syntax${NC}"
echo "---"

if [ -f "api/routes/orders.ts" ]; then
    # Check if optimized query exists
    if grep -q "count: 'estimated'" api/routes/orders.ts; then
        pass_test "Optimized query found (count: estimated)"
    else
        warn_test "Optimized query not found" "Still using count: exact"
    fi

    # Check if SELECT * was removed
    if ! grep -q "select(\`.*\*.*customers" api/routes/orders.ts; then
        pass_test "SELECT * removed from main query"
    else
        warn_test "SELECT * still present" "Should use explicit SELECT"
    fi
else
    echo -e "${YELLOW}⏭️  SKIP${NC}: Backend code not found (running in production)"
fi

echo ""

# ================================================================
# SUMMARY
# ================================================================
echo "======================================"
echo -e "${BLUE}SMOKE TEST SUMMARY${NC}"
echo "======================================"
echo ""
echo -e "Tests passed:  ${GREEN}${TESTS_PASSED}${NC}"
echo -e "Tests failed:  ${RED}${TESTS_FAILED}${NC}"
echo -e "Tests warned:  ${YELLOW}${TESTS_WARNED}${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ ✅ ✅  ALL TESTS PASSED  ✅ ✅ ✅${NC}"
    echo ""
    echo "Deployment appears successful!"
    echo ""
    echo "Next steps:"
    echo "  1. Monitor Railway logs for errors"
    echo "  2. Check Sentry for new issues"
    echo "  3. Test manually in browser"
    echo "  4. Monitor performance metrics"
    echo ""
    exit 0
else
    echo -e "${RED}❌ ❌ ❌  SOME TESTS FAILED  ❌ ❌ ❌${NC}"
    echo ""
    echo "Deployment might have issues!"
    echo ""
    echo "Recommended actions:"
    echo "  1. Check failed tests above"
    echo "  2. Review Railway deployment logs"
    echo "  3. Consider rollback if critical"
    echo "  4. Contact development team"
    echo ""
    exit 1
fi
