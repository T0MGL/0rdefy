-- ================================================================
-- SETTLEMENT & DISPATCH CODE RACE CONDITION FIX
-- ================================================================
-- Migration: 066_settlement_code_race_fix.sql
-- Author: Bright Idea
-- Date: 2026-01-15
--
-- Fixes identified issues:
-- 1. Race condition in settlement code generation (atomic with advisory lock)
-- 2. Race condition in dispatch session code generation (atomic with advisory lock)
-- 3. Missing UNIQUE constraints on settlement_code and session_code
--
-- NOTE: This migration checks if tables exist before operating on them.
-- The constraints and functions will only be created if the tables exist.
-- ================================================================


-- ================================================================
-- STEP 1: Add UNIQUE constraints to prevent duplicates
-- ================================================================
-- These constraints act as a last line of defense if the advisory
-- lock somehow fails (shouldn't happen, but defense in depth)

-- Check for existing duplicates and add constraint (daily_settlements)
DO $$
DECLARE
  v_duplicate_count INTEGER;
  v_table_exists BOOLEAN;
BEGIN
  -- Check if table exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'daily_settlements'
  ) INTO v_table_exists;

  IF NOT v_table_exists THEN
    RAISE NOTICE 'Table daily_settlements does not exist yet, skipping constraint creation';
    RETURN;
  END IF;

  -- Check for duplicates
  SELECT COUNT(*) INTO v_duplicate_count
  FROM (
    SELECT store_id, settlement_code, COUNT(*)
    FROM daily_settlements
    WHERE settlement_code IS NOT NULL
    GROUP BY store_id, settlement_code
    HAVING COUNT(*) > 1
  ) duplicates;

  IF v_duplicate_count > 0 THEN
    RAISE WARNING 'Found % duplicate settlement_code(s). Fixing by appending suffixes...', v_duplicate_count;

    -- Fix duplicates by appending a suffix
    WITH duplicates AS (
      SELECT id, settlement_code,
             ROW_NUMBER() OVER (PARTITION BY store_id, settlement_code ORDER BY created_at) as rn
      FROM daily_settlements
      WHERE settlement_code IS NOT NULL
    )
    UPDATE daily_settlements s
    SET settlement_code = d.settlement_code || '-DUP' || d.rn
    FROM duplicates d
    WHERE s.id = d.id AND d.rn > 1;
  END IF;

  -- Add constraint if not exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_daily_settlements_store_code'
  ) THEN
    ALTER TABLE daily_settlements
    ADD CONSTRAINT uq_daily_settlements_store_code
    UNIQUE (store_id, settlement_code);

    RAISE NOTICE 'Added UNIQUE constraint uq_daily_settlements_store_code';
  END IF;
END $$;

-- Check for existing duplicates and add constraint (dispatch_sessions)
DO $$
DECLARE
  v_duplicate_count INTEGER;
  v_table_exists BOOLEAN;
BEGIN
  -- Check if table exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'dispatch_sessions'
  ) INTO v_table_exists;

  IF NOT v_table_exists THEN
    RAISE NOTICE 'Table dispatch_sessions does not exist yet, skipping constraint creation';
    RETURN;
  END IF;

  -- Check for duplicates
  SELECT COUNT(*) INTO v_duplicate_count
  FROM (
    SELECT store_id, session_code, COUNT(*)
    FROM dispatch_sessions
    WHERE session_code IS NOT NULL
    GROUP BY store_id, session_code
    HAVING COUNT(*) > 1
  ) duplicates;

  IF v_duplicate_count > 0 THEN
    RAISE WARNING 'Found % duplicate session_code(s). Fixing by appending suffixes...', v_duplicate_count;

    -- Fix duplicates by appending a suffix
    WITH duplicates AS (
      SELECT id, session_code,
             ROW_NUMBER() OVER (PARTITION BY store_id, session_code ORDER BY created_at) as rn
      FROM dispatch_sessions
      WHERE session_code IS NOT NULL
    )
    UPDATE dispatch_sessions s
    SET session_code = d.session_code || '-DUP' || d.rn
    FROM duplicates d
    WHERE s.id = d.id AND d.rn > 1;
  END IF;

  -- Add constraint if not exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_dispatch_sessions_store_code'
  ) THEN
    ALTER TABLE dispatch_sessions
    ADD CONSTRAINT uq_dispatch_sessions_store_code
    UNIQUE (store_id, session_code);

    RAISE NOTICE 'Added UNIQUE constraint uq_dispatch_sessions_store_code';
  END IF;
