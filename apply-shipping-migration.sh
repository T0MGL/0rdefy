#!/bin/bash
# Script to apply shipments system migration (027)

echo "================================================================"
echo "Aplicando migración 027: Sistema de Despacho (Shipments)"
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

echo "📦 Aplicando migración..."
psql "$DATABASE_URL" -f db/migrations/027_shipments_system.sql

if [ $? -eq 0 ]; then
    echo ""
    echo "================================================================"
    echo "✅ Migración aplicada exitosamente"
    echo "================================================================"
    echo ""
    echo "Cambios realizados:"
    echo "  ✓ Tabla 'shipments' creada"
    echo "  ✓ Función 'create_shipment()' creada"
    echo "  ✓ Función 'create_shipments_batch()' creada"
    echo "  ✓ Índices de rendimiento agregados"
    echo ""
    echo "Ahora puedes usar el módulo de Despacho en la aplicación!"
    echo ""
else
    echo ""
    echo "================================================================"
    echo "❌ Error al aplicar la migración"
    echo "================================================================"
    exit 1
fi
