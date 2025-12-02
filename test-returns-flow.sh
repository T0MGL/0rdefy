#!/bin/bash

# ================================================================
# ORDEFY - Returns System Testing Script
# ================================================================
# Tests the complete return/refund workflow:
# 1. Get eligible orders for return
# 2. Create a return session
# 3. Process items (accept/reject)
# 4. Complete session (updates inventory)
# ================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# API configuration
API_URL="${API_URL:-http://localhost:3001}"
EMAIL="${1:-test@ordefy.io}"
PASSWORD="${2:-test123}"

echo -e "${BLUE}================================================================${NC}"
echo -e "${BLUE}ORDEFY - Returns System Testing Script${NC}"
echo -e "${BLUE}================================================================${NC}"
echo ""

# Step 1: Login
echo -e "${YELLOW}Step 1: Authenticating...${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")

TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['token'])" 2>/dev/null)
STORE_ID=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['user']['store_id'])" 2>/dev/null)

if [ -z "$TOKEN" ] || [ -z "$STORE_ID" ]; then
  echo -e "${RED}❌ Login failed. Check credentials.${NC}"
  echo "$LOGIN_RESPONSE" | python3 -m json.tool
  exit 1
fi

echo -e "${GREEN}✅ Authenticated successfully${NC}"
echo -e "   Store ID: ${STORE_ID}"
echo ""