END $$;


-- ================================================================
-- STEP 2: Atomic settlement code generation with advisory lock
-- ================================================================
-- Pattern from migration 062 (merchandise system)
-- Uses pg_advisory_xact_lock to ensure only one process can generate
-- codes for a given store+date at a time

CREATE OR REPLACE FUNCTION generate_settlement_code_atomic(p_store_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_lock_key BIGINT;
  v_today DATE := CURRENT_DATE;
  v_date_str TEXT;
  v_sequence INTEGER;
  v_code TEXT;
  v_table_exists BOOLEAN;
BEGIN
  -- Check if table exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'daily_settlements'
  ) INTO v_table_exists;

  IF NOT v_table_exists THEN
    RAISE EXCEPTION 'Table daily_settlements does not exist. Run migration 045 first.';
  END IF;

  -- Generate lock key from store_id + date + 'settlement' prefix
  -- The prefix ensures dispatch and settlement locks don't collide
  v_lock_key := ('x' || substr(md5(p_store_id::text || v_today::text || 'settlement'), 1, 15))::bit(60)::bigint;

  -- Acquire advisory lock (transaction-scoped, released on commit/rollback)
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Format date as DDMMYYYY (Latin American standard)
  v_date_str := TO_CHAR(v_today, 'DDMMYYYY');

  -- Get next sequence number by finding max existing sequence for today
  -- This handles gaps from deletions correctly
  SELECT COALESCE(
    MAX(
      CASE
        WHEN settlement_code ~ '^LIQ-[0-9]{8}-[0-9]{3}$'
        THEN SUBSTRING(settlement_code FROM 14 FOR 3)::INTEGER
        ELSE 0
      END
    ), 0
  ) + 1 INTO v_sequence
  FROM daily_settlements
  WHERE store_id = p_store_id
    AND settlement_date = v_today;

  -- Cap at 999 per day (3 digits)
  IF v_sequence > 999 THEN
    RAISE EXCEPTION 'Maximum daily settlements (999) exceeded for store % on %', p_store_id, v_date_str;
  END IF;

  -- Format: LIQ-DDMMYYYY-001
  v_code := 'LIQ-' || v_date_str || '-' || LPAD(v_sequence::TEXT, 3, '0');

  RETURN v_code;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_settlement_code_atomic(UUID) IS
'Generates unique settlement code with advisory lock to prevent race conditions.
Format: LIQ-DDMMYYYY-NNN (e.g., LIQ-15012026-001)
Uses pg_advisory_xact_lock for transaction-scoped mutual exclusion.';


-- ================================================================
-- STEP 3: Atomic dispatch session code generation with advisory lock
-- ================================================================

