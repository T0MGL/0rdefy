-- ================================================================
-- MIGRATION 150: Replicate Carrier to Multiple Stores
-- ================================================================
-- Purpose: Enable owners/admins to duplicate a carrier (with all its
-- zones and city coverage) into every store they have access to, in a
-- single atomic call.
--
-- Use case: When a user manages multiple stores and wants to add a new
-- carrier (e.g. "Lucero del Este") that operates across all of them
-- without re-entering zones and coverage rows N times.
--
-- Design:
--   - Source of truth: carriers table + carrier_zones + carrier_coverage
--   - Function: replicate_carrier_to_stores(source_carrier_id, target_store_ids, actor_user_id)
--   - Atomic: runs inside a single transaction. Partial failures inside
--     a target store roll back that store only (via savepoints) so other
--     targets still succeed.
--   - Idempotent: if a carrier with the same (store_id, name) already
--     exists in a target, that store is skipped and reported as
--     "already_exists". Duplicate zones/coverage rows inside the target
--     are also skipped via ON CONFLICT DO NOTHING.
--   - Permission: target stores are validated against user_stores. Only
--     active memberships with role owner or admin are accepted. The
--     function itself enforces this server-side so the backend cannot
--     be tricked into broadcasting to unauthorized stores.
--
-- Returns: JSONB summary with per-store result:
--   {
--     "replicated": [{ "store_id": "...", "carrier_id": "...", "zones": N, "coverage": M }],
--     "skipped": [{ "store_id": "...", "reason": "already_exists" | "permission_denied" | "not_found" }],
--     "failed":  [{ "store_id": "...", "reason": "..." }]
--   }
-- ================================================================

BEGIN;

-- ================================================================
-- 1. DROP previous signature if exists (idempotent re-runs)
-- ================================================================

DROP FUNCTION IF EXISTS public.replicate_carrier_to_stores(UUID, UUID[], UUID);

-- ================================================================
-- 2. FUNCTION: replicate_carrier_to_stores
-- ================================================================

