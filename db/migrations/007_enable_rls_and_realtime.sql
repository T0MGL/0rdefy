-- ================================================================
-- NEONFLOW - ENABLE ROW LEVEL SECURITY AND REALTIME
-- ================================================================
-- This migration enables RLS for multi-tenant security and
-- configures Realtime subscriptions for live updates
-- ================================================================
-- SECURITY MODEL:
-- - All tables with store_id enforce RLS based on user_stores access
-- - Users table allows users to read/update their own profile
-- - Service role (webhooks, system ops) bypasses RLS
-- - Regular authenticated requests must validate store access
-- ================================================================

-- ================================================================
-- HELPER FUNCTION: Check if user has access to a store
-- ================================================================
-- This function is used by all RLS policies to verify store access
-- Returns TRUE if the authenticated user has access to the given store_id
-- ================================================================

CREATE OR REPLACE FUNCTION public.user_has_store_access(check_store_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    -- Check if user_id from JWT exists in user_stores with this store_id
    RETURN EXISTS (
        SELECT 1
        FROM public.user_stores
        WHERE user_id = auth.uid()
        AND store_id = check_store_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.user_has_store_access IS 'Helper function to check if authenticated user has access to a store via user_stores';

-- ================================================================
-- ENABLE RLS ON ALL MULTI-TENANT TABLES
-- ================================================================

-- Tables with store_id (multi-tenant data)
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_up_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipping_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopify_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopify_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopify_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shopify_sync_conflicts ENABLE ROW LEVEL SECURITY;

-- User-related tables (different security model)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_stores ENABLE ROW LEVEL SECURITY;

-- ================================================================
-- RLS POLICIES: STORES
-- ================================================================
-- Users can only access stores they are members of
-- ================================================================

CREATE POLICY "Users can view their own stores"
ON public.stores FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.user_stores
        WHERE user_stores.user_id = auth.uid()
        AND user_stores.store_id = stores.id
    )
);

CREATE POLICY "Users can update stores they own or admin"
ON public.stores FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM public.user_stores
        WHERE user_stores.user_id = auth.uid()
        AND user_stores.store_id = stores.id
        AND user_stores.role IN ('owner', 'admin')
    )
);

-- Store creation is handled by backend during registration
-- No INSERT policy for users (service role only)

-- ================================================================
-- RLS POLICIES: STORE_CONFIG
-- ================================================================

CREATE POLICY "Users can view config for their stores"
ON public.store_config FOR SELECT
USING (public.user_has_store_access(store_id));

CREATE POLICY "Admins can update config for their stores"
ON public.store_config FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM public.user_stores
        WHERE user_stores.user_id = auth.uid()
        AND user_stores.store_id = store_config.store_id
        AND user_stores.role IN ('owner', 'admin')
    )
);

CREATE POLICY "Admins can insert config for their stores"
ON public.store_config FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_stores
        WHERE user_stores.user_id = auth.uid()
        AND user_stores.store_id = store_config.store_id
        AND user_stores.role IN ('owner', 'admin')
    )
);

-- ================================================================
-- RLS POLICIES: PRODUCTS
-- ================================================================

CREATE POLICY "Users can view products from their stores"
ON public.products FOR SELECT
USING (public.user_has_store_access(store_id));

CREATE POLICY "Users can insert products to their stores"
ON public.products FOR INSERT
WITH CHECK (public.user_has_store_access(store_id));

CREATE POLICY "Users can update products in their stores"
ON public.products FOR UPDATE
USING (public.user_has_store_access(store_id));

CREATE POLICY "Users can delete products from their stores"
ON public.products FOR DELETE
USING (public.user_has_store_access(store_id));

-- ================================================================
-- RLS POLICIES: CUSTOMERS
-- ================================================================

CREATE POLICY "Users can view customers from their stores"
ON public.customers FOR SELECT
USING (public.user_has_store_access(store_id));

CREATE POLICY "Users can insert customers to their stores"
ON public.customers FOR INSERT
WITH CHECK (public.user_has_store_access(store_id));

CREATE POLICY "Users can update customers in their stores"
ON public.customers FOR UPDATE
USING (public.user_has_store_access(store_id));

CREATE POLICY "Users can delete customers from their stores"
ON public.customers FOR DELETE
USING (public.user_has_store_access(store_id));

-- ================================================================
-- RLS POLICIES: ORDERS
-- ================================================================

CREATE POLICY "Users can view orders from their stores"
ON public.orders FOR SELECT
USING (public.user_has_store_access(store_id));

