/**
 * Pure derivations of the notification badge signals.
 *
 * The bell badge reflects UNREAD work, so marking a notification read lowers it
 * and "marcar todo leido" takes it to 0 (Fix 3, the visible-badge fix). The
 * number itself is the count of unread ACTIONABLE notifications (urgent +
 * action_required); informational ones (e.g. tomorrow's deliveries) are
 * heads-ups, not an alarm, so they do not drive the red/amber badge. Color is
 * red when any unread actionable is urgent, amber otherwise.
 *
 * This does NOT regress the original "read once kills the badge forever" bug:
 * notification ids carry a content fingerprint (hashItemIds), so a NEW or
 * CHANGED condition (a fresh pending order, a different ISO week on the weekly
 * reminder, an order crossing warning -> critical) produces a DISTINCT id. The
 * merge-by-id in NotificationsService only copies the prior `read` flag when the
 * id is identical, so a new condition arrives unread and the badge reappears on
 * its own, while an already-read condition with an unchanged id stays read and
 * does not re-inflate the badge.
 *
 * The LIVE helpers (condition active regardless of read state) are retained for
 * non-badge consumers (e.g. accessibility copy / future surfaces) but no longer
 * drive the visible count.
 *
 * Kept Vite-free so the badge logic is unit-testable under the Node runner. The
 * NotificationsService delegates to these so there is a single source of truth.
 */
import type { Notification } from '@/types/notification';

/** True when a notification is an unresolved, actionable problem. */
function isActionable(n: Notification): boolean {
  return n.category === 'urgent' || n.category === 'action_required';
}

/**
 * Unread + actionable count. Drives the visible bell badge number. Marking a
 * notification read decrements it; "marcar todo leido" zeroes it.
 */
export function countUnreadActionableNotifications(notifications: Notification[]): number {
  return notifications.filter(n => !n.read && isActionable(n)).length;
}

/** True when at least one UNREAD actionable notification is urgent (red vs amber). */
export function hasUrgentUnreadNotification(notifications: Notification[]): boolean {
  return notifications.some(n => !n.read && n.category === 'urgent');
}

/** Notifications whose underlying condition is active and actionable, ignoring read state. */
export function countLiveNotifications(notifications: Notification[]): number {
  return notifications.filter(n => n.live === true && isActionable(n)).length;
}

/** True when at least one live condition is urgent (red vs amber selection). */
export function hasUrgentLiveNotification(notifications: Notification[]): boolean {
  return notifications.some(n => n.live === true && n.category === 'urgent');
}

/** Total unread count (any category). */
export function countUnreadNotifications(notifications: Notification[]): number {
  return notifications.filter(n => !n.read).length;
}
