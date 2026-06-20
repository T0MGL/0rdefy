import { Notification, NotificationPreferences, DEFAULT_NOTIFICATION_PREFERENCES } from '@/types/notification';
import type { Order, Product, Ad } from '@/types';
import type { Carrier } from '@/services/carriers.service';
import { isOlderThan, getHoursDifference, formatTimeAgo, getNow, getISOWeekKey } from './timeUtils';
import { isConfirmed, isPending, isReadyToShip } from '@/lib/status';
import { logger } from '@/utils/logger';
import { hashItemIds } from './notificationIds';

interface NotificationEngineData {
  orders: Order[];
  products: Product[];
  ads: Ad[];
  carriers: Carrier[];
  /**
   * True when ad spend was already logged for the current week (computed
   * server-side). When false (or undefined for a store that has ad data),
   * the weekly ad-spend reminder is eligible to fire.
   */
  adSpendLoggedThisWeek?: boolean;
  /**
   * IANA store timezone. Used to compute the weekly ad-spend reminder week key
   * in the same timezone as the server-side gate that sets adSpendLoggedThisWeek.
   * Without it the browser timezone is used, which can disagree at the
   * Sunday/Monday border for stores in a different offset (e.g. Asuncion).
   */
  storeTimezone?: string;
}

/**
 * Per-feature gate flags. Each maps to a plan feature checked via
 * SubscriptionContext.hasFeature. Operational notifications (orders, stock) are
 * never gated. Optional-module notifications are only generated when the plan
 * includes the module:
 *   - ads / weekly ad-spend reminder -> campaign_tracking
 *   - carrier performance            -> carrier_integrations
 *
 * Undefined means "unknown" and is treated as enabled, so a store whose plan is
 * still loading never loses its operational notifications. The caller is
 * responsible for passing the resolved flags once the subscription is known.
 */
export interface NotificationFeatureFlags {
  ads?: boolean;
  carriers?: boolean;
}

interface NotificationEngineOptions {
  preferences?: NotificationPreferences;
  dismissedIds?: Set<string>;
  /**
   * Week keys ("YYYY-Www") the user already dismissed the weekly ad-spend
   * reminder for. Persisted separately from the 24h dismiss list so a dismiss
   * sticks for the whole week instead of reappearing the next day.
   */
  dismissedWeeklyReminders?: Set<string>;
  /**
   * Plan-feature gates. When omitted, every gate defaults to enabled so a store
   * with an unknown plan still receives operational notifications.
   */
  featureFlags?: NotificationFeatureFlags;
}

// Content-fingerprint helper for notification ids. Lives in a Vite-free module
// (./notificationIds) so it is unit-testable under the Node runner. It is
// imported above for internal use and re-exported here for callers that already
// import id helpers from the engine.
export { hashItemIds };

/**
 * Safely get a string value, returning fallback if null/undefined
 */
function safeString(value: string | null | undefined, fallback: string = ''): string {
  return value ?? fallback;
}

/**
 * Safely get a number value, returning 0 if null/undefined/NaN
 */
function safeNumber(value: number | null | undefined): number {
  if (value === null || value === undefined || isNaN(value)) return 0;
  return value;
}

/**
 * Validate that an order has required fields for notification processing
 */
function isValidOrder(order: any): order is Order {
  return (
    order &&
    typeof order.id === 'string' &&
    typeof order.status === 'string' &&
    order.date !== undefined
  );
}

/**
 * Validate that a product has required fields for notification processing
 */
function isValidProduct(product: any): product is Product {
  return (
    product &&
    typeof product.id === 'string' &&
    typeof product.stock === 'number'
  );
}

/**
 * Validate that a carrier has required fields for notification processing
 */
function isValidCarrier(carrier: any): carrier is Carrier {
  return (
    carrier &&
    typeof carrier.id === 'string'
  );
}

/**
 * Validate that an ad has required fields for notification processing
 */
function isValidAd(ad: any): ad is Ad {
  return (
    ad &&
    typeof ad.id === 'string' &&
    typeof ad.status === 'string'
  );
}

