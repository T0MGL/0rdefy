#!/bin/bash

# Test Script: Invitation Race Condition Fix
# Purpose: Verify that concurrent invitation acceptance is properly blocked
# Usage: ./test-invitation-race-condition.sh <invitation_token>

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
API_URL="${API_URL:-http://localhost:3001}"
TOKEN="${1:-}"
PASSWORD="TestPassword123"

if [ -z "$TOKEN" ]; then
  echo -e "${RED}Error: Invitation token required${NC}"
  echo "Usage: $0 <invitation_token>"
  exit 1
fi

echo "=================================================="
echo "Invitation Race Condition Test"
echo "=================================================="
echo "API URL: $API_URL"
echo "Token: $TOKEN"
echo ""

# Create temporary files for responses
RESPONSE_1=$(mktemp)
RESPONSE_2=$(mktemp)
RESPONSE_3=$(mktemp)

# Cleanup function
cleanup() {
  rm -f "$RESPONSE_1" "$RESPONSE_2" "$RESPONSE_3"
}
trap cleanup EXIT

echo -e "${YELLOW}[1/4] Testing concurrent acceptance (2 simultaneous requests)${NC}"

# Send two requests simultaneously
(
  curl -s -w "\n%{http_code}" -X POST "$API_URL/api/collaborators/accept-invitation" \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$TOKEN\", \"password\":\"$PASSWORD\"}" \
    > "$RESPONSE_1"
) &
PID1=$!

(
  curl -s -w "\n%{http_code}" -X POST "$API_URL/api/collaborators/accept-invitation" \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$TOKEN\", \"password\":\"$PASSWORD\"}" \
    > "$RESPONSE_2"
) &
PID2=$!

# Wait for both to complete
wait $PID1
wait $PID2

# Extract status codes
STATUS_1=$(tail -n 1 "$RESPONSE_1")
STATUS_2=$(tail -n 1 "$RESPONSE_2")
BODY_1=$(head -n -1 "$RESPONSE_1")
BODY_2=$(head -n -1 "$RESPONSE_2")

echo ""
echo "Response 1 - HTTP $STATUS_1:"
echo "$BODY_1" | jq '.' 2>/dev/null || echo "$BODY_1"
echo ""
echo "Response 2 - HTTP $STATUS_2:"
echo "$BODY_2" | jq '.' 2>/dev/null || echo "$BODY_2"
echo ""

# Verify results
SUCCESS_COUNT=0
CONFLICT_COUNT=0

if [ "$STATUS_1" = "200" ]; then
  ((SUCCESS_COUNT++))
elif [ "$STATUS_1" = "409" ]; then
  ((CONFLICT_COUNT++))
fi

if [ "$STATUS_2" = "200" ]; then
  ((SUCCESS_COUNT++))
elif [ "$STATUS_2" = "409" ]; then
  ((CONFLICT_COUNT++))
fi

echo -e "${YELLOW}[2/4] Verifying results${NC}"
echo "Successful acceptances: $SUCCESS_COUNT"
echo "Conflict responses (409): $CONFLICT_COUNT"

if [ "$SUCCESS_COUNT" -eq 1 ] && [ "$CONFLICT_COUNT" -eq 1 ]; then
  echo -e "${GREEN}✓ PASS: Exactly one acceptance succeeded${NC}"
else
  echo -e "${RED}✗ FAIL: Expected 1 success and 1 conflict, got $SUCCESS_COUNT success and $CONFLICT_COUNT conflict${NC}"
  exit 1
fi

echo ""
echo -e "${YELLOW}[3/4] Testing subsequent attempt (should fail)${NC}"

curl -s -w "\n%{http_code}" -X POST "$API_URL/api/collaborators/accept-invitation" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\", \"password\":\"$PASSWORD\"}" \
  > "$RESPONSE_3"

STATUS_3=$(tail -n 1 "$RESPONSE_3")
BODY_3=$(head -n -1 "$RESPONSE_3")

echo "Response 3 - HTTP $STATUS_3:"
echo "$BODY_3" | jq '.' 2>/dev/null || echo "$BODY_3"

if [ "$STATUS_3" = "404" ] || [ "$STATUS_3" = "409" ]; then
  echo -e "${GREEN}✓ PASS: Subsequent attempt correctly rejected${NC}"
else
  echo -e "${RED}✗ FAIL: Expected 404/409, got $STATUS_3${NC}"
  exit 1
fi

echo ""
echo -e "${YELLOW}[4/4] Database verification${NC}"

if [ -z "$DATABASE_URL" ]; then
  echo -e "${YELLOW}⚠ WARNING: DATABASE_URL not set, skipping database checks${NC}"
else
  # Check invitation status
  echo "Checking invitation in database..."
  USED_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM collaborator_invitations WHERE token = '$TOKEN' AND used = true;")
  USED_BY_COUNT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM collaborator_invitations WHERE token = '$TOKEN' AND used_by_user_id IS NOT NULL;")

  USED_COUNT=$(echo "$USED_COUNT" | xargs)
  USED_BY_COUNT=$(echo "$USED_BY_COUNT" | xargs)

  echo "Invitations marked used: $USED_COUNT"
  echo "Invitations with used_by_user_id: $USED_BY_COUNT"

  if [ "$USED_COUNT" = "1" ] && [ "$USED_BY_COUNT" = "1" ]; then
    echo -e "${GREEN}✓ PASS: Database state correct${NC}"
  else
    echo -e "${RED}✗ FAIL: Expected 1 used invitation with user_id${NC}"
    exit 1
  fi
fi

echo ""
echo "=================================================="
echo -e "${GREEN}ALL TESTS PASSED${NC}"
echo "=================================================="
echo ""
echo "Summary:"
echo "  • Concurrent requests: Both handled correctly (1 success, 1 conflict)"
echo "  • Subsequent requests: Properly rejected"
echo "  • Database state: Consistent (no duplicates)"
echo ""
echo "The race condition fix is working correctly!"
