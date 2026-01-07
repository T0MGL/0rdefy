-- ============================================================================
-- Migration 042: Fix collaborator invitation DELETE policy
-- Description: Allows both owners and admins to delete invitations (consistent with backend)
-- Author: Bright Idea
-- Date: 2026-01-07
-- ============================================================================

-- Drop existing restrictive policy
DROP POLICY IF EXISTS "Owners can delete invitations" ON collaborator_invitations;

-- Create new policy that allows both owners and admins
CREATE POLICY "Owners and admins can delete invitations"
ON collaborator_invitations FOR DELETE
USING (
    EXISTS (
        SELECT 1 FROM user_stores
        WHERE user_stores.user_id = auth.uid()
          AND user_stores.store_id = collaborator_invitations.store_id
          AND user_stores.role IN ('owner', 'admin')
          AND user_stores.is_active = TRUE
    )
);

COMMENT ON POLICY "Owners and admins can delete invitations" ON collaborator_invitations IS
'Permite a owners y admins cancelar invitaciones pendientes. Consistente con requireRole(OWNER, ADMIN) del backend.';
