-- ================================================================
-- SHOPIFY OAUTH POPUP MODE
-- ================================================================
-- Add is_popup flag to shopify_oauth_states for embedded app OAuth
-- When OAuth runs in popup (Shopify embedded mode), callback redirects
-- to special page that closes popup and notifies parent via postMessage
-- ================================================================

-- Add is_popup column to shopify_oauth_states
ALTER TABLE shopify_oauth_states
ADD COLUMN IF NOT EXISTS is_popup BOOLEAN DEFAULT false NOT NULL;

-- Create index for faster popup state lookups
CREATE INDEX IF NOT EXISTS idx_shopify_oauth_states_popup
ON shopify_oauth_states(is_popup)
WHERE is_popup = true;

COMMENT ON COLUMN shopify_oauth_states.is_popup IS 'True if OAuth initiated from popup (Shopify embedded mode), false for normal redirect flow';
