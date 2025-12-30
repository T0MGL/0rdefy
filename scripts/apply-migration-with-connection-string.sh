#!/bin/bash

# Script para aplicar la migración MASTER usando connection string de Supabase
#
# Uso:
#   ./scripts/apply-migration-with-connection-string.sh "postgresql://postgres...@...supabase.com:6543/postgres"
#
# O establece la variable de entorno:
#   export SUPABASE_DB_URL="postgresql://..."
#   ./scripts/apply-migration-with-connection-string.sh

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Aplicando migración MASTER a Supabase${NC}\n"

# Get database URL from argument or environment variable
DB_URL="${1:-$SUPABASE_DB_URL}"

if [ -z "$DB_URL" ]; then
    echo -e "${RED}❌ Error: No se proporcionó la connection string${NC}"
    echo ""
    echo "Uso:"
    echo "  $0 \"postgresql://postgres...@...supabase.com:6543/postgres\""
    echo ""
    echo "O establece la variable de entorno:"
    echo "  export SUPABASE_DB_URL=\"postgresql://...\""
    echo "  $0"
    echo ""
    echo -e "${YELLOW}Para obtener la connection string:${NC}"
    echo "  1. Ve a: https://supabase.com/dashboard/project/vgqecqqleuowvoimcoxg/settings/database"
    echo "  2. En 'Connection string' → 'URI'"
    echo "  3. Copia la URI completa (usa Transaction mode, puerto 6543)"
    exit 1
fi

# Verify migration file exists
MIGRATION_FILE="db/migrations/000_MASTER_MIGRATION.sql"
if [ ! -f "$MIGRATION_FILE" ]; then
    echo -e "${RED}❌ Error: No se encontró el archivo $MIGRATION_FILE${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Archivo de migración encontrado${NC}"
echo -e "   Ruta: $MIGRATION_FILE"
echo -e "   Tamaño: $(wc -c < "$MIGRATION_FILE") bytes\n"

# Test connection first
echo -e "${BLUE}🔗 Verificando conexión...${NC}"
if psql "$DB_URL" -c "SELECT version();" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Conexión exitosa${NC}\n"
else
    echo -e "${RED}❌ Error: No se pudo conectar a la base de datos${NC}"
    echo ""
    echo "Verifica que:"
    echo "  1. La connection string es correcta"
    echo "  2. El puerto es 6543 (transaction mode) o 5432 (session mode)"
    echo "  3. La contraseña está incluida en la URL"
    exit 1
fi

# Apply migration
echo -e "${BLUE}📝 Aplicando migración MASTER...${NC}"
echo -e "${YELLOW}   (Esto puede tardar 30-90 segundos)${NC}\n"

if psql "$DB_URL" -f "$MIGRATION_FILE"; then
    echo ""
    echo -e "${GREEN}✅ Migración aplicada exitosamente!${NC}\n"

    # Verify some tables were created
    echo -e "${BLUE}🔍 Verificando tablas creadas...${NC}"
    TABLE_COUNT=$(psql "$DB_URL" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';")
    echo -e "${GREEN}✅ Se crearon $TABLE_COUNT tablas en el schema public${NC}"

    # List main tables
    echo -e "\n${BLUE}📊 Tablas principales:${NC}"
    psql "$DB_URL" -c "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name LIMIT 20;"

    echo ""
    echo -e "${GREEN}🎉 ¡Migración completada con éxito!${NC}"
    echo ""
else
    echo ""
    echo -e "${RED}❌ Error al aplicar la migración${NC}"
    echo "Revisa los errores arriba para más detalles"
    exit 1
fi
