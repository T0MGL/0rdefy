import { NavLink } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useMemo, useRef, useCallback } from 'react';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  PackageOpen,
  Megaphone,
  PlusCircle,
  Link2,
  Users,
  UserCircle,
  Truck,
  DollarSign,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
  Warehouse,
  ChevronDown,
  Activity,
  ShoppingBag,
  PackageCheck,
  Store,
  Settings2,
  ClipboardList,
  RotateCcw,
  Send,
  AlertCircle,
  Lock,
  BarChart3,
  Pin,
  PinOff,
} from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { useAuth, Module, Role } from '@/contexts/AuthContext';
import { useSubscription, PATH_TO_FEATURE, PlanFeature, FEATURE_MIN_PLAN } from '@/contexts/SubscriptionContext';
import { useUpgradeModal } from '@/components/UpgradeModal';

interface SidebarProps {
  collapsed?: boolean; // Now optional - kept for backwards compatibility but not used
  onToggle?: () => void; // Now optional - kept for backwards compatibility
}

interface MenuItem {
  path: string;
  label: string;
  icon: any;
  module?: Module; // Required module for permission check
  tourTarget?: string; // Optional tour target for spotlight highlighting
}

interface MenuSection {
  label: string;
  icon: any;
  items: MenuItem[];
}

const menuSections: MenuSection[] = [
  {
    label: 'Dashboards',
    icon: LayoutDashboard,
    items: [
      { path: '/', label: 'Dashboard General', icon: Activity, module: Module.DASHBOARD, tourTarget: 'sidebar-dashboard' },
      { path: '/dashboard-logistics', label: 'Dashboard Logístico', icon: PackageCheck, module: Module.WAREHOUSE },
      { path: '/logistics', label: 'Costos de Envío', icon: BarChart3, module: Module.ANALYTICS },
    ],
  },
  {
    label: 'Ventas',
    icon: ShoppingBag,
    items: [
      { path: '/orders', label: 'Pedidos', icon: ShoppingCart, module: Module.ORDERS, tourTarget: 'sidebar-orders' },
      { path: '/returns', label: 'Devoluciones', icon: RotateCcw, module: Module.RETURNS, tourTarget: 'sidebar-returns' },
      { path: '/incidents', label: 'Incidencias', icon: AlertCircle, module: Module.ORDERS },
      { path: '/customers', label: 'Clientes', icon: UserCircle, module: Module.CUSTOMERS, tourTarget: 'sidebar-customers' },
      { path: '/ads', label: 'Anuncios', icon: Megaphone, module: Module.CAMPAIGNS, tourTarget: 'sidebar-ads' },
    ],
  },
  {
    label: 'Logística',
    icon: Truck,
    items: [
      { path: '/warehouse', label: 'Almacén', icon: Warehouse, module: Module.WAREHOUSE, tourTarget: 'sidebar-warehouse' },
      { path: '/shipping', label: 'Despacho', icon: Send, module: Module.WAREHOUSE },
      { path: '/merchandise', label: 'Mercadería', icon: PackageOpen, module: Module.MERCHANDISE, tourTarget: 'sidebar-merchandise' },
      { path: '/carriers', label: 'Transportadoras', icon: Truck, module: Module.CARRIERS, tourTarget: 'sidebar-carriers' },
      { path: '/settlements', label: 'Conciliaciones', icon: DollarSign, module: Module.CARRIERS, tourTarget: 'sidebar-settlements' },
    ],
  },
  {
    label: 'Inventario',
    icon: Store,
    items: [
      { path: '/products', label: 'Productos', icon: Package, module: Module.PRODUCTS, tourTarget: 'sidebar-products' },
      { path: '/inventory', label: 'Movimientos', icon: ClipboardList, module: Module.PRODUCTS },
      { path: '/suppliers', label: 'Proveedores', icon: Users, module: Module.SUPPLIERS, tourTarget: 'sidebar-suppliers' },
    ],
  },
  {
    label: 'Gestión',
    icon: Settings2,
    items: [
      { path: '/additional-values', label: 'Valores Adicionales', icon: PlusCircle, module: Module.ANALYTICS },
      { path: '/integrations', label: 'Integraciones', icon: Link2, module: Module.INTEGRATIONS, tourTarget: 'sidebar-integrations' },
      { path: '/support', label: 'Soporte', icon: HelpCircle }, // No module required - always visible
    ],
  },
];

// Constants for sidebar dimensions
const SIDEBAR_COLLAPSED_WIDTH = 80;
const SIDEBAR_EXPANDED_WIDTH = 280;
const HOVER_DELAY_MS = 200; // Delay before collapsing on mouse leave

