-- Migration 145: Shopify Billing API Integration
-- Description: Add columns to subscriptions to track Shopify App Subscriptions
--              alongside existing Stripe subscriptions. Required for Shopify
--              App Store approval (Req 1.2.2 and 1.2.3).
-- Author: Bright Idea
-- Date: 2026-03-31

-- Phase 1: subscriptions table

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS billing_source TEXT NOT NULL DEFAULT 'stripe'
    CHECK (billing_source IN ('stripe', 'shopify')),

  -- Shopify App Subscription GID (gid://shopify/AppSubscription/123456789)
  ADD COLUMN IF NOT EXISTS shopify_charge_id TEXT,

  -- Shopify confirmation URL — merchant must visit this to approve the charge
  ADD COLUMN IF NOT EXISTS shopify_confirmation_url TEXT,

  -- Shop domain this subscription belongs to (for Shopify billing context)
  ADD COLUMN IF NOT EXISTS shopify_shop_domain TEXT;

-- Index for fast lookups by shop domain (Shopify webhook handler needs this)
CREATE INDEX IF NOT EXISTS idx_subscriptions_shopify_shop_domain
  ON subscriptions(shopify_shop_domain)
  WHERE shopify_shop_domain IS NOT NULL;

-- Index for looking up by shopify_charge_id
CREATE INDEX IF NOT EXISTS idx_subscriptions_shopify_charge_id
  ON subscriptions(shopify_charge_id)
  WHERE shopify_charge_id IS NOT NULL;

-- Phase 2: shopify_billing_events table (idempotency for webhooks)

CREATE TABLE IF NOT EXISTS shopify_billing_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_event_id    TEXT NOT NULL UNIQUE, -- Shopify-Webhook-Id header
  event_type          TEXT NOT NULL,        -- app/subscriptions/update
  shop_domain         TEXT NOT NULL,
  charge_id           TEXT,
  payload             JSONB NOT NULL,
  processed           BOOLEAN NOT NULL DEFAULT false,
  processed_at        TIMESTAMPTZ,
  error               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shopify_billing_events_shop
  ON shopify_billing_events(shop_domain);
CREATE INDEX IF NOT EXISTS idx_shopify_billing_events_charge
  ON shopify_billing_events(charge_id)
  WHERE charge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shopify_billing_events_processed
  ON shopify_billing_events(processed, created_at);

-- RLS: service_role only (webhook handler uses supabaseAdmin)
ALTER TABLE shopify_billing_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only" ON shopify_billing_events
  USING (auth.role() = 'service_role');

COMMENT ON TABLE shopify_billing_events IS
  'Idempotency log for Shopify app/subscriptions/update webhooks.';
COMMENT ON COLUMN subscriptions.billing_source IS
  'stripe = Ordefy direct billing. shopify = charged through Shopify Billing API.';
COMMENT ON COLUMN subscriptions.shopify_charge_id IS
  'Shopify AppSubscription GID. Non-null when billing_source = shopify.';
COMMENT ON COLUMN subscriptions.shopify_confirmation_url IS
  'Pending confirmation URL returned by appSubscriptionCreate. Cleared after merchant confirms.';
