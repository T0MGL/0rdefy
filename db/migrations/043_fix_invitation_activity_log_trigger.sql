-- ============================================================================
-- Migration 043: Fix invitation activity log trigger
-- Description: Allows NULL user_id in activity_log for system operations
-- Root cause: auth.uid() returns NULL when using SERVICE_ROLE_KEY
-- Author: Bright Idea
-- Date: 2026-01-07
-- ============================================================================

-- Step 1: Make user_id nullable in activity_log (if it exists and is NOT NULL)
DO $$
BEGIN
    -- Check if activity_log table exists
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'activity_log'
    ) THEN
        -- Make user_id nullable
        ALTER TABLE activity_log ALTER COLUMN user_id DROP NOT NULL;
        RAISE NOTICE 'activity_log.user_id is now nullable';
    ELSE
        RAISE NOTICE 'activity_log table does not exist - skipping';
    END IF;
END $$;

-- Step 2: Recreate log_invitation_activity function with NULL-safe user_id
CREATE OR REPLACE FUNCTION log_invitation_activity()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO activity_log (user_id, store_id, action_type, description, metadata)
        VALUES (
            NEW.inviting_user_id,
            NEW.store_id,
            'invitation_created',
            'Invitación enviada a ' || NEW.invited_email || ' como ' || NEW.assigned_role,
            jsonb_build_object(
                'invitation_id', NEW.id,
                'invited_email', NEW.invited_email,
                'assigned_role', NEW.assigned_role
            )
        );
    ELSIF TG_OP = 'UPDATE' AND OLD.used = FALSE AND NEW.used = TRUE THEN
        INSERT INTO activity_log (user_id, store_id, action_type, description, metadata)
        VALUES (
            NEW.used_by_user_id,
            NEW.store_id,
            'invitation_accepted',
            'Invitación aceptada por ' || NEW.invited_email,
            jsonb_build_object(
                'invitation_id', NEW.id,
                'invited_email', NEW.invited_email,
                'assigned_role', NEW.assigned_role
            )
        );
    ELSIF TG_OP = 'DELETE' THEN
        -- FIXED: Use COALESCE to handle NULL user_id from system operations
        INSERT INTO activity_log (user_id, store_id, action_type, description, metadata)
        VALUES (
            COALESCE(auth.uid(), OLD.inviting_user_id), -- Fallback to inviter if no auth context
            OLD.store_id,
            'invitation_cancelled',
            'Invitación cancelada para ' || OLD.invited_email,
            jsonb_build_object(
                'invitation_id', OLD.id,
                'invited_email', OLD.invited_email,
                'assigned_role', OLD.assigned_role
            )
        );
    END IF;

    RETURN NULL; -- AFTER trigger
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION log_invitation_activity IS
'Registra actividad de invitaciones en activity_log. Soporta operaciones de sistema (user_id nullable).';
