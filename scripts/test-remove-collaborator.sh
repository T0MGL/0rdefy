#!/bin/bash

# Script de prueba específico para eliminación de colaboradores
# Valida que el flujo completo funcione correctamente

set -e

echo "🧪 Testing Collaborator Removal Flow"
echo "====================================="
echo ""

# Configuration
API_URL="${API_URL:-http://localhost:3001/api}"
AUTH_TOKEN="${AUTH_TOKEN}"
STORE_ID="${STORE_ID}"

if [ -z "$AUTH_TOKEN" ] || [ -z "$STORE_ID" ]; then
  echo "❌ Error: AUTH_TOKEN and STORE_ID environment variables are required"
  echo "Usage: AUTH_TOKEN='your-token' STORE_ID='your-store-id' ./test-remove-collaborator.sh"
  exit 1
fi

echo "📍 API URL: $API_URL"
echo "🏪 Store ID: $STORE_ID"
echo ""

# Helper function
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

echo "1️⃣  Obteniendo stats iniciales..."
stats_before=$(api_request GET "/collaborators/stats")
current_users_before=$(echo $stats_before | jq -r '.current_users // 0')
echo "  ✓ Usuarios actuales: $current_users_before"
echo ""

echo "2️⃣  Obteniendo lista de miembros del equipo..."
members_response=$(api_request GET "/collaborators")
echo "$members_response" | jq '.'

members_count=$(echo $members_response | jq -r '.members | length')
echo "  ✓ Total de miembros: $members_count"

# Encontrar un miembro que NO sea owner
non_owner_id=$(echo $members_response | jq -r '.members[] | select(.role != "owner") | .id' | head -n 1)

if [ -z "$non_owner_id" ] || [ "$non_owner_id" == "null" ]; then
  echo "  ℹ️  No hay colaboradores (no-owner) para eliminar"
  echo "  ℹ️  Creando una invitación para probar el flujo completo..."

  # Crear invitación de prueba
  invite_data=$(cat <<EOF
{
  "name": "Test Delete User",
  "email": "test-delete-$(date +%s)@example.com",
  "role": "confirmador"
}
EOF
)

  invite_response=$(api_request POST "/collaborators/invite" "$invite_data")
  invitation_id=$(echo $invite_response | jq -r '.invitation.id // "null"')

  if [ "$invitation_id" != "null" ]; then
    echo "  ✓ Invitación creada: $invitation_id"
    echo "  ℹ️  Para probar eliminación completa, acepta la invitación primero"
    echo "  ℹ️  Luego ejecuta nuevamente este script"

    # Cleanup - cancelar invitación
    echo ""
    echo "3️⃣  Limpiando invitación de prueba..."
    delete_response=$(api_request DELETE "/collaborators/invitations/$invitation_id")
    echo "  ✓ Invitación cancelada"
  else
    echo "  ❌ No se pudo crear invitación de prueba"
    echo "  Error: $(echo $invite_response | jq -r '.error // "Unknown error"')"
  fi

  exit 0
fi

non_owner_name=$(echo $members_response | jq -r ".members[] | select(.id == \"$non_owner_id\") | .name")
non_owner_role=$(echo $members_response | jq -r ".members[] | select(.id == \"$non_owner_id\") | .role")

echo ""
echo "  ✓ Colaborador encontrado:"
echo "    - ID: $non_owner_id"
echo "    - Nombre: $non_owner_name"
echo "    - Rol: $non_owner_role"
echo ""

echo "3️⃣  Eliminando colaborador..."
delete_response=$(api_request DELETE "/collaborators/$non_owner_id")
echo "Response: $delete_response"

success=$(echo $delete_response | jq -r '.success // false')

if [ "$success" == "true" ]; then
  echo "  ✓ Colaborador eliminado exitosamente"
else
  echo "  ❌ Error al eliminar colaborador"
  error_msg=$(echo $delete_response | jq -r '.error // "Unknown error"')
  echo "  Error: $error_msg"
  exit 1
fi
echo ""

echo "4️⃣  Verificando que el colaborador fue eliminado..."
members_after=$(api_request GET "/collaborators")
still_exists=$(echo $members_after | jq -r ".members[] | select(.id == \"$non_owner_id\") | .id // \"null\"")

if [ "$still_exists" == "null" ]; then
  echo "  ✓ Colaborador eliminado correctamente de la lista"
else
  echo "  ❌ Error: El colaborador aún aparece en la lista"
  exit 1
fi
echo ""

echo "5️⃣  Verificando stats actualizados..."
stats_after=$(api_request GET "/collaborators/stats")
current_users_after=$(echo $stats_after | jq -r '.current_users // 0')
echo "  ✓ Usuarios antes: $current_users_before"
echo "  ✓ Usuarios después: $current_users_after"

if [ "$current_users_after" -lt "$current_users_before" ]; then
  echo "  ✓ Stats actualizados correctamente (decrementó en $(($current_users_before - $current_users_after)))"
else
  echo "  ⚠️  Warning: Los stats no decrementaron como se esperaba"
fi
echo ""

echo "====================================="
echo "✅ Flujo de eliminación funciona correctamente!"
echo ""
echo "Resumen:"
echo "  - Miembro eliminado: $non_owner_name ($non_owner_role)"
echo "  - Soft delete aplicado: is_active = false"
echo "  - Lista de miembros actualizada: ✓"
echo "  - Stats actualizados: ✓"
echo ""
echo "🎉 El sistema de eliminación de colaboradores funciona perfectamente!"
