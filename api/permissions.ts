/**
 * Sistema de Permisos y Roles
 *
 * Define roles, módulos, permisos y la matriz de acceso para cada rol.
 * Este archivo es la fuente de verdad para el control de acceso basado en roles (RBAC).
 */

export enum Role {
  OWNER = 'owner',
  ADMIN = 'admin',
  LOGISTICS = 'logistics',
  CONFIRMADOR = 'confirmador',
  CONTADOR = 'contador',
  INVENTARIO = 'inventario',
  // External operator tier. Bound to a specific carrier via
  // user_stores.carrier_id (Migration 174). Sees only the courier
  // portal, never the admin app.
  COURIER = 'courier'
}

export enum Module {
  DASHBOARD = 'dashboard',
  ORDERS = 'orders',
  PRODUCTS = 'products',
  WAREHOUSE = 'warehouse',
  RETURNS = 'returns',
  MERCHANDISE = 'merchandise',
  CUSTOMERS = 'customers',
  SUPPLIERS = 'suppliers',
  CARRIERS = 'carriers',
  CAMPAIGNS = 'campaigns',
  ANALYTICS = 'analytics',
  SETTINGS = 'settings',
  TEAM = 'team',
  BILLING = 'billing',
  INTEGRATIONS = 'integrations',
  INVOICING = 'invoicing',
  // Courier-only portal. Strictly isolated from admin modules.
  COURIER_PORTAL = 'courier_portal'
}

export enum Permission {
  VIEW = 'view',
  CREATE = 'create',
  EDIT = 'edit',
  DELETE = 'delete'
}

// Type definitions
type ModulePermissions = {
  [key in Module]: Permission[];
};

type RolePermissions = {
  [key in Role]: ModulePermissions;
};

/**
 * Matriz de Permisos por Rol
 *
 * Define qué permisos tiene cada rol en cada módulo.
 * Permisos vacíos [] = sin acceso al módulo.
 */