CREATE POLICY "Users can insert orders to their stores"
ON public.orders FOR INSERT
WITH CHECK (public.user_has_store_access(store_id));

CREATE POLICY "Users can update orders in their stores"
ON public.orders FOR UPDATE
USING (public.user_has_store_access(store_id));

CREATE POLICY "Users can delete orders from their stores"
ON public.orders FOR DELETE
USING (public.user_has_store_access(store_id));

-- ================================================================
-- RLS POLICIES: ORDER_STATUS_HISTORY
-- ================================================================

CREATE POLICY "Users can view order history from their stores"
ON public.order_status_history FOR SELECT
USING (public.user_has_store_access(store_id));

CREATE POLICY "Users can insert order history to their stores"
ON public.order_status_history FOR INSERT
WITH CHECK (public.user_has_store_access(store_id));

-- No UPDATE/DELETE for audit log

-- ================================================================
-- RLS POLICIES: FOLLOW_UP_LOG
-- ================================================================

CREATE POLICY "Users can view follow-ups from their stores"
ON public.follow_up_log FOR SELECT
USING (public.user_has_store_access(store_id));

CREATE POLICY "Users can insert follow-ups to their stores"
ON public.follow_up_log FOR INSERT
WITH CHECK (public.user_has_store_access(store_id));

CREATE POLICY "Users can update follow-ups in their stores"
ON public.follow_up_log FOR UPDATE
USING (public.user_has_store_access(store_id));

-- ================================================================
-- RLS POLICIES: SUPPLIERS
-- ================================================================

CREATE POLICY "Users can view suppliers from their stores"
ON public.suppliers FOR SELECT
USING (public.user_has_store_access(store_id));

CREATE POLICY "Users can insert suppliers to their stores"
ON public.suppliers FOR INSERT
WITH CHECK (public.user_has_store_access(store_id));

CREATE POLICY "Users can update suppliers in their stores"
ON public.suppliers FOR UPDATE
USING (public.user_has_store_access(store_id));

CREATE POLICY "Users can delete suppliers from their stores"
ON public.suppliers FOR DELETE
USING (public.user_has_store_access(store_id));

-- ================================================================
-- RLS POLICIES: CAMPAIGNS
-- ================================================================

CREATE POLICY "Users can view campaigns from their stores"
ON public.campaigns FOR SELECT
USING (public.user_has_store_access(store_id));

CREATE POLICY "Users can insert campaigns to their stores"
ON public.campaigns FOR INSERT
WITH CHECK (public.user_has_store_access(store_id));

CREATE POLICY "Users can update campaigns in their stores"
ON public.campaigns FOR UPDATE
USING (public.user_has_store_access(store_id));

CREATE POLICY "Users can delete campaigns from their stores"
ON public.campaigns FOR DELETE
USING (public.user_has_store_access(store_id));

-- ================================================================
-- RLS POLICIES: SHIPPING_INTEGRATIONS
-- ================================================================

CREATE POLICY "Users can view shipping integrations from their stores"
ON public.shipping_integrations FOR SELECT
USING (public.user_has_store_access(store_id));

CREATE POLICY "Admins can insert shipping integrations to their stores"
ON public.shipping_integrations FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_stores
        WHERE user_stores.user_id = auth.uid()
        AND user_stores.store_id = shipping_integrations.store_id
        AND user_stores.role IN ('owner', 'admin')
    )
);

CREATE POLICY "Admins can update shipping integrations in their stores"
ON public.shipping_integrations FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM public.user_stores
        WHERE user_stores.user_id = auth.uid()
        AND user_stores.store_id = shipping_integrations.store_id
        AND user_stores.role IN ('owner', 'admin')
    )
);

CREATE POLICY "Admins can delete shipping integrations from their stores"
ON public.shipping_integrations FOR DELETE
USING (
    EXISTS (
        SELECT 1 FROM public.user_stores
        WHERE user_stores.user_id = auth.uid()
        AND user_stores.store_id = shipping_integrations.store_id
        AND user_stores.role IN ('owner', 'admin')
    )
);

-- ================================================================
-- RLS POLICIES: SHOPIFY_INTEGRATIONS
-- ================================================================

CREATE POLICY "Users can view Shopify integrations from their stores"
ON public.shopify_integrations FOR SELECT
USING (public.user_has_store_access(store_id));

CREATE POLICY "Admins can insert Shopify integrations to their stores"
ON public.shopify_integrations FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_stores
        WHERE user_stores.user_id = auth.uid()
        AND user_stores.store_id = shopify_integrations.store_id
        AND user_stores.role IN ('owner', 'admin')
    )
);