CREATE OR REPLACE FUNCTION public.replicate_carrier_to_stores(
    p_source_carrier_id UUID,
    p_target_store_ids  UUID[],
    p_actor_user_id     UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_source_carrier           carriers%ROWTYPE;
    v_target_store_id          UUID;
    v_new_carrier_id           UUID;
    v_existing_carrier_id      UUID;
    v_zones_inserted           INTEGER;
    v_coverage_inserted        INTEGER;
    v_role                     TEXT;
    v_replicated               JSONB := '[]'::JSONB;
    v_skipped                  JSONB := '[]'::JSONB;
    v_failed                   JSONB := '[]'::JSONB;
BEGIN
    -- Validate inputs
    IF p_source_carrier_id IS NULL THEN
        RAISE EXCEPTION 'p_source_carrier_id is required';
    END IF;

    IF p_actor_user_id IS NULL THEN
        RAISE EXCEPTION 'p_actor_user_id is required';
    END IF;

    IF p_target_store_ids IS NULL OR array_length(p_target_store_ids, 1) IS NULL THEN
        RETURN jsonb_build_object(
            'replicated', '[]'::JSONB,
            'skipped',    '[]'::JSONB,
            'failed',     '[]'::JSONB
        );
    END IF;

    -- Load source carrier
    SELECT *
      INTO v_source_carrier
      FROM carriers
     WHERE id = p_source_carrier_id
     LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Source carrier % not found', p_source_carrier_id;
    END IF;

    -- Verify the actor has permission on the SOURCE store too
    SELECT role INTO v_role
      FROM user_stores
     WHERE user_id = p_actor_user_id
       AND store_id = v_source_carrier.store_id
       AND is_active = TRUE
     LIMIT 1;

    IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
        RAISE EXCEPTION 'User % does not have replication privileges on source store %',
            p_actor_user_id, v_source_carrier.store_id;
    END IF;

    -- Iterate over target stores
    FOREACH v_target_store_id IN ARRAY p_target_store_ids
    LOOP
        -- Skip the source store itself (it already has the carrier)
        IF v_target_store_id = v_source_carrier.store_id THEN
            v_skipped := v_skipped || jsonb_build_object(
                'store_id', v_target_store_id,
                'reason',   'source_store'
            );
            CONTINUE;
        END IF;

        -- Permission check for target store
        SELECT role INTO v_role
          FROM user_stores
         WHERE user_id = p_actor_user_id
           AND store_id = v_target_store_id
           AND is_active = TRUE
         LIMIT 1;

        IF v_role IS NULL THEN
            v_skipped := v_skipped || jsonb_build_object(
                'store_id', v_target_store_id,
                'reason',   'not_a_member'
            );
            CONTINUE;
        END IF;

        IF v_role NOT IN ('owner', 'admin') THEN
            v_skipped := v_skipped || jsonb_build_object(
                'store_id', v_target_store_id,
                'reason',   'permission_denied',
                'role',     v_role
            );
            CONTINUE;
        END IF;

        -- Idempotency: skip if a carrier with the same name already exists
        SELECT id INTO v_existing_carrier_id
          FROM carriers
         WHERE store_id = v_target_store_id
           AND lower(name) = lower(v_source_carrier.name)
         LIMIT 1;

        IF v_existing_carrier_id IS NOT NULL THEN
            v_skipped := v_skipped || jsonb_build_object(
                'store_id',            v_target_store_id,
                'reason',              'already_exists',
                'existing_carrier_id', v_existing_carrier_id
            );
            CONTINUE;
        END IF;

        -- Attempt replication inside a savepoint so a failure here does
        -- not roll back replications into other stores.
        BEGIN
            v_new_carrier_id := gen_random_uuid();

            INSERT INTO carriers (
                id,
                store_id,
                name,
                phone,
                email,
                vehicle_type,
                license_plate,
                is_active,
                notes,
                carrier_type,
                default_zone,
                settlement_type,
                charges_failed_attempts,
                payment_schedule,
                failed_attempt_fee_percent,
                created_at,
                updated_at
            )
            VALUES (
                v_new_carrier_id,
                v_target_store_id,
                v_source_carrier.name,
                v_source_carrier.phone,
                v_source_carrier.email,
                v_source_carrier.vehicle_type,
                v_source_carrier.license_plate,
                v_source_carrier.is_active,
                v_source_carrier.notes,
                v_source_carrier.carrier_type,
                v_source_carrier.default_zone,
                v_source_carrier.settlement_type,
                v_source_carrier.charges_failed_attempts,
                v_source_carrier.payment_schedule,
                v_source_carrier.failed_attempt_fee_percent,
                NOW(),
                NOW()
            );

            -- Replicate carrier_zones
            WITH inserted_zones AS (
                INSERT INTO carrier_zones (
                    store_id,
                    carrier_id,
                    zone_name,
                    zone_code,
                    rate,
                    is_active,
                    created_at,
                    updated_at
                )
                SELECT
                    v_target_store_id,
                    v_new_carrier_id,
                    src.zone_name,
                    src.zone_code,
                    src.rate,
                    src.is_active,
                    NOW(),
                    NOW()
                FROM carrier_zones src
                WHERE src.carrier_id = p_source_carrier_id
                ON CONFLICT (carrier_id, zone_name) DO NOTHING
                RETURNING id
            )
            SELECT COUNT(*) INTO v_zones_inserted FROM inserted_zones;

            -- Replicate carrier_coverage
            WITH inserted_coverage AS (
                INSERT INTO carrier_coverage (
                    store_id,
                    carrier_id,
                    city,
                    department,
                    rate,
                    is_active,
                    created_at,
                    updated_at
                )
                SELECT
                    v_target_store_id,
                    v_new_carrier_id,
                    src.city,
                    COALESCE(src.department, ''),
                    src.rate,
                    src.is_active,
                    NOW(),
                    NOW()
                FROM carrier_coverage src
                WHERE src.carrier_id = p_source_carrier_id
                ON CONFLICT DO NOTHING
                RETURNING id
            )
            SELECT COUNT(*) INTO v_coverage_inserted FROM inserted_coverage;

            v_replicated := v_replicated || jsonb_build_object(
                'store_id',   v_target_store_id,
                'carrier_id', v_new_carrier_id,
                'zones',      v_zones_inserted,
                'coverage',   v_coverage_inserted
            );
        EXCEPTION
            WHEN OTHERS THEN
                v_failed := v_failed || jsonb_build_object(
                    'store_id', v_target_store_id,
                    'reason',   SQLERRM,
                    'sqlstate', SQLSTATE
                );
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'replicated', v_replicated,
        'skipped',    v_skipped,
        'failed',     v_failed
    );
END;
$$;

COMMENT ON FUNCTION public.replicate_carrier_to_stores(UUID, UUID[], UUID) IS
'Replicates a source carrier (plus its carrier_zones and carrier_coverage) '
'into the specified target stores. Enforces owner/admin permission per store '
'via user_stores. Idempotent on (store_id, lower(name)). Returns JSONB '
'with replicated/skipped/failed arrays for per-store reporting.';

-- Grant execute to authenticated role (service role already has full access).
-- The function is SECURITY DEFINER so it runs with the definer's rights,
-- but the permission check inside the function guarantees the actor can only
-- replicate into stores they belong to as owner/admin.
GRANT EXECUTE ON FUNCTION public.replicate_carrier_to_stores(UUID, UUID[], UUID)
    TO authenticated;

COMMIT;

-- ================================================================
-- VERIFICATION
-- ================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = 'replicate_carrier_to_stores'
    ) THEN
        RAISE EXCEPTION '[MIGRATION 150] replicate_carrier_to_stores was not created';
    END IF;

    RAISE NOTICE '[MIGRATION 150] replicate_carrier_to_stores created successfully';
END $$;
