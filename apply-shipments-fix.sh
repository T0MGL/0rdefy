#!/bin/bash
# Fix COALESCE type mismatch error in shipments system

echo "================================================================"
echo "Aplicando fix: COALESCE type mismatch en shipments"
echo "================================================================"

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: No se encontró el archivo .env"
    exit 1
fi

# Load environment variables
source .env

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: DATABASE_URL no está configurado en .env"
    exit 1
fi

echo "📦 Aplicando fix..."
psql "$DATABASE_URL" -f fix-shipments-coalesce.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "================================================================"
    echo "✅ Fix aplicado exitosamente"
    echo "================================================================"
    echo ""
    echo "El problema del COALESCE ha sido resuelto."
    echo "Ahora puedes usar el módulo de Despacho sin errores."
    echo ""
else
    echo ""
    echo "================================================================"
    echo "❌ Error al aplicar el fix"
    echo "================================================================"
    exit 1
fi
