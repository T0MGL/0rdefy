-- Migration 030: Collaborator Invitation System
-- Sistema completo de invitación de colaboradores con roles, permisos y límites por plan

-- ============================================================================
-- 1. NUEVA TABLA: collaborator_invitations
-- ============================================================================

CREATE TABLE IF NOT EXISTS collaborator_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token VARCHAR(255) UNIQUE NOT NULL,
    store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
    inviting_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Pre-filled data for invitee
    invited_name VARCHAR(255) NOT NULL,
    invited_email VARCHAR(255) NOT NULL,
    assigned_role VARCHAR(50) NOT NULL,

    -- Token lifecycle
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    used_at TIMESTAMP,
    used_by_user_id UUID REFERENCES users(id),

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),

    CONSTRAINT valid_role CHECK (assigned_role IN (
        'owner', 'admin', 'logistics', 'confirmador',
        'contador', 'inventario'
    ))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_invitations_token ON collaborator_invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_store ON collaborator_invitations(store_id);
CREATE INDEX IF NOT EXISTS idx_invitations_expires ON collaborator_invitations(expires_at);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON collaborator_invitations(invited_email);
CREATE INDEX IF NOT EXISTS idx_invitations_used ON collaborator_invitations(used);

COMMENT ON TABLE collaborator_invitations IS 'Invitaciones de colaboradores con tokens únicos y expiración';
COMMENT ON COLUMN collaborator_invitations.token IS 'Token único de 64 caracteres (32 bytes hex)';
COMMENT ON COLUMN collaborator_invitations.assigned_role IS 'Rol que se asignará al aceptar la invitación';
COMMENT ON COLUMN collaborator_invitations.expires_at IS 'Fecha de expiración (7 días por defecto)';

-- ============================================================================
-- 2. MEJORAR TABLA: stores (agregar plan de suscripción)
-- ============================================================================

ALTER TABLE stores
ADD COLUMN IF NOT EXISTS subscription_plan VARCHAR(50) DEFAULT 'free',
ADD COLUMN IF NOT EXISTS max_users INTEGER DEFAULT 1;

COMMENT ON COLUMN stores.subscription_plan IS 'Plan de suscripción: free ($29), starter ($99), growth ($169), enterprise (custom)';
COMMENT ON COLUMN stores.max_users IS 'Número máximo de usuarios permitidos (-1 = ilimitado)';

-- ============================================================================
-- 3. MEJORAR TABLA: user_stores (tracking de invitaciones)
-- ============================================================================

ALTER TABLE user_stores
ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS invited_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_user_stores_is_active ON user_stores(is_active);
CREATE INDEX IF NOT EXISTS idx_user_stores_invited_by ON user_stores(invited_by);

COMMENT ON COLUMN user_stores.invited_by IS 'Usuario que invitó a este miembro (NULL para owners)';
COMMENT ON COLUMN user_stores.invited_at IS 'Fecha en que fue invitado';
COMMENT ON COLUMN user_stores.is_active IS 'Indica si el usuario está activo en la tienda (soft delete)';

-- ============================================================================
-- 4. FUNCIÓN: Generar Token de Invitación
-- ============================================================================

CREATE OR REPLACE FUNCTION generate_invitation_token()
RETURNS VARCHAR(255) AS $$
DECLARE
    new_token VARCHAR(255);
    token_exists BOOLEAN;
    max_attempts INTEGER := 100;
    attempt INTEGER := 0;
BEGIN
    LOOP
        -- Generate 64-char hex token (32 random bytes)
        new_token := encode(gen_random_bytes(32), 'hex');

        -- Check uniqueness
        SELECT EXISTS(
            SELECT 1 FROM collaborator_invitations
            WHERE token = new_token
        ) INTO token_exists;

        EXIT WHEN NOT token_exists;

        attempt := attempt + 1;
        IF attempt >= max_attempts THEN
            RAISE EXCEPTION 'Failed to generate unique token after % attempts', max_attempts;
        END IF;
    END LOOP;

    RETURN new_token;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_invitation_token IS 'Genera un token único de 64 caracteres para invitaciones';

-- ============================================================================
-- 5. FUNCIÓN: Validar Límite de Usuarios
-- ============================================================================

