import { useState, useMemo, useCallback } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  ShoppingCart,
  Warehouse,
  RotateCcw,
  UserCircle,
  Package,
  PackageOpen,
  Users,
  Megaphone,
  MoreHorizontal,
  X,
  Truck,
  DollarSign,
  Link2,
  HelpCircle,
  Send,
  ClipboardList,
  BarChart3,
  PackageCheck,
  PlusCircle,
  ChevronRight,
  Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth, Module, Role } from '@/contexts/AuthContext';
import { useSubscription, PATH_TO_FEATURE, PlanFeature } from '@/contexts/SubscriptionContext';
import { useUpgradeModal } from '@/components/UpgradeModal';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from './ui/sheet';

// ================================================================
// Types
// ================================================================
interface NavItem {
  path: string;
  label: string;
  icon: any;
  module?: Module;
}

interface RoleTabConfig {
  tabs: NavItem[];
  moreItems: NavItem[];
}

// ================================================================
// Navigation Configuration by Role
// ================================================================

// All possible navigation items (mirroring Sidebar)
const ALL_NAV_ITEMS: NavItem[] = [
  // Dashboards
  { path: '/', label: 'Dashboard', icon: Activity, module: Module.DASHBOARD },
  { path: '/dashboard-logistics', label: 'Dashboard Logístico', icon: PackageCheck, module: Module.WAREHOUSE },
  { path: '/logistics', label: 'Costos de Envío', icon: BarChart3, module: Module.ANALYTICS },
  // Ventas
  { path: '/orders', label: 'Pedidos', icon: ShoppingCart, module: Module.ORDERS },
  { path: '/returns', label: 'Devoluciones', icon: RotateCcw, module: Module.RETURNS },
  { path: '/customers', label: 'Clientes', icon: UserCircle, module: Module.CUSTOMERS },
  { path: '/ads', label: 'Anuncios', icon: Megaphone, module: Module.CAMPAIGNS },
  // Logística
  { path: '/warehouse', label: 'Almacén', icon: Warehouse, module: Module.WAREHOUSE },
  { path: '/shipping', label: 'Despacho', icon: Send, module: Module.WAREHOUSE },
  { path: '/merchandise', label: 'Mercadería', icon: PackageOpen, module: Module.MERCHANDISE },
  { path: '/carriers', label: 'Transportadoras', icon: Truck, module: Module.CARRIERS },
  { path: '/settlements', label: 'Conciliaciones', icon: DollarSign, module: Module.CARRIERS },
  // Inventario
  { path: '/products', label: 'Productos', icon: Package, module: Module.PRODUCTS },
  { path: '/inventory', label: 'Movimientos', icon: ClipboardList, module: Module.PRODUCTS },
  { path: '/suppliers', label: 'Proveedores', icon: Users, module: Module.SUPPLIERS },
  // Gestión
  { path: '/additional-values', label: 'Valores Adicionales', icon: PlusCircle, module: Module.ANALYTICS },
  { path: '/integrations', label: 'Integraciones', icon: Link2, module: Module.INTEGRATIONS },
  { path: '/support', label: 'Soporte', icon: HelpCircle },
];

// Role-specific tab configurations
// Each role gets 3 main tabs + "Más" button
const ROLE_TAB_CONFIGS: Record<Role, { mainTabs: string[] }> = {
  [Role.OWNER]: {
    mainTabs: ['/', '/orders', '/warehouse'],
  },
  [Role.ADMIN]: {
    mainTabs: ['/', '/orders', '/warehouse'],
  },
  [Role.LOGISTICS]: {
    mainTabs: ['/warehouse', '/orders', '/returns'],
  },
  [Role.CONFIRMADOR]: {
    mainTabs: ['/orders', '/customers', '/'],
  },
  [Role.CONTADOR]: {
    mainTabs: ['/', '/orders', '/ads'],
  },
  [Role.INVENTARIO]: {
    mainTabs: ['/products', '/merchandise', '/suppliers'],
  },
};

// Sub-routes that should highlight a parent tab in the bottom nav
// Maps child routes to the nav item path that should be "active"
const ROUTE_PARENT_MAP: Record<string, string> = {
  // Orders sub-routes
  '/incidents': '/orders',
  // Warehouse sub-routes
  '/shipping': '/warehouse',
  '/dashboard-logistics': '/warehouse',
  // Carriers sub-routes
  '/courier-performance': '/carriers',
  '/carriers/compare': '/carriers',
  // Products sub-routes
  '/inventory': '/products',
};

