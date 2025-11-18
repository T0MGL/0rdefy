-- ================================================================
-- ORDEFY - DELIVERY PHOTOS STORAGE BUCKET
-- ================================================================
-- Configura Supabase Storage bucket para fotos de entrega
-- Las fotos se eliminan automáticamente después de 1 día
-- ================================================================

-- ================================================================
-- STEP 1: CREATE STORAGE BUCKET
-- ================================================================
-- NOTA: Este SQL debe ejecutarse en Supabase Dashboard o vía API
-- Los buckets de Storage no se crean directamente con SQL

-- Via Supabase Dashboard:
-- 1. Ir a Storage → Create a new bucket
-- 2. Nombre: "delivery-photos"
-- 3. Public: false (requiere autenticación)
-- 4. File size limit: 5MB (tamaño razonable para fotos)
-- 5. Allowed MIME types: image/jpeg, image/png, image/webp

-- ================================================================
-- STEP 2: STORAGE POLICIES (RLS)
-- ================================================================

-- NOTA: Las políticas de Storage en Supabase se configuran desde el Dashboard
-- No se pueden crear directamente con SQL en la mayoría de configuraciones

-- Configuración manual requerida en Supabase Dashboard:
-- 1. Ir a Storage → delivery-photos → Policies
-- 2. Crear política para INSERT:
--    - Policy name: "Authenticated users can upload"
--    - Allowed operation: INSERT
--    - Target roles: authenticated
--    - USING expression: true
--    - WITH CHECK expression: true
--
-- 3. Crear política para SELECT:
--    - Policy name: "Authenticated users can read"
--    - Allowed operation: SELECT
--    - Target roles: authenticated
--    - USING expression: true

-- Si tienes acceso a crear políticas vía SQL, puedes usar:
-- CREATE POLICY "Authenticated users can upload"
-- ON storage.objects FOR INSERT
-- TO authenticated
-- WITH CHECK (bucket_id = 'delivery-photos');
--
-- CREATE POLICY "Authenticated users can read"
-- ON storage.objects FOR SELECT
-- TO authenticated
-- USING (bucket_id = 'delivery-photos');

-- ================================================================
-- STEP 3: AUTO-DELETE PHOTOS AFTER 1 DAY
-- ================================================================

-- Crear función para eliminar fotos antiguas
CREATE OR REPLACE FUNCTION delete_old_delivery_photos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  old_photo RECORD;
BEGIN
  -- Encontrar todos los delivery_attempts con fotos de más de 1 día
  FOR old_photo IN
    SELECT photo_url
    FROM delivery_attempts
    WHERE photo_url IS NOT NULL
      AND actual_date < CURRENT_DATE - INTERVAL '1 day'
      AND photo_url LIKE '%delivery-photos%'
  LOOP
    -- Extraer el path del archivo de la URL
    -- Ejemplo: https://xxx.supabase.co/storage/v1/object/public/delivery-photos/store-id/photo.jpg
    -- Extraemos: store-id/photo.jpg

    -- Eliminar el registro de la URL (ya cumplió su propósito)
    UPDATE delivery_attempts
    SET photo_url = NULL
    WHERE photo_url = old_photo.photo_url;

    -- NOTA: La eliminación física del archivo en Storage debe hacerse
    -- vía la API de Supabase Storage desde el backend
    -- Ver api/services/delivery-photo-cleanup.service.ts
  END LOOP;
END;
$$;

COMMENT ON FUNCTION delete_old_delivery_photos() IS 'Limpia URLs de fotos de entrega de más de 1 día';

-- ================================================================
-- STEP 4: CRON JOB PARA LIMPIAR FOTOS
-- ================================================================

-- Ejecutar diariamente a las 3 AM
-- NOTA: Requiere la extensión pg_cron en Supabase
-- Ejecutar solo si pg_cron está disponible

-- Nota: Este bloque puede fallar si pg_cron no está instalado
-- En ese caso, puedes comentarlo y ejecutar la limpieza manualmente

DO $outer$
DECLARE
  cron_exists boolean;
BEGIN
  -- Verificar si pg_cron está disponible
  SELECT EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) INTO cron_exists;

  IF cron_exists THEN
    -- Eliminar job existente si existe (ignorar errores)
    BEGIN
      PERFORM cron.unschedule('cleanup-delivery-photos');
    EXCEPTION
      WHEN OTHERS THEN
        -- Ignorar si el job no existe
        NULL;
    END;

    -- Crear nuevo job
    PERFORM cron.schedule(
      'cleanup-delivery-photos',
      '0 3 * * *', -- Diariamente a las 3 AM
      'SELECT delete_old_delivery_photos()'
    );

    RAISE NOTICE 'Cron job created: cleanup-delivery-photos runs daily at 3 AM';
  ELSE
    RAISE NOTICE 'pg_cron extension not found. Skipping cron job creation. You can run delete_old_delivery_photos() manually.';
  END IF;
END $outer$;

-- ================================================================
-- MIGRATION NOTES
-- ================================================================
--
-- CONFIGURACIÓN MANUAL REQUERIDA:
--
-- 1. Crear bucket en Supabase Dashboard:
--    - Nombre: delivery-photos
--    - Public: false
--    - File size limit: 5MB
--    - Allowed MIME types: image/jpeg, image/png, image/webp
--
-- 2. Configurar políticas RLS en Storage:
--    - INSERT: authenticated users
--    - SELECT: authenticated users
--
-- 3. Implementar servicio backend para eliminar archivos físicos:
--    - Ver api/services/delivery-photo-cleanup.service.ts
--    - Llamar vía cron job o manual
--
-- ================================================================
