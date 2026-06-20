import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useDateRange } from '@/contexts/DateRangeContext';
import { useGlobalView } from '@/contexts/GlobalViewContext';
import { preserveShopifyParams, isShopifyEmbedded } from '@/utils/shopifyNavigation';
import { Bell, ChevronDown, ChevronLeft, Calendar, ListChecks } from 'lucide-react';
import { Button } from './ui/button';
import { GlobalSearch } from './GlobalSearch';
import { GlobalViewToggle } from './GlobalViewToggle';
import { OnboardingChecklist, useOnboardingProgress } from './OnboardingChecklist';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './ui/sheet';
import { notificationsService } from '@/services/notifications.service';
import type { Notification } from '@/types/notification';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { NotificationsPanel } from './notifications/NotificationsPanel';
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
  const { signOut, user, stores } = useAuth();
  const { selectedRange, setSelectedRange, customRange, setCustomRange, getDateRange } = useDateRange();
  const { globalViewEnabled, setGlobalViewEnabled } = useGlobalView();

  const isShopifyContext = isShopifyEmbedded();

  // Show Global View toggle only on Dashboard and when user has 2+ stores
  const isDashboard = location.pathname === '/' || location.pathname === '/dashboard';
  const hasMultipleStores = (stores?.length || 0) >= 2;
  const showGlobalViewToggle = isDashboard && hasMultipleStores;

  // Notification generation + polling lives in NotificationProvider (app level)
  // so it runs on every page. The Header is a pure renderer of the derived view.
  const { notifications, unreadCount, badgeCount, badgeUrgent } = useNotifications();

  const [notifOpen, setNotifOpen] = useState(false);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [showCalendarView, setShowCalendarView] = useState(false);
  const [customSelection, setCustomSelection] = useState<CalendarDateRange | undefined>(undefined);
  const [onboardingDrawerOpen, setOnboardingDrawerOpen] = useState(false);

  // Subscribe to onboarding progress for the header indicator. Returns null
  // for non-owners or while subscription/progress is loading: that's the
  // signal to hide the trigger entirely.
  const onboardingProgress = useOnboardingProgress();
  const showOnboardingTrigger =
    onboardingProgress !== null &&
    !onboardingProgress.isComplete &&
    !onboardingProgress.hasDismissed &&
    onboardingProgress.totalCount > 0;

  const handleSignOut = async () => {
    await signOut();
    // Preserve Shopify query parameters when navigating to login
    const pathWithShopifyParams = preserveShopifyParams('/login');
    navigate(pathWithShopifyParams);
  };

  // Opening the panel no longer marks everything read. "Seen" (unread) and
  // "resolved" (live) are separate signals: bulk-reading on open would wipe the
  // blue "new" indicator without the operator actually acting on anything, and
  // it never touched the live signal anyway. Read state is set per notification
  // on click, or explicitly via "Marcar todo leido".
  const handleNotificationOpen = (open: boolean) => {
    setNotifOpen(open);
  };

  const handleNotificationClick = (notif: Notification) => {
    // Mark this specific notification as read if not already. The service
    // notifies listeners, so the provider re-derives the badge state.
    if (!notif.read) {
      notificationsService.markAsRead(notif.id);
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
            Hola, {user?.name?.split(' ')[0] || user?.email?.split('@')[0] || 'Usuario'} <span className="inline-block">👋</span>
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

          {/* Onboarding Checklist Trigger - hidden when complete or dismissed */}
          {showOnboardingTrigger && onboardingProgress && (
            <Sheet open={onboardingDrawerOpen} onOpenChange={setOnboardingDrawerOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative h-10 w-10 min-h-[44px] min-w-[44px]"
                  aria-label={`Configura tu tienda, ${onboardingProgress.completedCount} de ${onboardingProgress.totalCount} pasos`}
                >
                  <ListChecks size={20} className="text-muted-foreground" />
                  <Badge
                    className={cn(
                      'absolute -top-1 -right-1 h-5 min-w-[1.25rem] flex items-center justify-center px-1 text-[10px] border-2 border-card tabular-nums',
                      onboardingProgress.percentage >= 80 ? 'bg-primary' : 'bg-primary'
                    )}
                  >
                    {onboardingProgress.completedCount}/{onboardingProgress.totalCount}
                  </Badge>
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
                <SheetHeader className="mb-4">
                  <SheetTitle>Pasos de configuración</SheetTitle>
                  <SheetDescription>
                    Completá estos pasos para sacar el máximo provecho de Ordefy.
                  </SheetDescription>
                </SheetHeader>
                <OnboardingChecklist
                  variant="drawer"
                  onDismiss={() => setOnboardingDrawerOpen(false)}
                />
              </SheetContent>
            </Sheet>
          )}

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
                <div className="w-[320px] p-4 space-y-4">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setShowCalendarView(false)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                      aria-label="Volver a rangos predefinidos"
                    >
                      <ChevronLeft size={14} />
                      Volver
                    </button>
                    <div className="h-4 w-px bg-border" />
                    <p className="text-sm font-semibold text-foreground">Rango personalizado</p>
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
                    className="p-0"
                    classNames={{
                      months: "flex flex-col",
                      month: "space-y-3",
                      caption: "relative flex items-center justify-center pt-1 pb-1",
                      caption_label: "sr-only",
                      caption_dropdowns: "flex items-center gap-2",
                      dropdown_month: "relative",
                      dropdown_year: "relative",
                      dropdown:
                        "h-8 cursor-pointer rounded-md border border-border bg-card px-2 text-sm font-medium text-foreground hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-colors",
                      vhidden: "hidden",
                      nav: "absolute inset-x-0 flex items-center justify-between px-1",
                      nav_button:
                        "inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-primary/10 hover:text-primary hover:border-primary/40 transition-colors",
                      nav_button_previous: "",
                      nav_button_next: "",
                      table: "w-full border-collapse",
                      head_row: "flex",
                      head_cell:
                        "w-9 text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground",
                      row: "flex w-full mt-1.5",
                      cell: "relative h-9 w-9 p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-primary/15 first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md",
                      day: "inline-flex h-9 w-9 items-center justify-center rounded-md p-0 text-sm font-normal text-foreground hover:bg-primary/15 hover:text-primary aria-selected:opacity-100 transition-colors",
                      day_today: "border border-primary/50 font-semibold text-foreground",
                      day_selected:
                        "bg-primary text-primary-foreground font-semibold hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
                      day_range_start: "rounded-l-md",
                      day_range_end: "rounded-r-md",
                      day_range_middle:
                        "rounded-none bg-primary/15 text-foreground hover:bg-primary/25",
                      day_outside: "text-muted-foreground/40 aria-selected:text-primary-foreground/70",
                      day_disabled: "text-muted-foreground/30 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground/30",
                      day_hidden: "invisible",
                    }}
                  />
                  <div className="flex gap-2 pt-3 border-t border-border">
                    <Button
                      onClick={handleResetDates}
                      variant="ghost"
                      size="sm"
                      className="h-9 text-muted-foreground hover:text-foreground hover:bg-muted"
                    >
                      Limpiar
                    </Button>
                    <Button
                      onClick={handleApplyCustomDates}
                      disabled={!customSelection?.from}
                      size="sm"
                      className="h-9 flex-1 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 font-medium"
                    >
                      Aplicar rango
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
          <NotificationsPanel
            open={notifOpen}
            onOpenChange={handleNotificationOpen}
            notifications={notifications}
            unreadCount={unreadCount}
            onClickNotification={handleNotificationClick}
            onMarkAllRead={handleMarkAllRead}
            trigger={
              <Button
                variant="ghost"
                size="icon"
                className="relative h-10 w-10 min-h-[44px] min-w-[44px]"
                aria-label={
                  badgeCount > 0
                    ? `Notificaciones, ${badgeCount} sin leer`
                    : 'Notificaciones'
                }
              >
                <Bell size={20} className="text-muted-foreground" />
                {/* Single signal: count of UNREAD actionable notifications.
                    Marking one read decrements it; "marcar todo leido" zeroes
                    it. A new or changed condition gets a distinct (content-hash)
                    id, arrives unread, and the badge reappears on its own, so
                    this does not regress to the old invisible-badge bug. Red
                    when any unread is urgent, amber otherwise. */}
                {badgeCount > 0 && (
                  <Badge className={cn(
                    "absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-[10px] border-2 border-card tabular-nums",
                    badgeUrgent ? "bg-red-600" : "bg-orange-500"
                  )}>
                    {badgeCount > 9 ? '9+' : badgeCount}
                  </Badge>
                )}
              </Button>
            }
          />

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-1 sm:gap-2 pl-1 pr-2 sm:pr-3 h-10 min-h-[44px]" aria-label="Menú de usuario">
                <Avatar className="h-8 w-8">
                  {(user as any)?.avatar_url ? (
                    <AvatarImage src={(user as any).avatar_url} alt="Foto de perfil" />
                  ) : (
                    <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
                      {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || 'U'}
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
              {!isShopifyContext && (
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => navigate(preserveShopifyParams('/settings?tab=subscription'))}
                >
                  Suscripción
                </DropdownMenuItem>
              )}
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
