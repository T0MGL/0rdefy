-- ============================================================================
-- Migration 044: Add UPDATE policy for user_stores
-- Description: Allows owners to update (deactivate/change role) collaborators
-- Root cause: Missing UPDATE policy on user_stores table
-- Author: Bright Idea
-- Date: 2026-01-07
-- ============================================================================

-- Create UPDATE policy for owners to manage team members
CREATE POLICY "Owners can update user_stores in their store"
ON user_stores FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM user_stores AS owner_check
        WHERE owner_check.user_id = auth.uid()
          AND owner_check.store_id = user_stores.store_id
          AND owner_check.role = 'owner'
          AND owner_check.is_active = TRUE
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM user_stores AS owner_check
        WHERE owner_check.user_id = auth.uid()
          AND owner_check.store_id = user_stores.store_id
          AND owner_check.role = 'owner'
          AND owner_check.is_active = TRUE
    )
);

COMMENT ON POLICY "Owners can update user_stores in their store" ON user_stores IS
'Permite a owners actualizar roles y estado (is_active) de colaboradores en su tienda';

-- Create DELETE policy for owners (in case we want to hard delete instead of soft delete)
CREATE POLICY "Owners can delete user_stores from their store"
ON user_stores FOR DELETE
USING (
    EXISTS (
        SELECT 1 FROM user_stores AS owner_check
        WHERE owner_check.user_id = auth.uid()
          AND owner_check.store_id = user_stores.store_id
          AND owner_check.role = 'owner'
          AND owner_check.is_active = TRUE
    )
);

COMMENT ON POLICY "Owners can delete user_stores from their store" ON user_stores IS
'Permite a owners eliminar colaboradores de su tienda (actualmente se usa soft delete)';
