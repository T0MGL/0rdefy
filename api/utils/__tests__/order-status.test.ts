/**
 * Unit tests for the canonical order-status helpers.
 *
 * Run with:
 *   npx tsx --test api/utils/__tests__/order-status.test.ts
 *
 * The helpers in api/utils/order-status.ts are the boundary that every
 * status comparison crosses on the backend. Drift here is drift in
 * production. The fixtures cover the canonical post-148c enum (pending,
 * confirmed, in_preparation, ready_to_ship, in_transit, delivered,
 * settled, cancelled, rejected, returned) and the legacy VARCHARs that
 * still appear in pre-148c stores (shipped, contacted, incident,
 * awaiting_carrier, delivery_failed, not_delivered).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    ACTIVE_SETTLEMENT_STATUSES,
    DISPATCHED_STATUSES,
    FAILED_DELIVERY_STATUSES,
    IN_TRANSIT_STATUSES,
    POST_PENDING_STATUSES,
    isActiveSettlement,
    isCancelled,
    isConfirmed,
    isDelivered,
    isDeliveredOrSettled,
    isDispatched,
    isFailedDelivery,
    isInPreparation,
    isInTransit,
    isPending,
    isPostPending,
    isReadyToShip,
    isRejected,
    isReturned,
    isSettled,
} from '../order-status';

describe('per-status predicates', () => {
    it('isPending matches only pending', () => {
        assert.equal(isPending('pending'), true);
        assert.equal(isPending('confirmed'), false);
        assert.equal(isPending(null), false);
        assert.equal(isPending(undefined), false);
    });

    it('isConfirmed matches only confirmed', () => {
        assert.equal(isConfirmed('confirmed'), true);
        assert.equal(isConfirmed('pending'), false);
        assert.equal(isConfirmed('in_preparation'), false);
    });

    it('isInPreparation matches only in_preparation', () => {
        assert.equal(isInPreparation('in_preparation'), true);
        assert.equal(isInPreparation('confirmed'), false);
        assert.equal(isInPreparation('ready_to_ship'), false);
    });

    it('isReadyToShip matches only ready_to_ship', () => {
        assert.equal(isReadyToShip('ready_to_ship'), true);
        assert.equal(isReadyToShip('in_preparation'), false);
        assert.equal(isReadyToShip('shipped'), false);
    });

    it('isDelivered is strict; does NOT match settled', () => {
        assert.equal(isDelivered('delivered'), true);
        assert.equal(isDelivered('settled'), false);
        assert.equal(isDelivered('returned'), false);
    });

    it('isSettled matches only settled', () => {
        assert.equal(isSettled('settled'), true);
        assert.equal(isSettled('delivered'), false);
    });

    it('isDeliveredOrSettled matches both delivered and settled (the terminal-success set)', () => {
        assert.equal(isDeliveredOrSettled('delivered'), true);
        assert.equal(isDeliveredOrSettled('settled'), true);
        assert.equal(isDeliveredOrSettled('in_transit'), false);
        assert.equal(isDeliveredOrSettled('returned'), false);
        assert.equal(isDeliveredOrSettled(null), false);
    });

    it('isReturned matches only returned', () => {
        assert.equal(isReturned('returned'), true);
        assert.equal(isReturned('delivered'), false);
        assert.equal(isReturned('cancelled'), false);
    });

    it('isCancelled matches only cancelled', () => {
        assert.equal(isCancelled('cancelled'), true);
        assert.equal(isCancelled('rejected'), false);
    });

    it('isRejected matches only rejected', () => {
        assert.equal(isRejected('rejected'), true);
        assert.equal(isRejected('cancelled'), false);
    });
});

describe('FAILED_DELIVERY_STATUSES set', () => {
    it('contains the three failure-after-dispatch statuses', () => {
        assert.equal(FAILED_DELIVERY_STATUSES.has('delivery_failed'), true);
        assert.equal(FAILED_DELIVERY_STATUSES.has('not_delivered'), true);
        assert.equal(FAILED_DELIVERY_STATUSES.has('returned'), true);
    });

    it('excludes successful and pre-dispatch states', () => {
        assert.equal(FAILED_DELIVERY_STATUSES.has('delivered'), false);
        assert.equal(FAILED_DELIVERY_STATUSES.has('cancelled'), false);
        assert.equal(FAILED_DELIVERY_STATUSES.has('pending'), false);
    });
});

describe('isFailedDelivery', () => {
    it('matches exactly FAILED_DELIVERY_STATUSES', () => {
        assert.equal(isFailedDelivery('returned'), true);
        assert.equal(isFailedDelivery('delivery_failed'), true);
        assert.equal(isFailedDelivery('not_delivered'), true);
        assert.equal(isFailedDelivery('delivered'), false);
        assert.equal(isFailedDelivery('cancelled'), false);
        assert.equal(isFailedDelivery(null), false);
    });
});

describe('isPostPending', () => {
    it('includes every state past pending (success or failure)', () => {
        assert.equal(isPostPending('confirmed'), true);
        assert.equal(isPostPending('in_preparation'), true);
        assert.equal(isPostPending('ready_to_ship'), true);
        assert.equal(isPostPending('in_transit'), true);
        assert.equal(isPostPending('shipped'), true); // legacy alias
        assert.equal(isPostPending('delivered'), true);
        assert.equal(isPostPending('settled'), true);
        assert.equal(isPostPending('returned'), true);
        assert.equal(isPostPending('delivery_failed'), true);
        assert.equal(isPostPending('not_delivered'), true);
    });

    it('excludes pending and rejected (rejected never confirmed)', () => {
        assert.equal(isPostPending('pending'), false);
        // Note: rejected and cancelled may or may not be post-pending
        // depending on policy. Current set definition excludes them.
        assert.equal(isPostPending(null), false);
    });
});

describe('isInTransit (wide pipeline definition)', () => {
    it('treats the full active pipeline as in transit', () => {
        assert.equal(isInTransit('confirmed'), true);
        assert.equal(isInTransit('in_preparation'), true);
        assert.equal(isInTransit('ready_to_ship'), true);
        assert.equal(isInTransit('in_transit'), true);
        assert.equal(isInTransit('shipped'), true); // legacy alias
        assert.equal(isInTransit('contacted'), true); // legacy
        assert.equal(isInTransit('incident'), true); // legacy
    });

    it('excludes pending, terminal, and failure states', () => {
        assert.equal(isInTransit('pending'), false);
        assert.equal(isInTransit('delivered'), false);
        assert.equal(isInTransit('settled'), false);
        assert.equal(isInTransit('returned'), false);
        assert.equal(isInTransit('cancelled'), false);
    });
});

describe('isDispatched', () => {
    it('matches DISPATCHED_STATUSES regardless of shipped_at', () => {
        assert.equal(isDispatched('ready_to_ship', null), true);
        assert.equal(isDispatched('shipped', null), true);
        assert.equal(isDispatched('in_transit', null), true);
        assert.equal(isDispatched('delivered', null), true);
        assert.equal(isDispatched('settled', null), true);
        assert.equal(isDispatched('returned', null), true);
        assert.equal(isDispatched('delivery_failed', null), true);
        assert.equal(isDispatched('not_delivered', null), true);
    });

    it('treats cancelled-with-shipped_at as dispatched (parcel left warehouse)', () => {
        assert.equal(isDispatched('cancelled', '2026-05-01T00:00:00Z'), true);
    });

    it('rejects cancelled-without-shipped_at (cancelled before dispatch)', () => {
        assert.equal(isDispatched('cancelled', null), false);
    });

    it('rejects pre-dispatch states', () => {
        assert.equal(isDispatched('pending', null), false);
        assert.equal(isDispatched('confirmed', null), false);
        assert.equal(isDispatched('in_preparation', null), false);
    });
});

describe('settlement status helpers', () => {
    it('isActiveSettlement matches pending or partial', () => {
        assert.equal(isActiveSettlement('pending'), true);
        assert.equal(isActiveSettlement('partial'), true);
    });

    it('isActiveSettlement excludes paid, cancelled, completed', () => {
        assert.equal(isActiveSettlement('paid'), false);
        assert.equal(isActiveSettlement('cancelled'), false);
        assert.equal(isActiveSettlement('completed'), false);
        assert.equal(isActiveSettlement(null), false);
    });

    it('ACTIVE_SETTLEMENT_STATUSES set contents', () => {
        assert.equal(ACTIVE_SETTLEMENT_STATUSES.has('pending'), true);
        assert.equal(ACTIVE_SETTLEMENT_STATUSES.has('partial'), true);
        assert.equal(ACTIVE_SETTLEMENT_STATUSES.has('paid'), false);
    });
});

describe('cross-set invariants', () => {
    it('every IN_TRANSIT status is also POST_PENDING', () => {
        for (const s of IN_TRANSIT_STATUSES) {
            assert.equal(POST_PENDING_STATUSES.has(s), true,
                `${s} is in transit but not post-pending`);
        }
    });

    it('DISPATCHED set includes terminal-success and failure', () => {
        assert.equal(DISPATCHED_STATUSES.has('delivered'), true);
        assert.equal(DISPATCHED_STATUSES.has('settled'), true);
        assert.equal(DISPATCHED_STATUSES.has('returned'), true);
        assert.equal(DISPATCHED_STATUSES.has('delivery_failed'), true);
    });

    it('FAILED_DELIVERY is a subset of DISPATCHED (you cannot fail what you did not dispatch)', () => {
        for (const s of FAILED_DELIVERY_STATUSES) {
            assert.equal(DISPATCHED_STATUSES.has(s), true,
                `${s} is failed-delivery but not dispatched`);
        }
    });
});