CREATE OR REPLACE FUNCTION generate_dispatch_code_atomic(p_store_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_lock_key BIGINT;
  v_today DATE := CURRENT_DATE;
  v_date_str TEXT;
  v_sequence INTEGER;
  v_code TEXT;
  v_table_exists BOOLEAN;
BEGIN
  -- Check if table exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'dispatch_sessions'
  ) INTO v_table_exists;

  IF NOT v_table_exists THEN
    RAISE EXCEPTION 'Table dispatch_sessions does not exist. Run migration 045 first.';
  END IF;

  -- Generate lock key from store_id + date + 'dispatch' prefix
  -- The prefix ensures dispatch and settlement locks don't collide
  v_lock_key := ('x' || substr(md5(p_store_id::text || v_today::text || 'dispatch'), 1, 15))::bit(60)::bigint;

  -- Acquire advisory lock (transaction-scoped, released on commit/rollback)
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Format date as DDMMYYYY (Latin American standard)
  v_date_str := TO_CHAR(v_today, 'DDMMYYYY');

  -- Get next sequence number by finding max existing sequence for today
  -- This handles gaps from deletions correctly
  SELECT COALESCE(
    MAX(
      CASE
        WHEN session_code ~ '^DISP-[0-9]{8}-[0-9]{3}$'
        THEN SUBSTRING(session_code FROM 15 FOR 3)::INTEGER
        ELSE 0
      END
    ), 0
  ) + 1 INTO v_sequence
  FROM dispatch_sessions
  WHERE store_id = p_store_id
    AND dispatch_date = v_today;

  -- Cap at 999 per day (3 digits)
  IF v_sequence > 999 THEN
    RAISE EXCEPTION 'Maximum daily dispatch sessions (999) exceeded for store % on %', p_store_id, v_date_str;
  END IF;

  -- Format: DISP-DDMMYYYY-001
  v_code := 'DISP-' || v_date_str || '-' || LPAD(v_sequence::TEXT, 3, '0');

  RETURN v_code;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_dispatch_code_atomic(UUID) IS
'Generates unique dispatch session code with advisory lock to prevent race conditions.
Format: DISP-DDMMYYYY-NNN (e.g., DISP-15012026-001)
Uses pg_advisory_xact_lock for transaction-scoped mutual exclusion.';


-- ================================================================
-- STEP 4: Add indexes to optimize code lookups (only if tables exist)
-- ================================================================

DO $$
BEGIN
  -- Index for settlement code lookups
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'daily_settlements'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_daily_settlements_store_date_code
    ON daily_settlements(store_id, settlement_date, settlement_code);
    RAISE NOTICE 'Created index idx_daily_settlements_store_date_code';
  END IF;

  -- Index for dispatch session code lookups
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'dispatch_sessions'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_dispatch_sessions_store_date_code
    ON dispatch_sessions(store_id, dispatch_date, session_code);
    RAISE NOTICE 'Created index idx_dispatch_sessions_store_date_code';
  END IF;
END $$;


-- ================================================================
-- STEP 5: Helper function to validate code format
-- ================================================================

CREATE OR REPLACE FUNCTION is_valid_settlement_code(p_code TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN p_code ~ '^LIQ-[0-9]{8}-[0-9]{3}$';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION is_valid_dispatch_code(p_code TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN p_code ~ '^DISP-[0-9]{8}-[0-9]{3}$';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION is_valid_settlement_code(TEXT) IS
'Validates settlement code format: LIQ-DDMMYYYY-NNN';

COMMENT ON FUNCTION is_valid_dispatch_code(TEXT) IS
'Validates dispatch session code format: DISP-DDMMYYYY-NNN';


-- ================================================================
-- STEP 6: Grant permissions for Supabase API access
-- ================================================================
-- These grants allow the functions to be called via Supabase RPC

GRANT EXECUTE ON FUNCTION generate_settlement_code_atomic(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_settlement_code_atomic(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION generate_settlement_code_atomic(UUID) TO anon;

GRANT EXECUTE ON FUNCTION generate_dispatch_code_atomic(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION generate_dispatch_code_atomic(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION generate_dispatch_code_atomic(UUID) TO anon;

GRANT EXECUTE ON FUNCTION is_valid_settlement_code(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION is_valid_settlement_code(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION is_valid_settlement_code(TEXT) TO anon;

GRANT EXECUTE ON FUNCTION is_valid_dispatch_code(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION is_valid_dispatch_code(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION is_valid_dispatch_code(TEXT) TO anon;

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';


-- ================================================================
-- Migration complete
-- ================================================================
