-- ================================================================
-- Agregar campo google_maps_link a orders
-- ================================================================
-- Permite almacenar un link directo de Google Maps en lugar de latitud/longitud
-- ================================================================

-- Agregar columna google_maps_link
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS google_maps_link TEXT;

-- Agregar índice para búsquedas
CREATE INDEX IF NOT EXISTS idx_orders_google_maps_link
ON orders(google_maps_link)
WHERE google_maps_link IS NOT NULL;

-- Comentario en la columna
COMMENT ON COLUMN orders.google_maps_link IS 'Link directo de Google Maps para la ubicación del pedido';
