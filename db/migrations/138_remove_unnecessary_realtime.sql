-- Migration 138: Remove unnecessary tables from Realtime publication
-- Only orders needs Realtime (live updates via WebSocket).
-- The other 6 tables broadcast every mutation to all clients, wasting egress.
-- Backend handles products/customers/campaigns updates via API responses.

BEGIN;

-- Postgres 15 ALTER PUBLICATION does not support IF EXISTS.
-- All 6 tables were added in migration 007; safe to drop unconditionally.
ALTER PUBLICATION supabase_realtime DROP TABLE public.products;
ALTER PUBLICATION supabase_realtime DROP TABLE public.customers;
ALTER PUBLICATION supabase_realtime DROP TABLE public.campaigns;
ALTER PUBLICATION supabase_realtime DROP TABLE public.order_status_history;
ALTER PUBLICATION supabase_realtime DROP TABLE public.shopify_import_jobs;
ALTER PUBLICATION supabase_realtime DROP TABLE public.shopify_webhook_events;

-- orders stays in the publication (added in 007, only table with frontend Realtime usage)

COMMIT;
