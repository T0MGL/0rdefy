/**
 * Tests for notification id hashing (content-fingerprinted ids) and the badge
 * signal derivations.
 *
 * These guard the core of the badge fix: a notification whose affected set
 * changes must become a DISTINCT id (so it does not inherit the read state of
 * the previous set), and the visible bell badge must reflect UNREAD actionable
 * work so marking a notification read lowers it.
 *
 * Run with `npm run test:unit`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashItemIds } from '../notificationIds';
import {
  countLiveNotifications,
  hasUrgentLiveNotification,
  countUnreadNotifications,
  countUnreadActionableNotifications,
  hasUrgentUnreadNotification,
} from '../notificationSignals';
import type { Notification } from '../../types/notification';

describe('hashItemIds', () => {
  it('is stable for the same set across calls', () => {
    const a = hashItemIds(['order-1', 'order-2', 'order-3']);
    const b = hashItemIds(['order-1', 'order-2', 'order-3']);
    assert.equal(a, b);
  });

  it('is order-independent (rows can come back in any order)', () => {
    const a = hashItemIds(['order-1', 'order-2', 'order-3']);
    const b = hashItemIds(['order-3', 'order-1', 'order-2']);
    assert.equal(a, b);
  });

  it('changes when a new item is added to the set', () => {
    const before = hashItemIds(['order-1', 'order-2']);
    const afterNewOrder = hashItemIds(['order-1', 'order-2', 'order-3']);
    assert.notEqual(before, afterNewOrder);
  });

  it('changes when an item is removed (one order resolved)', () => {
    const before = hashItemIds(['order-1', 'order-2', 'order-3']);
    const afterResolved = hashItemIds(['order-1', 'order-2']);
    assert.notEqual(before, afterResolved);
  });

  it('does not collide on shifted concatenation boundaries', () => {
    // The classic djb2 failure mode: ["ab","c"] vs ["a","bc"] concatenate to
    // the same byte stream. The separator must prevent the collision.
    assert.notEqual(hashItemIds(['ab', 'c']), hashItemIds(['a', 'bc']));
  });

  it('returns "0" for an empty set and undefined', () => {
    assert.equal(hashItemIds([]), '0');
    // @ts-expect-error exercising the defensive undefined guard
    assert.equal(hashItemIds(undefined), '0');
  });

  it('produces a compact base36 suffix with no minus sign', () => {
    const h = hashItemIds(['a-very-long-uuid-0000', 'another-uuid-1111']);
    assert.match(h, /^[0-9a-z]+$/);
    assert.ok(!h.startsWith('-'));
  });

  it('models the read-state-reset scenario: same set keeps id, new set new id', () => {
    // A pending order at 53h. Operator reads it. The id is content-hashed, so
    // while the same single order stays pending the id is identical (read state
    // persists), but the moment a second pending order joins, the id changes
    // (a genuinely new situation that should re-signal as unread).
    const onlyAlexandra = `notif-orders-critical-pending-${hashItemIds(['alexandra-sotto'])}`;
    const stillOnlyAlexandra = `notif-orders-critical-pending-${hashItemIds(['alexandra-sotto'])}`;
    const alexandraPlusOne = `notif-orders-critical-pending-${hashItemIds(['alexandra-sotto', 'new-order'])}`;

    assert.equal(onlyAlexandra, stillOnlyAlexandra);
    assert.notEqual(onlyAlexandra, alexandraPlusOne);
  });
});

// Minimal builder so fixtures stay readable.
function notif(partial: Partial<Notification>): Notification {
  return {
    id: partial.id ?? 'n',
    type: partial.type ?? 'order',
    message: partial.message ?? 'msg',
    timestamp: partial.timestamp ?? new Date().toISOString(),
    read: partial.read ?? false,
    priority: partial.priority ?? 'high',
    category: partial.category ?? 'urgent',
    live: partial.live,
    metadata: partial.metadata,
  };
}

describe('notification badge signals', () => {
  it('counts a live urgent condition even after it has been read (the badge bug)', () => {
    // The 53h pending order: read=true but condition still live. The red badge
    // must keep showing. This is the exact regression the fix targets.
    const list = [notif({ category: 'urgent', live: true, read: true })];
    assert.equal(countLiveNotifications(list), 1);
    assert.equal(hasUrgentLiveNotification(list), true);
    // It is read, so the blue "new" indicator is silent.
    assert.equal(countUnreadNotifications(list), 0);
  });

  it('does not count a resolved condition (live=false) toward the live badge', () => {
    const list = [notif({ category: 'urgent', live: false, read: true })];
    assert.equal(countLiveNotifications(list), 0);
    assert.equal(hasUrgentLiveNotification(list), false);
  });

  it('counts action_required live conditions but flags them as non-urgent (amber)', () => {
    const list = [notif({ category: 'action_required', live: true, read: false })];
    assert.equal(countLiveNotifications(list), 1);
    assert.equal(hasUrgentLiveNotification(list), false);
  });

  it('excludes informational notifications from the live badge', () => {
    // Tomorrow's deliveries: a heads-up, not an unresolved problem.
    const list = [notif({ category: 'informational', live: undefined, read: false })];
    assert.equal(countLiveNotifications(list), 0);
  });

  it('tracks unread independently of live', () => {
    const list = [
      notif({ id: 'a', category: 'urgent', live: true, read: true }), // live, seen
      notif({ id: 'b', category: 'informational', live: undefined, read: false }), // new, not live
    ];
    assert.equal(countLiveNotifications(list), 1);
    assert.equal(countUnreadNotifications(list), 1);
  });

  it('picks red over amber when both urgent-live and action-live are present', () => {
    const list = [
      notif({ id: 'a', category: 'action_required', live: true }),
      notif({ id: 'b', category: 'urgent', live: true }),
    ];
    assert.equal(countLiveNotifications(list), 2);
    assert.equal(hasUrgentLiveNotification(list), true);
  });
});

describe('bell badge (unread actionable) signal', () => {
  it('counts unread actionable notifications', () => {
    const list = [
      notif({ id: 'a', category: 'urgent', read: false }),
      notif({ id: 'b', category: 'action_required', read: false }),
    ];
    assert.equal(countUnreadActionableNotifications(list), 2);
    assert.equal(hasUrgentUnreadNotification(list), true);
  });

  it('marking a notification read lowers the badge (the reported bug)', () => {
    // Two unread actionable: badge = 2. Operator reads one: badge must drop to 1.
    const beforeRead = [
      notif({ id: 'a', category: 'urgent', read: false }),
      notif({ id: 'b', category: 'action_required', read: false }),
    ];
    assert.equal(countUnreadActionableNotifications(beforeRead), 2);

    const afterReadOne = [
      notif({ id: 'a', category: 'urgent', read: true }),
      notif({ id: 'b', category: 'action_required', read: false }),
    ];
    assert.equal(countUnreadActionableNotifications(afterReadOne), 1);
    // The remaining unread one is action_required, not urgent: amber, not red.
    assert.equal(hasUrgentUnreadNotification(afterReadOne), false);
  });

  it('marking everything read takes the badge to 0', () => {
    const allRead = [
      notif({ id: 'a', category: 'urgent', read: true }),
      notif({ id: 'b', category: 'action_required', read: true }),
    ];
    assert.equal(countUnreadActionableNotifications(allRead), 0);
    assert.equal(hasUrgentUnreadNotification(allRead), false);
  });

  it('does NOT count a live-but-read condition (this is the fix vs the prior behavior)', () => {
    // A 53h pending order seen and read by the operator: the condition is still
    // live, but the bell badge must NOT keep counting it, so reading clears it.
    const list = [notif({ category: 'urgent', live: true, read: true })];
    assert.equal(countUnreadActionableNotifications(list), 0);
    // The live helper still sees it (retained for non-badge consumers), proving
    // we changed only what drives the visible badge, not the live concept.
    assert.equal(countLiveNotifications(list), 1);
  });

  it('a NEW unread condition (distinct content-hash id) reappears on the badge', () => {
    // Salvaguarda: the prior single pending order was read. A second pending
    // order arrives -> notificationEngine emits a DISTINCT id -> the merge does
    // not match -> it lands unread -> the badge rises again. Modeled at the
    // signal level: the new unread notification lifts the count off zero.
    const onlyOldRead = [
      notif({ id: `pending-${hashItemIds(['order-1'])}`, category: 'urgent', read: true }),
    ];
    assert.equal(countUnreadActionableNotifications(onlyOldRead), 0);

    const newConditionArrived = [
      notif({ id: `pending-${hashItemIds(['order-1'])}`, category: 'urgent', read: true }),
      notif({ id: `pending-${hashItemIds(['order-1', 'order-2'])}`, category: 'urgent', read: false }),
    ];
    assert.notEqual(newConditionArrived[0].id, newConditionArrived[1].id);
    assert.equal(countUnreadActionableNotifications(newConditionArrived), 1);
    assert.equal(hasUrgentUnreadNotification(newConditionArrived), true);
  });

  it('an unchanged already-read condition does NOT re-inflate the badge', () => {
    // Salvaguarda: same itemIds -> same id -> merge keeps read=true -> badge 0.
    const sameId = `pending-${hashItemIds(['order-1'])}`;
    const list = [notif({ id: sameId, category: 'urgent', read: true })];
    assert.equal(countUnreadActionableNotifications(list), 0);
  });

  it('ignores informational notifications even when unread (no alarm badge)', () => {
    const list = [notif({ category: 'informational', read: false })];
    assert.equal(countUnreadActionableNotifications(list), 0);
    // But the panel's total-unread copy still counts it.
    assert.equal(countUnreadNotifications(list), 1);
  });
});
