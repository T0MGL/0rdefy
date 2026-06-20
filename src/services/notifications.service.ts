import { Notification, NotificationPreferences, DEFAULT_NOTIFICATION_PREFERENCES } from '@/types/notification';
import { generateNotifications, type NotificationFeatureFlags } from '@/utils/notificationEngine';
import {
  countLiveNotifications,
  hasUrgentLiveNotification,
  countUnreadNotifications,
  countUnreadActionableNotifications,
  hasUrgentUnreadNotification,
} from '@/utils/notificationSignals';
import { getISOWeekKey } from '@/utils/timeUtils';
import type { Order, Product, Ad } from '@/types';
import type { Carrier } from '@/services/carriers.service';

const STORAGE_KEY = 'ordefy_notifications';
const PREFERENCES_KEY = 'ordefy_notification_preferences';
const DISMISSED_KEY = 'ordefy_dismissed_notifications';
// Week-scoped dismissals for recurring weekly reminders. Kept separate from the
// 24h DISMISSED_KEY so dismissing a weekly reminder sticks for the whole week
// rather than reappearing the next day.
const DISMISSED_WEEKLY_KEY = 'ordefy_dismissed_weekly_reminders';
// Week id prefix used by the weekly ad-spend reminder. Must stay in sync with
// the id built in notificationEngine.ts.
const WEEKLY_AD_SPEND_PREFIX = 'notif-ads-weekly-spend-';
const STORAGE_VERSION = '2.0'; // Bumped for new notification system
const BROADCAST_CHANNEL_NAME = 'ordefy_notifications_sync';

interface StoredNotifications {
  version: string;
  notifications: Notification[];
  lastUpdated: string;
}

interface NotificationEngineData {
  orders: Order[];
  products: Product[];
  ads: Ad[];
  carriers: Carrier[];
  adSpendLoggedThisWeek?: boolean;
  storeTimezone?: string;
  /**
   * Per-feature gates resolved from the current plan. Operational notifications
   * (orders, stock) are never gated; ads and carrier notifications are only
   * generated when the plan includes the matching module. Optional: when omitted
   * the engine defaults every gate to enabled so a store with an unknown plan
   * still gets operational notifications.
   */
  featureFlags?: NotificationFeatureFlags;
}

type BroadcastMessage =
  | { type: 'NOTIFICATIONS_UPDATED' }
  | { type: 'MARK_READ'; ids: string[] }
  | { type: 'MARK_ALL_READ' }
  | { type: 'CLEAR_ALL' }
  | { type: 'PREFERENCES_UPDATED' }
  | { type: 'DISMISSED_UPDATED' };

// Event listeners for cross-component updates
type NotificationListener = () => void;

class NotificationsService {
  private notifications: Notification[] = [];
  private preferences: NotificationPreferences = DEFAULT_NOTIFICATION_PREFERENCES;
  private dismissedIds: Set<string> = new Set();
  private dismissedWeeklyReminders: Set<string> = new Set();
  private channel: BroadcastChannel | null = null;
  private listeners: Set<NotificationListener> = new Set();
  // Last store timezone seen via updateNotifications(). The weekly dismiss keys
  // are written in store tz (id suffix from notificationEngine), so the pruner
  // must use the same tz to avoid dropping a still-valid dismiss at the
  // Sunday/Monday border. Undefined until the first store-scoped update arrives;
  // until then the pruner keeps every key (prunes nothing) so it cannot drop a
  // valid dismiss using the wrong (browser) timezone.
  private storeTimezone: string | undefined;

  constructor() {
    this.loadFromStorage();
    this.loadPreferences();
    this.loadDismissed();
    this.loadDismissedWeekly();
    this.initBroadcastChannel();
    this.setupCleanupListeners();
  }

