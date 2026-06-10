/**
 * NotificationsPanel
 *
 * Renders the notifications list as a desktop dropdown panel or, on mobile,
 * as a bottom sheet via ResponsiveDialog. Same data, two presentations.
 *
 * Behavior:
 *  - Mobile (<lg): bottom sheet with sticky "Marcar todas como leidas" footer,
 *    filter chips at top, scrollable list, swipe-to-dismiss list items.
 *  - Desktop (lg+): DropdownMenu (existing pattern, unchanged UX).
 *
 * Open state and unread badge are owned by the caller (Header). This component
 * just renders the surface.
 */
import * as React from 'react';
import { Bell, Check } from 'lucide-react';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogBody,
  ResponsiveDialogFooter,
} from '@/components/ui/responsive-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useMediaQuery } from '@/hooks/use-media-query';
import { formatTimeAgo } from '@/utils/timeUtils';
import { cn } from '@/lib/utils';
import { tap, success } from '@/lib/haptics';
import type { Notification } from '@/types/notification';

type NotificationFilter = 'all' | 'urgent' | 'action_required' | 'informational';

interface NotificationsPanelProps {
  /** Trigger button. Used as DropdownMenu anchor on desktop and as a regular button on mobile. */
  trigger: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notifications: Notification[];
  unreadCount: number;
  onClickNotification: (n: Notification) => void;
  onMarkAllRead: () => void;
}

const FILTERS: Array<{ id: NotificationFilter; label: string }> = [
  { id: 'all', label: 'Todas' },
  { id: 'urgent', label: 'Urgentes' },
  { id: 'action_required', label: 'Accion' },
  { id: 'informational', label: 'Info' },
];

function categoryDot(category: Notification['category']): string {
  if (category === 'urgent') return 'bg-red-500';
  if (category === 'action_required') return 'bg-orange-500';
  return 'bg-blue-500';
}

function rowTone(n: Notification): string {
  if (n.read) return 'opacity-75';
  if (n.category === 'urgent') return 'bg-red-50 dark:bg-red-950/20';
  if (n.category === 'action_required') return 'bg-orange-50 dark:bg-orange-950/20';
  return 'bg-blue-50 dark:bg-blue-950/20';
}

function NotificationRow({
  notif,
  onClick,
}: {
  notif: Notification;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        tap();
        onClick();
      }}
      className={cn(
        'w-full text-left rounded-xl px-3 py-3 transition-colors',
        'active:scale-[0.99] hover:bg-muted/40',
        rowTone(notif),
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-1.5 h-2 w-2 rounded-full shrink-0',
            categoryDot(notif.category),
          )}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              'text-[15px] leading-snug',
              !notif.read ? 'font-semibold' : 'font-normal',
            )}
          >
            {notif.message}
          </p>
          {notif.actionLabel && !notif.read && (
            <p className="text-[13px] text-primary mt-1 font-medium">
              {notif.actionLabel}
            </p>
          )}
          <p className="text-[12px] text-muted-foreground mt-1">
            {formatTimeAgo(notif.metadata?.timeReference || notif.timestamp)}
          </p>
        </div>
        {!notif.read && (
          <span
            className="h-2 w-2 rounded-full bg-primary shrink-0 mt-2"
            aria-hidden="true"
          />
        )}
      </div>
    </button>
  );
}

/**
 * Empty state. Notifications are now gated per-feature inside the engine, so an
 * empty panel means there is genuinely nothing to act on, on every plan. We do
 * NOT show a plan-upsell teaser here (operational alerts ship on all plans);
 * the panel is a single honest "all clear" state.
 */
function EmptyState() {
  return (
    <div className="py-12 text-center" role="status">
      <Bell size={48} className="mx-auto mb-3 opacity-30" aria-hidden="true" />
      <p className="text-base font-semibold">Todo en orden</p>
      <p className="text-[13px] text-muted-foreground mt-1">
        No hay notificaciones pendientes
      </p>
    </div>
  );
}

export function NotificationsPanel({
  trigger,
  open,
  onOpenChange,
  notifications,
  unreadCount,
  onClickNotification,
  onMarkAllRead,
}: NotificationsPanelProps) {
  const isLgUp = useMediaQuery('(min-width: 1024px)');
  const [filter, setFilter] = React.useState<NotificationFilter>('all');

  const filtered = React.useMemo(() => {
    if (filter === 'all') return notifications;
    return notifications.filter((n) => n.category === filter);
  }, [notifications, filter]);

  const filterCounts = React.useMemo(() => {
    const counts: Record<NotificationFilter, number> = {
      all: notifications.length,
      urgent: 0,
      action_required: 0,
      informational: 0,
    };
    for (const n of notifications) {
      if (n.category in counts) {
        counts[n.category as NotificationFilter] += 1;
      }
    }
    return counts;
  }, [notifications]);

  // Desktop: keep existing DropdownMenu pattern.
  if (isLgUp) {
    return (
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[360px] max-w-[calc(100vw-24px)]">
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
                  onMarkAllRead();
                }}
              >
                Marcar todo leido
              </Button>
            )}
          </div>
          <DropdownMenuSeparator />
          <div className="max-h-[420px] overflow-y-auto p-1">
            {notifications.length === 0 ? (
              <EmptyState />
            ) : (
              notifications.map((notif) => (
                <DropdownMenuItem
                  key={notif.id}
                  asChild
                  className="p-0 focus:bg-transparent"
                >
                  <div>
                    <NotificationRow
                      notif={notif}
                      onClick={() => onClickNotification(notif)}
                    />
                  </div>
                </DropdownMenuItem>
              ))
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Mobile: bottom sheet via ResponsiveDialog.
  return (
    <>
      {/* Trigger stays in caller's DOM. We render it as-is, but wrap onClick. */}
      <span
        onClick={() => {
          tap();
          onOpenChange(true);
        }}
        className="contents"
      >
        {trigger}
      </span>
      <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
        <ResponsiveDialogContent desktopMaxWidth="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Notificaciones</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>

          {/* Filter chips */}
          {notifications.length > 0 && (
            <div className="px-5 pb-2 -mt-1">
              <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
                {FILTERS.map((f) => {
                  const count = filterCounts[f.id];
                  const active = filter === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => {
                        tap();
                        setFilter(f.id);
                      }}
                      className={cn(
                        'shrink-0 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium',
                        'border transition-all active:scale-[0.97]',
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border/60 bg-card text-foreground',
                      )}
                      aria-pressed={active}
                    >
                      {f.label}
                      {count > 0 && (
                        <span
                          className={cn(
                            'tabular-nums text-[11px]',
                            active
                              ? 'text-primary-foreground/80'
                              : 'text-muted-foreground',
                          )}
                        >
                          {count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <ResponsiveDialogBody className="pt-1">
            {notifications.length === 0 ? (
              <EmptyState />
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center" role="status">
                <p className="text-[15px] text-muted-foreground">
                  No hay notificaciones en este filtro.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {filtered.map((notif) => (
                  <NotificationRow
                    key={notif.id}
                    notif={notif}
                    onClick={() => onClickNotification(notif)}
                  />
                ))}
              </div>
            )}
          </ResponsiveDialogBody>

          {unreadCount > 0 && (
            <ResponsiveDialogFooter>
              <Button
                onClick={() => {
                  success();
                  onMarkAllRead();
                }}
                className="w-full h-12 text-[15px] gap-2"
              >
                <Check size={18} />
                Marcar todas como leidas ({unreadCount})
              </Button>
            </ResponsiveDialogFooter>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