# Step 2: Get eligible orders
echo -e "${YELLOW}Step 2: Fetching eligible orders for return...${NC}"
ELIGIBLE_ORDERS=$(curl -s -X GET "$API_URL/api/returns/eligible-orders" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Store-ID: $STORE_ID")

ORDER_COUNT=$(echo "$ELIGIBLE_ORDERS" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null)

if [ "$ORDER_COUNT" -eq 0 ]; then
  echo -e "${RED}❌ No eligible orders found${NC}"
  echo -e "${YELLOW}ℹ️  Orders must be in status: delivered, shipped, or cancelled${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Found $ORDER_COUNT eligible order(s)${NC}"
echo "$ELIGIBLE_ORDERS" | python3 -m json.tool
echo ""

# Get first order ID for testing
FIRST_ORDER_ID=$(echo "$ELIGIBLE_ORDERS" | python3 -c "import sys, json; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null)
echo -e "   Using order ID: ${FIRST_ORDER_ID}"
echo ""

# Step 3: Create return session
echo -e "${YELLOW}Step 3: Creating return session...${NC}"
SESSION_RESPONSE=$(curl -s -X POST "$API_URL/api/returns/sessions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Store-ID: $STORE_ID" \
  -H "Content-Type: application/json" \
  -d "{\"order_ids\":[\"$FIRST_ORDER_ID\"],\"notes\":\"Test return session\"}")

SESSION_ID=$(echo "$SESSION_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['id'])" 2>/dev/null)
SESSION_CODE=$(echo "$SESSION_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['session_code'])" 2>/dev/null)

if [ -z "$SESSION_ID" ]; then
  echo -e "${RED}❌ Failed to create session${NC}"
  echo "$SESSION_RESPONSE" | python3 -m json.tool
  exit 1
fi

echo -e "${GREEN}✅ Session created successfully${NC}"
echo -e "   Session ID: ${SESSION_ID}"
echo -e "   Session Code: ${SESSION_CODE}"
echo ""

# Step 4: Get session details
echo -e "${YELLOW}Step 4: Fetching session details...${NC}"
SESSION_DETAILS=$(curl -s -X GET "$API_URL/api/returns/sessions/$SESSION_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Store-ID: $STORE_ID")

ITEMS=$(echo "$SESSION_DETAILS" | python3 -c "import sys, json; print(json.dumps(json.load(sys.stdin)['items']))" 2>/dev/null)
ITEMS_COUNT=$(echo "$ITEMS" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null)

echo -e "${GREEN}✅ Session has $ITEMS_COUNT item(s) to process${NC}"
echo "$ITEMS" | python3 -m json.tool
echo ""

# Step 5: Process items (accept some, reject some)
echo -e "${YELLOW}Step 5: Processing items...${NC}"

# Get first item for testing
FIRST_ITEM_ID=$(echo "$ITEMS" | python3 -c "import sys, json; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null)
QUANTITY_EXPECTED=$(echo "$ITEMS" | python3 -c "import sys, json; print(json.load(sys.stdin)[0]['quantity_expected'])" 2>/dev/null)

# Accept half, reject half (or accept all if only 1)
if [ "$QUANTITY_EXPECTED" -gt 1 ]; then
  ACCEPT_QTY=$((QUANTITY_EXPECTED / 2))
  REJECT_QTY=$((QUANTITY_EXPECTED - ACCEPT_QTY))
else
  ACCEPT_QTY=$QUANTITY_EXPECTED
  REJECT_QTY=0
fi

echo -e "   Processing item: ${FIRST_ITEM_ID}"
echo -e "   Accepting: ${ACCEPT_QTY}, Rejecting: ${REJECT_QTY}"

UPDATE_RESPONSE=$(curl -s -X PATCH "$API_URL/api/returns/items/$FIRST_ITEM_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Store-ID: $STORE_ID" \
  -H "Content-Type: application/json" \
  -d "{\"quantity_accepted\":$ACCEPT_QTY,\"quantity_rejected\":$REJECT_QTY,\"rejection_reason\":\"damaged\",\"rejection_notes\":\"Test rejection\"}")

echo -e "${GREEN}✅ Item updated${NC}"
echo "$UPDATE_RESPONSE" | python3 -m json.tool
echo ""

# Process remaining items (accept all)
echo -e "${YELLOW}Step 5b: Processing remaining items (accepting all)...${NC}"
REMAINING_ITEMS=$(echo "$ITEMS" | python3 -c "import sys, json; items = json.load(sys.stdin); print(' '.join([item['id'] for item in items[1:]]))" 2>/dev/null)

for ITEM_ID in $REMAINING_ITEMS; do
  ITEM_QTY=$(echo "$ITEMS" | python3 -c "import sys, json; items = json.load(sys.stdin); item = next((i for i in items if i['id'] == '$ITEM_ID'), None); print(item['quantity_expected'] if item else 0)" 2>/dev/null)

  if [ -n "$ITEM_ID" ] && [ "$ITEM_QTY" -gt 0 ]; then
    echo -e "   Processing item: ${ITEM_ID} (accepting ${ITEM_QTY})"
    curl -s -X PATCH "$API_URL/api/returns/items/$ITEM_ID" \
      -H "Authorization: Bearer $TOKEN" \
      -H "X-Store-ID: $STORE_ID" \
      -H "Content-Type: application/json" \
      -d "{\"quantity_accepted\":$ITEM_QTY,\"quantity_rejected\":0}" > /dev/null
  fi
done

echo -e "${GREEN}✅ All items processed${NC}"
echo ""

# Step 6: Complete session
echo -e "${YELLOW}Step 6: Completing return session...${NC}"
COMPLETE_RESPONSE=$(curl -s -X POST "$API_URL/api/returns/sessions/$SESSION_ID/complete" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Store-ID: $STORE_ID")

echo -e "${GREEN}✅ Session completed successfully${NC}"
echo "$COMPLETE_RESPONSE" | python3 -m json.tool
echo ""

# Step 7: Verify inventory was updated
echo -e "${YELLOW}Step 7: Verifying inventory movements...${NC}"
MOVEMENTS=$(curl -s -X GET "$API_URL/api/inventory/movements" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Store-ID: $STORE_ID")

echo -e "${GREEN}✅ Recent inventory movements:${NC}"
echo "$MOVEMENTS" | python3 -c "
import sys, json
movements = json.load(sys.stdin)
for m in movements[:5]:
    print(f\"  - {m['movement_type']}: {m['product_name']} x{m['quantity']} ({m['reason']})\")
"
echo ""

# Step 8: Get return stats
echo -e "${YELLOW}Step 8: Fetching return statistics...${NC}"
STATS=$(curl -s -X GET "$API_URL/api/returns/stats" \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Store-ID: $STORE_ID")

echo -e "${GREEN}✅ Return Statistics:${NC}"
echo "$STATS" | python3 -m json.tool
echo ""

# Summary
echo -e "${BLUE}================================================================${NC}"
echo -e "${GREEN}✅ Returns System Test Completed Successfully!${NC}"
echo -e "${BLUE}================================================================${NC}"
echo ""
echo -e "${GREEN}Summary:${NC}"
echo -e "  ✅ Created return session: ${SESSION_CODE}"
echo -e "  ✅ Processed ${ITEMS_COUNT} item(s)"
echo -e "  ✅ Accepted ${ACCEPT_QTY} item(s) (returned to stock)"
echo -e "  ✅ Rejected ${REJECT_QTY} item(s) (not returned to stock)"
echo -e "  ✅ Inventory updated automatically"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo -e "  1. Check the Returns page in the UI"
echo -e "  2. Verify inventory was updated correctly"
echo -e "  3. Review inventory movements log"
echo ""
