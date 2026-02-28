import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { generateAlerts } from '@/utils/alertEngine';
import { useAuth, Module } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useDateRange } from '@/contexts/DateRangeContext';
import { useGlobalView } from '@/contexts/GlobalViewContext';
import { formatTimeAgo } from '@/utils/timeUtils';
import { preserveShopifyParams } from '@/utils/shopifyNavigation';
import { Bell, ChevronDown, Calendar } from 'lucide-react';
import { Button } from './ui/button';
import { GlobalSearch } from './GlobalSearch';
import { GlobalViewToggle } from './GlobalViewToggle';
import { analyticsService } from '@/services/analytics.service';
import { notificationsService } from '@/services/notifications.service';
import type { Order, DashboardOverview } from '@/types';
import type { Carrier } from '@/services/carriers.service';
import type { Notification } from '@/types/notification';
import { logger } from '@/utils/logger';
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
import type { DateRange as CalendarDateRange } from 'react-day-picker';

const dateRanges = [
  { label: 'Hoy', value: 'today' },
  { label: '7 días', value: '7d' },
  { label: '30 días', value: '30d' },
  { label: 'Desde siempre', value: 'all' },
  { label: 'Personalizado', value: 'custom' },
];

export function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, user, stores, permissions } = useAuth();
  const hasAnalyticsAccess = permissions.canAccessModule(Module.ANALYTICS);
  const { hasFeature } = useSubscription();
  const { selectedRange, setSelectedRange, customRange, setCustomRange, getDateRange } = useDateRange();
  const { globalViewEnabled, setGlobalViewEnabled } = useGlobalView();

  // Show Global View toggle only on Dashboard and when user has 2+ stores
  const isDashboard = location.pathname === '/' || location.pathname === '/dashboard';
  const hasMultipleStores = (stores?.length || 0) >= 2;
  const showGlobalViewToggle = isDashboard && hasMultipleStores;

  // Check if user has smart alerts feature (Growth+ plan)
  const hasSmartAlerts = hasFeature('smart_alerts');
  const [notifOpen, setNotifOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [showCalendarView, setShowCalendarView] = useState(false);
  const [customSelection, setCustomSelection] = useState<CalendarDateRange | undefined>(undefined);

  // Subscribe to cross-tab notification updates
  useEffect(() => {
    const unsubscribe = notificationsService.subscribe(() => {
      // Another tab updated notifications - refresh our state
      setNotifications(notificationsService.getAll());
      setUnreadCount(notificationsService.getUnreadCount());
    });
    return unsubscribe;
  }, []);

  // Track if a request is in flight to prevent concurrent requests
  const isLoadingRef = useRef(false);
  // Track current AbortController for cleanup
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load data for notifications and alerts - with abort support
  const loadData = useCallback(async (signal?: AbortSignal) => {
    // Skip analytics loading for users without analytics access
    if (!hasAnalyticsAccess) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    // Prevent concurrent requests
    if (isLoadingRef.current) {
      return;
    }

    isLoadingRef.current = true;

    try {
      // Use new lightweight notification data endpoint + overview for alerts
      const [notificationData, overviewData] = await Promise.all([
        analyticsService.getNotificationData(signal),
        analyticsService.getOverview(undefined, signal),
      ]);

      // Check if aborted before updating state
      if (signal?.aborted) {
        return;
      }

      setOverview(overviewData);

      // Update notifications service with new data (only if user has smart_alerts feature)
      if (hasSmartAlerts && notificationData) {
        // Store orders and carriers for alert generation
        setOrders(notificationData.orders as any);
        setCarriers(notificationData.carriers as any);

        notificationsService.updateNotifications({
          orders: notificationData.orders as any,
          products: notificationData.products as any,
          ads: notificationData.ads as any,
          carriers: notificationData.carriers as any,
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
      // Ignore abort errors - they're expected on cleanup
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      logger.error('Error loading header data:', error);
    } finally {
      isLoadingRef.current = false;
    }
  }, [hasSmartAlerts, hasAnalyticsAccess]);

  // Load data on mount and every 5 minutes with proper cleanup
  useEffect(() => {
    // Create abort controller for this effect lifecycle
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Initial load
    loadData(abortController.signal);

    // Refresh data every 5 minutes (optimized from 30 seconds)
    const interval = setInterval(() => {
      // Only start new request if not aborted
      if (!abortController.signal.aborted) {
        loadData(abortController.signal);
      }
    }, 300000);

    return () => {
      // Abort any in-flight requests
      abortController.abort();
      abortControllerRef.current = null;
      clearInterval(interval);
    };
  }, [loadData]); // Now properly tracks loadData changes

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

  const handleDatePopoverChange = (open: boolean) => {
    setDatePopoverOpen(open);
    if (!open) {
      setShowCalendarView(false);
    }
  };

  const handlePresetClick = (value: string) => {
    if (value === 'custom') {
      if (customRange?.from) {
        setCustomSelection({ from: customRange.from, to: customRange.to || customRange.from });
      } else {
        const currentRange = getDateRange();
        setCustomSelection({ from: currentRange.from, to: currentRange.to });
      }
      setShowCalendarView(true);
    } else {
      setSelectedRange(value as any);
      setDatePopoverOpen(false);
    }
  };

  const handleApplyCustomDates = () => {
    const from = customSelection?.from;
    const to = customSelection?.to || from;

    if (from && to) {
      setCustomRange({ from, to });
      setSelectedRange('custom');
      setDatePopoverOpen(false);
    }
  };

  const handleResetDates = () => {
    setCustomSelection(undefined);
    setCustomRange(null);
    setSelectedRange('7d');
    setDatePopoverOpen(false);
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
    <header className="h-16 border-b border-border bg-card sticky top-0 z-50 shadow-sm">
      <div className="h-full px-6 lg:pl-4 flex items-center justify-between">
        {/* Welcome Message - Hidden on mobile (we have bottom nav) */}
        <div
          className="hidden lg:block"
          style={{
            paddingLeft: 'calc(var(--sidebar-current-width, 80px) - 80px)',
            transition: 'padding-left 0.2s ease-out',
          }}
        >
          <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-card-foreground truncate max-w-[200px] md:max-w-none">
            Hola, {user?.name?.split(' ')[0] || user?.email?.split('@')[0] || 'Usuario'}! 👋
          </h1>
        </div>

        {/* Mobile: Show store name for context */}
        <div className="lg:hidden">
          <StoreSwitcher />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Global View Toggle - Only shows on Dashboard for users with 2+ stores (desktop only) */}
          {showGlobalViewToggle && (
            <div className="hidden lg:block">
              <GlobalViewToggle
                enabled={globalViewEnabled}
                onToggle={setGlobalViewEnabled}
              />
            </div>
          )}

          {/* Store Switcher - Only on desktop (shown on left for mobile) */}
          <div className="hidden lg:block">
            <StoreSwitcher />
          </div>

          {/* Global Search - Hidden on mobile (use bottom nav "Más" sheet instead) */}
          <div className="hidden lg:block">
            <GlobalSearch />
          </div>

          {/* Date Selector */}
          <Popover open={datePopoverOpen} onOpenChange={handleDatePopoverChange}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1 sm:gap-2 h-10 min-h-[44px] px-2 sm:px-3 bg-card">
                <Calendar size={16} className="text-muted-foreground" />
                <span className="text-sm hidden sm:inline">
                  {selectedRange === 'custom' && customRange
                    ? getCustomLabel()
                    : dateRanges.find((r) => r.value === selectedRange)?.label
                  }
                </span>
                <ChevronDown size={14} className="text-muted-foreground hidden sm:block" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0 bg-card border-border shadow-xl" align="end">
              {showCalendarView ? (
                <div className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowCalendarView(false)}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      ← Volver
                    </button>
                    <p className="text-sm font-medium text-foreground">Rango personalizado</p>
                  </div>
                  <CalendarComponent
                    mode="range"
                    selected={customSelection}
                    onSelect={setCustomSelection}
                    locale={es}
                    numberOfMonths={1}
                    captionLayout="dropdown-buttons"
                    fromYear={2020}
                    toYear={new Date().getFullYear()}
                    defaultMonth={customSelection?.from}
                    disabled={(date) => date > new Date()}
                    initialFocus
                    className="rounded-md border border-border bg-card"
                  />
                  <div className="flex gap-2 pt-2 border-t border-border">
                    <Button onClick={handleApplyCustomDates} disabled={!customSelection?.from} className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90">
                      Aplicar
                    </Button>
                    <Button onClick={handleResetDates} variant="outline" className="border-border hover:bg-muted">
                      Limpiar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="py-1 min-w-[160px]">
                  {dateRanges.map((range) => (
                    <button
                      key={range.value}
                      onClick={() => handlePresetClick(range.value)}
                      className={cn(
                        'w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors',
                        selectedRange === range.value && 'bg-primary/10 text-primary font-medium'
                      )}
                    >
                      {range.label}
                    </button>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>

          {/* Notifications */}
          <DropdownMenu open={notifOpen} onOpenChange={handleNotificationOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative h-10 w-10 min-h-[44px] min-w-[44px]"
                aria-label={`Notificaciones${unreadCount > 0 ? `, ${unreadCount} sin leer` : ''}`}
              >
                <Bell size={20} className="text-muted-foreground" />
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
            <DropdownMenuContent align="end" className="w-[340px] max-w-[calc(100vw-24px)]">
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
              <Button variant="ghost" className="gap-1 sm:gap-2 pl-1 pr-2 sm:pr-3 h-10 min-h-[44px]" aria-label="Menú de usuario">
                <Avatar className="h-8 w-8">
                  {(user as any)?.avatar_url ? (
                    <AvatarImage src={(user as any).avatar_url} alt="Foto de perfil" />
                  ) : (
                    <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
                      {user?.user_metadata?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
                    </AvatarFallback>
                  )}
                </Avatar>
                <ChevronDown size={14} className="text-muted-foreground hidden sm:block" />
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
