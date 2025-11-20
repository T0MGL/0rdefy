#!/bin/bash

# ================================================================
# SHOPIFY CONFIGURATION TEST SCRIPT
# ================================================================
# Tests the Shopify OAuth configuration and connectivity
# ================================================================

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_URL="${API_URL:-http://localhost:3001}"

echo -e "${BLUE}================================================================${NC}"
echo -e "${BLUE}   SHOPIFY OAUTH CONFIGURATION TEST${NC}"
echo -e "${BLUE}================================================================${NC}"
echo ""

# Test 1: Health Check
echo -e "${YELLOW}[1/4] Testing Shopify OAuth Health Check...${NC}"
HEALTH_RESPONSE=$(curl -s "${API_URL}/api/shopify-oauth/health")
HEALTH_STATUS=$(echo $HEALTH_RESPONSE | grep -o '"configured":[^,]*' | cut -d':' -f2)

if [ "$HEALTH_STATUS" == "true" ]; then
  echo -e "${GREEN}✅ Shopify OAuth is properly configured${NC}"
  echo -e "   Scopes: $(echo $HEALTH_RESPONSE | grep -o '"scopes":"[^"]*' | cut -d':' -f2 | tr -d '"')"
  echo -e "   API Version: $(echo $HEALTH_RESPONSE | grep -o '"api_version":"[^"]*' | cut -d':' -f2 | tr -d '"')"
else
  echo -e "${RED}❌ Shopify OAuth is NOT configured${NC}"
  echo -e "   Missing variables: $(echo $HEALTH_RESPONSE | grep -o '"missing_vars":\[[^\]]*\]')"
  echo ""
  echo -e "${YELLOW}Please configure the following environment variables:${NC}"
  echo -e "   - SHOPIFY_API_KEY"
  echo -e "   - SHOPIFY_API_SECRET"
  echo -e "   - SHOPIFY_REDIRECT_URI"
  echo ""
  echo -e "${YELLOW}See .env.shopify.example for reference${NC}"
  exit 1
fi
echo ""

# Test 2: Server is running
echo -e "${YELLOW}[2/4] Testing API server connectivity...${NC}"
if curl -s -f "${API_URL}/health" > /dev/null 2>&1; then
  echo -e "${GREEN}✅ API server is running${NC}"
else
  echo -e "${RED}❌ API server is not responding${NC}"
  echo -e "   Make sure the server is running: npm run api:dev"
  exit 1
fi
echo ""

# Test 3: Database connectivity
echo -e "${YELLOW}[3/4] Testing database connectivity...${NC}"
DB_TEST=$(curl -s "${API_URL}/health" | grep -o '"database":"[^"]*' | cut -d':' -f2 | tr -d '"')
if [ "$DB_TEST" == "connected" ]; then
  echo -e "${GREEN}✅ Database is connected${NC}"
else
  echo -e "${YELLOW}⚠️  Database status: ${DB_TEST}${NC}"
fi
echo ""

# Test 4: Frontend connectivity
echo -e "${YELLOW}[4/4] Testing frontend connectivity...${NC}"
FRONTEND_URL="${APP_URL:-http://localhost:8080}"
if curl -s -f "${FRONTEND_URL}" > /dev/null 2>&1; then
  echo -e "${GREEN}✅ Frontend is running at ${FRONTEND_URL}${NC}"
else
  echo -e "${YELLOW}⚠️  Frontend is not running at ${FRONTEND_URL}${NC}"
  echo -e "   Make sure the frontend is running: npm run dev"
fi
echo ""

# Summary
echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}✅ CONFIGURATION TEST COMPLETED${NC}"
echo -e "${BLUE}================================================================${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "1. Go to Shopify Partner Dashboard: https://partners.shopify.com/"
echo -e "2. Create or select your app"
echo -e "3. Configure the redirect URL: ${SHOPIFY_REDIRECT_URI:-$API_URL/api/shopify-oauth/callback}"
echo -e "4. Test the OAuth flow by connecting a store"
echo -e "5. Monitor logs for any errors"
echo ""
echo -e "${YELLOW}To test the OAuth flow:${NC}"
echo -e "1. Open: ${FRONTEND_URL}/integrations"
echo -e "2. Click 'Connect' on Shopify"
echo -e "3. Enter your shop domain (e.g., my-store.myshopify.com)"
echo -e "4. Complete the OAuth flow"
echo ""
