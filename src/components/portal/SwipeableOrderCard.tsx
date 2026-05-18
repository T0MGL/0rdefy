/**
 * Swipeable wrapper around `OrderCard` for the portal Activos list.
 *
 * Behaviour (iOS Mail / Tinder style):
 *   - Drag the card to the LEFT (right → left) past 40% of its width,
 *     or flick fast in that direction, to trigger `onSwipeDelivered`.
 *     The revealed action label says "Entregar" on a lime-primary
 *     background.
 *   - Drag to the RIGHT past the same threshold, or flick fast that
 *     way, to trigger `onSwipeIncident`. The revealed label says
 *     "Incidencia" on a rose background.
 *   - Anything below threshold and slow enough snaps back.
 *   - A tap with no drag invokes `onTap` (still useful when the
 *     courier wants the full detail screen).
 *   - When `useReducedMotion()` is true, the drag is disabled and two
 *     accessible buttons are rendered inline instead.
 *
 * The wrapper keeps a haptic-feedback hint on threshold cross via
 * `navigator.vibrate?.(10)` (no-op on iOS Safari, which silently
 * ignores it — that's fine, we never depend on it for correctness).
 */

import { useEffect, useRef, useState } from 'react';
import {
  motion,
  useMotionValue,
  useTransform,
  animate,
  useReducedMotion,
} from 'framer-motion';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { OrderCard } from './OrderCard';
import { decideSwipe } from '@/utils/swipeThreshold';
import type { PortalOrder } from '@/services/portal.service';

interface SwipeableOrderCardProps {
  order: PortalOrder;
  onTap: () => void;
  onSwipeDelivered: () => void;
  onSwipeIncident: () => void;
}

const THRESHOLD_RATIO = 0.4;
const VELOCITY_COMMIT = 500;
const VIBRATE_MS = 10;

export function SwipeableOrderCard({
  order,
  onTap,
  onSwipeDelivered,
  onSwipeIncident,
}: SwipeableOrderCardProps) {
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widthRef = useRef<number>(0);
  const hapticArmedRef = useRef<boolean>(true);

  const x = useMotionValue(0);

  // Background layer opacity: 0 at rest, 1 at threshold. We compute the
  // threshold in pixels once on mount; useTransform reacts to the live x.
  const [thresholdPx, setThresholdPx] = useState<number>(0);
  useEffect(() => {
    const measure = () => {
      const w = containerRef.current?.offsetWidth ?? 0;
      widthRef.current = w;
      setThresholdPx(w * THRESHOLD_RATIO);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  const deliveredOpacity = useTransform(
    x,
    [-thresholdPx, 0],
    [1, 0],
    { clamp: true },
  );
  const incidentOpacity = useTransform(
    x,
    [0, thresholdPx],
    [0, 1],
    { clamp: true },
  );

  useEffect(() => {
    const unsubscribe = x.on('change', (latest) => {
      // Arm/disarm haptic so we only buzz once per threshold cross.
      const t = widthRef.current * THRESHOLD_RATIO;
      if (t <= 0) return;
      if (Math.abs(latest) >= t) {
        if (hapticArmedRef.current) {
          hapticArmedRef.current = false;
          if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try {
              navigator.vibrate(VIBRATE_MS);
            } catch {
              /* iOS silently ignores; safe to swallow. */
            }
          }
        }
      } else {
        hapticArmedRef.current = true;
      }
    });
    return unsubscribe;
  }, [x]);

  if (reducedMotion) {
    // Accessibility fallback: no drag, no animation. Two buttons.
    return (
      <div className="space-y-2">
        <OrderCard order={order} variant="active" onClick={onTap} />
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onSwipeDelivered}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
            Entregar
          </button>
          <button
            type="button"
            onClick={onSwipeIncident}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-rose-600 text-sm font-medium text-white transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"
          >
            <AlertTriangle className="h-4 w-4" strokeWidth={2} />
            Incidencia
          </button>
        </div>
      </div>
    );
  }

  const handleDragEnd = (
    _: unknown,
    info: { offset: { x: number }; velocity: { x: number } },
  ) => {
    const outcome = decideSwipe({
      offsetX: info.offset.x,
      velocityX: info.velocity.x,
      containerWidth: widthRef.current,
      thresholdRatio: THRESHOLD_RATIO,
      velocityCommit: VELOCITY_COMMIT,
    });

    if (outcome === 'delivered') {
      animate(x, 0, { type: 'spring', stiffness: 500, damping: 35 });
      onSwipeDelivered();
      return;
    }
    if (outcome === 'incident') {
      animate(x, 0, { type: 'spring', stiffness: 500, damping: 35 });
      onSwipeIncident();
      return;
    }
    animate(x, 0, { type: 'spring', stiffness: 400, damping: 35 });
  };

  return (
    <div ref={containerRef} className="relative overflow-hidden rounded-2xl">
      {/* Action revealed on left swipe (delivered) — sits right side */}
      <motion.div
        aria-hidden
        style={{ opacity: deliveredOpacity }}
        className="pointer-events-none absolute inset-0 flex items-center justify-end rounded-2xl bg-primary px-6"
      >
        <div className="flex items-center gap-2 text-primary-foreground">
          <CheckCircle2 className="h-5 w-5" strokeWidth={2.25} />
          <span className="text-sm font-semibold">Entregar</span>
        </div>
      </motion.div>

      {/* Action revealed on right swipe (incident) — sits left side */}
      <motion.div
        aria-hidden
        style={{ opacity: incidentOpacity }}
        className="pointer-events-none absolute inset-0 flex items-center justify-start rounded-2xl bg-rose-600 px-6"
      >
        <div className="flex items-center gap-2 text-white">
          <AlertTriangle className="h-5 w-5" strokeWidth={2.25} />
          <span className="text-sm font-semibold">Incidencia</span>
        </div>
      </motion.div>

      {/* Foreground draggable card */}
      <motion.div
        drag="x"
        style={{ x }}
        dragConstraints={containerRef}
        dragElastic={0.08}
        dragMomentum={false}
        dragDirectionLock
        onDragEnd={handleDragEnd}
        className="relative bg-card rounded-2xl touch-pan-y"
      >
        <OrderCard order={order} variant="active" onClick={onTap} />
      </motion.div>
    </div>
  );
}
