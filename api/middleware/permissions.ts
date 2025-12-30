/**
 * Middleware de Permisos
 *
 * Proporciona middleware para verificar roles y permisos en las rutas de API.
 * Se usa en conjunto con el sistema de permisos definido en api/permissions.ts
 */

import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { Role, Module, Permission, hasPermission, canAccessModule } from '../permissions';
import { supabaseAdmin } from '../db/connection';

/**
 * Extended Request interface que incluye el rol del usuario
 */
export interface PermissionRequest extends AuthRequest {
  userRole?: Role;
}

/**
 * Middleware: Extrae el rol del usuario para la tienda actual
 *
 * Debe usarse después de verifyToken y extractStoreId.
 * Agrega req.userRole al request.
 */
export async function extractUserRole(
  req: PermissionRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const { userId, storeId } = req;

    if (!userId || !storeId) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'User ID or Store ID missing'
      });
    }

    // Fetch user role for current store
    const { data: userStore, error } = await supabaseAdmin
      .from('user_stores')
      .select('role')
      .eq('user_id', userId)
      .eq('store_id', storeId)
      .eq('is_active', true)
      .single();

    if (error || !userStore) {
      console.warn(`[extractUserRole] Access denied for user ${userId} in store ${storeId}`);
      return res.status(403).json({
        error: 'Access denied to this store',
        message: 'You do not have access to this store or your access has been revoked'
      });
    }

    req.userRole = userStore.role as Role;
    next();
  } catch (error) {
    console.error('[extractUserRole] Error extracting user role:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to determine user permissions'
    });
  }
}

/**
 * Middleware Factory: Requiere uno o más roles específicos
 *
 * Uso:
 * router.post('/invite', requireRole(Role.OWNER, Role.ADMIN), handler)
 */
export function requireRole(...allowedRoles: Role[]) {
  return (req: PermissionRequest, res: Response, next: NextFunction) => {
    if (!req.userRole) {
      return res.status(401).json({
        error: 'Role not determined',
        message: 'User role could not be determined'
      });
    }

    if (!allowedRoles.includes(req.userRole)) {
      console.warn(
        `[requireRole] Permission denied for user ${req.userId} with role ${req.userRole}. Required: ${allowedRoles.join(', ')}`
      );
      return res.status(403).json({
        error: 'Insufficient permissions',
        message: `This action requires one of the following roles: ${allowedRoles.join(', ')}`,
        required: allowedRoles,
        current: req.userRole
      });
    }

    next();
  };
}

/**
 * Middleware Factory: Requiere acceso a un módulo específico
 *
 * Uso:
 * router.get('/warehouse', requireModule(Module.WAREHOUSE), handler)
 */
export function requireModule(module: Module) {
  return (req: PermissionRequest, res: Response, next: NextFunction) => {
    if (!req.userRole) {
      return res.status(401).json({
        error: 'Role not determined',
        message: 'User role could not be determined'
      });
    }

    if (!canAccessModule(req.userRole, module)) {
      console.warn(
        `[requireModule] Module access denied for user ${req.userId} with role ${req.userRole} to module ${module}`
      );
      return res.status(403).json({
        error: `Access denied to ${module} module`,
        message: `Your role (${req.userRole}) does not have access to this module`,
        role: req.userRole,
        module
      });
    }

    next();
  };
}

/**
 * Middleware Factory: Requiere permiso específico en un módulo
 *
 * Uso:
 * router.delete('/products/:id', requirePermission(Module.PRODUCTS, Permission.DELETE), handler)
 */
export function requirePermission(module: Module, permission: Permission) {
  return (req: PermissionRequest, res: Response, next: NextFunction) => {
    if (!req.userRole) {
      return res.status(401).json({
        error: 'Role not determined',
        message: 'User role could not be determined'
      });
    }

    if (!hasPermission(req.userRole, module, permission)) {
      console.warn(
        `[requirePermission] Permission denied for user ${req.userId} with role ${req.userRole}: ${permission} on ${module}`
      );
      return res.status(403).json({
        error: `Permission denied: ${permission} on ${module}`,
        message: `Your role (${req.userRole}) cannot perform this action`,
        role: req.userRole,
        module,
        permission
      });
    }

    next();
  };
}

/**
 * Middleware: Only Owner
 *
 * Shorthand para requireRole(Role.OWNER)
 */
export const ownerOnly = requireRole(Role.OWNER);

/**
 * Middleware: Owner or Admin
 *
 * Shorthand para requireRole(Role.OWNER, Role.ADMIN)
 */
export const ownerOrAdmin = requireRole(Role.OWNER, Role.ADMIN);

/**
 * Helper: Check permission programmatically (no middleware)
 *
 * Útil para verificar permisos dentro de un handler sin usar middleware.
 */
export function checkPermission(
  req: PermissionRequest,
  module: Module,
  permission: Permission
): boolean {
  if (!req.userRole) return false;
  return hasPermission(req.userRole, module, permission);
}

/**
 * Helper: Check module access programmatically (no middleware)
 */
export function checkModuleAccess(
  req: PermissionRequest,
  module: Module
): boolean {
  if (!req.userRole) return false;
  return canAccessModule(req.userRole, module);
}
