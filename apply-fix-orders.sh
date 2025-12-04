#!/bin/bash
# ================================================================
# Apply Fix for Order Creation and Deletion
# ================================================================
# This script applies the critical fix for order creation and deletion
# ================================================================

set -e  # Exit on error

echo "================================================================"
echo "🔧 Aplicando corrección crítica de pedidos"
echo "================================================================"
echo ""
echo "Esta migración soluciona:"
echo "  ✅ Creación de pedidos con productos faltantes"
echo "  ✅ Eliminación de pedidos no procesados"
echo "  ✅ Mantiene protección de datos para pedidos procesados"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found"
    echo "Please create a .env file with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
    exit 1
fi

# Load environment variables
source .env

# Check required variables
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo "❌ Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env"
    exit 1
fi

echo "📡 Conectando a Supabase..."
echo "URL: $SUPABASE_URL"
echo ""

# Get database connection details from SUPABASE_URL
PROJECT_REF=$(echo $SUPABASE_URL | sed -E 's|https://([^.]+)\.supabase\.co|\1|')

echo "📝 Migración lista para aplicar: db/migrations/023_fix_order_creation_and_deletion.sql"
echo ""
echo "⚠️  IMPORTANTE: Debes ejecutar esta migración manualmente en Supabase"
echo ""
echo "Pasos:"
echo "1. Ve a https://supabase.com/dashboard/project/$PROJECT_REF/editor"
echo "2. Abre el SQL Editor"
echo "3. Copia y pega el contenido del archivo: db/migrations/023_fix_order_creation_and_deletion.sql"
echo "4. Ejecuta el SQL"
echo ""
echo "================================================================"
echo "✅ Instrucciones generadas exitosamente"
echo "================================================================"
echo ""