CREATE POLICY "Admins can update Shopify integrations in their stores"
ON public.shopify_integrations FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM public.user_stores
        WHERE user_stores.user_id = auth.uid()
        AND user_stores.store_id = shopify_integrations.store_id
        AND user_stores.role IN ('owner', 'admin')
    )
);

CREATE POLICY "Admins can delete Shopify integrations from their stores"
ON public.shopify_integrations FOR DELETE
USING (
    EXISTS (
        SELECT 1 FROM public.user_stores
        WHERE user_stores.user_id = auth.uid()
        AND user_stores.store_id = shopify_integrations.store_id
        AND user_stores.role IN ('owner', 'admin')
    )
);

-- ================================================================
-- RLS POLICIES: SHOPIFY_IMPORT_JOBS
-- ================================================================

CREATE POLICY "Users can view import jobs from their stores"
ON public.shopify_import_jobs FOR SELECT
USING (public.user_has_store_access(store_id));

CREATE POLICY "Admins can insert import jobs to their stores"
ON public.shopify_import_jobs FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_stores
        WHERE user_stores.user_id = auth.uid()
        AND user_stores.store_id = shopify_import_jobs.store_id
        AND user_stores.role IN ('owner', 'admin')
    )
);

-- Import jobs are updated by service role only (no user UPDATE policy)

-- ================================================================
-- RLS POLICIES: SHOPIFY_WEBHOOK_EVENTS
-- ================================================================

CREATE POLICY "Users can view webhook events from their stores"
ON public.shopify_webhook_events FOR SELECT
USING (public.user_has_store_access(store_id));

-- Webhook events are inserted/updated by service role only

-- ================================================================
-- RLS POLICIES: SHOPIFY_SYNC_CONFLICTS
-- ================================================================

CREATE POLICY "Users can view sync conflicts from their stores"
ON public.shopify_sync_conflicts FOR SELECT
USING (public.user_has_store_access(store_id));

CREATE POLICY "Admins can update sync conflicts in their stores"
ON public.shopify_sync_conflicts FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM public.user_stores
        WHERE user_stores.user_id = auth.uid()
        AND user_stores.store_id = shopify_sync_conflicts.store_id
        AND user_stores.role IN ('owner', 'admin')
    )
);

-- ================================================================
-- RLS POLICIES: USERS
-- ================================================================
-- Users can only view and update their own profile
-- ================================================================

CREATE POLICY "Users can view their own profile"
ON public.users FOR SELECT
USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
ON public.users FOR UPDATE
USING (auth.uid() = id);

-- User creation handled by backend during registration (service role only)

-- ================================================================
-- RLS POLICIES: USER_STORES
-- ================================================================
-- Users can view their own store associations
-- ================================================================

CREATE POLICY "Users can view their own store associations"
ON public.user_stores FOR SELECT
USING (auth.uid() = user_id);

-- Store associations managed by admins via backend (service role only)

-- ================================================================
-- ENABLE REALTIME FOR CRITICAL TABLES
-- ================================================================
-- These tables will broadcast changes to subscribed clients
-- ================================================================

-- Core business data tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.customers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_status_history;

-- Import/sync tracking tables for live progress
ALTER PUBLICATION supabase_realtime ADD TABLE public.shopify_import_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.shopify_webhook_events;

-- Campaign tracking for live metrics
ALTER PUBLICATION supabase_realtime ADD TABLE public.campaigns;

COMMENT ON PUBLICATION supabase_realtime IS 'Realtime publication for live dashboard updates. Clients must filter by store_id in subscriptions.';

-- ================================================================
-- GRANT PERMISSIONS
-- ================================================================
-- Update permissions to work with RLS
-- ================================================================

-- Authenticated users: RLS will filter their access
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- Anon users: Read-only access to public data (currently none)
GRANT SELECT ON public.stores TO anon;

-- Execute permission for helper function
GRANT EXECUTE ON FUNCTION public.user_has_store_access TO authenticated;

-- ================================================================
-- MIGRATION COMPLETE
-- ================================================================
-- ✅ RLS enabled on all multi-tenant tables
-- ✅ Policies enforce store access via user_stores
-- ✅ Realtime enabled on critical tables
-- ✅ Security model: RLS is primary, backend validation is secondary
-- ================================================================
-- IMPORTANT:
-- - Service role key bypasses RLS (use for webhooks, system ops)
-- - Anon key respects RLS (use for all user operations)
-- - Always filter Realtime subscriptions by store_id in client code
-- - Test policies thoroughly before production deployment
-- ================================================================