/**
 * Smart notification engine that generates actionable, non-intrusive notifications
 *
 * UX Principles:
 * 1. Aggregate similar issues into single notifications when possible
 * 2. Only show notifications that require action
 * 3. Provide clear, actionable CTAs
 * 4. Respect user preferences and quiet hours
 * 5. Limit total notifications to avoid overwhelming users
 *
 * Error Handling:
 * - All data is validated before processing
 * - Invalid items are skipped silently
 * - Function never throws - returns empty array on critical error
 */
export function generateNotifications(
  data: NotificationEngineData,
  options: NotificationEngineOptions = {}
): Notification[] {
  try {
    // Validate input data - return empty if invalid
    if (!data || typeof data !== 'object') {
      return [];
    }

    // Safely extract arrays with fallback to empty
    const orders = Array.isArray(data.orders) ? data.orders.filter(isValidOrder) : [];
    const products = Array.isArray(data.products) ? data.products.filter(isValidProduct) : [];
    const ads = Array.isArray(data.ads) ? data.ads.filter(isValidAd) : [];
    const carriers = Array.isArray(data.carriers) ? data.carriers.filter(isValidCarrier) : [];

    const preferences = options.preferences || DEFAULT_NOTIFICATION_PREFERENCES;
    const dismissedIds = options.dismissedIds || new Set<string>();
    const dismissedWeeklyReminders = options.dismissedWeeklyReminders || new Set<string>();
    // Per-feature gates. Undefined defaults to enabled (see NotificationFeatureFlags)
    // so operational notifications never disappear while the plan is loading.
    const flags = options.featureFlags || {};
    const adsFeatureEnabled = flags.ads !== false;
    const carriersFeatureEnabled = flags.carriers !== false;
    const notifications: Notification[] = [];

    // Check quiet hours for non-critical notifications
    const isQuietHours = checkQuietHours(preferences);

    // ═══════════════════════════════════════════════════════════════════════════
    // ORDER NOTIFICATIONS
    // ═══════════════════════════════════════════════════════════════════════════
    if (preferences.enableOrderNotifications && orders.length > 0) {
      // Critical: Orders pending >48h - These need URGENT attention
      const criticalPending = orders.filter(o => {
        try {
          return isPending(o.status) && isOlderThan(o.date, 48);
        } catch {
          return false;
        }
      });

      const criticalPendingId = `notif-orders-critical-pending-${hashItemIds(criticalPending.map(o => o.id))}`;
      if (criticalPending.length > 0 && !dismissedIds.has(criticalPendingId)) {
        try {
          const oldestOrder = criticalPending.reduce((oldest, o) => {
            try {
              return new Date(o.date) < new Date(oldest.date) ? o : oldest;
            } catch {
              return oldest;
            }
          });

          // Use the oldest order as the headline so the single-order copy names
          // the most overdue customer, not just whatever happened to be first.
          const headlineName = safeString(oldestOrder?.customer, 'Cliente');

          notifications.push({
            id: criticalPendingId,
            type: 'order',
            category: 'urgent',
            priority: 'high',
            live: true,
            message: criticalPending.length === 1
              ? `Pedido de ${headlineName} lleva ${formatTimeAgo(oldestOrder.date)} sin confirmar`
              : `${criticalPending.length} pedidos llevan más de 48 horas sin confirmar`,
            actionLabel: criticalPending.length === 1 ? 'Ver pedido' : 'Confirmar pedidos',
            actionUrl: criticalPending.length === 1
              ? `/orders?filter=pending&highlight=${oldestOrder.id}`
              : '/orders?filter=pending',
            timestamp: getNow().toISOString(),
            read: false,
            metadata: {
              count: criticalPending.length,
              itemIds: criticalPending.map(o => o.id),
              timeReference: oldestOrder.date,
            },
          });
        } catch (error) {
          // Skip this notification if there's an error processing it
          logger.warn('Error generating critical pending notification:', error);
        }
      }

      // Warning: Orders pending 24-48h - Action required but not critical
      const warningPending = orders.filter(o => {
        try {
          return (
            isPending(o.status) &&
            isOlderThan(o.date, preferences.pendingOrderHoursThreshold) &&
            !isOlderThan(o.date, 48)
          );
        } catch {
          return false;
        }
      });

      const warningPendingId = `notif-orders-warning-pending-${hashItemIds(warningPending.map(o => o.id))}`;
      if (warningPending.length > 0 && !isQuietHours && !dismissedIds.has(warningPendingId)) {
        notifications.push({
          id: warningPendingId,
          type: 'order',
          category: 'action_required',
          priority: 'medium',
          live: true,
          message: `${warningPending.length} pedido${warningPending.length > 1 ? 's pendientes' : ' pendiente'} de confirmación`,
          actionLabel: 'Revisar pedidos',
          actionUrl: '/orders?filter=pending',
          timestamp: getNow().toISOString(),
          read: false,
          metadata: {
            count: warningPending.length,
            itemIds: warningPending.map(o => o.id),
          },
        });
      }

      // Medium priority: Orders awaiting carrier assignment (separate confirmation flow)
      // These are sales confirmed by confirmadores but need carrier assignment by admin
      // 'awaiting_carrier' is a legacy pre-148c VARCHAR; explicit literal kept.
      const awaitingCarrier = orders.filter(o => {
        try {
          return o.status === 'awaiting_carrier';
        } catch {
          return false;
        }
      });

      const awaitingCarrierId = `notif-orders-awaiting-carrier-${hashItemIds(awaitingCarrier.map(o => o.id))}`;
      if (awaitingCarrier.length > 0 && !dismissedIds.has(awaitingCarrierId)) {
        notifications.push({
          id: awaitingCarrierId,
          type: 'order',
          category: 'action_required',
          priority: 'medium',
          live: true,
          message: `${awaitingCarrier.length} pedido${awaitingCarrier.length > 1 ? 's esperan' : ' espera'} asignación de repartidor`,
          actionLabel: 'Asignar repartidores',
          actionUrl: '/orders?filter=awaiting_carrier',
          timestamp: getNow().toISOString(),
          read: false,
          metadata: {
            count: awaitingCarrier.length,
            itemIds: awaitingCarrier.map(o => o.id),
          },
        });
      }

      // Informational: Deliveries scheduled for tomorrow - Plan ahead
      try {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        const dayAfterTomorrow = new Date(tomorrow);
        dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 1);

        const tomorrowDeliveries = orders.filter(o => {
          try {
            if (!isConfirmed(o.status) && !isReadyToShip(o.status)) return false;
            if (!o.delivery_date) return false;
            const deliveryDate = new Date(o.delivery_date);
            if (isNaN(deliveryDate.getTime())) return false;
            deliveryDate.setHours(0, 0, 0, 0);
            return deliveryDate >= tomorrow && deliveryDate < dayAfterTomorrow;
          } catch {
            return false;
          }
        });

        const tomorrowDeliveriesId = `notif-deliveries-tomorrow-${hashItemIds(tomorrowDeliveries.map(o => o.id))}`;
        if (tomorrowDeliveries.length > 0 && !isQuietHours && !dismissedIds.has(tomorrowDeliveriesId)) {
          notifications.push({
            id: tomorrowDeliveriesId,
            type: 'order',
            category: 'informational',
            priority: 'low',
            message: `${tomorrowDeliveries.length} entrega${tomorrowDeliveries.length > 1 ? 's programadas' : ' programada'} para mañana`,
            actionLabel: 'Ver entregas',
            actionUrl: '/orders?filter=confirmed',
            timestamp: getNow().toISOString(),
            read: false,
            metadata: {
              count: tomorrowDeliveries.length,
              itemIds: tomorrowDeliveries.map(o => o.id),
            },
          });
        }
      } catch (error) {
        logger.warn('Error generating tomorrow deliveries notification:', error);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STOCK NOTIFICATIONS
    // ═══════════════════════════════════════════════════════════════════════════
    if (preferences.enableStockNotifications && products.length > 0) {
      // Critical: Products completely out of stock
      const outOfStock = products.filter(p => safeNumber(p.stock) === 0);

      const outOfStockId = `notif-stock-out-${hashItemIds(outOfStock.map(p => p.id))}`;
      if (outOfStock.length > 0 && !dismissedIds.has(outOfStockId)) {
        const productName = safeString(outOfStock[0]?.name, 'Producto');

        notifications.push({
          id: outOfStockId,
          type: 'stock',
          category: 'urgent',
          priority: 'high',
          live: true,
          message: outOfStock.length === 1
            ? `"${productName}" está agotado`
            : `${outOfStock.length} productos agotados`,
          actionLabel: 'Reponer stock',
          actionUrl: outOfStock.length === 1
            ? `/products?highlight=${outOfStock[0].id}`
            : '/products?filter=out-of-stock',
          timestamp: getNow().toISOString(),
          read: false,
          metadata: {
            count: outOfStock.length,
            itemIds: outOfStock.map(p => p.id),
          },
        });
      }

      // Warning: Low stock products (below threshold)
      const lowStock = products.filter(p => {
        const stock = safeNumber(p.stock);
        return stock > 0 && stock < preferences.stockThreshold;
      });

      const lowStockId = `notif-stock-low-${hashItemIds(lowStock.map(p => p.id))}`;
      if (lowStock.length > 0 && !isQuietHours && !dismissedIds.has(lowStockId)) {
        notifications.push({
          id: lowStockId,
          type: 'stock',
          category: 'action_required',
          priority: 'medium',
          live: true,
          message: `${lowStock.length} producto${lowStock.length > 1 ? 's con' : ' con'} stock bajo`,
          actionLabel: 'Ver productos',
          actionUrl: '/products?filter=low-stock',
          timestamp: getNow().toISOString(),
          read: false,
          metadata: {
            count: lowStock.length,
            itemIds: lowStock.map(p => p.id),
          },
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CARRIER NOTIFICATIONS
    // ═══════════════════════════════════════════════════════════════════════════
    // Carrier performance notifications are gated to the carrier_integrations
    // feature: a store without the carriers module has no actionable surface for
    // these, so they are not generated (not shown as a locked teaser).
    if (preferences.enableCarrierNotifications && carriersFeatureEnabled && carriers.length > 0) {
      // Only alert on carriers with significant delivery history (>10 deliveries)
      const carriersWithHistory = carriers.filter(c => {
        const deliveries = safeNumber(c.total_deliveries) || safeNumber(c.totalShipments);
        return deliveries > 10;
      });

      // Critical: Carriers with very poor performance (<60%)
      const criticalCarriers = carriersWithHistory.filter(c =>
        safeNumber(c.delivery_rate) < 60
      );

      const criticalCarriersId = `notif-carriers-critical-${hashItemIds(criticalCarriers.map(c => c.id))}`;
      if (criticalCarriers.length > 0 && !dismissedIds.has(criticalCarriersId)) {
        const carrierName = safeString(criticalCarriers[0]?.name, 'Transportadora');
        const deliveryRate = safeNumber(criticalCarriers[0]?.delivery_rate);

        notifications.push({
          id: criticalCarriersId,
          type: 'carrier',
          category: 'urgent',
          priority: 'high',
          live: true,
          featureKey: 'carrier_integrations',
          message: criticalCarriers.length === 1
            ? `"${carrierName}" tiene ${deliveryRate}% de entregas exitosas`
            : `${criticalCarriers.length} transportadoras con rendimiento crítico`,
          actionLabel: 'Revisar rendimiento',
          actionUrl: criticalCarriers.length === 1
            ? `/carriers?highlight=${criticalCarriers[0].id}`
            : '/carriers?filter=poor-performance',
          timestamp: getNow().toISOString(),
          read: false,
          metadata: {
            count: criticalCarriers.length,
            itemIds: criticalCarriers.map(c => c.id),
          },
        });
      }

      // Warning: Carriers with poor performance (60-80%) - only show if no critical
      const warningCarriers = carriersWithHistory.filter(c => {
        const rate = safeNumber(c.delivery_rate);
        return rate >= 60 && rate < 80;
      });

      const warningCarriersId = `notif-carriers-warning-${hashItemIds(warningCarriers.map(c => c.id))}`;
      if (warningCarriers.length > 0 && criticalCarriers.length === 0 && !isQuietHours && !dismissedIds.has(warningCarriersId)) {
        notifications.push({
          id: warningCarriersId,
          type: 'carrier',
          category: 'action_required',
          priority: 'medium',
          live: true,
          featureKey: 'carrier_integrations',
          message: `${warningCarriers.length} transportadora${warningCarriers.length > 1 ? 's' : ''} con rendimiento mejorable`,
          actionLabel: 'Ver métricas',
          actionUrl: '/carriers?filter=poor-performance',
          timestamp: getNow().toISOString(),
          read: false,
          metadata: {
            count: warningCarriers.length,
            itemIds: warningCarriers.map(c => c.id),
          },
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADS/CAMPAIGN NOTIFICATIONS
    // ═══════════════════════════════════════════════════════════════════════════
    // Ads/ROAS notifications are gated to the campaign_tracking feature. A store
    // without the campaigns module cannot act on these, so they are not generated.
    if (preferences.enableAdsNotifications && adsFeatureEnabled && ads.length > 0) {
      const activeAds = ads.filter(ad => ad.status === 'active');

      // Critical: Campaigns losing money (ROAS < 1.5)
      const criticalAds = activeAds.filter(ad => {
        const roas = safeNumber(ad.roas);
        return roas > 0 && roas < 1.5; // Only if ROAS is set and low
      });

      const criticalAdsId = `notif-ads-critical-${hashItemIds(criticalAds.map(ad => ad.id))}`;
      if (criticalAds.length > 0 && !dismissedIds.has(criticalAdsId)) {
        const adName = safeString(criticalAds[0]?.name, 'Campaña');
        const roas = safeNumber(criticalAds[0]?.roas);

        notifications.push({
          id: criticalAdsId,
          type: 'ads',
          category: 'urgent',
          priority: 'high',
          live: true,
          featureKey: 'campaign_tracking',
          message: criticalAds.length === 1
            ? `"${adName}" tiene ROAS de ${roas.toFixed(1)}x`
            : `${criticalAds.length} campañas con ROAS crítico`,
          actionLabel: 'Ver métricas',
          actionUrl: '/dashboard', // Ads page is placeholder
          timestamp: getNow().toISOString(),
          read: false,
          metadata: {
            count: criticalAds.length,
            itemIds: criticalAds.map(ad => ad.id),
          },
        });
      }

      // Warning: Low ROAS (1.5-2.5) - only if no critical
      const warningAds = activeAds.filter(ad => {
        const roas = safeNumber(ad.roas);
        return roas >= 1.5 && roas < 2.5;
      });

      const warningAdsId = `notif-ads-warning-${hashItemIds(warningAds.map(ad => ad.id))}`;
      if (warningAds.length > 0 && criticalAds.length === 0 && !isQuietHours && !dismissedIds.has(warningAdsId)) {
        notifications.push({
          id: warningAdsId,
          type: 'ads',
          category: 'action_required',
          priority: 'medium',
          live: true,
          featureKey: 'campaign_tracking',
          message: `${warningAds.length} campaña${warningAds.length > 1 ? 's' : ''} con ROAS mejorable`,
          actionLabel: 'Optimizar campañas',
          actionUrl: '/dashboard',
          timestamp: getNow().toISOString(),
          read: false,
          metadata: {
            count: warningAds.length,
            itemIds: warningAds.map(ad => ad.id),
          },
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // WEEKLY AD-SPEND REMINDER
    // ═══════════════════════════════════════════════════════════════════════════
    // Recurring nudge to keep marketing spend current so analytics (ROI, net
    // profit, margin) stays accurate. Product rules, not a blind timer:
    //   1. Only fires when spend has NOT been logged this week. If the user
    //      already entered it, we stay silent.
    //   2. The id is week-scoped, so it is a distinct notification each week and
    //      the read/dismiss state of last week never suppresses this week.
    //   3. A dismiss is persisted per week (dismissedWeeklyReminders), so it does
    //      not bounce back the next day like the 24h dismiss list would allow.
    //   4. Medium priority, respects quiet hours, timezone-aware week key.
    if (
      preferences.enableWeeklyReminders &&
      preferences.enableAdsNotifications &&
      adsFeatureEnabled &&
      data.adSpendLoggedThisWeek === false &&
      !isQuietHours
    ) {
      try {
        // Compute the week key in the store timezone so it lines up with the
        // server gate (adSpendLoggedThisWeek). Falls back to browser tz only if
        // the store tz was not supplied.
        const weekKey = getISOWeekKey(undefined, data.storeTimezone);
        const weeklyReminderId = `notif-ads-weekly-spend-${weekKey}`;

        if (
          !dismissedIds.has(weeklyReminderId) &&
          !dismissedWeeklyReminders.has(weekKey)
        ) {
          notifications.push({
            id: weeklyReminderId,
            type: 'ads',
            category: 'action_required',
            priority: 'medium',
            live: true,
            featureKey: 'campaign_tracking',
            message: 'Cargaste tus gastos de ads de esta semana? Mantenelos al dia para que tu rentabilidad sea exacta',
            actionLabel: 'Cargar gastos',
            actionUrl: '/ads',
            timestamp: getNow().toISOString(),
            read: false,
            metadata: {
              count: 1,
              // weekKey is an ISO week label ("YYYY-Www"), NOT a parseable date.
              // It already scopes the id and the dismiss set above; it must never
              // be used as timeReference or formatTimeAgo() would render "fecha
              // inválida". Omit timeReference so the row falls back to `timestamp`
              // (a valid ISO instant) and shows a correct relative time.
              weekKey,
            },
          });
        }
      } catch (error) {
        logger.warn('Error generating weekly ad-spend reminder:', error);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FINAL PROCESSING
    // ═══════════════════════════════════════════════════════════════════════════

    // Sort by priority (high > medium > low) then by category (urgent > action_required > informational)
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const categoryOrder: Record<string, number> = { urgent: 0, action_required: 1, informational: 2 };

    notifications.sort((a, b) => {
      const priorityDiff = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
      if (priorityDiff !== 0) return priorityDiff;
      return (categoryOrder[a.category] ?? 2) - (categoryOrder[b.category] ?? 2);
    });

    // Limit total notifications to avoid overwhelming the user
    const maxNotifications = Math.max(1, Math.min(50, preferences.maxVisibleNotifications || 10));
    return notifications.slice(0, maxNotifications);

  } catch (error) {
    // Critical error in notification generation - return empty to prevent app crash
    logger.error('Critical error in generateNotifications:', error);
    return [];
  }
}

/**
 * Check if current time is within quiet hours
 */
function checkQuietHours(preferences: NotificationPreferences): boolean {
  try {
    if (!preferences.quietHoursEnabled) return false;

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute;

    const startParts = (preferences.quietHoursStart || '22:00').split(':');
    const endParts = (preferences.quietHoursEnd || '08:00').split(':');

    const startHour = parseInt(startParts[0], 10) || 22;
    const startMinute = parseInt(startParts[1], 10) || 0;
    const endHour = parseInt(endParts[0], 10) || 8;
    const endMinute = parseInt(endParts[1], 10) || 0;

    const startTime = startHour * 60 + startMinute;
    const endTime = endHour * 60 + endMinute;

    // Handle overnight quiet hours (e.g., 22:00 - 08:00)
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime < endTime;
    }

    return currentTime >= startTime && currentTime < endTime;
  } catch {
    return false;
  }
}

/**
 * Get a human-readable summary of notification counts by category
 */
export function getNotificationSummary(notifications: Notification[]): {
  urgent: number;
  actionRequired: number;
  informational: number;
  total: number;
} {
  if (!Array.isArray(notifications)) {
    return { urgent: 0, actionRequired: 0, informational: 0, total: 0 };
  }

  return {
    urgent: notifications.filter(n => n?.category === 'urgent').length,
    actionRequired: notifications.filter(n => n?.category === 'action_required').length,
    informational: notifications.filter(n => n?.category === 'informational').length,
    total: notifications.length,
  };
}