CREATE OR REPLACE FUNCTION can_add_user_to_store(p_store_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_current_users INTEGER;
    v_max_users INTEGER;
BEGIN
    -- Get current active user count
    SELECT COUNT(*) INTO v_current_users
    FROM user_stores
    WHERE store_id = p_store_id
      AND is_active = TRUE;

    -- Get max users allowed
    SELECT max_users INTO v_max_users
    FROM stores
    WHERE id = p_store_id;

    -- Unlimited users if max_users = -1 (enterprise/growth)
    IF v_max_users = -1 THEN
        RETURN TRUE;
    END IF;

    RETURN v_current_users < v_max_users;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION can_add_user_to_store IS 'Verifica si se pueden agregar más usuarios según el plan de suscripción';

-- ============================================================================
-- 6. FUNCIÓN: Estadísticas de Usuarios por Tienda
-- ============================================================================

CREATE OR REPLACE FUNCTION get_store_user_stats(p_store_id UUID)
RETURNS TABLE (
    current_users INTEGER,
    max_users INTEGER,
    plan VARCHAR(50),
    can_add_more BOOLEAN,
    slots_available INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        (SELECT COUNT(*)::INTEGER
         FROM user_stores
         WHERE store_id = p_store_id AND is_active = TRUE),
        s.max_users,
        s.subscription_plan,
        can_add_user_to_store(p_store_id),
        CASE
            WHEN s.max_users = -1 THEN -1
            ELSE s.max_users - (
                SELECT COUNT(*)::INTEGER
                FROM user_stores
                WHERE store_id = p_store_id AND is_active = TRUE
            )
        END
    FROM stores s
    WHERE s.id = p_store_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_store_user_stats IS 'Retorna estadísticas de usuarios actuales vs límites del plan';

-- ============================================================================
-- 7. RLS POLICIES: collaborator_invitations
-- ============================================================================

-- Enable RLS
ALTER TABLE collaborator_invitations ENABLE ROW LEVEL SECURITY;

-- Owners/Admins can view invitations for their store
CREATE POLICY "Users can view invitations for their stores"
ON collaborator_invitations FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM user_stores
        WHERE user_stores.user_id = auth.uid()
          AND user_stores.store_id = collaborator_invitations.store_id
          AND user_stores.role IN ('owner', 'admin')
          AND user_stores.is_active = TRUE
    )
);

-- Owners/Admins can create invitations
CREATE POLICY "Owners and admins can create invitations"
ON collaborator_invitations FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM user_stores
        WHERE user_stores.user_id = auth.uid()
          AND user_stores.store_id = store_id
          AND user_stores.role IN ('owner', 'admin')
          AND user_stores.is_active = TRUE
    )
);

-- Owners can delete (cancel) invitations
CREATE POLICY "Owners can delete invitations"
ON collaborator_invitations FOR DELETE
USING (
    EXISTS (
        SELECT 1 FROM user_stores
        WHERE user_stores.user_id = auth.uid()
          AND user_stores.store_id = collaborator_invitations.store_id
          AND user_stores.role = 'owner'
          AND user_stores.is_active = TRUE
    )
);

-- ============================================================================
-- 8. MIGRAR DATOS EXISTENTES
-- ============================================================================

-- Set first user per store as owner (if not already)
UPDATE user_stores us
SET role = 'owner'
WHERE id IN (
    SELECT DISTINCT ON (store_id) id
    FROM user_stores
    ORDER BY store_id, created_at ASC
)
AND role != 'owner';

-- Set default subscription plan for existing stores
UPDATE stores
SET subscription_plan = 'free',
    max_users = 1
WHERE subscription_plan IS NULL;

-- Set is_active = TRUE for all existing user_stores
UPDATE user_stores
SET is_active = TRUE
WHERE is_active IS NULL;

-- ============================================================================
-- 9. CLEANUP FUNCTION: Expired Invitations (Cron Job)
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_expired_invitations()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM collaborator_invitations
    WHERE used = FALSE
      AND expires_at < NOW()
      AND created_at < NOW() - INTERVAL '30 days'; -- Keep for 30 days for audit

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_expired_invitations IS 'Limpia invitaciones expiradas (ejecutar diariamente con cron)';

-- ============================================================================
-- 10. TRIGGER: Activity Log para Invitaciones
-- ============================================================================

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
        INSERT INTO activity_log (user_id, store_id, action_type, description, metadata)
        VALUES (
            auth.uid(),
            OLD.store_id,
            'invitation_cancelled',
            'Invitación cancelada para ' || OLD.invited_email,
            jsonb_build_object(
                'invitation_id', OLD.id,
                'invited_email', OLD.invited_email
            )
        );
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_log_invitation_activity
AFTER INSERT OR UPDATE OR DELETE ON collaborator_invitations
FOR EACH ROW
EXECUTE FUNCTION log_invitation_activity();

-- ============================================================================
-- 11. VALIDATION: Prevent removing last owner
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_removing_last_owner()
RETURNS TRIGGER AS $$
DECLARE
    owner_count INTEGER;
BEGIN
    -- Only check when deactivating an owner
    IF NEW.is_active = FALSE AND OLD.is_active = TRUE AND OLD.role = 'owner' THEN
        -- Count remaining active owners in the store
        SELECT COUNT(*) INTO owner_count
        FROM user_stores
        WHERE store_id = OLD.store_id
          AND role = 'owner'
          AND is_active = TRUE
          AND id != OLD.id;

        IF owner_count = 0 THEN
            RAISE EXCEPTION 'Cannot remove the last owner of the store';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_prevent_removing_last_owner
BEFORE UPDATE ON user_stores
FOR EACH ROW
EXECUTE FUNCTION prevent_removing_last_owner();

-- ============================================================================
-- VERIFICATION QUERIES (Para testing manual)
-- ============================================================================

-- Ver estructura de tablas
COMMENT ON COLUMN collaborator_invitations.id IS 'Verificar con: SELECT * FROM collaborator_invitations;';
COMMENT ON COLUMN stores.subscription_plan IS 'Verificar con: SELECT id, name, subscription_plan, max_users FROM stores;';
COMMENT ON COLUMN user_stores.is_active IS 'Verificar con: SELECT user_id, store_id, role, is_active FROM user_stores;';

-- Test functions
-- SELECT generate_invitation_token();
-- SELECT can_add_user_to_store('{store-uuid}');
-- SELECT * FROM get_store_user_stats('{store-uuid}');
