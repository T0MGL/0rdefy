/**
 * Collaborators API Routes
 *
 * Endpoints para gestionar invitaciones de colaboradores y miembros del equipo.
 *
 * Security Features:
 * - Role-based access control (owner/admin for most operations)
 * - Plan limit validation at invitation creation AND acceptance
 * - Atomic token claiming to prevent race conditions
 * - canInviteRole validation to prevent privilege escalation
 * - Secure token generation (32 bytes = 64 hex chars)
 */

import { Router, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '../db/connection';
import { verifyToken, extractStoreId } from '../middleware/auth';
import { extractUserRole, requireRole, PermissionRequest } from '../middleware/permissions';
import { requireFeature } from '../middleware/planLimits';
import { Role, canInviteRole } from '../permissions';
import { sendCollaboratorInvite } from '../services/email.service';

export const collaboratorsRouter = Router();

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is required');
}
const JWT_ALGORITHM = 'HS256';
const JWT_ISSUER = 'ordefy-api';
const JWT_AUDIENCE = 'ordefy-app';
const TOKEN_EXPIRY = '7d';
const SALT_ROUNDS = 10;

/**
 * Mask email for privacy (e.g., john.doe@example.com -> j***@example.com)
 */
function maskEmail(email: string): string {
  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) return '***@***';

  // Show first char and mask the rest
  const maskedLocal = localPart.length > 1
    ? localPart[0] + '***'
    : localPart + '***';

  return `${maskedLocal}@${domain}`;
}

// Apply authentication middleware to all routes (except public ones)
collaboratorsRouter.use((req, res, next) => {
  // Public routes that don't require authentication
  // Note: cleanup-expired-tokens uses X-Cron-Secret header instead
  const publicRoutes = ['/validate-token/', '/accept-invitation', '/cleanup-expired-tokens'];
  const isPublicRoute = publicRoutes.some(route => req.path.includes(route));

  if (isPublicRoute) {
    return next();
  }

  // Apply auth middleware chain for protected routes
  return verifyToken(req, res, () => {
    extractStoreId(req, res, () => {
      extractUserRole(req as PermissionRequest, res, () => {
        // Team management requires Starter plan or higher
        requireFeature('team_management')(req, res, next);
      });
    });
  });
});

// ============================================================================
// POST /api/collaborators/invite
// Crear invitación de colaborador
// ============================================================================