  /**
   * Setup cleanup listeners for page unload
   */
  private setupCleanupListeners(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.handleBeforeUnload);
    }
  }

  /**
   * Handle page unload - cleanup resources before tab closes
   * Note: No need to removeEventListener here since the page is unloading
   */
  private handleBeforeUnload = (): void => {
    // Close BroadcastChannel to notify other tabs
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    // Clear listeners to release references
    this.listeners.clear();
  };

  /**
   * Initialize BroadcastChannel for cross-tab synchronization
   */
  private initBroadcastChannel(): void {
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        this.channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
          this.handleBroadcastMessage(event.data);
        };
      }
    } catch (error) {
      console.warn('BroadcastChannel not supported, cross-tab sync disabled');
    }
  }

  /**
   * Handle incoming broadcast messages from other tabs
   */
  private handleBroadcastMessage(message: BroadcastMessage): void {
    switch (message.type) {
      case 'NOTIFICATIONS_UPDATED':
      case 'MARK_READ':
      case 'MARK_ALL_READ':
      case 'CLEAR_ALL':
        this.loadFromStorage();
        this.notifyListeners();
        break;
      case 'PREFERENCES_UPDATED':
        this.loadPreferences();
        this.notifyListeners();
        break;
      case 'DISMISSED_UPDATED':
        this.loadDismissed();
        this.loadDismissedWeekly();
        this.loadFromStorage();
        this.notifyListeners();
        break;
    }
  }

  /**
   * Broadcast a message to other tabs
   */
  private broadcast(message: BroadcastMessage): void {
    if (this.channel) {
      try {
        this.channel.postMessage(message);
      } catch (error) {
        console.warn('Failed to broadcast notification update:', error);
      }
    }
  }

  /**
   * Subscribe to notification updates (for components)
   * ✅ FIXED: Defensive limit to prevent memory leaks WITHOUT nuclear cleanup
   * If limit reached, logs warning but allows natural cleanup via component unmount
   */
  subscribe(listener: NotificationListener): () => void {
    const MAX_LISTENERS = 200; // ✅ FIXED: Increased limit (was 100)

    if (this.listeners.size >= MAX_LISTENERS) {
      // ✅ FIXED: Log warning but DON'T clear all listeners
      // Let components cleanup naturally when they unmount
      console.error(
        `NotificationsService: Max listeners (${MAX_LISTENERS}) reached. ` +
        `This indicates a memory leak - components are not cleaning up subscriptions. ` +
        `Current count: ${this.listeners.size}`
      );
      // Continue anyway - better to have too many listeners than to break the UI
    }

    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notify all listeners about updates
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener();
      } catch (error) {
        console.error('Error in notification listener:', error);
      }
    });
  }

  /**
   * Load notifications from localStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        this.notifications = [];
        return;
      }

      const data: StoredNotifications = JSON.parse(stored);

      // Version check - reset if version changed
      if (data.version !== STORAGE_VERSION) {
        this.notifications = [];
        this.saveToStorage();
        return;
      }

      // Clean up old notifications (older than 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      this.notifications = data.notifications.filter(n => {
        const notifDate = new Date(n.timestamp);
        return notifDate >= sevenDaysAgo;
      });

      if (this.notifications.length !== data.notifications.length) {
        this.saveToStorage();
      }
    } catch (error) {
      console.error('Error loading notifications from storage:', error);
      this.notifications = [];
    }
  }

  /**
   * Save notifications to localStorage with quota handling
   */
  private saveToStorage(): void {
    try {
      const data: StoredNotifications = {
        version: STORAGE_VERSION,
        notifications: this.notifications,
        lastUpdated: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error: any) {
      // Handle localStorage quota exceeded
      if (error?.name === 'QuotaExceededError' || error?.code === 22) {
        console.warn('localStorage quota exceeded, trimming notifications...');
        // Keep only the most recent 20 notifications
        this.notifications = this.notifications.slice(0, 20);
        try {
          const trimmedData: StoredNotifications = {
            version: STORAGE_VERSION,
            notifications: this.notifications,
            lastUpdated: new Date().toISOString(),
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmedData));
        } catch (retryError) {
          // If still failing, clear and start fresh
          console.error('Failed to save even trimmed notifications:', retryError);
          localStorage.removeItem(STORAGE_KEY);
        }
      } else {
        console.error('Error saving notifications to storage:', error);
      }
    }
  }

  /**
   * Load user preferences from localStorage
   */
  private loadPreferences(): void {
    try {
      const stored = localStorage.getItem(PREFERENCES_KEY);
      if (stored) {
        this.preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...JSON.parse(stored) };
      }
    } catch (error) {
      console.error('Error loading notification preferences:', error);
      this.preferences = DEFAULT_NOTIFICATION_PREFERENCES;
    }
  }

  /**
   * Save user preferences to localStorage
   */
  private savePreferences(): void {
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(this.preferences));
    } catch (error) {
      console.error('Error saving notification preferences:', error);
    }
  }

  /**
   * Load dismissed notification IDs from localStorage
   */
  private loadDismissed(): void {
    try {
      const stored = localStorage.getItem(DISMISSED_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        // Clean up old dismissals (older than 24 hours)
        const yesterday = new Date();
        yesterday.setHours(yesterday.getHours() - 24);
        const validDismissals = Object.entries(data)
          .filter(([_, timestamp]) => new Date(timestamp as string) >= yesterday)
          .map(([id]) => id);
        this.dismissedIds = new Set(validDismissals);
      }
    } catch (error) {
      console.error('Error loading dismissed notifications:', error);
      this.dismissedIds = new Set();
    }
  }

  /**
   * Save dismissed notification IDs to localStorage
   */
  private saveDismissed(): void {
    try {
      const data: Record<string, string> = {};
      this.dismissedIds.forEach(id => {
        data[id] = new Date().toISOString();
      });
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Error saving dismissed notifications:', error);
    }
  }

  /**
   * Load week-scoped reminder dismissals from localStorage.
   * Entries are keyed by ISO week ("YYYY-Www"). We prune anything older than
   * the previous week so the store stays small while keeping the current and
   * prior week (the prior week guards against a cron/clock edge at week roll).
   *
   * Pruning MUST use the store timezone, because the dismiss key is written in
   * store tz (the id suffix produced by notificationEngine). Using the browser
   * tz here would, at the Sunday/Monday border for a store in a different
   * offset, compute a different "current week" than the one that was dismissed
   * and drop a still-valid dismiss, making the reminder reappear once.
   *
   * Until the store timezone is known (before the first updateNotifications),
   * we keep every key untouched rather than prune with the wrong tz.
   */
  private loadDismissedWeekly(): void {
    try {
      const stored = localStorage.getItem(DISMISSED_WEEKLY_KEY);
      if (!stored) {
        this.dismissedWeeklyReminders = new Set();
        return;
      }

      const weeks: string[] = JSON.parse(stored);
      if (!Array.isArray(weeks)) {
        this.dismissedWeeklyReminders = new Set();
        return;
      }

      // Store tz not yet known: load all keys, defer pruning to avoid dropping
      // a valid dismiss using the browser timezone.
      if (!this.storeTimezone) {
        this.dismissedWeeklyReminders = new Set(weeks);
        return;
      }

      const currentWeek = getISOWeekKey(undefined, this.storeTimezone);
      const lastWeek = getISOWeekKey(
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        this.storeTimezone
      );
      const valid = weeks.filter(w => w === currentWeek || w === lastWeek);
      this.dismissedWeeklyReminders = new Set(valid);

      if (valid.length !== weeks.length) {
        this.saveDismissedWeekly();
      }
    } catch (error) {
      console.error('Error loading weekly dismissed reminders:', error);
      this.dismissedWeeklyReminders = new Set();
    }
  }

  /**
   * Persist week-scoped reminder dismissals to localStorage.
   */
  private saveDismissedWeekly(): void {
    try {
      localStorage.setItem(
        DISMISSED_WEEKLY_KEY,
        JSON.stringify(Array.from(this.dismissedWeeklyReminders))
      );
    } catch (error) {
      console.error('Error saving weekly dismissed reminders:', error);
    }
  }

  /**
   * Generate and merge new notifications with existing ones
   */
  updateNotifications(data: NotificationEngineData): void {
    // Capture the store timezone so the weekly dismiss pruner uses the same tz
    // the dismiss keys were written in. Re-prune when it first becomes known or
    // changes, since the constructor-time load deferred pruning (no tz yet).
    if (data.storeTimezone && data.storeTimezone !== this.storeTimezone) {
      this.storeTimezone = data.storeTimezone;
      this.loadDismissedWeekly();
    }

    const newNotifications = generateNotifications(data, {
      preferences: this.preferences,
      dismissedIds: this.dismissedIds,
      dismissedWeeklyReminders: this.dismissedWeeklyReminders,
      featureFlags: data.featureFlags,
    });

    // Create a map of existing notifications by ID
    const existingMap = new Map(
      this.notifications.map(n => [n.id, n])
    );

    // Merge: keep read status for existing notifications, add new ones
    const mergedNotifications: Notification[] = [];
    const existingIds = new Set<string>();

    newNotifications.forEach(newNotif => {
      const existing = existingMap.get(newNotif.id);

      if (existing) {
        mergedNotifications.push({
          ...newNotif,
          read: existing.read,
          timestamp: existing.timestamp,
        });
        existingIds.add(newNotif.id);
      } else {
        mergedNotifications.push(newNotif);
      }
    });

    // Keep read notifications for history (24 hours)
    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 24);

    this.notifications.forEach(oldNotif => {
      if (!existingIds.has(oldNotif.id) && oldNotif.read) {
        const notifDate = new Date(oldNotif.timestamp);
        if (notifDate >= yesterday) {
          // This notification was not regenerated this pass, so its underlying
          // condition is no longer active (order confirmed, stock replenished,
          // affected set changed -> new id). Force live=false so the red
          // live-signal badge does not keep counting a resolved condition.
          mergedNotifications.push({ ...oldNotif, live: false });
        }
      }
    });

    // Sort by priority then category
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const categoryOrder = { urgent: 0, action_required: 1, informational: 2 };

    mergedNotifications.sort((a, b) => {
      // Unread first
      if (a.read !== b.read) return a.read ? 1 : -1;

      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;

      const catA = a.category || 'informational';
      const catB = b.category || 'informational';
      return categoryOrder[catA] - categoryOrder[catB];
    });

    this.notifications = mergedNotifications;
    this.saveToStorage();
    this.broadcast({ type: 'NOTIFICATIONS_UPDATED' });
  }

  /**
   * Get all notifications (respecting max visible preference)
   */
  getAll(): Notification[] {
    return [...this.notifications].slice(0, this.preferences.maxVisibleNotifications);
  }

  /**
   * Get all notifications without limit (for history view)
   */
  getAllUnlimited(): Notification[] {
    return [...this.notifications];
  }

  /**
   * Get unread notifications
   */
  getUnread(): Notification[] {
    return this.notifications.filter(n => !n.read);
  }

  /**
   * Get unread count
   */
  getUnreadCount(): number {
    return countUnreadNotifications(this.notifications);
  }

  /**
   * Get urgent notifications count (for badge styling)
   */
  getUrgentCount(): number {
    return this.notifications.filter(n => !n.read && n.category === 'urgent').length;
  }

  /**
   * Count of UNREAD actionable notifications (urgent + action_required). Drives
   * the visible bell badge: marking a notification read decrements it, and
   * markAllAsRead zeroes it. Informational notifications (e.g. tomorrow's
   * deliveries) are excluded so they do not raise an alarm badge.
   *
   * Does not regress the original invisible-badge bug: notification ids carry a
   * content fingerprint, so a new or changed condition gets a distinct id, is
   * not matched by the merge, arrives unread, and the badge reappears on its
   * own. An already-read condition with an unchanged id keeps its read flag and
   * does not re-inflate the badge.
   */
  getUnreadActionableCount(): number {
    return countUnreadActionableNotifications(this.notifications);
  }

  /**
   * True when at least one UNREAD actionable notification is urgent. Lets the
   * badge pick red (urgent) vs amber (action-required) without recomputing in
   * the UI.
   */
  hasUrgentUnread(): boolean {
    return hasUrgentUnreadNotification(this.notifications);
  }

  /**
   * Count of notifications whose underlying condition is currently active and
   * actionable (urgent or action_required), independent of read state. Retained
   * for non-badge consumers; no longer drives the visible bell badge.
   */
  getLiveCount(): number {
    return countLiveNotifications(this.notifications);
  }

  /**
   * True when at least one live condition is urgent. Retained for non-badge
   * consumers; no longer drives the visible bell badge.
   */
  hasUrgentLive(): boolean {
    return hasUrgentLiveNotification(this.notifications);
  }

  /**
   * Mark a notification as read
   */
  markAsRead(id: string): void {
    const notification = this.notifications.find(n => n.id === id);
    if (notification && !notification.read) {
      notification.read = true;
      this.saveToStorage();
      this.broadcast({ type: 'MARK_READ', ids: [id] });
      // Same-tab listeners (NotificationProvider) only react to notifyListeners;
      // broadcast reaches other tabs. Fire both so the local badge updates.
      this.notifyListeners();
    }
  }

  /**
   * Mark multiple notifications as read
   */
  markMultipleAsRead(ids: string[]): void {
    let changed = false;
    const changedIds: string[] = [];
    ids.forEach(id => {
      const notification = this.notifications.find(n => n.id === id);
      if (notification && !notification.read) {
        notification.read = true;
        changed = true;
        changedIds.push(id);
      }
    });
    if (changed) {
      this.saveToStorage();
      this.broadcast({ type: 'MARK_READ', ids: changedIds });
      this.notifyListeners();
    }
  }

  /**
   * Mark all notifications as read
   */
  markAllAsRead(): void {
    let changed = false;
    this.notifications.forEach(n => {
      if (!n.read) {
        n.read = true;
        changed = true;
      }
    });
    if (changed) {
      this.saveToStorage();
      this.broadcast({ type: 'MARK_ALL_READ' });
      this.notifyListeners();
    }
  }

  /**
   * Dismiss a notification (won't show again for 24 hours)
   */
  dismiss(id: string): void {
    this.dismissedIds.add(id);
    this.saveDismissed();

    // Weekly reminders need a week-scoped dismissal so they do not bounce back
    // once the 24h dismiss window expires. The week key is the id suffix.
    if (id.startsWith(WEEKLY_AD_SPEND_PREFIX)) {
      const weekKey = id.slice(WEEKLY_AD_SPEND_PREFIX.length);
      if (weekKey) {
        this.dismissedWeeklyReminders.add(weekKey);
        this.saveDismissedWeekly();
      }
    }

    // Also remove from current notifications
    const index = this.notifications.findIndex(n => n.id === id);
    if (index !== -1) {
      this.notifications.splice(index, 1);
      this.saveToStorage();
    }

    this.broadcast({ type: 'DISMISSED_UPDATED' });
    this.notifyListeners();
  }

  /**
   * Delete a notification
   */
  delete(id: string): void {
    const index = this.notifications.findIndex(n => n.id === id);
    if (index !== -1) {
      this.notifications.splice(index, 1);
      this.saveToStorage();
      this.broadcast({ type: 'NOTIFICATIONS_UPDATED' });
    }
  }

  /**
   * Clear all notifications
   */
  clearAll(): void {
    this.notifications = [];
    this.saveToStorage();
    this.broadcast({ type: 'CLEAR_ALL' });
    this.notifyListeners();
  }

  /**
   * Clear read notifications
   */
  clearRead(): void {
    this.notifications = this.notifications.filter(n => !n.read);
    this.saveToStorage();
    this.broadcast({ type: 'NOTIFICATIONS_UPDATED' });
  }

  /**
   * Get current preferences
   */
  getPreferences(): NotificationPreferences {
    return { ...this.preferences };
  }

  /**
   * Update preferences
   */
  updatePreferences(updates: Partial<NotificationPreferences>): void {
    this.preferences = { ...this.preferences, ...updates };
    this.savePreferences();
    this.broadcast({ type: 'PREFERENCES_UPDATED' });
  }

  /**
   * Reset preferences to defaults
   */
  resetPreferences(): void {
    this.preferences = DEFAULT_NOTIFICATION_PREFERENCES;
    this.savePreferences();
    this.broadcast({ type: 'PREFERENCES_UPDATED' });
  }

  /**
   * Clear all dismissed notifications
   */
  clearDismissed(): void {
    this.dismissedIds.clear();
    this.dismissedWeeklyReminders.clear();
    this.saveDismissed();
    this.saveDismissedWeekly();
    this.broadcast({ type: 'DISMISSED_UPDATED' });
  }

  /**
   * Cleanup method - closes BroadcastChannel and removes event listeners
   * Use this for programmatic cleanup (e.g., in tests or when replacing the service)
   */
  destroy(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.handleBeforeUnload);
    }
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.listeners.clear();
  }
}

// Export singleton instance
export const notificationsService = new NotificationsService();
