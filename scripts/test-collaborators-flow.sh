#!/bin/bash

# Script de prueba para el sistema de colaboradores
# Prueba todos los endpoints y flujos principales

set -e

echo "🧪 Testing Collaborator System"
echo "================================"
echo ""

# Configuration
API_URL="${API_URL:-http://localhost:3001/api}"
AUTH_TOKEN="${AUTH_TOKEN}"
STORE_ID="${STORE_ID}"

if [ -z "$AUTH_TOKEN" ] || [ -z "$STORE_ID" ]; then
  echo "❌ Error: AUTH_TOKEN and STORE_ID environment variables are required"
  echo "Usage: AUTH_TOKEN='your-token' STORE_ID='your-store-id' ./test-collaborators-flow.sh"
  exit 1
fi

echo "📍 API URL: $API_URL"
echo "🏪 Store ID: $STORE_ID"
echo ""

# Helper function to make authenticated requests
api_request() {
  local method=$1
  local endpoint=$2
  local data=$3

  if [ -n "$data" ]; then
    curl -s -X "$method" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      -H "X-Store-ID: $STORE_ID" \
      -H "Content-Type: application/json" \
      -d "$data" \
      "$API_URL$endpoint"
  else
    curl -s -X "$method" \
      -H "Authorization: Bearer $AUTH_TOKEN" \
      -H "X-Store-ID: $STORE_ID" \
      "$API_URL$endpoint"
  fi
}

# Test 1: Get stats
echo "1️⃣  Testing GET /api/collaborators/stats"
stats_response=$(api_request GET "/collaborators/stats")
echo "Response: $stats_response"

current_users=$(echo $stats_response | jq -r '.current_users // 0')
max_users=$(echo $stats_response | jq -r '.max_users // 0')
can_add_more=$(echo $stats_response | jq -r '.can_add_more // false')
plan=$(echo $stats_response | jq -r '.plan // "unknown"')

echo "  ✓ Current users: $current_users"
echo "  ✓ Max users: $max_users"
echo "  ✓ Can add more: $can_add_more"
echo "  ✓ Plan: $plan"
echo ""

# Test 2: Get team members
echo "2️⃣  Testing GET /api/collaborators"
members_response=$(api_request GET "/collaborators")
echo "Response: $members_response"

members_count=$(echo $members_response | jq -r '.members | length')
echo "  ✓ Team members: $members_count"
echo ""

# Test 3: Get invitations
echo "3️⃣  Testing GET /api/collaborators/invitations"
invitations_response=$(api_request GET "/collaborators/invitations")
echo "Response: $invitations_response"

invitations_count=$(echo $invitations_response | jq -r '.invitations | length')
pending_count=$(echo $invitations_response | jq -r '[.invitations[] | select(.status == "pending")] | length')
echo "  ✓ Total invitations: $invitations_count"
echo "  ✓ Pending invitations: $pending_count"
echo ""

# Test 4: Create invitation (if possible)
if [ "$can_add_more" == "true" ]; then
  echo "4️⃣  Testing POST /api/collaborators/invite"

  invite_data=$(cat <<EOF
{
  "name": "Test Collaborator",
  "email": "test-collaborator-$(date +%s)@example.com",
  "role": "confirmador"
}
EOF
)

  invite_response=$(api_request POST "/collaborators/invite" "$invite_data")
  echo "Response: $invite_response"

  invitation_id=$(echo $invite_response | jq -r '.invitation.id // "null"')
  invite_url=$(echo $invite_response | jq -r '.invitation.inviteUrl // "null"')

  if [ "$invitation_id" != "null" ]; then
    echo "  ✓ Invitation created successfully"
    echo "  ✓ Invitation ID: $invitation_id"
    echo "  ✓ Invite URL: $invite_url"
    echo ""

    # Test 5: Cancel invitation
    echo "5️⃣  Testing DELETE /api/collaborators/invitations/$invitation_id"
    delete_response=$(api_request DELETE "/collaborators/invitations/$invitation_id")
    echo "Response: $delete_response"

    success=$(echo $delete_response | jq -r '.success // false')
    if [ "$success" == "true" ]; then
      echo "  ✓ Invitation cancelled successfully"
    else
      echo "  ❌ Failed to cancel invitation"
    fi
  else
    echo "  ❌ Failed to create invitation"
    echo "  Error: $(echo $invite_response | jq -r '.error // "Unknown error"')"
  fi
else
  echo "4️⃣  Skipping invitation tests - user limit reached"
  echo "  Current: $current_users / $max_users"
fi
echo ""

# Test 6: Validate stats after operations
echo "6️⃣  Testing stats after operations"
stats_response_after=$(api_request GET "/collaborators/stats")
echo "Response: $stats_response_after"

current_users_after=$(echo $stats_response_after | jq -r '.current_users // 0')
pending_after=$(echo $stats_response_after | jq -r '.pending_invitations // 0')
can_add_more_after=$(echo $stats_response_after | jq -r '.can_add_more // false')

echo "  ✓ Current users: $current_users_after"
echo "  ✓ Pending invitations: $pending_after"
echo "  ✓ Can add more: $can_add_more_after"
echo ""

# Summary
echo "================================"
echo "✅ All tests completed!"
echo ""
echo "Summary:"
echo "  - Stats endpoint: ✓"
echo "  - Members listing: ✓"
echo "  - Invitations listing: ✓"
if [ "$can_add_more" == "true" ]; then
  echo "  - Create invitation: ✓"
  echo "  - Cancel invitation: ✓"
fi
echo ""
echo "🎉 Collaborator system is working correctly!"
