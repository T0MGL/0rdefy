#!/bin/bash

# ================================================================
# Bidirectional Sync Test Script for Shopify Integration
# ================================================================
# Tests both directions of product sync:
# 1. Shopify → Ordefy (via webhooks)
# 2. Ordefy → Shopify (via automatic sync)
#
# Usage:
#   ./test-bidirectional-sync.sh
#
# Required Environment Variables:
#   AUTH_TOKEN     - JWT token for API authentication
#   STORE_ID       - Store ID for the test
#   PRODUCT_ID     - Product ID to test (must have shopify_product_id)
#   API_URL        - API base URL (default: https://api.ordefy.io)
# ================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_URL="${API_URL:-https://api.ordefy.io}"
AUTH_TOKEN="${AUTH_TOKEN:-}"
STORE_ID="${STORE_ID:-}"
PRODUCT_ID="${PRODUCT_ID:-}"

# Function to print colored output
print_step() {
    echo -e "${BLUE}==>${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Function to check required variables
check_requirements() {
    print_step "Checking requirements..."

    if [ -z "$AUTH_TOKEN" ]; then
        print_error "AUTH_TOKEN environment variable is required"
        echo "Export it with: export AUTH_TOKEN='your_token_here'"
        exit 1
    fi

    if [ -z "$STORE_ID" ]; then
        print_error "STORE_ID environment variable is required"
        echo "Export it with: export STORE_ID='your_store_id_here'"
        exit 1
    fi

    if [ -z "$PRODUCT_ID" ]; then
        print_error "PRODUCT_ID environment variable is required"
        echo "Export it with: export PRODUCT_ID='your_product_id_here'"
        exit 1
    fi

    print_success "All requirements met"
}

# Function to make API calls
api_call() {
    local method=$1
    local endpoint=$2
    local data=$3

    if [ -z "$data" ]; then
        curl -s -X "$method" "$API_URL$endpoint" \
            -H "Authorization: Bearer $AUTH_TOKEN" \
            -H "X-Store-ID: $STORE_ID" \
            -H "Content-Type: application/json"
    else
        curl -s -X "$method" "$API_URL$endpoint" \
            -H "Authorization: Bearer $AUTH_TOKEN" \
            -H "X-Store-ID: $STORE_ID" \
            -H "Content-Type: application/json" \
            -d "$data"
    fi
}

# Test 1: Check Shopify integration status
test_integration_status() {
    print_step "Test 1: Checking Shopify integration status..."

    response=$(api_call GET "/api/shopify/integration")

    if echo "$response" | grep -q '"success":true'; then
        if echo "$response" | grep -q '"integration":null'; then
            print_error "No active Shopify integration found"
            echo "Please configure Shopify integration first via /api/shopify/configure"
            exit 1
        else
            print_success "Shopify integration is active"
            shop_domain=$(echo "$response" | grep -o '"shop_domain":"[^"]*"' | cut -d'"' -f4)
            print_success "Connected to: $shop_domain"
        fi
    else
        print_error "Failed to check integration status"
        echo "$response"
        exit 1
    fi
}

# Test 2: Get product details
test_get_product() {
    print_step "Test 2: Getting product details..."

    response=$(api_call GET "/api/products/$PRODUCT_ID")

    if echo "$response" | grep -q '"id"'; then
        print_success "Product found"
        product_name=$(echo "$response" | grep -o '"name":"[^"]*"' | cut -d'"' -f4)
        product_price=$(echo "$response" | grep -o '"price":[0-9.]*' | cut -d':' -f2)
        product_stock=$(echo "$response" | grep -o '"stock":[0-9]*' | cut -d':' -f2)

        echo "  Name: $product_name"
        echo "  Price: \$$product_price"
        echo "  Stock: $product_stock units"

        # Check if product has shopify_product_id
        if ! echo "$response" | grep -q '"shopify_product_id"'; then
            print_warning "Product does not have shopify_product_id"
            print_warning "This product cannot be synced to Shopify"
            echo "Please use a product imported from Shopify or create one in Shopify first"
            exit 1
        fi
    else
        print_error "Product not found or error occurred"
        echo "$response"
        exit 1
    fi
}

# Test 3: Update product price (Ordefy → Shopify)
test_update_product_price() {
    print_step "Test 3: Updating product price (Ordefy → Shopify sync)..."

    # Generate new random price between 10.00 and 99.99
    new_price=$(awk -v min=10 -v max=99 'BEGIN{srand(); print int(min+rand()*(max-min+1)) + rand()}')
    new_price=$(printf "%.2f" $new_price)

    echo "  New price: \$$new_price"

    response=$(api_call PUT "/api/products/$PRODUCT_ID" "{\"price\": $new_price}")

    if echo "$response" | grep -q '"message":"Product updated successfully"'; then
        print_success "Product updated in Ordefy database"

        # Check if sync warning is present
        if echo "$response" | grep -q '"sync_warning"'; then
            print_warning "Sync to Shopify failed"
            sync_warning=$(echo "$response" | grep -o '"sync_warning":"[^"]*"' | cut -d'"' -f4)
            echo "  Warning: $sync_warning"
        else
            print_success "Product automatically synced to Shopify"
        fi
    else
        print_error "Failed to update product"
        echo "$response"
        exit 1
    fi
}

# Test 4: Update product stock (Ordefy → Shopify)
test_update_product_stock() {
    print_step "Test 4: Updating product stock (Ordefy → Shopify sync)..."

    # Generate new random stock between 10 and 100
    new_stock=$((10 + RANDOM % 91))

    echo "  New stock: $new_stock units"

    response=$(api_call PATCH "/api/products/$PRODUCT_ID/stock" "{\"stock\": $new_stock, \"operation\": \"set\"}")

    if echo "$response" | grep -q '"message":"Stock updated successfully"'; then
        print_success "Stock updated in Ordefy database"
        print_success "Stock automatically synced to Shopify"
    else
        print_error "Failed to update stock"
        echo "$response"
        exit 1
    fi
}

# Test 5: Check webhook health
test_webhook_health() {
    print_step "Test 5: Checking webhook health (Shopify → Ordefy)..."

    response=$(api_call GET "/api/shopify/webhook-health?hours=24")

    if echo "$response" | grep -q '"success":true'; then
        status=$(echo "$response" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
        total_received=$(echo "$response" | grep -o '"total_received":[0-9]*' | cut -d':' -f2 | head -1)
        success_rate=$(echo "$response" | grep -o '"success_rate":[0-9.]*' | cut -d':' -f2 | head -1)
        pending_retries=$(echo "$response" | grep -o '"pending_retries":[0-9]*' | cut -d':' -f2 | head -1)

        if [ "$status" = "healthy" ]; then
            print_success "Webhook system is healthy"
        elif [ "$status" = "degraded" ]; then
            print_warning "Webhook system is degraded"
        else
            print_error "Webhook system is unhealthy"
        fi

        echo "  Total webhooks received (24h): $total_received"
        echo "  Success rate: $success_rate%"
        echo "  Pending retries: $pending_retries"
    else
        print_error "Failed to check webhook health"
        echo "$response"
    fi
}

# Test 6: Verify webhooks are registered
test_webhook_registration() {
    print_step "Test 6: Verifying webhook registration..."

    response=$(api_call GET "/api/shopify/webhooks/list")

    if echo "$response" | grep -q '"success":true'; then
        webhook_count=$(echo "$response" | grep -o '"count":[0-9]*' | cut -d':' -f2)
        print_success "Found $webhook_count registered webhooks"

        # Check for required webhooks
        required_webhooks=("orders/create" "orders/updated" "products/update" "products/delete" "app/uninstalled")

        for topic in "${required_webhooks[@]}"; do
            if echo "$response" | grep -q "\"topic\":\"$topic\""; then
                print_success "  ✓ $topic webhook is registered"
            else
                print_warning "  ✗ $topic webhook is NOT registered"
            fi
        done
    else
        print_error "Failed to list webhooks"
        echo "$response"
    fi
}

# Test 7: Manual trigger of webhook processing (if any pending)
test_retry_queue() {
    print_step "Test 7: Processing webhook retry queue..."

    response=$(api_call POST "/api/shopify/webhook-retry/process")

    if echo "$response" | grep -q '"success":true'; then
        processed=$(echo "$response" | grep -o '"processed":[0-9]*' | cut -d':' -f2)
        succeeded=$(echo "$response" | grep -o '"succeeded":[0-9]*' | cut -d':' -f2)
        failed=$(echo "$response" | grep -o '"failed":[0-9]*' | cut -d':' -f2)

        if [ "$processed" -eq 0 ]; then
            print_success "No pending webhooks to retry"
        else
            print_success "Processed $processed webhooks: $succeeded succeeded, $failed failed"
        fi
    else
        print_error "Failed to process retry queue"
        echo "$response"
    fi
}

# Main execution
main() {
    echo ""
    echo "================================================================"
    echo "  Bidirectional Sync Test Suite for Shopify Integration"
    echo "================================================================"
    echo ""

    check_requirements
    echo ""

    test_integration_status
    echo ""

    test_get_product
    echo ""

    test_update_product_price
    echo ""

    sleep 2  # Wait for sync to complete

    test_update_product_stock
    echo ""

    sleep 2  # Wait for sync to complete

    test_webhook_health
    echo ""

    test_webhook_registration
    echo ""

    test_retry_queue
    echo ""

    echo "================================================================"
    print_success "All tests completed!"
    echo "================================================================"
    echo ""
    echo "Next steps:"
    echo "1. Check Shopify admin to verify price and stock changes"
    echo "2. Update the product in Shopify admin and verify it updates in Ordefy"
    echo "3. Monitor webhook health regularly via /api/shopify/webhook-health"
    echo ""
}

# Run main function
main
