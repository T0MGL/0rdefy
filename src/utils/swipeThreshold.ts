/**
 * Pure decision helper for swipe gestures.
 *
 * Decides what to do after the user lets go of a swipeable element:
 * commit a delivered-style action, commit an incident-style action,
 * or snap back to idle.
 *
 * Two signals matter:
 *   - offsetX: how far the element has been dragged from the rest
 *     position. Positive = swiped right (left→right), negative =
 *     swiped left (right→left).
 *   - velocityX: how fast it was moving at release. A fast flick
 *     should commit even if the offset is below the distance
 *     threshold (Tinder, iOS Mail behavior).
 *
 * Conventions (matches SwipeableOrderCard):
 *   - left swipe (offsetX <= -threshold)  → 'delivered'
 *   - right swipe (offsetX >=  threshold) → 'incident'
 *   - otherwise → 'snap-back'
 */

export type SwipeOutcome = 'delivered' | 'incident' | 'snap-back';

export interface SwipeDecisionInput {
  /** Pixel offset from the rest position (negative = left). */
  offsetX: number;
  /** Pixel velocity at release (px/second, framer-motion convention). */
  velocityX: number;
  /** Container width in pixels; threshold is a fraction of this. */
  containerWidth: number;
  /** Fraction of the container width above which a commit is triggered. Default 0.4. */
  thresholdRatio?: number;
  /** Absolute velocity (px/s) above which a flick commits even without distance. Default 500. */
  velocityCommit?: number;
}

const DEFAULT_THRESHOLD_RATIO = 0.4;
const DEFAULT_VELOCITY_COMMIT = 500;

export function decideSwipe({
  offsetX,
  velocityX,
  containerWidth,
  thresholdRatio = DEFAULT_THRESHOLD_RATIO,
  velocityCommit = DEFAULT_VELOCITY_COMMIT,
}: SwipeDecisionInput): SwipeOutcome {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return 'snap-back';

  const threshold = containerWidth * thresholdRatio;

  // Velocity-driven commit: a fast flick beats distance threshold.
  if (velocityX <= -velocityCommit) return 'delivered';
  if (velocityX >= velocityCommit) return 'incident';

  // Distance-driven commit.
  if (offsetX <= -threshold) return 'delivered';
  if (offsetX >= threshold) return 'incident';

  return 'snap-back';
}