export function Sidebar({ collapsed: _collapsed, onToggle: _onToggle }: SidebarProps) {
  // Hover-based expansion state (replaces prop-based collapsed state)
  const [isHovering, setIsHovering] = useState(false);
  const [isPinned, setIsPinned] = useState(false); // Allow users to pin sidebar open
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [expandedSections, setExpandedSections] = useState<string[]>(['Dashboards', 'Ventas', 'Logística']);
  const { permissions } = useAuth();
  const { hasFeatureByPath, shouldShowLockedFeatures, loading: subscriptionLoading } = useSubscription();
  const { openModal, UpgradeModalComponent } = useUpgradeModal();

  // Sidebar is expanded when hovering OR pinned
  const isExpanded = isHovering || isPinned;

  // Handle mouse enter - expand immediately
  const handleMouseEnter = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovering(true);
  }, []);

  // Handle mouse leave - collapse with delay for smoother UX
  const handleMouseLeave = useCallback(() => {
    if (isPinned) return; // Don't collapse if pinned

    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovering(false);
    }, HOVER_DELAY_MS);
  }, [isPinned]);

  // Toggle pin state
  const togglePin = useCallback(() => {
    setIsPinned(prev => !prev);
    if (!isPinned) {
      setIsHovering(true); // Keep expanded when pinning
    }
  }, [isPinned]);

  const toggleSection = (sectionLabel: string) => {
    setExpandedSections(prev =>
      prev.includes(sectionLabel)
        ? prev.filter(s => s !== sectionLabel)
        : [...prev, sectionLabel]
    );
  };

  // Check if a menu item is locked by plan
  const isItemLocked = (path: string): boolean => {
    if (subscriptionLoading) return false;
    return !hasFeatureByPath(path);
  };

  // Get the feature for a path (for the upgrade modal)
  const getFeatureForPath = (path: string): PlanFeature | undefined => {
    return PATH_TO_FEATURE[path];
  };

  // Filter menu sections based on user permissions AND plan features
  const filteredMenuSections = useMemo(() => {
    const isOwner = permissions.currentRole === Role.OWNER;

    return menuSections
      .map(section => ({
        ...section,
        items: section.items.filter(item => {
          // If no module specified, item is always visible (e.g., Support)
          if (!item.module) return true;

          // Check RBAC permission first
          const hasRbacAccess = permissions.canAccessModule(item.module);

          // For non-owners (collaborators): only show items they have RBAC access to
          if (!isOwner) {
            return hasRbacAccess;
          }

          // For owners: show all items they have RBAC access to
          // Locked items will be shown with lock icon (handled in render)
          return hasRbacAccess;
        })
      }))
      // Remove sections with no visible items
      .filter(section => section.items.length > 0);
  }, [permissions]);

  // Flat list of all items for collapsed view
  const allItems = filteredMenuSections.flatMap(section => section.items);

  return (
    // Outer container - ALWAYS takes 80px in the flex flow (never changes)
    <div
      className="flex-shrink-0 relative"
      style={{ width: SIDEBAR_COLLAPSED_WIDTH }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Actual sidebar - positioned absolutely when expanded to overlay content */}
      <motion.aside
        initial={false}
        animate={{
          width: isExpanded ? SIDEBAR_EXPANDED_WIDTH : SIDEBAR_COLLAPSED_WIDTH
        }}
        transition={{
          duration: 0.2,
          ease: 'easeOut'
        }}
        className={cn(
          'h-screen bg-sidebar border-r border-sidebar-border flex flex-col fixed top-0 left-0 overflow-hidden',
          'z-40', // Ensure sidebar is above content
          isExpanded && 'shadow-2xl shadow-black/20' // Add shadow when expanded
        )}
      >
        {/* Logo */}
        <div className="h-16 flex items-center border-b border-sidebar-border shrink-0">
          {/* Collapsed: centered logo */}
          {!isExpanded && (
            <div className="w-full flex items-center justify-center">
              <img
                src="/favicon.ico"
                alt="Ordefy Logo"
                className="w-10 h-10 object-contain"
              />
            </div>
          )}

          {/* Expanded: logo + name + pin button */}
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
              className="w-full flex items-center justify-between px-4"
            >
              <div className="flex items-center gap-3">
                <img
                  src="/favicon.ico"
                  alt="Ordefy Logo"
                  className="w-10 h-10 object-contain flex-shrink-0"
                />
                <span className="font-bold text-xl text-sidebar-foreground">
                  Ordefy
                </span>
              </div>

              {/* Pin button */}
              <Button
                variant="ghost"
                size="icon"
                onClick={togglePin}
                className={cn(
                  'h-8 w-8 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent flex-shrink-0',
                  isPinned && 'text-primary bg-sidebar-accent'
                )}
                title={isPinned ? 'Desfijar sidebar' : 'Fijar sidebar abierto'}
              >
                {isPinned ? <PinOff size={16} /> : <Pin size={16} />}
              </Button>
            </motion.div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto overflow-x-hidden">
          {/* Collapsed view - flat icon list */}
          {!isExpanded && (
            <>
              {allItems.map((item) => {
                const Icon = item.icon;
                const locked = isItemLocked(item.path);

                if (locked) {
                  return (
                    <button
                      key={item.path}
                      onClick={() => openModal(getFeatureForPath(item.path), item.label)}
                      className={cn(
                        'w-full flex items-center justify-center px-2 py-2.5 rounded-lg transition-all duration-200',
                        'hover:bg-sidebar-accent/50 cursor-pointer',
                        'text-sidebar-foreground/40 opacity-50'
                      )}
                      title={`${item.label} (Requiere upgrade)`}
                    >
                      <div className="relative">
                        <Icon size={18} className="flex-shrink-0" />
                        <Lock size={10} className="absolute -top-1 -right-1 text-sidebar-foreground/60" />
                      </div>
                    </button>
                  );
                }

                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === '/'}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center justify-center px-2 py-2.5 rounded-lg transition-all duration-200',
                        'hover:bg-sidebar-accent',
                        isActive
                          ? 'bg-sidebar-accent text-primary font-medium'
                          : 'text-sidebar-foreground/80 hover:text-sidebar-foreground'
                      )
                    }
                    title={item.label}
                    {...(item.tourTarget && { 'data-tour-target': item.tourTarget })}
                  >
                    <Icon size={18} className="flex-shrink-0" />
                  </NavLink>
                );
              })}
            </>
          )}

          {/* Expanded view - grouped sections */}
          {isExpanded && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15, delay: 0.05 }}
              className="space-y-2"
            >
              {filteredMenuSections.map((section) => {
                const SectionIcon = section.icon;
                const isSectionExpanded = expandedSections.includes(section.label);

                return (
                  <div key={section.label} className="space-y-1">
                    {/* Section Header */}
                    <button
                      onClick={() => toggleSection(section.label)}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200',
                        'hover:bg-sidebar-accent text-sidebar-foreground/90 hover:text-sidebar-foreground',
                        'text-xs font-semibold uppercase tracking-wider'
                      )}
                    >
                      <SectionIcon size={14} className="flex-shrink-0" />
                      <span className="flex-1 text-left whitespace-nowrap">{section.label}</span>
                      <ChevronDown
                        size={14}
                        className={cn(
                          'transition-transform duration-200',
                          isSectionExpanded ? 'rotate-180' : ''
                        )}
                      />
                    </button>

                    {/* Section Items */}
                    <AnimatePresence initial={false}>
                      {isSectionExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden space-y-0.5 pl-2"
                        >
                          {section.items.map((item) => {
                            const Icon = item.icon;
                            const locked = isItemLocked(item.path);

                            if (locked) {
                              return (
                                <button
                                  key={item.path}
                                  onClick={() => openModal(getFeatureForPath(item.path), item.label)}
                                  className={cn(
                                    'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200',
                                    'hover:bg-sidebar-accent/50 cursor-pointer',
                                    'text-sidebar-foreground/40 opacity-50'
                                  )}
                                >
                                  <div className="relative">
                                    <Icon size={16} className="flex-shrink-0" />
                                    <Lock size={8} className="absolute -top-0.5 -right-0.5 text-sidebar-foreground/60" />
                                  </div>
                                  <span className="text-sm flex-1 text-left whitespace-nowrap">{item.label}</span>
                                  <Lock size={12} className="text-sidebar-foreground/40" />
                                </button>
                              );
                            }

                            return (
                              <NavLink
                                key={item.path}
                                to={item.path}
                                end={item.path === '/'}
                                className={({ isActive }) =>
                                  cn(
                                    'flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200',
                                    'hover:bg-sidebar-accent',
                                    isActive
                                      ? 'bg-sidebar-accent text-primary font-medium'
                                      : 'text-sidebar-foreground/80 hover:text-sidebar-foreground'
                                  )
                                }
                                {...(item.tourTarget && { 'data-tour-target': item.tourTarget })}
                              >
                                <Icon size={16} className="flex-shrink-0" />
                                <span className="text-sm whitespace-nowrap">{item.label}</span>
                              </NavLink>
                            );
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </motion.div>
          )}
        </nav>

        {/* Upgrade Modal */}
        <UpgradeModalComponent />

        {/* Pin indicator at bottom when collapsed */}
        {!isExpanded && isPinned && (
          <div className="p-3 border-t border-sidebar-border">
            <Button
              variant="ghost"
              size="icon"
              onClick={togglePin}
              className="w-full text-primary hover:text-primary hover:bg-sidebar-accent"
              title="Sidebar fijado - click para desfijar"
            >
              <PinOff size={18} />
            </Button>
          </div>
        )}
      </motion.aside>
    </div>
  );
}
