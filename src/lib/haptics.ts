/**
 * Haptic feedback helper for mobile interactions.
 *
 * Wraps `navigator.vibrate` with named intents so callers describe meaning,
 * not duration. Safe to call on any device (no-op when API absent).
 *
 * Patterns follow iOS/Android haptic conventions:
 *  - tap: 8ms     (light touch, button press, card open)
 *  - success: 10ms
 *  - warning: [0,30,40,30] (double-pulse)
 *  - error: [0,30,40,30,40,30] (triple-pulse)
 *  - destructive: 15ms (slightly heavier than tap)
 *  - selection: 5ms (very light, list selection toggle)
 */

type HapticIntent =
  | 'tap'
  | 'selection'
  | 'success'
  | 'warning'
  | 'error'
  | 'destructive';

const PATTERNS: Record<HapticIntent, number | number[]> = {
  tap: 8,
  selection: 5,
  success: 10,
  warning: [0, 30, 40, 30],
  error: [0, 30, 40, 30, 40, 30],
  destructive: 15,
};

function canVibrate(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'vibrate' in navigator &&
    typeof navigator.vibrate === 'function'
  );
}

export function haptic(intent: HapticIntent): void {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(PATTERNS[intent]);
  } catch {
    // Some browsers throw on rapid invocation. Swallow silently.
  }
}

/**
 * Convenience aliases for hot paths.
 */
export const tap = () => haptic('tap');
export const success = () => haptic('success');
export const warning = () => haptic('warning');
export const error = () => haptic('error');
export const destructive = () => haptic('destructive');
export const selection = () => haptic('selection');
