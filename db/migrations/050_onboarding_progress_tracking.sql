-- Migration: Onboarding Progress Tracking
-- Description: Adds table to track user onboarding progress and store setup completion
-- Author: Bright Idea
-- Date: 2026-01-11

-- Note: This migration uses a lightweight approach - most onboarding progress is
-- computed dynamically from existing data (products, orders, carriers, etc.)
-- This table only stores explicit user actions like dismissing the checklist

-- Create onboarding_progress table for user preferences
CREATE TABLE IF NOT EXISTS onboarding_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- User preferences
    checklist_dismissed BOOLEAN DEFAULT FALSE,
    dismissed_at TIMESTAMP,

    -- First-time module visits (JSON array of module IDs)
    visited_modules JSONB DEFAULT '[]'::jsonb,

    -- Tour completion
    tour_completed BOOLEAN DEFAULT FALSE,
    tour_completed_at TIMESTAMP,
    tour_path VARCHAR(50), -- 'manual', 'shopify', 'collaborator'

    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Ensure one record per user per store
    UNIQUE(store_id, user_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_onboarding_progress_store_user
ON onboarding_progress(store_id, user_id);

-- Add trigger to update updated_at
CREATE OR REPLACE FUNCTION update_onboarding_progress_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_onboarding_progress_timestamp ON onboarding_progress;
CREATE TRIGGER trigger_update_onboarding_progress_timestamp
    BEFORE UPDATE ON onboarding_progress
    FOR EACH ROW
    EXECUTE FUNCTION update_onboarding_progress_timestamp();

-- Function to get onboarding progress for a store
-- This computes progress dynamically based on actual data
CREATE OR REPLACE FUNCTION get_onboarding_progress(p_store_id UUID, p_user_id UUID)
RETURNS JSON AS $$
DECLARE
    v_has_carrier BOOLEAN;
    v_has_product BOOLEAN;
    v_has_order BOOLEAN;
    v_has_shopify BOOLEAN;
    v_has_customer BOOLEAN;
    v_checklist_dismissed BOOLEAN := FALSE;
    v_steps JSON;
    v_completed_count INT := 0;
    v_total_count INT := 4;
BEGIN
    -- Check if user has dismissed the checklist
    SELECT checklist_dismissed INTO v_checklist_dismissed
    FROM onboarding_progress
    WHERE store_id = p_store_id AND user_id = p_user_id;

    -- Check for carrier
    SELECT EXISTS(
        SELECT 1 FROM carriers
        WHERE store_id = p_store_id AND is_active = TRUE
        LIMIT 1
    ) INTO v_has_carrier;

    -- Check for product
    SELECT EXISTS(
        SELECT 1 FROM products
        WHERE store_id = p_store_id AND is_active = TRUE
        LIMIT 1
    ) INTO v_has_product;

    -- Check for customer
    SELECT EXISTS(
        SELECT 1 FROM customers
        WHERE store_id = p_store_id
        LIMIT 1
    ) INTO v_has_customer;

    -- Check for order
    SELECT EXISTS(
        SELECT 1 FROM orders
        WHERE store_id = p_store_id AND is_deleted = FALSE
        LIMIT 1
    ) INTO v_has_order;

    -- Check for Shopify integration
    SELECT EXISTS(
        SELECT 1 FROM shopify_integrations
        WHERE store_id = p_store_id AND is_active = TRUE
        LIMIT 1
    ) INTO v_has_shopify;

    -- Count completed steps
    IF v_has_carrier THEN v_completed_count := v_completed_count + 1; END IF;
    IF v_has_product THEN v_completed_count := v_completed_count + 1; END IF;
    IF v_has_customer THEN v_completed_count := v_completed_count + 1; END IF;
    IF v_has_order THEN v_completed_count := v_completed_count + 1; END IF;

    -- Build steps array
    v_steps := json_build_array(
        json_build_object(
            'id', 'create-carrier',
            'title', 'Agregar transportadora',
            'description', 'Configura al menos una transportadora para enviar pedidos',
            'completed', v_has_carrier,
            'route', '/carriers',
            'priority', 1,
            'category', 'setup'
        ),
        json_build_object(
            'id', 'add-product',
            'title', 'Agregar primer producto',
            'description', 'Crea un producto o importa desde Shopify',
            'completed', v_has_product,
            'route', '/products',
            'priority', 2,
            'category', 'setup'
        ),
        json_build_object(
            'id', 'add-customer',
            'title', 'Agregar cliente',
            'description', 'Registra tu primer cliente para crear pedidos',
            'completed', v_has_customer,
            'route', '/customers',
            'priority', 3,
            'category', 'setup'
        ),
        json_build_object(
            'id', 'first-order',
            'title', 'Crear primer pedido',
            'description', 'Crea tu primer pedido para ver el flujo completo',
            'completed', v_has_order,
            'route', '/orders',
            'priority', 4,
            'category', 'operation'
        )
    );

    -- Return complete progress object
    RETURN json_build_object(
        'steps', v_steps,
        'completedCount', v_completed_count,
        'totalCount', v_total_count,
        'percentage', ROUND((v_completed_count::DECIMAL / v_total_count) * 100),
        'isComplete', v_completed_count = v_total_count,
        'hasShopify', v_has_shopify,
        'hasDismissed', COALESCE(v_checklist_dismissed, FALSE)
    );
END;
$$ LANGUAGE plpgsql;

-- Function to dismiss onboarding checklist
CREATE OR REPLACE FUNCTION dismiss_onboarding_checklist(p_store_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    INSERT INTO onboarding_progress (store_id, user_id, checklist_dismissed, dismissed_at)
    VALUES (p_store_id, p_user_id, TRUE, NOW())
    ON CONFLICT (store_id, user_id)
    DO UPDATE SET
        checklist_dismissed = TRUE,
        dismissed_at = NOW();

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to mark module as visited
CREATE OR REPLACE FUNCTION mark_module_visited(p_store_id UUID, p_user_id UUID, p_module_id TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    INSERT INTO onboarding_progress (store_id, user_id, visited_modules)
    VALUES (p_store_id, p_user_id, jsonb_build_array(p_module_id))
    ON CONFLICT (store_id, user_id)
    DO UPDATE SET
        visited_modules = CASE
            WHEN NOT (onboarding_progress.visited_modules ? p_module_id)
            THEN onboarding_progress.visited_modules || jsonb_build_array(p_module_id)
            ELSE onboarding_progress.visited_modules
        END;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Function to check if module is first visit
CREATE OR REPLACE FUNCTION is_first_module_visit(p_store_id UUID, p_user_id UUID, p_module_id TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_visited BOOLEAN;
BEGIN
    SELECT NOT (visited_modules ? p_module_id)
    INTO v_visited
    FROM onboarding_progress
    WHERE store_id = p_store_id AND user_id = p_user_id;

    -- If no record exists, it's a first visit
    RETURN COALESCE(v_visited, TRUE);
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own onboarding progress"
ON onboarding_progress FOR SELECT
USING (
    user_id = auth.uid() OR
    store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid())
);

CREATE POLICY "Users can insert their own onboarding progress"
ON onboarding_progress FOR INSERT
WITH CHECK (
    user_id = auth.uid() OR
    store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid())
);

CREATE POLICY "Users can update their own onboarding progress"
ON onboarding_progress FOR UPDATE
USING (
    user_id = auth.uid() OR
    store_id IN (SELECT store_id FROM user_stores WHERE user_id = auth.uid())
);

-- Add comment
COMMENT ON TABLE onboarding_progress IS 'Tracks user onboarding progress and preferences for the setup checklist';
COMMENT ON FUNCTION get_onboarding_progress IS 'Computes onboarding progress dynamically based on store data';
