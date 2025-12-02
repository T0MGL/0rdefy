import { NavLink } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
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
  PackageX,
  RotateCcw,
} from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

interface MenuItem {
  path: string;
  label: string;
  icon: any;
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
      { path: '/', label: 'Dashboard General', icon: Activity },
      { path: '/dashboard-logistics', label: 'Dashboard Logístico', icon: PackageCheck },
    ],
  },
  {
    label: 'Ventas',
    icon: ShoppingBag,
    items: [
      { path: '/orders', label: 'Pedidos', icon: ShoppingCart },
      { path: '/returns', label: 'Devoluciones', icon: RotateCcw },
      { path: '/customers', label: 'Clientes', icon: UserCircle },
      { path: '/ads', label: 'Anuncios', icon: Megaphone },
    ],
  },
  {
    label: 'Logística',
    icon: Truck,
    items: [
      { path: '/warehouse', label: 'Almacén', icon: Warehouse },
      { path: '/merchandise', label: 'Mercadería', icon: PackageOpen },
      { path: '/carriers', label: 'Transportadoras', icon: Truck },
      { path: '/settlements', label: 'Conciliaciones', icon: DollarSign },
    ],
  },
  {
    label: 'Inventario',
    icon: Store,
    items: [
      { path: '/products', label: 'Productos', icon: Package },
      { path: '/inventory', label: 'Movimientos', icon: ClipboardList },
      { path: '/suppliers', label: 'Proveedores', icon: Users },
    ],
  },
  {
    label: 'Gestión',
    icon: Settings2,
    items: [
      { path: '/additional-values', label: 'Valores Adicionales', icon: PlusCircle },
      { path: '/integrations', label: 'Integraciones', icon: Link2 },
      { path: '/support', label: 'Soporte', icon: HelpCircle },
    ],
  },
];

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const [expandedSections, setExpandedSections] = useState<string[]>(['Dashboards', 'Ventas', 'Logística']);

  const toggleSection = (sectionLabel: string) => {
    setExpandedSections(prev =>
      prev.includes(sectionLabel)
        ? prev.filter(s => s !== sectionLabel)
        : [...prev, sectionLabel]
    );
  };

  if (collapsed) {
    // Collapsed view - show flat list of all items with icons only
    const allItems = menuSections.flatMap(section => section.items);

    return (
      <motion.aside
        initial={false}
        animate={{ width: 80 }}
        className="h-screen bg-sidebar border-r border-sidebar-border flex flex-col sticky top-0 overflow-hidden"
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-center px-4 border-b border-sidebar-border">
          <img
            src="/favicon.ico"
            alt="Ordefy Logo"
            className="w-12 h-12 object-contain cursor-pointer"
            onClick={onToggle}
            title="Expandir sidebar"
          />
        </div>

        {/* Navigation - Flat list when collapsed */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {allItems.map((item) => {
            const Icon = item.icon;
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
              >
                <Icon size={18} className="flex-shrink-0" />
              </NavLink>
            );
          })}
        </nav>

        {/* Expand button at bottom */}
        <div className="p-3 border-t border-sidebar-border">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className="w-full text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
            title="Expandir sidebar"
          >
            <ChevronRight size={20} />
          </Button>
        </div>
      </motion.aside>
    );
  }

  return (
    <motion.aside
      initial={false}
      animate={{ width: 280 }}
      className="h-screen bg-sidebar border-r border-sidebar-border flex flex-col sticky top-0 overflow-hidden"
    >
      {/* Logo */}
      <div className="h-16 flex items-center justify-center px-4 border-b border-sidebar-border relative">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-3 flex-1"
        >
          <img
            src="/favicon.ico"
            alt="Ordefy Logo"
            className="w-10 h-10 object-contain"
          />
          <span className="font-bold text-xl text-sidebar-foreground">Ordefy</span>
        </motion.div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className="text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <ChevronLeft size={20} />
        </Button>
      </div>

      {/* Navigation - Grouped sections */}
      <nav className="flex-1 p-3 space-y-2 overflow-y-auto">
        {menuSections.map((section) => {
          const SectionIcon = section.icon;
          const isExpanded = expandedSections.includes(section.label);

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
                <span className="flex-1 text-left">{section.label}</span>
                <ChevronDown
                  size={14}
                  className={cn(
                    'transition-transform duration-200',
                    isExpanded ? 'rotate-180' : ''
                  )}
                />
              </button>

              {/* Section Items */}
              <AnimatePresence initial={false}>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden space-y-0.5 pl-2"
                  >
                    {section.items.map((item) => {
                      const Icon = item.icon;
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
                        >
                          <Icon size={16} className="flex-shrink-0" />
                          <span className="text-sm">{item.label}</span>
                        </NavLink>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </nav>
    </motion.aside>
  );
}