// Check if a given pathname matches a nav item path
function isPathActive(pathname: string, itemPath: string): boolean {
  if (itemPath === '/') {
    return pathname === '/';
  }
  // Direct match or sub-route match
  if (pathname === itemPath || pathname.startsWith(itemPath + '/')) {
    return true;
  }
  // Check parent mapping (e.g., /incidents → /orders)
  const parentPath = ROUTE_PARENT_MAP[pathname];
  if (parentPath === itemPath) {
    return true;
  }
  // Check if a parent mapping entry startsWith the pathname
  // (handles dynamic routes like /carriers/123)
  for (const [route, parent] of Object.entries(ROUTE_PARENT_MAP)) {
    if (pathname.startsWith(route) && parent === itemPath) {
      return true;
    }
  }
  return false;
}

// ================================================================
// Component
// ================================================================
export function MobileBottomNav() {
  const [sheetOpen, setSheetOpen] = useState(false);
  const location = useLocation();
  const { permissions } = useAuth();
  const { hasFeatureByPath, loading: subscriptionLoading } = useSubscription();
  const { openModal, UpgradeModalComponent } = useUpgradeModal();

  const currentRole = permissions.currentRole;

  // Check if a path is locked by subscription plan
  const isPathLocked = (path: string): boolean => {
    if (subscriptionLoading) return false;
    return !hasFeatureByPath(path);
  };

  // Get feature for upgrade modal
  const getFeatureForPath = (path: string): PlanFeature | undefined => {
    return PATH_TO_FEATURE[path];
  };

  // Filter items based on permissions
  const filterByPermissions = useCallback((items: NavItem[]): NavItem[] => {
    return items.filter(item => {
      if (!item.module) return true; // No module = always visible (e.g., Support)
      return permissions.canAccessModule(item.module);
    });
  }, [permissions]);

  // Build role-specific navigation config
  const navConfig = useMemo((): RoleTabConfig => {
    if (!currentRole) {
      // Default fallback for unauthenticated or unknown roles
      return {
        tabs: [
          { path: '/', label: 'Inicio', icon: Activity },
          { path: '/orders', label: 'Pedidos', icon: ShoppingCart },
          { path: '/products', label: 'Productos', icon: Package },
        ],
        moreItems: [],
      };
    }

    const roleConfig = ROLE_TAB_CONFIGS[currentRole];
    const mainTabPaths = roleConfig.mainTabs;

    // Get main tabs (filtered by permissions)
    const mainTabs = mainTabPaths
      .map(path => ALL_NAV_ITEMS.find(item => item.path === path))
      .filter((item): item is NavItem => item !== undefined)
      .filter(item => !item.module || permissions.canAccessModule(item.module));

    // Get "more" items (everything not in main tabs, filtered by permissions)
    const moreItems = filterByPermissions(
      ALL_NAV_ITEMS.filter(item => !mainTabPaths.includes(item.path))
    );

    return { tabs: mainTabs, moreItems };
  }, [currentRole, permissions, filterByPermissions]);

  // Check if "Más" sheet has the active route
  const isMoreActive = navConfig.moreItems.some(item =>
    isPathActive(location.pathname, item.path)
  );

  // Handle locked item click
  const handleLockedClick = (path: string, label: string) => {
    const feature = getFeatureForPath(path);
    openModal(feature, label);
  };

  // Handle navigation from sheet
  const handleSheetNavigation = () => {
    setSheetOpen(false);
  };

  return (
    <>
      {/* Bottom Navigation Bar - Only visible on mobile */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 lg:hidden"
        aria-label="Navegación principal mobile"
        role="navigation"
      >
        {/* Glassmorphism background with safe area support */}
        <div className="bg-card/95 backdrop-blur-lg border-t border-border shadow-[0_-4px_20px_rgba(0,0,0,0.08)] dark:shadow-[0_-4px_20px_rgba(0,0,0,0.3)]">
          <div className="flex items-center justify-around h-16 px-2 max-w-lg mx-auto">
            {/* Main Tabs */}
            {navConfig.tabs.map((item) => {
              const Icon = item.icon;
              const isActive = isPathActive(location.pathname, item.path);
              const isLocked = isPathLocked(item.path);

              if (isLocked) {
                return (
                  <button
                    key={item.path}
                    onClick={() => handleLockedClick(item.path, item.label)}
                    className="flex flex-col items-center justify-center flex-1 h-full py-2 px-1 opacity-50 active:scale-95 transition-transform"
                  >
                    <div className="relative">
                      <Icon size={22} className="text-muted-foreground" />
                      <Lock size={10} className="absolute -top-1 -right-1 text-muted-foreground" />
                    </div>
                    <span className="text-[10px] mt-1 text-muted-foreground truncate max-w-[60px]">
                      {item.label}
                    </span>
                  </button>
                );
              }

              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className="flex flex-col items-center justify-center flex-1 h-full py-2 px-1 active:scale-95 transition-transform"
                  onClick={handleSheetNavigation}
                >
                  <motion.div
                    initial={false}
                    animate={{
                      scale: isActive ? 1.1 : 1,
                    }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    className="relative"
                  >
                    <Icon
                      size={22}
                      className={cn(
                        'transition-colors duration-200',
                        isActive ? 'text-primary' : 'text-muted-foreground'
                      )}
                    />
                    {/* Active indicator dot */}
                    <AnimatePresence>
                      {isActive && (
                        <motion.div
                          initial={{ scale: 0, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          exit={{ scale: 0, opacity: 0 }}
                          className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary"
                        />
                      )}
                    </AnimatePresence>
                  </motion.div>
                  <span
                    className={cn(
                      'text-[10px] mt-1 truncate max-w-[60px] transition-colors duration-200',
                      isActive ? 'text-primary font-medium' : 'text-muted-foreground'
                    )}
                  >
                    {item.label}
                  </span>
                </NavLink>
              );
            })}

            {/* "Más" Button */}
            {navConfig.moreItems.length > 0 && (
              <button
                onClick={() => setSheetOpen(true)}
                className="flex flex-col items-center justify-center flex-1 h-full py-2 px-1 active:scale-95 transition-transform"
                aria-label="Ver más opciones de navegación"
                aria-expanded={sheetOpen}
                aria-haspopup="dialog"
              >
                <motion.div
                  initial={false}
                  animate={{
                    scale: isMoreActive || sheetOpen ? 1.1 : 1,
                  }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  className="relative"
                >
                  <MoreHorizontal
                    size={22}
                    className={cn(
                      'transition-colors duration-200',
                      isMoreActive || sheetOpen ? 'text-primary' : 'text-muted-foreground'
                    )}
                  />
                  <AnimatePresence>
                    {(isMoreActive || sheetOpen) && (
                      <motion.div
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary"
                      />
                    )}
                  </AnimatePresence>
                </motion.div>
                <span
                  className={cn(
                    'text-[10px] mt-1 transition-colors duration-200',
                    isMoreActive || sheetOpen ? 'text-primary font-medium' : 'text-muted-foreground'
                  )}
                >
                  Más
                </span>
              </button>
            )}
          </div>

          {/* iOS safe area padding */}
          <div className="h-[env(safe-area-inset-bottom)]" />
        </div>
      </nav>

      {/* "Más" Sheet - Full navigation with native mobile feel */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          className="h-[70vh] rounded-t-3xl p-0 bg-card/98 backdrop-blur-xl [&>button.absolute]:hidden"
          aria-describedby={undefined}
        >
          {/* Drag handle indicator */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-10 h-1 bg-muted-foreground/30 rounded-full" />
          </div>
          <SheetHeader className="px-6 pb-4 border-b border-border">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-lg font-semibold">Navegación</SheetTitle>
              <button
                onClick={() => setSheetOpen(false)}
                className="p-2.5 -mr-2 rounded-full hover:bg-muted active:bg-muted/80 transition-colors"
                aria-label="Cerrar"
              >
                <X size={20} className="text-muted-foreground" />
              </button>
            </div>
          </SheetHeader>

          <div className="overflow-y-auto h-[calc(70vh-80px)] pb-[env(safe-area-inset-bottom)]">
            <div className="p-4 space-y-1">
              {navConfig.moreItems.map((item) => {
                const Icon = item.icon;
                const isActive = isPathActive(location.pathname, item.path);
                const isLocked = isPathLocked(item.path);

                if (isLocked) {
                  return (
                    <button
                      key={item.path}
                      onClick={() => {
                        handleLockedClick(item.path, item.label);
                        setSheetOpen(false);
                      }}
                      className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all opacity-50 active:scale-[0.98]"
                    >
                      <div className="relative">
                        <Icon size={22} className="text-muted-foreground" />
                        <Lock size={10} className="absolute -top-1 -right-1 text-muted-foreground" />
                      </div>
                      <span className="flex-1 text-left text-muted-foreground">{item.label}</span>
                      <Lock size={16} className="text-muted-foreground" />
                    </button>
                  );
                }

                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={handleSheetNavigation}
                    className={cn(
                      'flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all active:scale-[0.98]',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'hover:bg-muted active:bg-muted/80 text-foreground'
                    )}
                  >
                    <Icon
                      size={22}
                      className={isActive ? 'text-primary' : 'text-muted-foreground'}
                    />
                    <span className="flex-1">{item.label}</span>
                    {isActive && (
                      <div className="w-2 h-2 rounded-full bg-primary" />
                    )}
                    <ChevronRight
                      size={18}
                      className={cn(
                        'transition-colors',
                        isActive ? 'text-primary' : 'text-muted-foreground/50'
                      )}
                    />
                  </NavLink>
                );
              })}
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Upgrade Modal */}
      <UpgradeModalComponent />
    </>
  );
}
