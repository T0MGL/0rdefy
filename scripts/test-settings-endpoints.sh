#!/bin/bash

# Test Settings Page Endpoints
# This script tests all the endpoints used in the Settings page

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# API base URL
API_URL="${API_URL:-https://api.ordefy.io}"

echo "🧪 Testing Settings Page Endpoints"
echo "====================================="
echo ""

# You need to set these environment variables with valid credentials
if [ -z "$TEST_TOKEN" ]; then
  echo "${RED}❌ ERROR: TEST_TOKEN environment variable not set${NC}"
  echo "Please set TEST_TOKEN with a valid auth token"
  exit 1
fi

if [ -z "$TEST_STORE_ID" ]; then
  echo "${RED}❌ ERROR: TEST_STORE_ID environment variable not set${NC}"
  echo "Please set TEST_STORE_ID with a valid store ID"
  exit 1
fi

HEADERS=(
  -H "Authorization: Bearer $TEST_TOKEN"
  -H "X-Store-ID: $TEST_STORE_ID"
  -H "Content-Type: application/json"
)

# Test 1: GET /api/collaborators
echo "${YELLOW}1. Testing GET /api/collaborators${NC}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "${HEADERS[@]}" \
  "$API_URL/api/collaborators")

if [ "$HTTP_CODE" = "200" ]; then
  echo "${GREEN}✅ SUCCESS: GET /api/collaborators (HTTP $HTTP_CODE)${NC}"
else
  echo "${RED}❌ FAILED: GET /api/collaborators (HTTP $HTTP_CODE)${NC}"
fi
echo ""

# Test 2: GET /api/security/sessions
echo "${YELLOW}2. Testing GET /api/security/sessions${NC}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "${HEADERS[@]}" \
  "$API_URL/api/security/sessions")

if [ "$HTTP_CODE" = "200" ]; then
  echo "${GREEN}✅ SUCCESS: GET /api/security/sessions (HTTP $HTTP_CODE)${NC}"
else
  echo "${RED}❌ FAILED: GET /api/security/sessions (HTTP $HTTP_CODE)${NC}"
fi
echo ""

# Test 3: GET /api/security/activity
echo "${YELLOW}3. Testing GET /api/security/activity${NC}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "${HEADERS[@]}" \
  "$API_URL/api/security/activity")

if [ "$HTTP_CODE" = "200" ]; then
  echo "${GREEN}✅ SUCCESS: GET /api/security/activity (HTTP $HTTP_CODE)${NC}"
else
  echo "${RED}❌ FAILED: GET /api/security/activity (HTTP $HTTP_CODE)${NC}"
fi
echo ""

# Test 4: GET /api/collaborators/stats
echo "${YELLOW}4. Testing GET /api/collaborators/stats${NC}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "${HEADERS[@]}" \
  "$API_URL/api/collaborators/stats")

if [ "$HTTP_CODE" = "200" ]; then
  echo "${GREEN}✅ SUCCESS: GET /api/collaborators/stats (HTTP $HTTP_CODE)${NC}"
else
  echo "${RED}❌ FAILED: GET /api/collaborators/stats (HTTP $HTTP_CODE)${NC}"
fi
echo ""

echo "====================================="
echo "✅ Testing complete"
