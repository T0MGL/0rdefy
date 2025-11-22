import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { generateAlerts } from '@/utils/alertEngine';
import { useAuth } from '@/contexts/AuthContext';
import { useDateRange } from '@/contexts/DateRangeContext';
import { Bell, ChevronDown, Calendar } from 'lucide-react';
import { Button } from './ui/button';
import { GlobalSearch } from './GlobalSearch';
import { ordersService } from '@/services/orders.service';
import { productsService } from '@/services/products.service';
import { adsService } from '@/services/ads.service';
import { carriersService } from '@/services/carriers.service';
import { analyticsService } from '@/services/analytics.service';
import { notificationsService } from '@/services/notifications.service';
import type { Order, Product, Ad, DashboardOverview } from '@/types';
import type { Carrier } from '@/services/carriers.service';
import type { Notification } from '@/types/notification';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './ui/popover';
import { Calendar as CalendarComponent } from './ui/calendar';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { Badge } from './ui/badge';
import { cn } from '@/lib/utils';
import { StoreSwitcher } from './StoreSwitcher';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

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
  const { selectedRange, setSelectedRange, customRange, setCustomRange } = useDateRange();
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileImage, setProfileImage] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showCalendar, setShowCalendar] = useState(false);
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();

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

        // Update notifications service with new data
        notificationsService.updateNotifications({
          orders: ordersData,
          products: productsData,
          ads: adsData,
          carriers: carriersData,
        });

        // Get updated notifications
        setNotifications(notificationsService.getAll());
        setUnreadCount(notificationsService.getUnreadCount());
      } catch (error) {
        console.error('Error loading header data:', error);
      }
    };
    loadData();

    // Refresh data every 30 seconds
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  const alerts = overview
    ? generateAlerts({ orders, overview, carriers })
    : [];
  const criticalAlerts = alerts.filter(a => a.severity === 'critical').length;

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  // Mark all notifications as read when dropdown opens
  const handleNotificationOpen = (open: boolean) => {
    setNotifOpen(open);
    if (open && unreadCount > 0) {
      // Mark all visible unread notifications as read
      const unreadIds = notifications.filter(n => !n.read).map(n => n.id);
      notificationsService.markMultipleAsRead(unreadIds);

      // Update state
      setNotifications(notificationsService.getAll());
      setUnreadCount(0);
    }
  };

  const handleNotificationClick = (notif: Notification) => {
    // Mark this specific notification as read if not already
    if (!notif.read) {
      notificationsService.markAsRead(notif.id);
      setNotifications(notificationsService.getAll());
      setUnreadCount(notificationsService.getUnreadCount());
    }

    // Navigate to action URL
    if (notif.actionUrl) {
      navigate(notif.actionUrl);
    }

    // Close dropdown
    setNotifOpen(false);
  };

  const handleDateRangeChange = (value: string) => {
    if (value !== 'custom') {
      setSelectedRange(value as any);
    } else {
      setShowCalendar(true);
    }
  };

  const handleApplyCustomDates = () => {
    if (startDate && endDate) {
      setCustomRange({ from: startDate, to: endDate });
      setSelectedRange('custom');
      setShowCalendar(false);
    } else if (startDate && !endDate) {
      // Si solo hay fecha de inicio, usar el mismo día como fin
      setCustomRange({ from: startDate, to: startDate });
      setSelectedRange('custom');
      setShowCalendar(false);
    }
  };

  const handleResetDates = () => {
    setStartDate(undefined);
    setEndDate(undefined);
  };

  const getCustomLabel = () => {
    if (customRange) {
      if (format(customRange.from, 'yyyy-MM-dd') === format(customRange.to, 'yyyy-MM-dd')) {
        return format(customRange.from, 'dd/MM/yyyy', { locale: es });
      }
      return `${format(customRange.from, 'dd/MM', { locale: es })} - ${format(customRange.to, 'dd/MM', { locale: es })}`;
    }
    return 'Personalizado';
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
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 h-9 px-3 bg-card">
                  <Calendar size={16} className="text-muted-foreground" />
                  <span className="text-sm">
                    {selectedRange === 'custom' && customRange
                      ? getCustomLabel()
                      : dateRanges.find((r) => r.value === selectedRange)?.label
                    }
                  </span>
                  <ChevronDown size={14} className="text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {dateRanges.map((range) => (
                  <DropdownMenuItem
                    key={range.value}
                    onClick={() => handleDateRangeChange(range.value)}
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

            {/* Custom Date Picker Dialog */}
            {selectedRange === 'custom' && (
              <Popover open={showCalendar} onOpenChange={setShowCalendar}>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9">
                    {customRange ? getCustomLabel() : 'Seleccionar fechas'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-4" align="end">
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-medium mb-2">Fecha de Inicio</p>
                      <CalendarComponent
                        mode="single"
                        selected={startDate}
                        onSelect={setStartDate}
                        locale={es}
                        initialFocus
                      />
                    </div>

                    {startDate && (
                      <div>
                        <p className="text-sm font-medium mb-2">
                          Fecha de Fin <span className="text-muted-foreground text-xs">(opcional)</span>
                        </p>
                        <CalendarComponent
                          mode="single"
                          selected={endDate}
                          onSelect={setEndDate}
                          locale={es}
                          disabled={(date) => date < startDate}
                        />
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button onClick={handleApplyCustomDates} disabled={!startDate} className="flex-1">
                        Aplicar
                      </Button>
                      <Button onClick={handleResetDates} variant="outline">
                        Reset
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>

          {/* Notifications */}
          <DropdownMenu open={notifOpen} onOpenChange={handleNotificationOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative h-9 w-9">
                <Bell size={18} className="text-muted-foreground" />
                {(unreadCount > 0 || criticalAlerts > 0) && (
                  <Badge className={cn(
                    "absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-[10px] border-2 border-card",
                    criticalAlerts > 0 ? "bg-red-600" : "bg-destructive"
                  )}>
                    {unreadCount + criticalAlerts}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>Notificaciones</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    No hay notificaciones
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <DropdownMenuItem
                      key={notif.id}
                      className={cn(
                        "cursor-pointer flex-col items-start p-3 gap-1",
                        !notif.read && "bg-primary/5"
                      )}
                      onClick={() => handleNotificationClick(notif)}
                    >
                      <div className="flex items-start justify-between w-full gap-2">
                        <p className={cn(
                          "text-sm flex-1",
                          !notif.read ? "font-semibold" : "font-medium"
                        )}>
                          {notif.message}
                        </p>
                        {!notif.read && (
                          <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-1" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(notif.timestamp).toLocaleString('es-ES', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </DropdownMenuItem>
                  ))
                )}
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
    </header>
  );
}
