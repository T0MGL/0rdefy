/**
 * NotificationContext
 *
 * Owns the notification generation cycle at the app level so it runs no matter
 * which page the user is on (previously it lived in the Header and only ran
 * while the Header data effect was mounted and active). Responsibilities:
 *
 *  - Poll /analytics/notification-data on an interval and feed the result into
 *    notificationsService, which generates + merges notifications.
 *  - Resolve per-plan feature gates (Fix 3) and pass them to the engine so
 *    operational notifications (orders, stock) fire on every plan including
 *    free / plan-null, while ads and carrier notifications only fire when the
 *    plan includes the matching module.
 *  - Expose the derived view (notifications, unreadCount, badgeCount,
 *    badgeUrgent) so the Header is a pure renderer.
 *
 * The bell badge reflects UNREAD actionable work (badgeCount): marking a
 * notification read lowers it and "marcar todo leido" zeroes it. It does not
 * regress to the original invisible-badge bug because notification ids carry a
 * content fingerprint, so a new or changed condition gets a distinct id, arrives
 * unread, and the badge reappears on its own. unreadCount (all unread) is kept
 * for the panel's own copy.
 *
 * Polling is gated by tab visibility with a catch-up fetch on return, matching
 * the prior Header behavior. The cadence is 5 minutes (Fix 2): the operational
 * set (pending orders, out-of-stock) is time-sensitive enough that a 30-minute
 * window let real problems sit unsignalled.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { useAuth, Module } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { analyticsService } from '@/services/analytics.service';
import { notificationsService } from '@/services/notifications.service';
import type { Notification } from '@/types/notification';
import { logger } from '@/utils/logger';

// 5-minute cadence for the operational notification set. See file header.
const POLL_INTERVAL_MS = 5 * 60 * 1000;

interface NotificationContextValue {
  notifications: Notification[];
  /** Total unread (any category). Used by the panel's own copy. */
  unreadCount: number;
  /** Unread actionable count (urgent + action_required). Drives the bell badge number. */
  badgeCount: number;
  /** At least one unread actionable is urgent: red vs amber badge selection. */
  badgeUrgent: boolean;
}

const NotificationContext = createContext<NotificationContextValue | undefined>(undefined);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { permissions } = useAuth();
  const { hasFeature, loading: subscriptionLoading } = useSubscription();

  const hasAnalyticsAccess = permissions.canAccessModule(Module.ANALYTICS);

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [badgeCount, setBadgeCount] = useState(0);
  const [badgeUrgent, setBadgeUrgent] = useState(false);

  // Resolve per-feature gates from the plan. While the subscription is still
  // loading we leave the gates undefined (engine treats undefined as enabled),
  // so operational notifications appear immediately and the first post-load
  // poll narrows ads/carriers if the plan does not include them.
  const adsEnabled = hasFeature('campaign_tracking');
  const carriersEnabled = hasFeature('carrier_integrations');

  const featureFlags = useMemo(() => {
    if (subscriptionLoading) return undefined;
    return { ads: adsEnabled, carriers: carriersEnabled };
  }, [subscriptionLoading, adsEnabled, carriersEnabled]);

  // Keep the latest feature flags in a ref so the polling effect can read them
  // without re-subscribing the interval every time the plan resolves.
  const featureFlagsRef = useRef(featureFlags);
  featureFlagsRef.current = featureFlags;

  // Single in-flight controller. A new load aborts the previous one rather than
  // skipping, so a plan-change refresh always wins over an older operational
  // fetch and the per-feature gates apply immediately (not after the next poll).
  const inFlightRef = useRef<AbortController | null>(null);

  const syncFromService = useCallback(() => {
    setNotifications(notificationsService.getAll());
    setUnreadCount(notificationsService.getUnreadCount());
    setBadgeCount(notificationsService.getUnreadActionableCount());
    setBadgeUrgent(notificationsService.hasUrgentUnread());
  }, []);

  // Cross-tab + same-tab service updates: re-derive the view.
  useEffect(() => {
    const unsubscribe = notificationsService.subscribe(syncFromService);
    // Prime from whatever the service already holds (persisted from a prior
    // session) so the badge is correct before the first network fetch returns.
    syncFromService();
    return unsubscribe;
  }, [syncFromService]);

  const loadData = useCallback(async () => {
    // Users without analytics access do not receive notifications. Only clear
    // when there is actually something to clear, so a no-access tab does not
    // broadcast/persist on every poll tick.
    if (!hasAnalyticsAccess) {
      if (notificationsService.getAllUnlimited().length > 0) {
        notificationsService.clearAll();
      }
      return;
    }

    // Abort any prior in-flight load so the latest request wins (e.g. a
    // plan-change refresh supersedes an older operational fetch).
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;

    try {
      const notificationData = await analyticsService.getNotificationData(controller.signal);
      if (controller.signal.aborted || !notificationData) return;

      notificationsService.updateNotifications({
        orders: notificationData.orders as any,
        products: notificationData.products as any,
        ads: notificationData.ads as any,
        carriers: notificationData.carriers as any,
        adSpendLoggedThisWeek: notificationData.adSpendLoggedThisWeek,
        storeTimezone: notificationData.storeTimezone,
        featureFlags: featureFlagsRef.current,
      });

      syncFromService();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      logger.error('Error loading notification data:', error);
    } finally {
      if (inFlightRef.current === controller) {
        inFlightRef.current = null;
      }
    }
  }, [hasAnalyticsAccess, syncFromService]);

  // Visibility-gated polling with catch-up on return. A backgrounded tab does
  // not hit the API; when the operator returns after longer than the interval a
  // single immediate fetch runs so the badge is current.
  useEffect(() => {
    if (typeof document === 'undefined') return;

    let stopped = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    let lastFetchAt = 0;

    const safeLoad = () => {
      if (stopped) return;
      if (document.visibilityState !== 'visible') return;
      lastFetchAt = Date.now();
      void loadData();
    };

    const startInterval = () => {
      if (interval !== null) return;
      interval = setInterval(safeLoad, POLL_INTERVAL_MS);
    };

    const stopInterval = () => {
      if (interval === null) return;
      clearInterval(interval);
      interval = null;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastFetchAt >= POLL_INTERVAL_MS) {
          safeLoad();
        }
        startInterval();
      } else {
        stopInterval();
      }
    };

    if (document.visibilityState === 'visible') {
      safeLoad();
      startInterval();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopped = true;
      inFlightRef.current?.abort();
      stopInterval();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadData]);

  // When the plan finishes loading (or changes), re-run generation so the gates
  // narrow/widen immediately instead of waiting for the next poll tick. loadData
  // aborts any in-flight operational fetch first, so the gated result wins.
  useEffect(() => {
    if (subscriptionLoading) return;
    void loadData();
  }, [subscriptionLoading, adsEnabled, carriersEnabled, loadData]);

  const value = useMemo<NotificationContextValue>(
    () => ({ notifications, unreadCount, badgeCount, badgeUrgent }),
    [notifications, unreadCount, badgeCount, badgeUrgent]
  );

  return (
    <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const context = useContext(NotificationContext);
  if (context === undefined) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
