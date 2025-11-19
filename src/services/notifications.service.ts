import { Notification } from '@/types/notification';
import { generateNotifications } from '@/utils/notificationEngine';
import type { Order, Product, Ad } from '@/types';
import type { Carrier } from '@/services/carriers.service';

const STORAGE_KEY = 'ordefy_notifications';
const STORAGE_VERSION = '1.0';

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

class NotificationsService {
  private notifications: Notification[] = [];

  constructor() {
    this.loadFromStorage();
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

      // Save cleaned data back
      if (this.notifications.length !== data.notifications.length) {
        this.saveToStorage();
      }
    } catch (error) {
      console.error('Error loading notifications from storage:', error);
      this.notifications = [];
    }
  }

  /**
   * Save notifications to localStorage
   */
  private saveToStorage(): void {
    try {
      const data: StoredNotifications = {
        version: STORAGE_VERSION,
        notifications: this.notifications,
        lastUpdated: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Error saving notifications to storage:', error);
    }
  }

  /**
   * Generate and merge new notifications with existing ones
   */
  updateNotifications(data: NotificationEngineData): void {
    const newNotifications = generateNotifications(data);

    // Create a map of existing notifications by ID
    const existingMap = new Map(
      this.notifications.map(n => [n.id, n])
    );

    // Merge: keep read status for existing notifications, add new ones
    const mergedNotifications: Notification[] = [];
    const existingIds = new Set<string>();

    // Process new notifications
    newNotifications.forEach(newNotif => {
      const existing = existingMap.get(newNotif.id);

      if (existing) {
        // Keep the read status from existing notification
        mergedNotifications.push({
          ...newNotif,
          read: existing.read,
          timestamp: existing.timestamp, // Keep original timestamp
        });
        existingIds.add(newNotif.id);
      } else {
        // This is a truly new notification
        mergedNotifications.push(newNotif);
      }
    });

    // Keep read notifications that are no longer active (for history)
    // but only if they're less than 24 hours old
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

    // Sort by timestamp (newest first)
    mergedNotifications.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    this.notifications = mergedNotifications;
    this.saveToStorage();
  }

  /**
   * Get all notifications
   */
  getAll(): Notification[] {
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
   * Mark a notification as read
   */
  markAsRead(id: string): void {
    const notification = this.notifications.find(n => n.id === id);
    if (notification && !notification.read) {
      notification.read = true;
      this.saveToStorage();
    }
  }

  /**
   * Mark multiple notifications as read
   */
  markMultipleAsRead(ids: string[]): void {
    let changed = false;
    ids.forEach(id => {
      const notification = this.notifications.find(n => n.id === id);
      if (notification && !notification.read) {
        notification.read = true;
        changed = true;
      }
    });
    if (changed) {
      this.saveToStorage();
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
    }
  }

  /**
   * Delete a notification
   */
  delete(id: string): void {
    const index = this.notifications.findIndex(n => n.id === id);
    if (index !== -1) {
      this.notifications.splice(index, 1);
      this.saveToStorage();
    }
  }

  /**
   * Clear all notifications
   */
  clearAll(): void {
    this.notifications = [];
    this.saveToStorage();
  }

  /**
   * Clear read notifications
   */
  clearRead(): void {
    this.notifications = this.notifications.filter(n => !n.read);
    this.saveToStorage();
  }
}

// Export singleton instance
export const notificationsService = new NotificationsService();
