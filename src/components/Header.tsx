import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateAlerts } from '@/utils/alertEngine';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useDateRange } from '@/contexts/DateRangeContext';
import { formatTimeAgo } from '@/utils/timeUtils';
import { preserveShopifyParams } from '@/utils/shopifyNavigation';
import { Bell, ChevronDown, Calendar } from 'lucide-react';
import { Button } from './ui/button';
import { GlobalSearch } from './GlobalSearch';
import { ordersService } from '@/services/orders.service';
import { productsService } from '@/services/products.service';
import { adsService } from '@/services/ads.service';
import { carriersService } from '@/services/carriers.service';
import { analyticsService } from '@/services/analytics.service';
import { notificationsService } from '@/services/notifications.service';
import type { Order, DashboardOverview } from '@/types';
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

export function Header() {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const { hasFeature } = useSubscription();
  const { selectedRange, setSelectedRange, customRange, setCustomRange } = useDateRange();

  // Check if user has smart alerts feature (Growth+ plan)
  const hasSmartAlerts = hasFeature('smart_alerts');
  const [notifOpen, setNotifOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showCalendar, setShowCalendar] = useState(false);
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();

  // Subscribe to cross-tab notification updates
  useEffect(() => {
    const unsubscribe = notificationsService.subscribe(() => {
      // Another tab updated notifications - refresh our state
      setNotifications(notificationsService.getAll());
      setUnreadCount(notificationsService.getUnreadCount());
    });
    return unsubscribe;
  }, []);

  // Load data for notifications and alerts
  useEffect(() => {
    const loadData = async () => {
      try {
        const [ordersResponse, productsData, adsData, carriersData, overviewData] = await Promise.all([
          ordersService.getAll(),
          productsService.getAll(),
          adsService.getAll(),
          carriersService.getAll(),
          analyticsService.getOverview(),
        ]);
        setOrders(ordersResponse.data || []);
        setCarriers(carriersData);
        setOverview(overviewData);

        // Update notifications service with new data (only if user has smart_alerts feature)
        if (hasSmartAlerts) {
          notificationsService.updateNotifications({
            orders: ordersResponse.data || [],
            products: productsData,
            ads: adsData,
            carriers: carriersData,
          });

          // Get updated notifications
          setNotifications(notificationsService.getAll());
          setUnreadCount(notificationsService.getUnreadCount());
        } else {
          // Clear notifications for users without smart_alerts
          setNotifications([]);
          setUnreadCount(0);
        }
      } catch (error) {
        console.error('Error loading header data:', error);
      }
    };
    loadData();

    // Refresh data every 5 minutes (optimized from 30 seconds)
    const interval = setInterval(loadData, 300000);
    return () => clearInterval(interval);
  }, [hasSmartAlerts]);

  // Only generate alerts if user has smart_alerts feature
  const alerts = (hasSmartAlerts && overview)
    ? generateAlerts({ orders, overview, carriers })
    : [];
  const criticalAlerts = hasSmartAlerts ? alerts.filter(a => a.severity === 'critical').length : 0;

  const handleSignOut = async () => {
    await signOut();
    // Preserve Shopify query parameters when navigating to login
    const pathWithShopifyParams = preserveShopifyParams('/login');
    navigate(pathWithShopifyParams);
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
      // Preserve Shopify query parameters when navigating
      const pathWithShopifyParams = preserveShopifyParams(notif.actionUrl);
      navigate(pathWithShopifyParams);
    }

    // Close dropdown
    setNotifOpen(false);
  };

  const handleMarkAllRead = () => {
    notificationsService.markAllAsRead();
    setNotifications(notificationsService.getAll());
    setUnreadCount(0);
  };

  const handleDateRangeChange = (value: string) => {
    if (value !== 'custom') {
      setSelectedRange(value as any);
    } else {
      // Set to custom mode and open calendar
      setSelectedRange('custom');
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
            <Popover open={showCalendar} onOpenChange={setShowCalendar}>
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
                  {dateRanges.filter(r => r.value !== 'custom').map((range) => (
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
                  <PopoverTrigger asChild>
                    <DropdownMenuItem
                      className={cn(
                        'cursor-pointer',
                        selectedRange === 'custom' && 'bg-primary/10 text-primary font-medium'
                      )}
                      onSelect={(e) => {
                        e.preventDefault();
                        setSelectedRange('custom');
                        setShowCalendar(true);
                      }}
                    >
                      Personalizado
                    </DropdownMenuItem>
                  </PopoverTrigger>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Custom Date Picker Popover */}
              <PopoverContent className="w-auto p-4 bg-card border-border shadow-xl" align="end">
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium mb-2 text-foreground">Fecha de Inicio</p>
                    <CalendarComponent
                      mode="single"
                      selected={startDate}
                      onSelect={setStartDate}
                      locale={es}
                      initialFocus
                      className="rounded-md border border-border bg-card"
                    />
                  </div>

                  {startDate && (
                    <div>
                      <p className="text-sm font-medium mb-2 text-foreground">
                        Fecha de Fin <span className="text-muted-foreground text-xs">(opcional)</span>
                      </p>
                      <CalendarComponent
                        mode="single"
                        selected={endDate}
                        onSelect={setEndDate}
                        locale={es}
                        disabled={(date) => date < startDate}
                        className="rounded-md border border-border bg-card"
                      />
                    </div>
                  )}

                  <div className="flex gap-2 pt-2 border-t border-border">
                    <Button onClick={handleApplyCustomDates} disabled={!startDate} className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90">
                      Aplicar
                    </Button>
                    <Button onClick={handleResetDates} variant="outline" className="border-border hover:bg-muted">
                      Limpiar
                    </Button>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          {/* Notifications */}
          <DropdownMenu open={notifOpen} onOpenChange={handleNotificationOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative h-9 w-9">
                <Bell size={18} className="text-muted-foreground" />
                {(unreadCount > 0 || criticalAlerts > 0) && (
                  <Badge className={cn(
                    "absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-[10px] border-2 border-card",
                    // Red for urgent, orange for others
                    notifications.some(n => !n.read && n.category === 'urgent') || criticalAlerts > 0
                      ? "bg-red-600"
                      : "bg-orange-500"
                  )}>
                    {unreadCount + criticalAlerts}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[340px]">
              <div className="flex items-center justify-between px-3 py-2">
                <DropdownMenuLabel className="p-0">Notificaciones</DropdownMenuLabel>
                {unreadCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleMarkAllRead();
                    }}
                  >
                    Marcar todo leído
                  </Button>
                )}
              </div>
              <DropdownMenuSeparator />
              <div className="max-h-[400px] overflow-y-auto">
                {!hasSmartAlerts ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    <p className="font-medium mb-2">Alertas Inteligentes</p>
                    <p>Disponible en plan Growth</p>
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    <Bell size={32} className="mx-auto mb-3 opacity-30" />
                    <p>Todo en orden</p>
                    <p className="text-xs mt-1">No hay notificaciones pendientes</p>
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <DropdownMenuItem
                      key={notif.id}
                      className={cn(
                        "cursor-pointer flex-col items-start p-3 gap-1.5 focus:bg-muted/50",
                        !notif.read && notif.category === 'urgent' && "bg-red-50 dark:bg-red-950/20",
                        !notif.read && notif.category === 'action_required' && "bg-orange-50 dark:bg-orange-950/20",
                        !notif.read && notif.category === 'informational' && "bg-blue-50 dark:bg-blue-950/20",
                        notif.read && "opacity-70"
                      )}
                      onClick={() => handleNotificationClick(notif)}
                    >
                      <div className="flex items-start justify-between w-full gap-2">
                        <div className="flex items-start gap-2 flex-1">
                          {/* Category indicator */}
                          <div className={cn(
                            "h-2 w-2 rounded-full mt-1.5 flex-shrink-0",
                            notif.category === 'urgent' && "bg-red-500",
                            notif.category === 'action_required' && "bg-orange-500",
                            notif.category === 'informational' && "bg-blue-500"
                          )} />
                          <div className="flex-1">
                            <p className={cn(
                              "text-sm leading-tight",
                              !notif.read ? "font-semibold" : "font-normal"
                            )}>
                              {notif.message}
                            </p>
                            {/* Action label as subtle CTA */}
                            {notif.actionLabel && !notif.read && (
                              <p className="text-xs text-primary mt-1 font-medium">
                                {notif.actionLabel} →
                              </p>
                            )}
                          </div>
                        </div>
                        {!notif.read && (
                          <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-1" />
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground ml-4">
                        {formatTimeAgo(notif.metadata?.timeReference || notif.timestamp)}
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
                  {(user as any)?.avatar_url ? (
                    <AvatarImage src={(user as any).avatar_url} alt="Profile" />
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
                onClick={() => navigate(preserveShopifyParams('/settings?tab=profile'))}
              >
                Perfil
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => navigate(preserveShopifyParams('/settings?tab=subscription'))}
              >
                Suscripción
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={() => navigate(preserveShopifyParams('/settings?tab=preferences'))}
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
