#!/bin/bash

# Test the DELETE /api/collaborators/:userId endpoint

# You need to provide:
# - AUTH_TOKEN: Your JWT token
# - STORE_ID: Your store ID
# - USER_ID: The user ID to remove

echo "Testing DELETE /api/collaborators/:userId endpoint"
echo ""

# Example (replace with real values):
# AUTH_TOKEN="your-jwt-token"
# STORE_ID="your-store-id"
# USER_ID="user-id-to-remove"

# Uncomment and set these:
# curl -X DELETE "http://localhost:3001/api/collaborators/${USER_ID}" \
#   -H "Authorization: Bearer ${AUTH_TOKEN}" \
#   -H "X-Store-ID: ${STORE_ID}" \
#   -H "Content-Type: application/json" \
#   -v

echo "Please uncomment and set AUTH_TOKEN, STORE_ID, and USER_ID in this script"
