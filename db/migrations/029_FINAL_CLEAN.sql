-- ================================================================
-- MIGRATION 029: FIX CRITICAL SCHEMA (VERSIÓN LIMPIA)
-- ================================================================
-- Ejecutar en Supabase SQL Editor o cualquier cliente PostgreSQL
-- Esta versión NO tiene transacciones ni RAISE NOTICE problemáticos
-- ================================================================

-- ================================================================
-- FIX 1: Agregar columna id a shopify_webhook_idempotency
-- ================================================================

-- Agregar columna id si no existe
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'shopify_webhook_idempotency'
        AND column_name = 'id'
    ) THEN
        -- Agregar columna
        ALTER TABLE shopify_webhook_idempotency
        ADD COLUMN id UUID DEFAULT gen_random_uuid();

        -- Rellenar NULLs
        UPDATE shopify_webhook_idempotency
        SET id = gen_random_uuid()
        WHERE id IS NULL;

        -- Hacer NOT NULL
        ALTER TABLE shopify_webhook_idempotency
        ALTER COLUMN id SET NOT NULL;

        -- Eliminar constraint existente si hay
        ALTER TABLE shopify_webhook_idempotency
        DROP CONSTRAINT IF EXISTS shopify_webhook_idempotency_pkey CASCADE;

        -- Crear Primary Key
        ALTER TABLE shopify_webhook_idempotency
        ADD CONSTRAINT shopify_webhook_idempotency_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- ================================================================
-- FIX 2: Crear índices UNIQUE en orders
-- ================================================================

-- Índice simple
DROP INDEX IF EXISTS idx_orders_shopify_id;
CREATE UNIQUE INDEX idx_orders_shopify_id
ON orders(shopify_order_id)
WHERE shopify_order_id IS NOT NULL;

-- Índice compuesto (CRÍTICO para UPSERTS)
DROP INDEX IF EXISTS idx_orders_shopify_store_unique;
CREATE UNIQUE INDEX idx_orders_shopify_store_unique
ON orders(shopify_order_id, store_id)
WHERE shopify_order_id IS NOT NULL;

-- ================================================================
-- VERIFICACIÓN
-- ================================================================

DO $$
DECLARE
    v_id_exists BOOLEAN;
    v_idx_composite_exists BOOLEAN;
BEGIN
    -- Check column id
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'shopify_webhook_idempotency'
        AND column_name = 'id'
    ) INTO v_id_exists;

    -- Check composite index
    SELECT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE tablename = 'orders'
        AND indexname = 'idx_orders_shopify_store_unique'
    ) INTO v_idx_composite_exists;

    -- Fail if not correct
    IF NOT v_id_exists THEN
        RAISE EXCEPTION 'FALLO: columna id no existe en shopify_webhook_idempotency';
    END IF;

    IF NOT v_idx_composite_exists THEN
        RAISE EXCEPTION 'FALLO: idx_orders_shopify_store_unique no existe';
    END IF;
END $$;

-- Si llegas aquí, la migración fue exitosa
SELECT 'Migración 029 completada exitosamente' as status;
