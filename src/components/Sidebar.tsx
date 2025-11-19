import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Megaphone,
  PlusCircle,
  Link2,
  Users,
  UserCircle,
  Truck,
  FileText,
  DollarSign,
  HelpCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { cn } from '@/lib/utils';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const menuItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/orders', label: 'Pedidos', icon: ShoppingCart },
  { path: '/products', label: 'Productos', icon: Package },
  { path: '/customers', label: 'Clientes', icon: UserCircle },
  { path: '/ads', label: 'Anuncios', icon: Megaphone },
  { path: '/additional-values', label: 'Valores Adicionales', icon: PlusCircle },
  { path: '/integrations', label: 'Integraciones', icon: Link2 },
  { path: '/suppliers', label: 'Proveedores', icon: Users },
  { path: '/carriers', label: 'Transportadoras', icon: Truck },
  { path: '/settlements', label: 'Conciliaciones', icon: DollarSign },
  { path: '/support', label: 'Soporte', icon: HelpCircle },
];

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 80 : 280 }}
      className="h-screen bg-sidebar border-r border-sidebar-border flex flex-col sticky top-0 overflow-hidden"
    >
      {/* Logo */}
      <div className="h-16 flex items-center justify-center px-4 border-b border-sidebar-border relative">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <img
              src="/favicon.ico"
              alt="Ordefy Logo"
              className="w-12 h-12 object-contain cursor-pointer"
              onClick={onToggle}
              title="Expandir sidebar"
            />
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200',
                  'hover:bg-sidebar-accent',
                  isActive
                    ? 'bg-sidebar-accent text-primary font-medium'
                    : 'text-sidebar-foreground/80 hover:text-sidebar-foreground',
                  collapsed && 'justify-center px-2'
                )
              }
              title={collapsed ? item.label : undefined}
            >
              <Icon size={18} className="flex-shrink-0" />
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-center gap-2 flex-1 text-sm"
                >
                  {item.label}
                  {item.badge && (
                    <Badge 
                      className="text-[10px] ml-auto bg-primary/20 text-primary border-primary/30 px-1.5 py-0"
                    >
                      {item.badge}
                    </Badge>
                  )}
                </motion.span>
              )}
            </NavLink>
          );
        })}
      </nav>
    </motion.aside>
  );
}
