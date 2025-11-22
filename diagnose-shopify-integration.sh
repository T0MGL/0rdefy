#!/bin/bash

# Script de diagnóstico para integración de Shopify
# Verifica configuración, webhooks y prueba sincronización

API_URL="http://localhost:3001"

echo "========================================"
echo "DIAGNÓSTICO DE INTEGRACIÓN SHOPIFY"
echo "========================================"
echo ""

# Verificar que el servidor está corriendo
echo "1️⃣  Verificando servidor API..."
HEALTH=$(curl -s "${API_URL}/health" -w "\nHTTP_STATUS:%{http_code}")
HTTP_CODE=$(echo "$HEALTH" | grep "HTTP_STATUS" | cut -d':' -f2)

if [ "$HTTP_CODE" == "200" ]; then
  echo "✅ Servidor API está corriendo"
else
  echo "❌ Servidor API no responde (código: $HTTP_CODE)"
  exit 1
fi
echo ""

# Solicitar credenciales
echo "2️⃣  Ingresa tus credenciales de autenticación:"
echo ""
read -p "Token de autenticación (JWT): " AUTH_TOKEN
read -p "Store ID: " STORE_ID
echo ""

# Verificar integración de Shopify
echo "3️⃣  Verificando integración de Shopify..."
INTEGRATION=$(curl -s "${API_URL}/api/shopify/integration" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "X-Store-ID: ${STORE_ID}")

SHOP_DOMAIN=$(echo "$INTEGRATION" | grep -o '"shop_domain":"[^"]*"' | cut -d'"' -f4)

if [ -z "$SHOP_DOMAIN" ]; then
  echo "❌ No hay integración de Shopify configurada"
  echo ""
  echo "Respuesta del servidor:"
  echo "$INTEGRATION" | json_pp 2>/dev/null || echo "$INTEGRATION"
  exit 1
else
  echo "✅ Integración encontrada: $SHOP_DOMAIN"
fi
echo ""

# Listar webhooks registrados
echo "4️⃣  Verificando webhooks registrados en Shopify..."
WEBHOOKS=$(curl -s "${API_URL}/api/shopify/webhooks/list" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "X-Store-ID: ${STORE_ID}")

WEBHOOK_COUNT=$(echo "$WEBHOOKS" | grep -o '"count":[0-9]*' | cut -d':' -f2)

if [ -z "$WEBHOOK_COUNT" ] || [ "$WEBHOOK_COUNT" == "0" ]; then
  echo "⚠️  No hay webhooks registrados"
  echo ""
  echo "Registrando webhooks automáticamente..."

  SETUP_RESULT=$(curl -s -X POST "${API_URL}/api/shopify/webhooks/setup" \
    -H "Authorization: Bearer ${AUTH_TOKEN}" \
    -H "X-Store-ID: ${STORE_ID}")

  echo "$SETUP_RESULT" | json_pp 2>/dev/null || echo "$SETUP_RESULT"
else
  echo "✅ Webhooks registrados: $WEBHOOK_COUNT"
  echo ""
  echo "Lista de webhooks:"
  echo "$WEBHOOKS" | json_pp 2>/dev/null || echo "$WEBHOOKS"
fi
echo ""

# Verificar configuración de n8n
echo "5️⃣  Verificando configuración de n8n..."
if grep -q "N8N_WEBHOOK_URL=" .env 2>/dev/null; then
  N8N_URL=$(grep "N8N_WEBHOOK_URL=" .env | cut -d'=' -f2)
  if [ "$N8N_URL" == "http://localhost:5678/webhook" ]; then
    echo "⚠️  URL de n8n usa localhost (no funcionará en producción)"
    echo "   URL actual: $N8N_URL"
  else
    echo "✅ N8N_WEBHOOK_URL configurado: $N8N_URL"
  fi
else
  echo "❌ N8N_WEBHOOK_URL no configurado en .env"
fi
echo ""

# Verificar health de webhooks
echo "6️⃣  Verificando salud de webhooks (últimas 24 horas)..."
WEBHOOK_HEALTH=$(curl -s "${API_URL}/api/shopify/webhook-health?hours=24" \
  -H "Authorization: Bearer ${AUTH_TOKEN}" \
  -H "X-Store-ID: ${STORE_ID}")

HEALTH_STATUS=$(echo "$WEBHOOK_HEALTH" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

if [ "$HEALTH_STATUS" == "healthy" ]; then
  echo "✅ Webhooks funcionando correctamente"
elif [ "$HEALTH_STATUS" == "degraded" ]; then
  echo "⚠️  Webhooks con problemas (degraded)"
elif [ "$HEALTH_STATUS" == "unhealthy" ]; then
  echo "❌ Webhooks con errores críticos"
else
  echo "ℹ️  No hay datos de webhooks aún"
fi

echo ""
echo "Detalles:"
echo "$WEBHOOK_HEALTH" | json_pp 2>/dev/null || echo "$WEBHOOK_HEALTH"
echo ""

# Prueba de sincronización manual
echo "7️⃣  ¿Deseas probar sincronización manual? (s/n)"
read -p "> " TEST_SYNC

if [ "$TEST_SYNC" == "s" ] || [ "$TEST_SYNC" == "S" ]; then
  echo ""
  echo "Selecciona tipo de sincronización:"
  echo "1) Productos"
  echo "2) Clientes"
  echo "3) Todo (productos + clientes)"
  read -p "> " SYNC_OPTION

  case $SYNC_OPTION in
    1)
      SYNC_TYPE="products"
      ;;
    2)
      SYNC_TYPE="customers"
      ;;
    3)
      SYNC_TYPE="all"
      ;;
    *)
      echo "❌ Opción inválida"
      exit 1
      ;;
  esac

  echo ""
  echo "Iniciando sincronización de $SYNC_TYPE..."

  SYNC_RESULT=$(curl -s -X POST "${API_URL}/api/shopify/manual-sync" \
    -H "Authorization: Bearer ${AUTH_TOKEN}" \
    -H "X-Store-ID: ${STORE_ID}" \
    -H "Content-Type: application/json" \
    -d "{\"sync_type\":\"${SYNC_TYPE}\"}")

  echo "$SYNC_RESULT" | json_pp 2>/dev/null || echo "$SYNC_RESULT"
fi

echo ""
echo "========================================"
echo "DIAGNÓSTICO COMPLETO"
echo "========================================"
echo ""
echo "💡 PRÓXIMOS PASOS:"
echo ""
echo "1. Si no aparecen órdenes desde Shopify:"
echo "   - Verifica que los webhooks estén registrados (paso 4)"
echo "   - Crea una orden de prueba en Shopify"
echo "   - Revisa los logs del servidor: tail -f api/logs/error.log"
echo ""
echo "2. Si la sincronización manual falla:"
echo "   - Verifica las credenciales de Shopify en la base de datos"
echo "   - Revisa que el access_token sea válido"
echo ""
echo "3. Para ver estado de importación en tiempo real:"
echo "   - Abre el dashboard de Ordefy"
echo "   - Ve a Integraciones → Shopify"
echo "   - Observa la barra de progreso"
echo ""
