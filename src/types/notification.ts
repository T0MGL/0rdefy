export type NotificationType = 'order' | 'stock' | 'ads' | 'carrier' | 'system';
export type NotificationPriority = 'low' | 'medium' | 'high';
export type NotificationCategory = 'urgent' | 'action_required' | 'informational';

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  timestamp: string;
  read: boolean;
  priority: NotificationPriority;
  category: NotificationCategory;
  actionUrl?: string;
  actionLabel?: string; // Clear CTA text like "Confirmar pedidos" or "Reponer stock"

  // Metadata for specific navigation and better UX
  metadata?: {
    orderId?: string;
    productId?: string;
    adId?: string;
    carrierId?: string;
    count?: number; // Number of items affected
    itemIds?: string[]; // List of affected item IDs
    timeReference?: string; // Original time for accurate "time ago" display
  };

  // UX improvements
  snoozedUntil?: string; // ISO date - if set, notification is hidden until this time
  dismissedAt?: string; // ISO date - when user dismissed (won't show again for same issue)
  lastShownAt?: string; // ISO date - for throttling repeated notifications
}

/**
 * User preferences for notifications
 */
export interface NotificationPreferences {
  // Enable/disable by type
  enableOrderNotifications: boolean;
  enableStockNotifications: boolean;
  enableCarrierNotifications: boolean;
  enableAdsNotifications: boolean;

  // Thresholds
  stockThreshold: number; // Default 10, user can adjust
  pendingOrderHoursThreshold: number; // Default 24, user can adjust

  // Quiet hours (don't show non-critical notifications)
  quietHoursEnabled: boolean;
  quietHoursStart: string; // "22:00"
  quietHoursEnd: string; // "08:00"

  // Aggregation preference
  preferAggregatedNotifications: boolean; // true = summaries, false = individual

  // Max notifications to show
  maxVisibleNotifications: number; // Default 10
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enableOrderNotifications: true,
  enableStockNotifications: true,
  enableCarrierNotifications: true,
  enableAdsNotifications: true,
  stockThreshold: 10,
  pendingOrderHoursThreshold: 24,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
  preferAggregatedNotifications: true,
  maxVisibleNotifications: 10,
};