export const ROLE_PERMISSIONS: RolePermissions = {
  [Role.OWNER]: {
    [Module.DASHBOARD]: [Permission.VIEW],
    [Module.ORDERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.PRODUCTS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.WAREHOUSE]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.RETURNS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.MERCHANDISE]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CUSTOMERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.SUPPLIERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CARRIERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CAMPAIGNS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.ANALYTICS]: [Permission.VIEW],
    [Module.SETTINGS]: [Permission.VIEW, Permission.EDIT],
    [Module.TEAM]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.BILLING]: [Permission.VIEW, Permission.EDIT],
    [Module.INTEGRATIONS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.INVOICING]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.COURIER_PORTAL]: [], // Owners gestionan couriers desde admin, no entran al portal
  },

  [Role.ADMIN]: {
    [Module.DASHBOARD]: [Permission.VIEW],
    [Module.ORDERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.PRODUCTS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.WAREHOUSE]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.RETURNS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.MERCHANDISE]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CUSTOMERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.SUPPLIERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CARRIERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CAMPAIGNS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.ANALYTICS]: [Permission.VIEW],
    [Module.SETTINGS]: [Permission.VIEW, Permission.EDIT],
    [Module.TEAM]: [],
    [Module.BILLING]: [],
    [Module.INTEGRATIONS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.INVOICING]: [Permission.VIEW, Permission.CREATE, Permission.EDIT],
    [Module.COURIER_PORTAL]: [],
  },

  [Role.LOGISTICS]: {
    [Module.DASHBOARD]: [Permission.VIEW],
    [Module.ORDERS]: [Permission.VIEW, Permission.EDIT],
    [Module.PRODUCTS]: [],
    [Module.WAREHOUSE]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.RETURNS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.MERCHANDISE]: [],
    [Module.CUSTOMERS]: [],
    [Module.SUPPLIERS]: [],
    [Module.CARRIERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CAMPAIGNS]: [],
    [Module.ANALYTICS]: [Permission.VIEW],
    [Module.SETTINGS]: [],
    [Module.TEAM]: [],
    [Module.BILLING]: [],
    [Module.INTEGRATIONS]: [],
    [Module.INVOICING]: [],
    [Module.COURIER_PORTAL]: [],
  },

  [Role.CONFIRMADOR]: {
    [Module.DASHBOARD]: [Permission.VIEW],
    [Module.ORDERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT],
    [Module.PRODUCTS]: [Permission.VIEW],
    [Module.WAREHOUSE]: [],
    [Module.RETURNS]: [],
    [Module.MERCHANDISE]: [],
    [Module.CUSTOMERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT],
    [Module.SUPPLIERS]: [],
    [Module.CARRIERS]: [Permission.VIEW],
    [Module.CAMPAIGNS]: [],
    [Module.ANALYTICS]: [],
    [Module.SETTINGS]: [],
    [Module.TEAM]: [],
    [Module.BILLING]: [],
    [Module.INTEGRATIONS]: [],
    [Module.INVOICING]: [],
    [Module.COURIER_PORTAL]: [],
  },

  [Role.CONTADOR]: {
    [Module.DASHBOARD]: [Permission.VIEW],
    [Module.ORDERS]: [Permission.VIEW],
    [Module.PRODUCTS]: [Permission.VIEW],
    [Module.WAREHOUSE]: [],
    [Module.RETURNS]: [],
    [Module.MERCHANDISE]: [],
    [Module.CUSTOMERS]: [Permission.VIEW],
    [Module.SUPPLIERS]: [],
    [Module.CARRIERS]: [],
    [Module.CAMPAIGNS]: [Permission.VIEW],
    [Module.ANALYTICS]: [Permission.VIEW],
    [Module.SETTINGS]: [],
    [Module.TEAM]: [],
    [Module.BILLING]: [],
    [Module.INTEGRATIONS]: [],
    [Module.INVOICING]: [Permission.VIEW],
    [Module.COURIER_PORTAL]: [],
  },

  [Role.INVENTARIO]: {
    [Module.DASHBOARD]: [Permission.VIEW],
    [Module.ORDERS]: [],
    [Module.PRODUCTS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.WAREHOUSE]: [],
    [Module.RETURNS]: [],
    [Module.MERCHANDISE]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CUSTOMERS]: [],
    [Module.SUPPLIERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CARRIERS]: [],
    [Module.CAMPAIGNS]: [],
    [Module.ANALYTICS]: [],
    [Module.SETTINGS]: [],
    [Module.TEAM]: [],
    [Module.BILLING]: [],
    [Module.INTEGRATIONS]: [],
    [Module.INVOICING]: [],
    [Module.COURIER_PORTAL]: [],
  },

  [Role.COURIER]: {
    // External operator. Sees ONLY the courier portal scoped to its carrier_id.
    // Every admin module is explicitly false. The matrix is the source of truth,
    // not a default. Adding a new Module value forces this row to declare access.
    [Module.DASHBOARD]: [],
    [Module.ORDERS]: [],
    [Module.PRODUCTS]: [],
    [Module.WAREHOUSE]: [],
    [Module.RETURNS]: [],
    [Module.MERCHANDISE]: [],
    [Module.CUSTOMERS]: [],
    [Module.SUPPLIERS]: [],
    [Module.CARRIERS]: [],
    [Module.CAMPAIGNS]: [],
    [Module.ANALYTICS]: [],
    [Module.SETTINGS]: [],
    [Module.TEAM]: [],
    [Module.BILLING]: [],
    [Module.INTEGRATIONS]: [],
    [Module.INVOICING]: [],
    [Module.COURIER_PORTAL]: [Permission.VIEW, Permission.EDIT],
  }
};

/**
 * Labels en español para los roles
 */
export const ROLE_LABELS: Record<Role, string> = {
  [Role.OWNER]: 'Propietario',
  [Role.ADMIN]: 'Administrador',
  [Role.LOGISTICS]: 'Logística',
  [Role.CONFIRMADOR]: 'Confirmador',
  [Role.CONTADOR]: 'Contador',
  [Role.INVENTARIO]: 'Inventario',
  [Role.COURIER]: 'Operador de courier'
};

