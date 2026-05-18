/**
 * Unit tests for swipeThreshold.decideSwipe.
 *
 * Run with:
 *   npx tsx --test src/utils/__tests__/swipeThreshold.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { decideSwipe } from '../swipeThreshold';

const W = 240; // container width in px

describe('decideSwipe: distance-driven commits', () => {
  it('commits delivered when offset is past -40% with low velocity', () => {
    assert.equal(
      decideSwipe({
        offsetX: -W * 0.5,
        velocityX: 0,
        containerWidth: W,
      }),
      'delivered',
    );
  });

  it('commits incident when offset is past +40% with low velocity', () => {
    assert.equal(
      decideSwipe({
        offsetX: W * 0.5,
        velocityX: 0,
        containerWidth: W,
      }),
      'incident',
    );
  });

  it('snaps back below the distance threshold with no velocity', () => {
    assert.equal(
      decideSwipe({
        offsetX: -W * 0.3,
        velocityX: 0,
        containerWidth: W,
      }),
      'snap-back',
    );
    assert.equal(
      decideSwipe({
        offsetX: W * 0.3,
        velocityX: 0,
        containerWidth: W,
      }),
      'snap-back',
    );
  });
});

describe('decideSwipe: velocity-driven commits', () => {
  it('commits delivered on a fast left flick even with tiny offset', () => {
    assert.equal(
      decideSwipe({
        offsetX: -10,
        velocityX: -800,
        containerWidth: W,
      }),
      'delivered',
    );
  });

  it('commits incident on a fast right flick even with tiny offset', () => {
    assert.equal(
      decideSwipe({
        offsetX: 10,
        velocityX: 800,
        containerWidth: W,
      }),
      'incident',
    );
  });

  it('does not commit on a slow velocity below the threshold', () => {
    assert.equal(
      decideSwipe({
        offsetX: -10,
        velocityX: -100,
        containerWidth: W,
      }),
      'snap-back',
    );
  });
});

describe('decideSwipe: directional precedence', () => {
  it('left velocity beats right offset when both are non-trivial', () => {
    // User swiped right slightly but accidentally flicks left at release.
    // Velocity-driven decision wins.
    assert.equal(
      decideSwipe({
        offsetX: 20,
        velocityX: -700,
        containerWidth: W,
      }),
      'delivered',
    );
  });

  it('exactly at the distance threshold commits', () => {
    assert.equal(
      decideSwipe({
        offsetX: -W * 0.4,
        velocityX: 0,
        containerWidth: W,
      }),
      'delivered',
    );
    assert.equal(
      decideSwipe({
        offsetX: W * 0.4,
        velocityX: 0,
        containerWidth: W,
      }),
      'incident',
    );
  });
});

describe('decideSwipe: defensive defaults', () => {
  it('returns snap-back when container width is zero', () => {
    assert.equal(
      decideSwipe({ offsetX: -100, velocityX: -1000, containerWidth: 0 }),
      'snap-back',
    );
  });

  it('returns snap-back when container width is negative', () => {
    assert.equal(
      decideSwipe({ offsetX: -100, velocityX: 0, containerWidth: -50 }),
      'snap-back',
    );
  });

  it('returns snap-back when container width is NaN', () => {
    assert.equal(
      decideSwipe({ offsetX: -100, velocityX: 0, containerWidth: Number.NaN }),
      'snap-back',
    );
  });

  it('respects a custom thresholdRatio', () => {
    // With ratio 0.2, -50 (=W * 0.2 ~ 48) commits delivered.
    assert.equal(
      decideSwipe({
        offsetX: -W * 0.25,
        velocityX: 0,
        containerWidth: W,
        thresholdRatio: 0.2,
      }),
      'delivered',
    );
    // But with default ratio 0.4 the same offset is snap-back.
    assert.equal(
      decideSwipe({
        offsetX: -W * 0.25,
        velocityX: 0,
        containerWidth: W,
      }),
      'snap-back',
    );
  });

  it('respects a custom velocityCommit', () => {
    assert.equal(
      decideSwipe({
        offsetX: 0,
        velocityX: -300,
        containerWidth: W,
        velocityCommit: 250,
      }),
      'delivered',
    );
    assert.equal(
      decideSwipe({
        offsetX: 0,
        velocityX: -300,
        containerWidth: W,
      }),
      'snap-back',
    );
  });
});
