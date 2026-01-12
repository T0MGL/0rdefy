-- ============================================================================
-- Migration 055: Update max_stores limits per plan
-- ============================================================================
--
-- Current limits (INCORRECT):
--   Free: 1 store
--   Starter: 1 store
--   Growth: 1 store
--   Professional: 3 stores
--
-- New limits (CORRECT):
--   Free: 1 store
--   Starter: 1 store
--   Growth: 3 stores (plan del medio)
--   Professional: 10 stores (plan más caro)
--
-- ============================================================================

BEGIN;

RAISE NOTICE '========================================';
RAISE NOTICE 'Migration 055: Update max_stores limits';
RAISE NOTICE '========================================';

-- Show current limits
RAISE NOTICE 'Current max_stores limits:';
DO $$
DECLARE
  plan_rec RECORD;
BEGIN
  FOR plan_rec IN
    SELECT plan, max_stores
    FROM plan_limits
    ORDER BY
      CASE plan
        WHEN 'free' THEN 1
        WHEN 'starter' THEN 2
        WHEN 'growth' THEN 3
        WHEN 'professional' THEN 4
      END
  LOOP
    RAISE NOTICE '  %: % stores', plan_rec.plan, plan_rec.max_stores;
  END LOOP;
END $$;

-- Update max_stores for Growth plan (3 stores)
UPDATE plan_limits
SET max_stores = 3
WHERE plan = 'growth';

-- Update max_stores for Professional plan (10 stores)
UPDATE plan_limits
SET max_stores = 10
WHERE plan = 'professional';

RAISE NOTICE '';
RAISE NOTICE 'Updated limits:';

-- Show new limits
DO $$
DECLARE
  plan_rec RECORD;
BEGIN
  FOR plan_rec IN
    SELECT plan, max_stores
    FROM plan_limits
    ORDER BY
      CASE plan
        WHEN 'free' THEN 1
        WHEN 'starter' THEN 2
        WHEN 'growth' THEN 3
        WHEN 'professional' THEN 4
      END
  LOOP
    RAISE NOTICE '  %: % stores', plan_rec.plan, plan_rec.max_stores;
  END LOOP;
END $$;

-- Verify changes
DO $$
DECLARE
  growth_stores INTEGER;
  prof_stores INTEGER;
BEGIN
  SELECT max_stores INTO growth_stores FROM plan_limits WHERE plan = 'growth';
  SELECT max_stores INTO prof_stores FROM plan_limits WHERE plan = 'professional';

  IF growth_stores = 3 AND prof_stores = 10 THEN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ Migration 055 Complete!';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Growth plan: 3 stores';
    RAISE NOTICE 'Professional plan: 10 stores';
    RAISE NOTICE '========================================';
  ELSE
    RAISE EXCEPTION 'Verification failed: Growth=%, Professional=%', growth_stores, prof_stores;
  END IF;
END $$;

COMMIT;
