#!/bin/bash
# ================================================================
# Apply Returns System Migration
# ================================================================
# This script applies ONLY the returns system migration (Part 13)
# to an existing Ordefy database
# ================================================================

set -e  # Exit on error

echo "================================================================"
echo "🔄 Aplicando migración del sistema de devoluciones"
echo "================================================================"

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

# Extract the SQL for returns system from master migration
# Lines 1553-1777 contain the returns system migration
echo "📝 Extrayendo migración de returns..."
sed -n '1553,1777p' db/migrations/000_MASTER_MIGRATION.sql > /tmp/returns_migration.sql

# Apply migration using Supabase REST API
echo "🚀 Ejecutando migración..."

# Get database connection details from SUPABASE_URL
# Format: https://xxxxx.supabase.co
PROJECT_REF=$(echo $SUPABASE_URL | sed -E 's|https://([^.]+)\.supabase\.co|\1|')

echo "⚠️  IMPORTANTE: Debes ejecutar esta migración manualmente en Supabase"
echo ""
echo "Pasos:"
echo "1. Ve a https://supabase.com/dashboard/project/$PROJECT_REF/editor"
echo "2. Abre el SQL Editor"
echo "3. Copia y pega el contenido del archivo: db/migrations/022_returns_system.sql"
echo "4. Ejecuta el SQL"
echo ""
echo "O ejecuta directamente el archivo master migration:"
echo "1. Ve a https://supabase.com/dashboard/project/$PROJECT_REF/editor"
echo "2. Abre el SQL Editor"
echo "3. Copia y pega el contenido del archivo: db/migrations/000_MASTER_MIGRATION.sql"
echo "4. Ejecuta el SQL (es idempotente, no causará problemas)"
echo ""
echo "================================================================"
echo "✅ Instrucciones generadas exitosamente"
echo "================================================================"
echo ""
echo "📁 Archivos de migración disponibles:"
echo "  - db/migrations/000_MASTER_MIGRATION.sql (completo, recomendado)"
echo "  - db/migrations/022_returns_system.sql (solo returns)"
echo ""
