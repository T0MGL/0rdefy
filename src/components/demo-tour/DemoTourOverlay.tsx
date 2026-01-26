/**
 * DemoTourOverlay - Production-ready spotlight overlay
 *
 * Creates a dark overlay with a spotlight cutout on the target element.
 * Handles edge cases gracefully and provides smooth animations.
 *
 * Features:
 * - SVG mask-based spotlight with smooth transitions
 * - Automatic element tracking with retry logic
 * - Scroll into view for off-screen elements
 * - Animated glow border around spotlight
 * - Click blockers to prevent interaction outside spotlight
 * - Graceful fallback when element not found
 *
 * @module DemoTourOverlay
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDemoTour } from './DemoTourProvider';

interface SpotlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Configuration
const CONFIG = {
  OVERLAY_OPACITY: 0.85,
  SPOTLIGHT_PADDING: 12,
  BORDER_RADIUS: 12,
  MAX_RETRIES: 30,
  RETRY_INTERVAL_MS: 100,
  POSITION_UPDATE_INTERVAL_MS: 150,
  GLOW_COLOR: 'hsl(84 81% 60%)', // Primary green
  SCROLL_BEHAVIOR: 'smooth' as ScrollBehavior,
} as const;

export function DemoTourOverlay() {
  const { isActive, currentStep, isTransitioning } = useDemoTour();
  const [targetRect, setTargetRect] = useState<SpotlightRect | null>(null);
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });
  const [elementFound, setElementFound] = useState(true);
  const retryCountRef = useRef(0);
  const updateIntervalRef = useRef<number | null>(null);

  // Update window size on resize
  useEffect(() => {
    const updateWindowSize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    updateWindowSize();
    window.addEventListener('resize', updateWindowSize);
    return () => window.removeEventListener('resize', updateWindowSize);
  }, []);

  // Find and track target element with retry logic
  const findAndTrackElement = useCallback(() => {
    if (!currentStep?.target) {
      setTargetRect(null);
      setElementFound(true);
      return;
    }

    const element = document.querySelector(currentStep.target);

    if (element) {
      const rect = element.getBoundingClientRect();
      const padding = CONFIG.SPOTLIGHT_PADDING;

      setTargetRect({
        x: rect.x - padding,
        y: rect.y - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
      });
      setElementFound(true);
      retryCountRef.current = 0;

      // Scroll into view if needed (only once when element is first found)
      const isInViewport =
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.right <= window.innerWidth;

      if (!isInViewport && retryCountRef.current === 0) {
        element.scrollIntoView({
          behavior: CONFIG.SCROLL_BEHAVIOR,
          block: 'center',
          inline: 'center',
        });
      }
    } else {
      retryCountRef.current++;

      if (retryCountRef.current >= CONFIG.MAX_RETRIES) {
        // Element not found after max retries - fall back to full overlay
        setTargetRect(null);
        setElementFound(false);
      }
    }
  }, [currentStep?.target]);

  // Main effect for tracking target element
  useEffect(() => {
    if (!isActive || !currentStep) {
      setTargetRect(null);
      setElementFound(true);
      return;
    }

    // Center placement means no spotlight on specific element
    if (currentStep.placement === 'center' || !currentStep.target) {
      setTargetRect(null);
      setElementFound(true);
      return;
    }

    // Reset retry count on step change
    retryCountRef.current = 0;

    // Initial find
    findAndTrackElement();

    // Set up continuous position tracking
    updateIntervalRef.current = window.setInterval(
      findAndTrackElement,
      CONFIG.POSITION_UPDATE_INTERVAL_MS
    );

    return () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current);
        updateIntervalRef.current = null;
      }
    };
  }, [isActive, currentStep, findAndTrackElement]);

  // Don't render if tour is not active
  if (!isActive) return null;

  // Full overlay for center placement or when no target specified
  if (!targetRect) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="full-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="fixed inset-0 z-[9998] pointer-events-auto"
          style={{
            background: `rgba(0, 0, 0, ${CONFIG.OVERLAY_OPACITY})`,
            backdropFilter: 'blur(4px)',
          }}
        />
      </AnimatePresence>
    );
  }

  // SVG spotlight mask for targeted elements
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`spotlight-${currentStep?.id}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="fixed inset-0 z-[9998]"
      >
        <svg
          className="w-full h-full"
          width={windowSize.width}
          height={windowSize.height}
          style={{ position: 'absolute', top: 0, left: 0 }}
        >
          <defs>
            {/* Mask for creating the spotlight hole */}
            <mask id="demo-spotlight-mask">
              {/* White background = visible overlay */}
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {/* Black rectangle = transparent hole */}
              <motion.rect
                initial={{
                  x: targetRect.x,
                  y: targetRect.y,
                  width: targetRect.width,
                  height: targetRect.height,
                }}
                animate={{
                  x: targetRect.x,
                  y: targetRect.y,
                  width: targetRect.width,
                  height: targetRect.height,
                }}
                transition={{
                  type: 'spring',
                  stiffness: 400,
                  damping: 35,
                  mass: 0.8,
                }}
                rx={CONFIG.BORDER_RADIUS}
                ry={CONFIG.BORDER_RADIUS}
                fill="black"
              />
            </mask>

            {/* Glow filter for the spotlight border */}
            <filter id="demo-spotlight-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Dark overlay with spotlight cutout */}
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill={`rgba(0, 0, 0, ${CONFIG.OVERLAY_OPACITY})`}
            mask="url(#demo-spotlight-mask)"
          />

          {/* Animated glowing border around spotlight */}
          <motion.rect
            initial={{
              x: targetRect.x,
              y: targetRect.y,
              width: targetRect.width,
              height: targetRect.height,
              opacity: 0,
            }}
            animate={{
              x: targetRect.x,
              y: targetRect.y,
              width: targetRect.width,
              height: targetRect.height,
              opacity: [0.3, 0.7, 0.3],
            }}
            transition={{
              x: { type: 'spring', stiffness: 400, damping: 35 },
              y: { type: 'spring', stiffness: 400, damping: 35 },
              width: { type: 'spring', stiffness: 400, damping: 35 },
              height: { type: 'spring', stiffness: 400, damping: 35 },
              opacity: {
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              },
            }}
            rx={CONFIG.BORDER_RADIUS}
            ry={CONFIG.BORDER_RADIUS}
            fill="none"
            stroke={CONFIG.GLOW_COLOR}
            strokeWidth="2.5"
            filter="url(#demo-spotlight-glow)"
          />

          {/* Inner subtle border for crisp edges */}
          <motion.rect
            initial={{
              x: targetRect.x,
              y: targetRect.y,
              width: targetRect.width,
              height: targetRect.height,
            }}
            animate={{
              x: targetRect.x,
              y: targetRect.y,
              width: targetRect.width,
              height: targetRect.height,
            }}
            transition={{
              type: 'spring',
              stiffness: 400,
              damping: 35,
            }}
            rx={CONFIG.BORDER_RADIUS}
            ry={CONFIG.BORDER_RADIUS}
            fill="none"
            stroke={CONFIG.GLOW_COLOR}
            strokeWidth="1"
            strokeOpacity="0.6"
          />
        </svg>

        {/* Click blockers - prevent interaction outside spotlight area */}
        {/* Top blocker */}
        <div
          className="fixed left-0 right-0 top-0 pointer-events-auto"
          style={{ height: Math.max(0, targetRect.y) }}
          onClick={(e) => e.stopPropagation()}
        />
        {/* Bottom blocker */}
        <div
          className="fixed left-0 right-0 bottom-0 pointer-events-auto"
          style={{ top: Math.min(windowSize.height, targetRect.y + targetRect.height) }}
          onClick={(e) => e.stopPropagation()}
        />
        {/* Left blocker */}
        <div
          className="fixed left-0 top-0 bottom-0 pointer-events-auto"
          style={{ width: Math.max(0, targetRect.x) }}
          onClick={(e) => e.stopPropagation()}
        />
        {/* Right blocker */}
        <div
          className="fixed top-0 bottom-0 right-0 pointer-events-auto"
          style={{ left: Math.min(windowSize.width, targetRect.x + targetRect.width) }}
          onClick={(e) => e.stopPropagation()}
        />
      </motion.div>
    </AnimatePresence>
  );
}
