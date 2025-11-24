#!/bin/bash

# ================================================================
# SHOPIFY CONNECTION TEST SCRIPT
# ================================================================
# Tests Shopify OAuth configuration and API connectivity
# Usage: ./test-shopify-connection.sh <shop_domain> [access_token]
# ================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Load .env file
if [ -f .env ]; then
    echo -e "${BLUE}📁 Loading .env file...${NC}"
    export $(cat .env | grep -v '^#' | xargs)
else
    echo -e "${RED}❌ .env file not found${NC}"
    exit 1
fi

# Check required parameters
SHOP_DOMAIN="${1:-}"
ACCESS_TOKEN="${2:-}"

if [ -z "$SHOP_DOMAIN" ]; then
    echo -e "${RED}❌ Usage: ./test-shopify-connection.sh <shop_domain> [access_token]${NC}"
    echo -e "${YELLOW}   Example: ./test-shopify-connection.sh mystore.myshopify.com${NC}"
    exit 1
fi

echo -e "${BLUE}🔧 Shopify Connection Test${NC}"
echo -e "${BLUE}=========================${NC}\n"

# ================================================================
# TEST 1: Environment Variables
# ================================================================
echo -e "${YELLOW}[1/5] Checking environment variables...${NC}"

if [ -z "$SHOPIFY_API_KEY" ]; then
    echo -e "${RED}   ❌ SHOPIFY_API_KEY is not set${NC}"
    exit 1
else
    echo -e "${GREEN}   ✅ SHOPIFY_API_KEY: ${SHOPIFY_API_KEY:0:10}...${NC}"
fi

if [ -z "$SHOPIFY_API_SECRET" ]; then
    echo -e "${RED}   ❌ SHOPIFY_API_SECRET is not set${NC}"
    exit 1
else
    echo -e "${GREEN}   ✅ SHOPIFY_API_SECRET: ${SHOPIFY_API_SECRET:0:10}...${NC}"
fi

if [ -z "$SHOPIFY_REDIRECT_URI" ]; then
    echo -e "${RED}   ❌ SHOPIFY_REDIRECT_URI is not set${NC}"
    exit 1
else
    echo -e "${GREEN}   ✅ SHOPIFY_REDIRECT_URI: ${SHOPIFY_REDIRECT_URI}${NC}"
fi

API_VERSION="${SHOPIFY_API_VERSION:-2025-10}"
echo -e "${GREEN}   ✅ API_VERSION: ${API_VERSION}${NC}\n"

# ================================================================
# TEST 2: OAuth Health Check
# ================================================================
echo -e "${YELLOW}[2/5] Testing OAuth configuration...${NC}"

API_URL="${API_URL:-http://localhost:3001}"
HEALTH_URL="${API_URL}/api/shopify-oauth/health"

echo -e "${BLUE}   → GET ${HEALTH_URL}${NC}"

HEALTH_RESPONSE=$(curl -s "${HEALTH_URL}")
echo "$HEALTH_RESPONSE" | jq '.' 2>/dev/null || echo "$HEALTH_RESPONSE"

if echo "$HEALTH_RESPONSE" | grep -q '"configured":true'; then
    echo -e "${GREEN}   ✅ OAuth is properly configured${NC}\n"
else
    echo -e "${RED}   ❌ OAuth is not properly configured${NC}\n"
    exit 1
fi

# ================================================================
# TEST 3: OAuth Flow URL Generation
# ================================================================
echo -e "${YELLOW}[3/5] Generating OAuth URL...${NC}"

OAUTH_URL="${API_URL}/api/shopify-oauth/auth?shop=${SHOP_DOMAIN}"
echo -e "${GREEN}   ✅ OAuth URL: ${OAUTH_URL}${NC}"
echo -e "${BLUE}   → Visit this URL to start OAuth flow${NC}\n"