/**
 * Descripciones de los roles
 */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  [Role.OWNER]: 'Acceso total a todos los módulos, team management y billing',
  [Role.ADMIN]: 'Acceso completo excepto team management y billing',
  [Role.LOGISTICS]: 'Gestión de warehouse, returns, carriers, edición de estado de orders y métricas de logística',
  [Role.CONFIRMADOR]: 'Confirmación de órdenes, gestión de customers y vista de productos',
  [Role.CONTADOR]: 'Acceso a analytics, reportes y vista de campaigns',
  [Role.INVENTARIO]: 'Gestión de products, merchandise y suppliers',
  [Role.COURIER]: 'Operador externo de courier. Solo accede al portal de couriers de su carrier asignado'
};

/**
 * Helper Functions
 */

export function hasPermission(
  role: Role,
  module: Module,
  permission: Permission
): boolean {
  const modulePermissions = ROLE_PERMISSIONS[role]?.[module] || [];
  return modulePermissions.includes(permission);
}

export function canAccessModule(role: Role, module: Module): boolean {
  const modulePermissions = ROLE_PERMISSIONS[role]?.[module] || [];
  return modulePermissions.length > 0;
}

export function getAccessibleModules(role: Role): Module[] {
  return Object.entries(ROLE_PERMISSIONS[role])
    .filter(([_, permissions]) => permissions.length > 0)
    .map(([module, _]) => module as Module);
}

export function getModulePermissions(role: Role, module: Module): Permission[] {
  return ROLE_PERMISSIONS[role]?.[module] || [];
}

export function isValidRole(role: string): role is Role {
  return Object.values(Role).includes(role as Role);
}

/**
 * Retorna roles disponibles para invitar (todos excepto owner)
 */
export function getInvitableRoles(): Role[] {
  return [
    Role.ADMIN,
    Role.LOGISTICS,
    Role.CONFIRMADOR,
    Role.CONTADOR,
    Role.INVENTARIO,
    Role.COURIER
  ];
}

/**
 * Verifica si un rol puede invitar a otro rol específico
 *
 * SECURITY: Prevents horizontal privilege escalation
 * - Owners can invite any non-owner role
 * - Admins can invite team roles strictly below admin AND couriers
 * - Couriers cannot invite anyone
 * - Other roles cannot invite
 */
export function canInviteRole(currentRole: Role, targetRole: Role): boolean {
  if (targetRole === Role.OWNER) {
    return false;
  }

  if (currentRole === Role.OWNER) {
    return true;
  }

  if (currentRole === Role.ADMIN) {
    const adminInvitable: Role[] = [
      Role.LOGISTICS,
      Role.CONFIRMADOR,
      Role.CONTADOR,
      Role.INVENTARIO,
      Role.COURIER
    ];
    return adminInvitable.includes(targetRole);
  }

  return false;
}

/**
 * Mapeo de módulos a rutas del frontend
 */
export const MODULE_ROUTES: Record<Module, string> = {
  [Module.DASHBOARD]: '/dashboard',
  [Module.ORDERS]: '/orders',
  [Module.PRODUCTS]: '/products',
  [Module.WAREHOUSE]: '/warehouse',
  [Module.RETURNS]: '/returns',
  [Module.MERCHANDISE]: '/merchandise',
  [Module.CUSTOMERS]: '/customers',
  [Module.SUPPLIERS]: '/suppliers',
  [Module.CARRIERS]: '/carriers',
  [Module.CAMPAIGNS]: '/campaigns',
  [Module.ANALYTICS]: '/dashboard',
  [Module.SETTINGS]: '/settings',
  [Module.TEAM]: '/settings?tab=team',
  [Module.BILLING]: '/settings?tab=billing',
  [Module.INTEGRATIONS]: '/integrations',
  [Module.INVOICING]: '/facturacion',
  [Module.COURIER_PORTAL]: '/portal'
};
