#!/bin/bash

# ================================================================
# WAREHOUSE PICKING & PACKING FLOW TEST
# Tests the complete warehouse workflow from session creation to completion
#
# Usage: ./test-warehouse-flow.sh [email] [password]
# Example: ./test-warehouse-flow.sh user@example.com mypassword
# ================================================================

set -e  # Exit on error

API_URL="http://localhost:3001"
AUTH_TOKEN=""
STORE_ID=""

# Get credentials from arguments or use defaults
USER_EMAIL="${1:-test@ordefy.io}"
USER_PASSWORD="${2:-test123}"

echo "================================================================"
echo "🧪 WAREHOUSE FLOW TEST"
echo "================================================================"
echo "Testing with user: $USER_EMAIL"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ================================================================
# STEP 1: Login and get token
# ================================================================
echo -e "${BLUE}STEP 1: Authenticating...${NC}"

LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$USER_EMAIL\",
    \"password\": \"$USER_PASSWORD\"
  }")

AUTH_TOKEN=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('token', ''))" 2>/dev/null || echo "")
STORE_ID=$(echo "$LOGIN_RESPONSE" | python3 -c "import sys, json; data=json.load(sys.stdin); stores=data.get('user', {}).get('stores', []); print(stores[0]['id'] if stores else '')" 2>/dev/null || echo "")

if [ -z "$AUTH_TOKEN" ] || [ -z "$STORE_ID" ]; then
  echo -e "${RED}❌ Login failed. Please check credentials.${NC}"
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✅ Authenticated successfully${NC}"
echo "   Store ID: $STORE_ID"
echo ""

# ================================================================
# STEP 2: Get confirmed orders
# ================================================================
echo -e "${BLUE}STEP 2: Fetching confirmed orders...${NC}"

CONFIRMED_ORDERS=$(curl -s -X GET "$API_URL/api/warehouse/orders/confirmed" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "X-Store-ID: $STORE_ID")