# ================================================================
# TEST 4: Shopify API Access (if access_token provided)
# ================================================================
if [ -n "$ACCESS_TOKEN" ]; then
    echo -e "${YELLOW}[4/5] Testing Shopify API access with provided token...${NC}"

    # Test shop.json endpoint
    SHOP_URL="https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/shop.json"
    echo -e "${BLUE}   → GET ${SHOP_URL}${NC}"

    SHOP_RESPONSE=$(curl -s -w "\n%{http_code}" \
        -H "X-Shopify-Access-Token: ${ACCESS_TOKEN}" \
        "${SHOP_URL}")

    HTTP_CODE=$(echo "$SHOP_RESPONSE" | tail -n1)
    SHOP_DATA=$(echo "$SHOP_RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}   ✅ Successfully connected to Shopify API${NC}"
        echo "$SHOP_DATA" | jq '.shop | {name, email, domain, currency}' 2>/dev/null || echo "$SHOP_DATA"
    else
        echo -e "${RED}   ❌ Failed to connect to Shopify API (HTTP $HTTP_CODE)${NC}"
        echo "$SHOP_DATA" | jq '.' 2>/dev/null || echo "$SHOP_DATA"
        exit 1
    fi

    echo ""

    # ================================================================
    # TEST 5: List Webhooks
    # ================================================================
    echo -e "${YELLOW}[5/5] Listing registered webhooks...${NC}"

    WEBHOOKS_URL="https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/webhooks.json"
    echo -e "${BLUE}   → GET ${WEBHOOKS_URL}${NC}"

    WEBHOOKS_RESPONSE=$(curl -s -w "\n%{http_code}" \
        -H "X-Shopify-Access-Token: ${ACCESS_TOKEN}" \
        "${WEBHOOKS_URL}")

    HTTP_CODE=$(echo "$WEBHOOKS_RESPONSE" | tail -n1)
    WEBHOOKS_DATA=$(echo "$WEBHOOKS_RESPONSE" | sed '$d')

    if [ "$HTTP_CODE" = "200" ]; then
        WEBHOOK_COUNT=$(echo "$WEBHOOKS_DATA" | jq '.webhooks | length')
        echo -e "${GREEN}   ✅ Found ${WEBHOOK_COUNT} registered webhooks${NC}"

        if [ "$WEBHOOK_COUNT" -gt 0 ]; then
            echo "$WEBHOOKS_DATA" | jq '.webhooks[] | {topic, address, id}' 2>/dev/null
        else
            echo -e "${YELLOW}   ⚠️  No webhooks registered${NC}"
        fi
    else
        echo -e "${RED}   ❌ Failed to list webhooks (HTTP $HTTP_CODE)${NC}"
        echo "$WEBHOOKS_DATA" | jq '.' 2>/dev/null || echo "$WEBHOOKS_DATA"
    fi
else
    echo -e "${YELLOW}[4/5] Skipping API test (no access token provided)${NC}"
    echo -e "${BLUE}   → To test API access, provide access_token as second argument${NC}\n"

    echo -e "${YELLOW}[5/5] Skipping webhook test (no access token provided)${NC}\n"
fi

# ================================================================
# Summary
# ================================================================
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}✅ Connection test completed${NC}"
echo -e "${GREEN}================================${NC}\n"

if [ -z "$ACCESS_TOKEN" ]; then
    echo -e "${YELLOW}📝 Next Steps:${NC}"
    echo -e "${YELLOW}   1. Visit the OAuth URL above to authorize your shop${NC}"
    echo -e "${YELLOW}   2. After authorization, get the access_token from the database${NC}"
    echo -e "${YELLOW}   3. Run this script again with the access_token to test API access${NC}\n"
fi

echo -e "${BLUE}📊 Configuration Summary:${NC}"
echo -e "   Shop Domain: ${SHOP_DOMAIN}"
echo -e "   API Version: ${API_VERSION}"
echo -e "   API Key: ${SHOPIFY_API_KEY:0:10}..."
echo -e "   Redirect URI: ${SHOPIFY_REDIRECT_URI}"
echo -e "   OAuth URL: ${OAUTH_URL}\n"