collaboratorsRouter.post(
  '/invite',
  requireRole(Role.OWNER, Role.ADMIN),
  async (req: PermissionRequest, res: Response) => {
    try {
      const { storeId, userId } = req;
      const { name, email, role } = req.body;

      console.log('[Invite] Creating invitation:', { store: storeId, inviter: userId, email, role });

      // Validations
      if (!name || !email || !role) {
        return res.status(400).json({
          error: 'Name, email, and role are required',
          missing: {
            name: !name,
            email: !email,
            role: !role
          }
        });
      }

      // Email format validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          error: 'Invalid email format'
        });
      }

      // Valid roles (cannot invite owners)
      const validRoles = ['admin', 'logistics', 'confirmador', 'contador', 'inventario'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({
          error: 'Invalid role',
          validRoles
        });
      }

      // SECURITY: Validate that current user can invite the target role
      // Prevents admins from inviting other admins (horizontal privilege escalation)
      if (!canInviteRole(req.userRole as Role, role as Role)) {
        console.warn(`[Invite] Role escalation attempt: ${req.userRole} tried to invite ${role}`);
        return res.status(403).json({
          error: 'You cannot invite users with this role',
          message: `Your role (${req.userRole}) cannot invite ${role} users`
        });
      }

      // Check user limit for subscription plan
      const { data: canAdd, error: canAddError } = await supabaseAdmin
        .rpc('can_add_user_to_store', { p_store_id: storeId });

      if (canAddError) {
        console.error('[Invite] Error checking user limit:', canAddError);
        return res.status(500).json({ error: 'Error al verificar límite de usuarios' });
      }

      if (!canAdd) {
        const { data: stats } = await supabaseAdmin
          .rpc('get_store_user_stats', { p_store_id: storeId })
          .single();

        console.warn('[Invite] User limit reached:', stats);
        return res.status(403).json({
          error: 'User limit reached for your subscription plan',
          current: stats?.current_users,
          max: stats?.max_users,
          plan: stats?.plan
        });
      }

      // Check if user already exists in this store
      const { data: existingUser } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('email', email)
        .single();

      if (existingUser) {
        const { data: existingMember } = await supabaseAdmin
          .from('user_stores')
          .select('id, is_active')
          .eq('user_id', existingUser.id)
          .eq('store_id', storeId)
          .single();

        if (existingMember) {
          return res.status(400).json({
            error: existingMember.is_active
              ? 'User is already a member of this store'
              : 'User was previously a member. Please reactivate instead.'
          });
        }
      }

      // Check for pending invitation with same email
      const { data: pendingInvitation } = await supabaseAdmin
        .from('collaborator_invitations')
        .select('id, expires_at')
        .eq('store_id', storeId)
        .eq('invited_email', email)
        .eq('used', false)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (pendingInvitation) {
        return res.status(400).json({
          error: 'An active invitation already exists for this email',
          expiresAt: pendingInvitation.expires_at
        });
      }

      // SECURITY: Generate cryptographically secure token (32 bytes = 64 hex chars)
      // Previous implementation used only 8 chars which was weak
      // Now using full 64 character hex string for maximum security
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiry

      // Create invitation
      const { data: invitation, error } = await supabaseAdmin
        .from('collaborator_invitations')
        .insert({
          token,
          store_id: storeId,
          inviting_user_id: userId,
          invited_name: name,
          invited_email: email,
          assigned_role: role,
          expires_at: expiresAt.toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error('[Invite] Error creating invitation:', error);
        return res.status(500).json({ error: 'Error al crear invitación' });
      }

      console.log('[Invite] Invitation created successfully:', invitation.id);

      // Generate invitation URL (short format: /i/abc12345)
      const baseUrl = process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:8080';
      const inviteUrl = `${baseUrl}/i/${token}`;

      // Get inviter name and store name for email
      const { data: inviterData } = await supabaseAdmin
        .from('users')
        .select('name')
        .eq('id', userId)
        .single();

      const { data: storeData } = await supabaseAdmin
        .from('stores')
        .select('name')
        .eq('id', storeId)
        .single();

      // Send invitation email (non-blocking - don't fail if email fails)
      const emailResult = await sendCollaboratorInvite(email, {
        inviteeName: name,
        inviterName: inviterData?.name || 'Tu compañero de equipo',
        storeName: storeData?.name || 'Tu tienda',
        role,
        inviteLink: inviteUrl,
        expiresAt
      });

      if (!emailResult.success) {
        console.warn('[Invite] Email failed but invitation created:', emailResult.error);
      }

      res.status(201).json({
        success: true,
        invitation: {
          id: invitation.id,
          email: invitation.invited_email,
          name: invitation.invited_name,
          role: invitation.assigned_role,
          inviteUrl,
          expiresAt: invitation.expires_at
        }
      });
    } catch (error) {
      console.error('[Invite] Unexpected error:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
);

// ============================================================================
// GET /api/collaborators/invitations
// Listar invitaciones (pending, expired, used)
// ============================================================================

collaboratorsRouter.get(
  '/invitations',
  requireRole(Role.OWNER, Role.ADMIN),
  async (req: PermissionRequest, res: Response) => {
    try {
      const { storeId } = req;

      const { data: invitations, error } = await supabaseAdmin
        .from('collaborator_invitations')
        .select(`
          *,
          inviting_user:users!collaborator_invitations_inviting_user_id_fkey(name, email)
        `)
        .eq('store_id', storeId)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Invitations] Error fetching:', error);
        return res.status(500).json({ error: 'Error al obtener invitaciones' });
      }

      const now = new Date();
      res.json({
        invitations: invitations.map(inv => ({
          id: inv.id,
          name: inv.invited_name,
          email: inv.invited_email,
          role: inv.assigned_role,
          invitedBy: inv.inviting_user,
          status: inv.used
            ? 'used'
            : new Date(inv.expires_at) < now
              ? 'expired'
              : 'pending',
          expiresAt: inv.expires_at,
          createdAt: inv.created_at,
          usedAt: inv.used_at
        }))
      });
    } catch (error) {
      console.error('[Invitations] Unexpected error:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
);

// ============================================================================
// DELETE /api/collaborators/invitations/:id
// Cancelar invitación
// ============================================================================

collaboratorsRouter.delete(
  '/invitations/:id',
  requireRole(Role.OWNER, Role.ADMIN),
  async (req: PermissionRequest, res: Response) => {
    try {
      const { storeId } = req;
      const { id } = req.params;

      const { error } = await supabaseAdmin
        .from('collaborator_invitations')
        .delete()
        .eq('id', id)
        .eq('store_id', storeId)
        .eq('used', false); // Only delete unused invitations

      if (error) {
        console.error('[Invitations] Error deleting:', error);
        return res.status(500).json({ error: 'Error al eliminar invitación' });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('[Invitations] Unexpected error:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
);

// ============================================================================
// GET /api/collaborators/validate-token/:token
// Validar token de invitación (público - no requiere auth)
// ============================================================================

collaboratorsRouter.get(
  '/validate-token/:token',
  async (req, res) => {
    try {
      const { token } = req.params;

      console.log('[ValidateToken] Validating token:', token.substring(0, 10) + '...');

      const { data: invitation, error } = await supabaseAdmin
        .from('collaborator_invitations')
        .select(`
          *,
          store:stores(name, country, timezone)
        `)
        .eq('token', token)
        .eq('used', false)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (error || !invitation) {
        console.warn('[ValidateToken] Invalid or expired invitation');
        return res.status(404).json({
          valid: false,
          error: 'Invalid or expired invitation'
        });
      }

      console.log('[ValidateToken] Valid invitation found for:', invitation.invited_email);

      // SECURITY: Only expose minimal information needed for the UI
      // Don't reveal assigned_role (security-sensitive)
      // Email is masked for privacy but shown so user can confirm it's for them
      const maskedEmail = maskEmail(invitation.invited_email);

      // Check if user already exists (needed to show correct password prompt)
      const { data: existingUser } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('email', invitation.invited_email)
        .single();

      res.json({
        valid: true,
        invitation: {
          name: invitation.invited_name,
          email: maskedEmail, // Masked email for privacy (e.g., j***@example.com)
          // role intentionally omitted - revealed after password set
          storeName: invitation.store.name,
          expiresAt: invitation.expires_at,
          userExists: !!existingUser // Indicates if user needs to enter existing password
        }
      });
    } catch (error) {
      console.error('[ValidateToken] Unexpected error:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
);

// ============================================================================
// POST /api/collaborators/accept-invitation
// Aceptar invitación (crear usuario y vincular a tienda)
// ============================================================================

collaboratorsRouter.post(
  '/accept-invitation',
  async (req, res) => {
    try {
      const { token, password } = req.body;

      console.log('[AcceptInvitation] Processing acceptance');

      // Validations
      if (!token || !password) {
        return res.status(400).json({
          error: 'Token and password are required'
        });
      }

      if (password.length < 8) {
        return res.status(400).json({
          error: 'Password must be at least 8 characters'
        });
      }

      // RACE CONDITION FIX: Use atomic update to claim the invitation
      // This prevents two concurrent requests from accepting the same invitation
      // by atomically setting used=true and only proceeding if update affected a row
      const { data: invitation, error: invError } = await supabaseAdmin
        .from('collaborator_invitations')
        .update({
          used: true,
          used_at: new Date().toISOString()
        })
        .eq('token', token)
        .eq('used', false)  // Only update if not already used (atomic check)
        .gt('expires_at', new Date().toISOString())
        .select('*')
        .single();

      if (invError || !invitation) {
        console.warn('[AcceptInvitation] Invalid or already claimed invitation');
        return res.status(404).json({
          error: 'Invalid or expired invitation'
        });
      }

      console.log('[AcceptInvitation] Invitation atomically claimed for:', invitation.invited_email);

      // SECURITY FIX: Validate plan limit at acceptance time (not just at creation)
      // This prevents race conditions where multiple invitations exceed the limit
      const { data: canAdd, error: canAddError } = await supabaseAdmin
        .rpc('can_add_user_to_store', { p_store_id: invitation.store_id });

      if (canAddError) {
        console.error('[AcceptInvitation] Error checking user limit:', canAddError);
        // Rollback: Mark invitation as unused
        await supabaseAdmin
          .from('collaborator_invitations')
          .update({ used: false, used_at: null })
          .eq('id', invitation.id);
        return res.status(500).json({ error: 'Error al verificar límite de usuarios' });
      }

      if (!canAdd) {
        console.warn('[AcceptInvitation] User limit reached at acceptance time');
        // Rollback: Mark invitation as unused so it can be used when space is available
        await supabaseAdmin
          .from('collaborator_invitations')
          .update({ used: false, used_at: null })
          .eq('id', invitation.id);

        const { data: stats } = await supabaseAdmin
          .rpc('get_store_user_stats', { p_store_id: invitation.store_id })
          .single();

        return res.status(403).json({
          error: 'User limit reached for the store subscription plan',
          message: 'The store has reached its maximum number of users. Please contact the store owner to upgrade the plan.',
          current: stats?.current_users,
          max: stats?.max_users,
          plan: stats?.plan
        });
      }

      // Check if user already exists with this email
      let userId: string;
      let isExistingUser = false;
      const { data: existingUser } = await supabaseAdmin
        .from('users')
        .select('id, password_hash')
        .eq('email', invitation.invited_email)
        .single();

      if (existingUser) {
        // User exists - they're accepting an invitation to a new store
        console.log('[AcceptInvitation] Existing user found:', existingUser.id);
        userId = existingUser.id;
        isExistingUser = true;

        // Verify password matches (they should login with existing password)
        const passwordMatch = await bcrypt.compare(password, existingUser.password_hash);
        if (!passwordMatch) {
          // IMPORTANT: Rollback invitation claim so user can try again
          console.log('[AcceptInvitation] Password mismatch, rolling back invitation claim');
          await supabaseAdmin
            .from('collaborator_invitations')
            .update({ used: false, used_at: null })
            .eq('id', invitation.id);

          return res.status(401).json({
            error: 'Contraseña incorrecta. Usa la contraseña de tu cuenta existente.'
          });
        }
      } else {
        // New user - create account
        console.log('[AcceptInvitation] Creating new user');
        const password_hash = await bcrypt.hash(password, SALT_ROUNDS);

        const { data: newUser, error: userError } = await supabaseAdmin
          .from('users')
          .insert({
            email: invitation.invited_email,
            password_hash,
            name: invitation.invited_name,
            is_active: true
          })
          .select()
          .single();

        if (userError || !newUser) {
          console.error('[AcceptInvitation] Error creating user:', userError);
          // IMPORTANT: Rollback invitation claim so it can be tried again
          await supabaseAdmin
            .from('collaborator_invitations')
            .update({ used: false, used_at: null })
            .eq('id', invitation.id);
          return res.status(500).json({ error: 'Error al crear usuario' });
        }

        userId = newUser.id;
        console.log('[AcceptInvitation] New user created:', userId);
      }

      // ATOMIC OPERATION: Create user_stores and mark invitation as used together
      // If either fails, we need to rollback
      const { error: linkError } = await supabaseAdmin
        .from('user_stores')
        .insert({
          user_id: userId,
          store_id: invitation.store_id,
          role: invitation.assigned_role,
          invited_by: invitation.inviting_user_id,
          invited_at: new Date().toISOString(),
          is_active: true
        });

      if (linkError) {
        console.error('[AcceptInvitation] Error linking user to store:', linkError);
        // ROLLBACK: Revert invitation claim and delete new user if created
        console.log('[AcceptInvitation] Rolling back: reverting invitation claim');
        await supabaseAdmin
          .from('collaborator_invitations')
          .update({ used: false, used_at: null, used_by_user_id: null })
          .eq('id', invitation.id);

        if (!isExistingUser) {
          console.log('[AcceptInvitation] Rolling back: deleting newly created user');
          await supabaseAdmin.from('users').delete().eq('id', userId);
        }
        return res.status(500).json({ error: 'Error al vincular usuario a tienda' });
      }

      console.log('[AcceptInvitation] User linked to store');

      // Update invitation with user_id who accepted it (invitation already marked used atomically above)
      const { error: updateInvError } = await supabaseAdmin
        .from('collaborator_invitations')
        .update({ used_by_user_id: userId })
        .eq('id', invitation.id);

      if (updateInvError) {
        // Non-critical error - invitation is already marked as used, just log
        console.warn('[AcceptInvitation] Failed to update used_by_user_id:', updateInvError);
      }

      // Generate JWT token for auto-login
      const authToken = jwt.sign(
        { userId, email: invitation.invited_email },
        JWT_SECRET,
        {
          algorithm: JWT_ALGORITHM as jwt.Algorithm,
          expiresIn: TOKEN_EXPIRY,
          issuer: JWT_ISSUER,
          audience: JWT_AUDIENCE
        }
      );

      // Fetch complete user data with stores (same format as login)
      const { data: userData } = await supabaseAdmin
        .from('users')
        .select('id, name, email, phone, phone_verified')
        .eq('id', userId)
        .single();

      const { data: userStores } = await supabaseAdmin
        .from('user_stores')
        .select(`
          role,
          store:stores(id, name, country, currency, timezone)
        `)
        .eq('user_id', userId)
        .eq('is_active', true);

      const stores = userStores?.map((us: any) => ({
        id: us.store.id,
        name: us.store.name,
        country: us.store.country,
        currency: us.store.currency,
        timezone: us.store.timezone,
        role: us.role
      })) || [];

      console.log('[AcceptInvitation] Success! Auto-login token generated');

      res.json({
        success: true,
        token: authToken,
        storeId: invitation.store_id,
        user: {
          id: userData?.id || userId,
          email: userData?.email || invitation.invited_email,
          name: userData?.name || invitation.invited_name,
          phone: userData?.phone,
          phone_verified: userData?.phone_verified || false,
          stores
        }
      });
    } catch (error) {
      console.error('[AcceptInvitation] Unexpected error:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
);

// ============================================================================
// GET /api/collaborators
// Listar colaboradores de la tienda
// ============================================================================

collaboratorsRouter.get(
  '/',
  requireRole(Role.OWNER, Role.ADMIN),
  async (req: PermissionRequest, res: Response) => {
    try {
      const { storeId } = req;

      if (!storeId) {
        console.error('[Collaborators] Missing storeId in request');
        return res.status(400).json({ error: 'Se requiere el ID de la tienda' });
      }

      console.log('[Collaborators] Fetching team members for store:', storeId);

      const { data: members, error } = await supabaseAdmin
        .from('user_stores')
        .select(`
          *,
          user:users!user_stores_user_id_fkey(id, name, email, phone),
          invited_by_user:users!user_stores_invited_by_fkey(name)
        `)
        .eq('store_id', storeId)
        .eq('is_active', true)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[Collaborators] Database error:', {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
        return res.status(500).json({
          error: 'Error al obtener colaboradores',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
      }

      console.log('[Collaborators] Found', members.length, 'members');

      res.json({
        members: members.map(m => ({
          id: m.user.id,
          name: m.user.name,
          email: m.user.email,
          phone: m.user.phone,
          role: m.role,
          invitedBy: m.invited_by_user?.name || null,
          invitedAt: m.invited_at,
          joinedAt: m.created_at
        }))
      });
    } catch (error) {
      console.error('[Collaborators] Unexpected error:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
);

// ============================================================================
// DELETE /api/collaborators/:userId
// Remover colaborador (soft delete)
// ============================================================================

collaboratorsRouter.delete(
  '/:userId',
  requireRole(Role.OWNER),
  async (req: PermissionRequest, res: Response) => {
    try {
      const { storeId, userId: currentUserId } = req;
      const { userId } = req.params;

      // Cannot remove yourself
      if (userId === currentUserId) {
        return res.status(400).json({
          error: 'Cannot remove yourself from the store'
        });
      }

      // Soft delete (set is_active = false)
      const { error } = await supabaseAdmin
        .from('user_stores')
        .update({ is_active: false })
        .eq('user_id', userId)
        .eq('store_id', storeId);

      if (error) {
        console.error('[Remove] Error removing collaborator:', error);
        return res.status(500).json({ error: 'Error al eliminar colaborador' });
      }

      console.log('[Remove] Collaborator removed:', userId);
      res.json({ success: true });
    } catch (error) {
      console.error('[Remove] Unexpected error:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
);

// ============================================================================
// PATCH /api/collaborators/:userId/role
// Cambiar rol de colaborador
// ============================================================================

collaboratorsRouter.patch(
  '/:userId/role',
  requireRole(Role.OWNER),
  async (req: PermissionRequest, res: Response) => {
    try {
      const { storeId, userId: currentUserId } = req;
      const { userId } = req.params;
      const { role } = req.body;

      const validRoles = ['admin', 'logistics', 'confirmador', 'contador', 'inventario'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({
          error: 'Invalid role',
          validRoles
        });
      }

      // Cannot change your own role
      if (userId === currentUserId) {
        return res.status(400).json({
          error: 'Cannot change your own role'
        });
      }

      const { error } = await supabaseAdmin
        .from('user_stores')
        .update({ role })
        .eq('user_id', userId)
        .eq('store_id', storeId);

      if (error) {
        console.error('[ChangeRole] Error updating role:', error);
        return res.status(500).json({ error: 'Error al actualizar rol' });
      }

      console.log('[ChangeRole] Role updated:', { userId, role });
      res.json({ success: true });
    } catch (error) {
      console.error('[ChangeRole] Unexpected error:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
);

// ============================================================================
// PATCH /api/collaborators/:userId/reactivate
// Reactivar colaborador previamente removido (soft delete → active)
// ============================================================================

collaboratorsRouter.patch(
  '/:userId/reactivate',
  requireRole(Role.OWNER),
  async (req: PermissionRequest, res: Response) => {
    try {
      const { storeId } = req;
      const { userId } = req.params;
      const { role } = req.body; // Optional: new role for reactivation

      console.log('[Reactivate] Attempting to reactivate user:', userId);

      // Check if user exists in store and is inactive
      const { data: userStore, error: fetchError } = await supabaseAdmin
        .from('user_stores')
        .select('id, role, is_active')
        .eq('user_id', userId)
        .eq('store_id', storeId)
        .single();

      if (fetchError || !userStore) {
        return res.status(404).json({
          error: 'User not found in this store'
        });
      }

      if (userStore.is_active) {
        return res.status(400).json({
          error: 'User is already active in this store'
        });
      }

      // Check user limit for subscription plan before reactivation
      const { data: canAdd, error: canAddError } = await supabaseAdmin
        .rpc('can_add_user_to_store', { p_store_id: storeId });

      if (canAddError) {
        console.error('[Reactivate] Error checking user limit:', canAddError);
        return res.status(500).json({ error: 'Error al verificar límite de usuarios' });
      }

      if (!canAdd) {
        const { data: stats } = await supabaseAdmin
          .rpc('get_store_user_stats', { p_store_id: storeId })
          .single();

        console.warn('[Reactivate] User limit reached:', stats);
        return res.status(403).json({
          error: 'User limit reached for your subscription plan',
          message: 'Upgrade your plan to add more users',
          current: stats?.current_users,
          max: stats?.max_users,
          plan: stats?.plan
        });
      }

      // Validate new role if provided
      const validRoles = ['admin', 'logistics', 'confirmador', 'contador', 'inventario'];
      const newRole = role && validRoles.includes(role) ? role : userStore.role;

      // Reactivate user
      const { error: updateError } = await supabaseAdmin
        .from('user_stores')
        .update({
          is_active: true,
          role: newRole,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('store_id', storeId);

      if (updateError) {
        console.error('[Reactivate] Error reactivating user:', updateError);
        return res.status(500).json({ error: 'Error al reactivar usuario' });
      }

      // Fetch user details for response
      const { data: userData } = await supabaseAdmin
        .from('users')
        .select('id, name, email')
        .eq('id', userId)
        .single();

      console.log('[Reactivate] User reactivated:', { userId, role: newRole });
      res.json({
        success: true,
        message: 'User reactivated successfully',
        user: userData,
        role: newRole
      });
    } catch (error) {
      console.error('[Reactivate] Unexpected error:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
);

// ============================================================================
// GET /api/collaborators/stats
// Estadísticas de usuarios vs límites
// ============================================================================

collaboratorsRouter.get(
  '/stats',
  requireRole(Role.OWNER, Role.ADMIN),
  async (req: PermissionRequest, res: Response) => {
    try {
      const { storeId } = req;

      const { data: stats, error } = await supabaseAdmin
        .rpc('get_store_user_stats', { p_store_id: storeId })
        .single();

      if (error) {
        console.error('[Stats] Error fetching stats:', error);
        return res.status(500).json({ error: 'Error al obtener estadísticas' });
      }

      // Add can_add_more field based on slots_available
      const canAddMore = stats.slots_available > 0 || stats.slots_available === -1;

      res.json({
        ...stats,
        can_add_more: canAddMore
      });
    } catch (error) {
      console.error('[Stats] Unexpected error:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
);

// ============================================================================
// POST /api/collaborators/cleanup-expired-tokens
// Limpieza de tokens de invitación expirados (para cron job)
// ============================================================================

collaboratorsRouter.post(
  '/cleanup-expired-tokens',
  async (req, res) => {
    try {
      // Require CRON_SECRET for security - single check to avoid information disclosure
      const cronSecret = req.headers['x-cron-secret'];
      const expectedSecret = process.env.CRON_SECRET;

      // SECURITY: Single check - return 401 whether CRON_SECRET is missing or mismatched
      // This prevents attackers from learning if the secret is configured
      if (!expectedSecret || cronSecret !== expectedSecret) {
        console.warn('[Cleanup] Unauthorized cleanup attempt');
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Delete expired AND unused invitations older than 7 days (double the expiry period)
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 7);

      const { data: deleted, error } = await supabaseAdmin
        .from('collaborator_invitations')
        .delete()
        .eq('used', false)
        .lt('expires_at', cutoffDate.toISOString())
        .select('id');

      if (error) {
        console.error('[Cleanup] Error deleting expired tokens:', error);
        return res.status(500).json({ error: 'Error al limpiar tokens' });
      }

      const deletedCount = deleted?.length || 0;
      console.log(`[Cleanup] Deleted ${deletedCount} expired invitation tokens`);

      res.json({
        success: true,
        deleted: deletedCount,
        cutoff_date: cutoffDate.toISOString()
      });
    } catch (error) {
      console.error('[Cleanup] Unexpected error:', error);
      res.status(500).json({ error: 'Error interno del servidor' });
    }
  }
);
