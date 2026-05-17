-- ================================================================
-- 190_sifen_async_realtime.sql
-- ================================================================
-- El worker sifen-worker corre en Railway donde NO hay IPv6 outbound
-- y Supabase descontinuo el A record IPv4 del direct connection
-- (db.<ref>.supabase.co) desde 2024. Refactoreamos el wakeup de
-- dispatcher/poller a Supabase Realtime (WSS sobre IPv4 nativo) en
-- lugar de pg LISTEN/NOTIFY.
--
-- Esta migration garantiza que la tabla `invoices` este en la
-- publication `supabase_realtime` para que el worker reciba INSERT
-- y UPDATE events. Tambien deja los triggers pg_notify de migration
-- 189 intactos: si en el futuro habilitamos IPv4 add-on, pg_notify
-- vuelve a funcionar sin tocar nada.
--
-- Idempotente: no falla si la tabla ya esta en la publication.
-- ================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'invoices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE invoices;
  END IF;
END $$;

-- REPLICA IDENTITY DEFAULT (PK only) es suficiente. El worker solo
-- necesita la PK + columnas filtradas (sifen_status, sifen_protocol_number)
-- para hacer scheduleWake(); no necesita el OLD row completo.
-- Confirmamos el default por las dudas.
ALTER TABLE invoices REPLICA IDENTITY DEFAULT;
