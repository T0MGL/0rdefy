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
  INVENTARIO = 'inventario'
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
  INTEGRATIONS = 'integrations'
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
    // Owner tiene acceso completo a todo
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
  },

  [Role.ADMIN]: {
    // Admin: todo excepto billing y team management
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
    [Module.TEAM]: [], // Sin acceso
    [Module.BILLING]: [], // Sin acceso
    [Module.INTEGRATIONS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
  },

  [Role.LOGISTICS]: {
    // Logística: Warehouse, Returns, Carriers, Orders (solo vista)
    [Module.DASHBOARD]: [Permission.VIEW],
    [Module.ORDERS]: [Permission.VIEW], // Solo lectura
    [Module.PRODUCTS]: [], // Sin acceso
    [Module.WAREHOUSE]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.RETURNS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.MERCHANDISE]: [], // Sin acceso
    [Module.CUSTOMERS]: [], // Sin acceso
    [Module.SUPPLIERS]: [], // Sin acceso
    [Module.CARRIERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CAMPAIGNS]: [], // Sin acceso
    [Module.ANALYTICS]: [], // Sin acceso
    [Module.SETTINGS]: [], // Sin acceso
    [Module.TEAM]: [], // Sin acceso
    [Module.BILLING]: [], // Sin acceso
    [Module.INTEGRATIONS]: [], // Sin acceso
  },

  [Role.CONFIRMADOR]: {
    // Confirmadores: Orders, Customers
    [Module.DASHBOARD]: [Permission.VIEW],
    [Module.ORDERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT], // No delete
    [Module.PRODUCTS]: [], // Sin acceso
    [Module.WAREHOUSE]: [], // Sin acceso
    [Module.RETURNS]: [], // Sin acceso
    [Module.MERCHANDISE]: [], // Sin acceso
    [Module.CUSTOMERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT],
    [Module.SUPPLIERS]: [], // Sin acceso
    [Module.CARRIERS]: [Permission.VIEW], // Solo vista para asignar carrier
    [Module.CAMPAIGNS]: [], // Sin acceso
    [Module.ANALYTICS]: [], // Sin acceso
    [Module.SETTINGS]: [], // Sin acceso
    [Module.TEAM]: [], // Sin acceso
    [Module.BILLING]: [], // Sin acceso
    [Module.INTEGRATIONS]: [], // Sin acceso
  },

  [Role.CONTADOR]: {
    // Contador: Analytics, Campaigns (vista), Orders/Products (solo lectura)
    [Module.DASHBOARD]: [Permission.VIEW],
    [Module.ORDERS]: [Permission.VIEW], // Solo lectura
    [Module.PRODUCTS]: [Permission.VIEW], // Solo lectura (ver costos)
    [Module.WAREHOUSE]: [], // Sin acceso
    [Module.RETURNS]: [], // Sin acceso
    [Module.MERCHANDISE]: [], // Sin acceso
    [Module.CUSTOMERS]: [Permission.VIEW], // Solo lectura
    [Module.SUPPLIERS]: [], // Sin acceso
    [Module.CARRIERS]: [], // Sin acceso
    [Module.CAMPAIGNS]: [Permission.VIEW], // Solo lectura (ver inversión)
    [Module.ANALYTICS]: [Permission.VIEW], // Acceso completo a reportes
    [Module.SETTINGS]: [], // Sin acceso
    [Module.TEAM]: [], // Sin acceso
    [Module.BILLING]: [], // Sin acceso
    [Module.INTEGRATIONS]: [], // Sin acceso
  },

  [Role.INVENTARIO]: {
    // Inventario: Products, Merchandise, Suppliers
    [Module.DASHBOARD]: [Permission.VIEW],
    [Module.ORDERS]: [], // Sin acceso
    [Module.PRODUCTS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.WAREHOUSE]: [], // Sin acceso
    [Module.RETURNS]: [], // Sin acceso
    [Module.MERCHANDISE]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CUSTOMERS]: [], // Sin acceso
    [Module.SUPPLIERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CARRIERS]: [], // Sin acceso
    [Module.CAMPAIGNS]: [], // Sin acceso
    [Module.ANALYTICS]: [], // Sin acceso
    [Module.SETTINGS]: [], // Sin acceso
    [Module.TEAM]: [], // Sin acceso
    [Module.BILLING]: [], // Sin acceso
    [Module.INTEGRATIONS]: [], // Sin acceso
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
  [Role.INVENTARIO]: 'Inventario'
};

/**
 * Descripciones de los roles
 */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  [Role.OWNER]: 'Acceso total a todos los módulos, team management y billing',
  [Role.ADMIN]: 'Acceso completo excepto team management y billing',
  [Role.LOGISTICS]: 'Gestión de warehouse, returns, carriers y vista de orders',
  [Role.CONFIRMADOR]: 'Confirmación de órdenes y gestión de customers',
  [Role.CONTADOR]: 'Acceso a analytics, reportes y vista de campaigns',
  [Role.INVENTARIO]: 'Gestión de products, merchandise y suppliers'
};

/**
 * Helper Functions
 */

/**
 * Verifica si un rol tiene un permiso específico en un módulo
 */
export function hasPermission(
  role: Role,
  module: Module,
  permission: Permission
): boolean {
  const modulePermissions = ROLE_PERMISSIONS[role]?.[module] || [];
  return modulePermissions.includes(permission);
}

/**
 * Verifica si un rol puede acceder a un módulo (tiene al menos un permiso)
 */
export function canAccessModule(role: Role, module: Module): boolean {
  const modulePermissions = ROLE_PERMISSIONS[role]?.[module] || [];
  return modulePermissions.length > 0;
}

/**
 * Retorna todos los módulos accesibles para un rol
 */
export function getAccessibleModules(role: Role): Module[] {
  return Object.entries(ROLE_PERMISSIONS[role])
    .filter(([_, permissions]) => permissions.length > 0)
    .map(([module, _]) => module as Module);
}

/**
 * Retorna todos los permisos que tiene un rol en un módulo específico
 */
export function getModulePermissions(role: Role, module: Module): Permission[] {
  return ROLE_PERMISSIONS[role]?.[module] || [];
}

/**
 * Verifica si un rol es válido
 */
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
    Role.INVENTARIO
  ];
}

/**
 * Verifica si un rol puede invitar a otro rol específico
 */
export function canInviteRole(currentRole: Role, targetRole: Role): boolean {
  // Solo owners pueden invitar a cualquiera
  if (currentRole === Role.OWNER) {
    return true;
  }

  // Admins no pueden invitar a owners
  if (currentRole === Role.ADMIN && targetRole === Role.OWNER) {
    return false;
  }

  // Admins pueden invitar a todos los demás roles
  return currentRole === Role.ADMIN;
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
  [Module.ANALYTICS]: '/dashboard', // Analytics está en dashboard
  [Module.SETTINGS]: '/settings',
  [Module.TEAM]: '/settings?tab=team',
  [Module.BILLING]: '/settings?tab=billing',
  [Module.INTEGRATIONS]: '/integrations'
};
