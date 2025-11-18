import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { generateNotifications } from '@/utils/notificationEngine';
import { generateAlerts } from '@/utils/alertEngine';
import { useAuth } from '@/contexts/AuthContext';
import { Bell, ChevronDown, Calendar, AlertTriangle } from 'lucide-react';
import { Button } from './ui/button';
import { GlobalSearch } from './GlobalSearch';
import { ordersService } from '@/services/orders.service';
import { productsService } from '@/services/products.service';
import { adsService } from '@/services/ads.service';
import { carriersService } from '@/services/carriers.service';
import { analyticsService } from '@/services/analytics.service';
import type { Order, Product, Ad, DashboardOverview } from '@/types';
import type { Carrier } from '@/services/carriers.service';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { cn } from '@/lib/utils';
import { AlertsPanel } from './AlertsPanel';
import { StoreSwitcher } from './StoreSwitcher';

const dateRanges = [
  { label: 'Hoy', value: 'today' },
  { label: '7 días', value: '7d' },
  { label: '30 días', value: '30d' },
  { label: 'Personalizado', value: 'custom' },
];

const breadcrumbMap: Record<string, string> = {
  '/': 'Dashboard',
  '/orders': 'Pedidos',
  '/products': 'Productos',
  '/ads': 'Anuncios',
  '/additional-values': 'Valores Adicionales',
  '/integrations': 'Integraciones',
  '/suppliers': 'Proveedores',
  '/carriers': 'Transportadoras',
  '/billing': 'Facturación',
  '/support': 'Soporte',
  '/settings': 'Configuración',
};

export function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const [selectedRange, setSelectedRange] = useState('7d');
  const [notifOpen, setNotifOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [profileImage, setProfileImage] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);

  const currentPage = breadcrumbMap[location.pathname] || 'Dashboard';

  // Load data for notifications and alerts
  useEffect(() => {
    const loadData = async () => {
      try {
        const [ordersData, productsData, adsData, carriersData, overviewData] = await Promise.all([
          ordersService.getAll(),
          productsService.getAll(),
          adsService.getAll(),
          carriersService.getAll(),
          analyticsService.getOverview(),
        ]);
        setOrders(ordersData);
        setProducts(productsData);
        setAds(adsData);
        setCarriers(carriersData);
        setOverview(overviewData);
      } catch (error) {
        console.error('Error loading header data:', error);
      }
    };
    loadData();
  }, []);

  const notifications = overview
    ? generateNotifications({ orders, products, ads, carriers })
    : [];
  const unreadCount = notifications.filter(n => !n.read).length;

  const alerts = overview
    ? generateAlerts({ orders, overview, carriers })
    : [];
  const criticalAlerts = alerts.filter(a => a.severity === 'critical').length;

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <header className="h-16 border-b border-border bg-card sticky top-0 z-40 shadow-sm">
      <div className="h-full px-6 flex items-center justify-between">
        {/* Welcome Message */}
        <div>
          <h1 className="text-2xl font-bold text-card-foreground">
            Hola, {user?.name || user?.email?.split('@')[0] || 'Usuario'}! 👋
          </h1>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          {/* Store Switcher */}
          <StoreSwitcher />

          {/* Global Search */}
          <GlobalSearch />

          {/* Date Selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 h-9 px-3 bg-card">
                <Calendar size={16} className="text-muted-foreground" />
                <span className="text-sm">
                  {dateRanges.find((r) => r.value === selectedRange)?.label}
                </span>
                <ChevronDown size={14} className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {dateRanges.map((range) => (
                <DropdownMenuItem
                  key={range.value}
                  onClick={() => setSelectedRange(range.value)}
                  className={cn(
                    'cursor-pointer',
                    selectedRange === range.value && 'bg-primary/10 text-primary font-medium'
                  )}
                >
                  {range.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          
          {/* Alerts */}
          <Button 
            variant="ghost" 
            size="icon" 
            className="relative h-9 w-9"
            onClick={() => setAlertsOpen(true)}
          >
            <AlertTriangle size={18} className="text-muted-foreground" />
            {criticalAlerts > 0 && (
              <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-[10px] bg-red-600 border-2 border-card">
                {criticalAlerts}
              </Badge>
            )}
          </Button>

          {/* Notifications */}
          <DropdownMenu open={notifOpen} onOpenChange={setNotifOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative h-9 w-9">
                <Bell size={18} className="text-muted-foreground" />
                {unreadCount > 0 && (
                  <Badge className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-[10px] bg-destructive border-2 border-card">
                    {unreadCount}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>Notificaciones</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="max-h-96 overflow-y-auto">
                {notifications.map((notif) => (
                  <DropdownMenuItem 
                    key={notif.id}
                    className="cursor-pointer flex-col items-start p-3"
                    onClick={() => {
                      if (notif.actionUrl) navigate(notif.actionUrl);
                      setNotifOpen(false);
                    }}
                  >
                    <p className="text-sm font-medium">{notif.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(notif.timestamp).toLocaleString('es-ES')}
                    </p>
                  </DropdownMenuItem>
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 pl-1 pr-3 h-9">
                <Avatar className="h-7 w-7">
                  {profileImage ? (
                    <AvatarImage src={profileImage} alt="Profile" />
                  ) : (
                    <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
                      {user?.user_metadata?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
                    </AvatarFallback>
                  )}
                </Avatar>
                <ChevronDown size={14} className="text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Mi Cuenta</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => navigate('/settings?tab=profile')}
              >
                Perfil
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => navigate('/settings?tab=billing')}
              >
                Facturación
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => navigate('/settings?tab=preferences')}
              >
                Preferencias
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive cursor-pointer"
                onClick={handleSignOut}
              >
                Cerrar Sesión
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <AlertsPanel open={alertsOpen} onOpenChange={setAlertsOpen} initialAlerts={alerts} />
    </header>
  );
}
