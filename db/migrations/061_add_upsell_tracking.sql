-- =============================================
-- Migration 060: Add Upsell Tracking to Order Line Items
-- Description: Adds is_upsell column to track products added during confirmation
-- Author: Claude
-- Date: 2026-01-13
-- =============================================

BEGIN;

-- Add is_upsell column to track upsell products
ALTER TABLE order_line_items
ADD COLUMN IF NOT EXISTS is_upsell BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN order_line_items.is_upsell IS
'Indicates if this line item was added as an upsell during order confirmation (does not replace existing items)';

-- Create index for filtering upsell items
CREATE INDEX IF NOT EXISTS idx_order_line_items_is_upsell
ON order_line_items(is_upsell) WHERE is_upsell = TRUE;

-- =============================================
-- VERIFICATION
-- =============================================

DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 060 Verification';
  RAISE NOTICE '========================================';

  -- Verify column exists
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'order_line_items' AND column_name = 'is_upsell') THEN
    RAISE NOTICE 'OK: is_upsell column exists';
  ELSE
    RAISE EXCEPTION 'FAILED: is_upsell column not created';
  END IF;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 060 Complete!';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Changes:';
  RAISE NOTICE '1. Added is_upsell column to order_line_items';
  RAISE NOTICE '2. Added index for upsell filtering';
  RAISE NOTICE '========================================';
END $$;

COMMIT;
