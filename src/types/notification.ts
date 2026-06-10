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

  /**
   * True when the underlying condition is currently active (e.g. there is still
   * a pending order older than the threshold, a product is still out of stock).
   * Drives the red "live signal" badge independently of read state: a condition
   * the operator already saw but has not resolved keeps signalling. Set by the
   * engine on every generation pass.
   */
  live?: boolean;

  /**
   * Plan feature that gates this notification. Operational notifications (orders,
   * stock) leave this undefined and always apply. Notifications tied to an
   * optional module (ads -> campaign_tracking, carrier performance ->
   * carrier_integrations) carry the feature key so the engine can suppress them
   * when the plan does not include the module. This is NOT an upsell teaser:
   * a gated-out notification is simply not generated.
   */
  featureKey?: string;

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

  // Recurring operational reminders (e.g. weekly ad spend logging prompt)
  enableWeeklyReminders: boolean;

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
  enableWeeklyReminders: true,
  stockThreshold: 10,
  pendingOrderHoursThreshold: 24,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00',
  preferAggregatedNotifications: true,
  maxVisibleNotifications: 10,
};