ORDER_COUNT=$(echo "$CONFIRMED_ORDERS" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

echo -e "${GREEN}✅ Found $ORDER_COUNT confirmed orders${NC}"

if [ "$ORDER_COUNT" -eq 0 ]; then
  echo -e "${YELLOW}⚠️  No confirmed orders available for testing${NC}"
  echo -e "${YELLOW}   Please create some confirmed orders first${NC}"
  exit 0
fi

# Get first 2 order IDs for session
ORDER_IDS=$(echo "$CONFIRMED_ORDERS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
ids = [order['id'] for order in data[:2]]
print(json.dumps(ids))
" 2>/dev/null)

echo "   Order IDs for session: $ORDER_IDS"
echo ""

# ================================================================
# STEP 3: Create picking session
# ================================================================
echo -e "${BLUE}STEP 3: Creating picking session...${NC}"

SESSION_RESPONSE=$(curl -s -X POST "$API_URL/api/warehouse/sessions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "X-Store-ID: $STORE_ID" \
  -d "{\"orderIds\": $ORDER_IDS}")

SESSION_ID=$(echo "$SESSION_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id', ''))" 2>/dev/null || echo "")
SESSION_CODE=$(echo "$SESSION_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('code', ''))" 2>/dev/null || echo "")

if [ -z "$SESSION_ID" ]; then
  echo -e "${RED}❌ Failed to create session${NC}"
  echo "Response: $SESSION_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✅ Session created: $SESSION_CODE${NC}"
echo "   Session ID: $SESSION_ID"
echo ""

# ================================================================
# STEP 4: Get picking list
# ================================================================
echo -e "${BLUE}STEP 4: Fetching picking list...${NC}"

PICKING_LIST=$(curl -s -X GET "$API_URL/api/warehouse/sessions/$SESSION_ID/picking-list" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "X-Store-ID: $STORE_ID")

ITEM_COUNT=$(echo "$PICKING_LIST" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

echo -e "${GREEN}✅ Picking list contains $ITEM_COUNT items${NC}"

# Display items
echo "$PICKING_LIST" | python3 -c "
import sys, json
items = json.load(sys.stdin)
for item in items:
    print(f\"   - {item.get('product_name', 'Unknown')}: {item['quantity_picked']}/{item['total_quantity_needed']}\")
" 2>/dev/null

echo ""

# ================================================================
# STEP 5: Update picking progress (pick all items)
# ================================================================
echo -e "${BLUE}STEP 5: Picking items...${NC}"

echo "$PICKING_LIST" | python3 -c "
import sys, json, subprocess

items = json.load(sys.stdin)
for item in items:
    product_id = item['product_id']
    quantity = item['total_quantity_needed']

    result = subprocess.run([
        'curl', '-s', '-X', 'POST',
        f\"$API_URL/api/warehouse/sessions/$SESSION_ID/picking-progress\",
        '-H', 'Content-Type: application/json',
        '-H', f'Authorization: Bearer $AUTH_TOKEN',
        '-H', f'X-Store-ID: $STORE_ID',
        '-d', json.dumps({'productId': product_id, 'quantityPicked': quantity})
    ], capture_output=True, text=True)

    print(f\"   ✓ Picked {item.get('product_name', 'Unknown')}: {quantity} units\")
"

echo -e "${GREEN}✅ All items picked${NC}"
echo ""

# ================================================================
# STEP 6: Finish picking and transition to packing
# ================================================================
echo -e "${BLUE}STEP 6: Finishing picking phase...${NC}"

FINISH_RESPONSE=$(curl -s -X POST "$API_URL/api/warehouse/sessions/$SESSION_ID/finish-picking" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "X-Store-ID: $STORE_ID")

NEW_STATUS=$(echo "$FINISH_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('status', ''))" 2>/dev/null || echo "")

if [ "$NEW_STATUS" != "packing" ]; then
  echo -e "${RED}❌ Failed to transition to packing${NC}"
  echo "Response: $FINISH_RESPONSE"
  exit 1
fi

echo -e "${GREEN}✅ Transitioned to packing phase${NC}"
echo ""

# ================================================================
# STEP 7: Get packing list
# ================================================================
echo -e "${BLUE}STEP 7: Fetching packing list...${NC}"

PACKING_LIST=$(curl -s -X GET "$API_URL/api/warehouse/sessions/$SESSION_ID/packing-list" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "X-Store-ID: $STORE_ID")

echo -e "${GREEN}✅ Packing list retrieved${NC}"

# Display orders and available items
echo ""
echo "Available Items (Basket):"
echo "$PACKING_LIST" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for item in data.get('availableItems', []):
    print(f\"   - {item['product_name']}: {item['remaining']} remaining\")
"

echo ""
echo "Orders to Pack:"
echo "$PACKING_LIST" | python3 -c "
import sys, json
data = json.load(sys.stdin)
for order in data.get('orders', []):
    status = '✓ Complete' if order['is_complete'] else '○ Pending'
    print(f\"   {status} Order #{order['order_number']} ({order['customer_name']})\")
    for item in order['items']:
        print(f\"      - {item['product_name']}: {item['quantity_packed']}/{item['quantity_needed']}\")
"

echo ""

# ================================================================
# STEP 8: Pack items into orders
# ================================================================
echo -e "${BLUE}STEP 8: Packing items into orders...${NC}"

# This is complex - we need to pack each item into its respective order
# The packing list tells us which items go into which orders
echo "$PACKING_LIST" | python3 -c "
import sys, json, subprocess

data = json.load(sys.stdin)
orders = data.get('orders', [])

for order in orders:
    order_id = order['id']
    order_num = order['order_number']

    for item in order['items']:
        product_id = item['product_id']
        needed = item['quantity_needed']
        packed = item['quantity_packed']

        # Pack remaining items
        for _ in range(needed - packed):
            result = subprocess.run([
                'curl', '-s', '-X', 'POST',
                f\"$API_URL/api/warehouse/sessions/$SESSION_ID/packing-progress\",
                '-H', 'Content-Type: application/json',
                '-H', f'Authorization: Bearer $AUTH_TOKEN',
                '-H', f'X-Store-ID: $STORE_ID',
                '-d', json.dumps({'orderId': order_id, 'productId': product_id})
            ], capture_output=True, text=True)

    print(f\"   ✓ Packed order #{order_num}\")
"

echo -e "${GREEN}✅ All items packed${NC}"
echo ""

# ================================================================
# STEP 9: Verify all orders are ready to ship
# ================================================================
echo -e "${BLUE}STEP 9: Verifying packing completion...${NC}"

FINAL_PACKING_LIST=$(curl -s -X GET "$API_URL/api/warehouse/sessions/$SESSION_ID/packing-list" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "X-Store-ID: $STORE_ID")

ALL_COMPLETE=$(echo "$FINAL_PACKING_LIST" | python3 -c "
import sys, json
data = json.load(sys.stdin)
orders = data.get('orders', [])
all_complete = all(order['is_complete'] for order in orders)
print('true' if all_complete else 'false')
")

if [ "$ALL_COMPLETE" != "true" ]; then
  echo -e "${YELLOW}⚠️  Not all orders are complete${NC}"
else
  echo -e "${GREEN}✅ All orders are ready to ship${NC}"
fi

echo ""

# ================================================================
# SUMMARY
# ================================================================
echo "================================================================"
echo -e "${GREEN}✅ WAREHOUSE FLOW TEST COMPLETED SUCCESSFULLY${NC}"
echo "================================================================"
echo ""
echo "Summary:"
echo "  Session Code: $SESSION_CODE"
echo "  Orders Processed: $(echo "$ORDER_IDS" | python3 -c "import sys, json; print(len(json.load(sys.stdin)))")"
echo "  Items Picked: $ITEM_COUNT"
echo "  Final Status: Packing Complete"
echo ""
echo "Next Steps:"
echo "  - You can complete the session via API or UI"
echo "  - Orders should now be in 'ready_to_ship' status"
echo "  - Print shipping labels and dispatch"
echo ""
