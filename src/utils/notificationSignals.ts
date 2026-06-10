/**
 * Pure derivations of the two notification badge signals (Fix 1):
 *
 *  - LIVE: conditions currently active and unresolved (red/amber badge).
 *    Independent of read state, so a notification the operator already saw but
 *    has not acted on keeps signalling. Only urgent + action_required count;
 *    informational notifications (e.g. tomorrow's deliveries) are heads-ups,
 *    not unresolved problems.
 *  - UNREAD: new since the operator last looked (blue "new" indicator).
 *
 * Kept Vite-free so the badge logic is unit-testable under the Node runner. The
 * NotificationsService delegates to these so there is a single source of truth.
 */
import type { Notification } from '@/types/notification';

/** Notifications whose underlying condition is active and actionable. */
export function countLiveNotifications(notifications: Notification[]): number {
  return notifications.filter(
    n => n.live === true && (n.category === 'urgent' || n.category === 'action_required')
  ).length;
}

/** True when at least one live condition is urgent (red vs amber selection). */
export function hasUrgentLiveNotification(notifications: Notification[]): boolean {
  return notifications.some(n => n.live === true && n.category === 'urgent');
}

/** New-since-last-seen count. Drives the blue indicator. */
export function countUnreadNotifications(notifications: Notification[]): number {
  return notifications.filter(n => !n.read).length;
}
