import { Notification, NotificationPreferences, DEFAULT_NOTIFICATION_PREFERENCES } from '@/types/notification';
import { generateNotifications } from '@/utils/notificationEngine';
import type { Order, Product, Ad } from '@/types';
import type { Carrier } from '@/services/carriers.service';

const STORAGE_KEY = 'ordefy_notifications';
const PREFERENCES_KEY = 'ordefy_notification_preferences';
const DISMISSED_KEY = 'ordefy_dismissed_notifications';
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
  private channel: BroadcastChannel | null = null;
  private listeners: Set<NotificationListener> = new Set();

  constructor() {
    this.loadFromStorage();
    this.loadPreferences();
    this.loadDismissed();
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
   */
  subscribe(listener: NotificationListener): () => void {
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
   * Generate and merge new notifications with existing ones
   */
  updateNotifications(data: NotificationEngineData): void {
    const newNotifications = generateNotifications(data, {
      preferences: this.preferences,
      dismissedIds: this.dismissedIds,
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
          mergedNotifications.push(oldNotif);
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
    return this.notifications.filter(n => !n.read).length;
  }

  /**
   * Get urgent notifications count (for badge styling)
   */
  getUrgentCount(): number {
    return this.notifications.filter(n => !n.read && n.category === 'urgent').length;
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
    }
  }

  /**
   * Dismiss a notification (won't show again for 24 hours)
   */
  dismiss(id: string): void {
    this.dismissedIds.add(id);
    this.saveDismissed();

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
    this.saveDismissed();
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
