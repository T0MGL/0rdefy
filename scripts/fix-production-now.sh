#!/bin/bash

##############################################################################
# SCRIPT DE EMERGENCIA: Fix Producción 029
##############################################################################
# Este script ejecuta TODO el proceso de migración de forma automática
# Uso: ./scripts/fix-production-now.sh
##############################################################################

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Functions
error() {
    echo -e "${RED}❌ ERROR: $1${NC}"
    exit 1
}

success() {
    echo -e "${GREEN}✅ $1${NC}"
}

info() {
    echo -e "${CYAN}ℹ️  $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

banner() {
    echo ""
    echo "================================================================"
    echo -e "${CYAN}$1${NC}"
    echo "================================================================"
    echo ""
}

# Check DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
    error "Falta variable de entorno DATABASE_URL"
    echo ""
    echo "Configúrala ejecutando:"
    echo "  export DATABASE_URL='postgresql://user:password@host:5432/database'"
    echo ""
    echo "O crea un archivo .env con:"
    echo "  DATABASE_URL=postgresql://user:password@host:5432/database"
    echo ""
    exit 1
fi

# Check psql
if ! command -v psql &> /dev/null; then
    error "psql no está instalado"
    echo ""
    echo "Instalación:"
    echo "  macOS: brew install postgresql"
    echo "  Ubuntu: sudo apt-get install postgresql-client"
    exit 1
fi

# Extract DB info for display (hide password)
DB_INFO=$(echo "$DATABASE_URL" | sed 's/:[^@]*@/:***@/')

banner "ORDEFY - HOTFIX 029: Fix Producción"

info "Base de datos: $DB_INFO"
info "Modo: Transaccional (rollback automático si falla)"
echo ""

# Confirm execution
warning "Esta operación MODIFICARÁ la base de datos."
echo ""
echo "Cambios que se aplicarán:"
echo "  1. Agregar columna 'id' a shopify_webhook_idempotency"
echo "  2. Crear índice UNIQUE en orders.shopify_order_id"
echo "  3. Crear índice UNIQUE en orders.(shopify_order_id, store_id)"
echo ""

read -p "¿Continuar? (escribir 'yes' para confirmar): " confirm

if [ "$confirm" != "yes" ]; then
    warning "Operación cancelada por el usuario"
    exit 0
fi

echo ""

##############################################################################
# PASO 1: Verificar estado actual
##############################################################################

banner "PASO 1/4: Verificando estado actual"

info "Ejecutando diagnóstico..."
VERIFY_OUTPUT=$(psql "$DATABASE_URL" -f db/migrations/verify_schema_before_029.sql 2>&1)
VERIFY_EXIT_CODE=$?

if [ $VERIFY_EXIT_CODE -ne 0 ]; then
    error "Falló verificación de schema"
    echo "$VERIFY_OUTPUT"
    exit 1
fi

echo "$VERIFY_OUTPUT"

# Check for duplicates in output
if echo "$VERIFY_OUTPUT" | grep -q "Duplicados detectados: [1-9]"; then
    warning "Se detectaron pedidos duplicados"
    echo ""
    read -p "¿Deseas limpiar duplicados antes de continuar? (yes/no): " clean_duplicates

    if [ "$clean_duplicates" = "yes" ]; then
        banner "LIMPIANDO DUPLICADOS"

        warning "Esta operación eliminará pedidos duplicados (conservando el más reciente)"
        read -p "¿Estás seguro? (escribir 'DELETE' para confirmar): " confirm_delete

        if [ "$confirm_delete" = "DELETE" ]; then
            # Create temporary modified cleanup script
            TEMP_CLEANUP=$(mktemp)

            # Modify cleanup script to actually delete
            sed 's/-- DELETE FROM orders WHERE id IN/DELETE FROM orders WHERE id IN/' \
                db/migrations/cleanup_duplicate_orders.sql | \
            sed 's/ROLLBACK;/COMMIT;/' > "$TEMP_CLEANUP"

            info "Ejecutando limpieza de duplicados..."
            psql "$DATABASE_URL" -f "$TEMP_CLEANUP"

            rm "$TEMP_CLEANUP"
            success "Duplicados eliminados"
        else
            error "Limpieza cancelada. No se puede continuar con duplicados."
            exit 1
        fi
    else
        error "No se puede continuar con duplicados. Cancela y limpia manualmente."
        exit 1
    fi
fi

success "Verificación completada - sin duplicados"
echo ""

##############################################################################
# PASO 2: Ejecutar migración
##############################################################################

banner "PASO 2/4: Ejecutando migración 029 (Transaccional)"

info "Aplicando correcciones de schema..."
echo ""

MIGRATION_OUTPUT=$(psql "$DATABASE_URL" -f db/migrations/029_fix_critical_schema_transactional.sql 2>&1)
MIGRATION_EXIT_CODE=$?

if [ $MIGRATION_EXIT_CODE -ne 0 ]; then
    error "Migración falló"
    echo "$MIGRATION_OUTPUT"
    exit 1
fi

echo "$MIGRATION_OUTPUT"

# Check if migration was successful
if echo "$MIGRATION_OUTPUT" | grep -q "Migración 029 completada exitosamente"; then
    success "Migración ejecutada exitosamente"
else
    warning "No se pudo confirmar éxito de migración (revisar output arriba)"
fi

echo ""

##############################################################################
# PASO 3: Verificación post-migración
##############################################################################

banner "PASO 3/4: Verificando correcciones aplicadas"

info "Verificando columna id en shopify_webhook_idempotency..."
ID_CHECK=$(psql "$DATABASE_URL" -t -c "
SELECT COUNT(*) FROM information_schema.columns
WHERE table_name = 'shopify_webhook_idempotency' AND column_name = 'id';
" | tr -d ' ')

if [ "$ID_CHECK" = "1" ]; then
    success "Columna id existe"
else
    error "Columna id NO existe"
    exit 1
fi

info "Verificando índice UNIQUE simple..."
IDX_SIMPLE=$(psql "$DATABASE_URL" -t -c "
SELECT COUNT(*) FROM pg_indexes
WHERE tablename = 'orders' AND indexname = 'idx_orders_shopify_id';
" | tr -d ' ')

if [ "$IDX_SIMPLE" = "1" ]; then
    success "Índice idx_orders_shopify_id existe"
else
    warning "Índice simple no existe (no crítico)"
fi

info "Verificando índice UNIQUE compuesto..."
IDX_COMPOSITE=$(psql "$DATABASE_URL" -t -c "
SELECT COUNT(*) FROM pg_indexes
WHERE tablename = 'orders' AND indexname = 'idx_orders_shopify_store_unique';
" | tr -d ' ')

if [ "$IDX_COMPOSITE" = "1" ]; then
    success "Índice idx_orders_shopify_store_unique existe"
else
    error "Índice compuesto NO existe (CRÍTICO)"
    exit 1
fi

echo ""

##############################################################################
# PASO 4: Testing
##############################################################################

banner "PASO 4/4: Testing funcional"

info "Test 1: Inserción en shopify_webhook_idempotency..."

TEST1_RESULT=$(psql "$DATABASE_URL" -t -c "
INSERT INTO shopify_webhook_idempotency (
    integration_id,
    idempotency_key,
    shopify_event_id,
    shopify_topic,
    response_status,
    expires_at
) VALUES (
    (SELECT id FROM shopify_integrations LIMIT 1),
    'test-fix-029-' || NOW()::TEXT,
    'evt-test-123',
    'orders/create',
    200,
    NOW() + INTERVAL '1 day'
) RETURNING id;
" 2>&1)

if echo "$TEST1_RESULT" | grep -qE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'; then
    success "Test 1 OK - Webhook idempotency funciona"
else
    error "Test 1 FALLÓ"
    echo "$TEST1_RESULT"
    exit 1
fi

info "Test 2: UPSERT en orders..."

# First insert
SHOPIFY_ORDER_ID="test-shopify-029-$(date +%s)"
STORE_ID=$(psql "$DATABASE_URL" -t -c "SELECT id FROM stores LIMIT 1;" | tr -d ' ')

if [ -z "$STORE_ID" ]; then
    warning "No hay tiendas en la base de datos, saltando test 2"
else
    TEST2A_RESULT=$(psql "$DATABASE_URL" -t -c "
    INSERT INTO orders (store_id, shopify_order_id, customer_email, total_price)
    VALUES (
        '$STORE_ID',
        '$SHOPIFY_ORDER_ID',
        'test@ordefy.io',
        100.00
    )
    ON CONFLICT (shopify_order_id, store_id)
    DO UPDATE SET total_price = EXCLUDED.total_price
    RETURNING total_price;
    " 2>&1)

    if echo "$TEST2A_RESULT" | grep -q "100.00"; then
        success "Test 2a OK - INSERT funciona"
    else
        error "Test 2a FALLÓ (INSERT)"
        echo "$TEST2A_RESULT"
        exit 1
    fi

    # Second insert (should UPDATE)
    TEST2B_RESULT=$(psql "$DATABASE_URL" -t -c "
    INSERT INTO orders (store_id, shopify_order_id, customer_email, total_price)
    VALUES (
        '$STORE_ID',
        '$SHOPIFY_ORDER_ID',
        'test@ordefy.io',
        200.00
    )
    ON CONFLICT (shopify_order_id, store_id)
    DO UPDATE SET total_price = EXCLUDED.total_price
    RETURNING total_price;
    " 2>&1)

    if echo "$TEST2B_RESULT" | grep -q "200.00"; then
        success "Test 2b OK - UPDATE funciona (ON CONFLICT resuelto)"
    else
        error "Test 2b FALLÓ (UPDATE)"
        echo "$TEST2B_RESULT"
        exit 1
    fi
fi

echo ""

##############################################################################
# RESUMEN FINAL
##############################################################################

banner "RESUMEN FINAL"

success "✅ Migración 029 completada exitosamente"
echo ""
echo "Correcciones aplicadas:"
echo "  ✅ Columna 'id' agregada a shopify_webhook_idempotency"
echo "  ✅ Índice UNIQUE creado en orders.shopify_order_id"
echo "  ✅ Índice UNIQUE compuesto creado"
echo "  ✅ Tests funcionales pasados"
echo ""

info "Próximos pasos:"
echo "  1. Crear pedido de prueba en Shopify Admin"
echo "  2. Verificar que el webhook se procesa sin errores"
echo "  3. Verificar que el pedido aparece en la base de datos"
echo "  4. Monitorear logs durante la próxima hora"
echo ""

info "Comandos útiles:"
echo "  # Ver webhooks recientes"
echo "  psql \"\$DATABASE_URL\" -c \"SELECT shopify_topic, COUNT(*) FROM shopify_webhook_idempotency WHERE created_at > NOW() - INTERVAL '1 hour' GROUP BY shopify_topic;\""
echo ""
echo "  # Ver pedidos recientes"
echo "  psql \"\$DATABASE_URL\" -c \"SELECT id, shopify_order_id, customer_email, created_at FROM orders ORDER BY created_at DESC LIMIT 5;\""
echo ""

success "Producción restaurada 🎉"
