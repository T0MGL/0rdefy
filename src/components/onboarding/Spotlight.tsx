import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnboardingTour } from '@/contexts/OnboardingTourContext';
import { logger } from '@/utils/logger';

interface SpotlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SpotlightProps {
  padding?: number;
  borderRadius?: number;
}

export function Spotlight({ padding = 8, borderRadius = 12 }: SpotlightProps) {
  const { isActive, currentTour, currentStepIndex, isTransitioning } = useOnboardingTour();
  const [targetRect, setTargetRect] = useState<SpotlightRect | null>(null);
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });

  // Get current step
  const currentStep = currentTour?.steps[currentStepIndex];

  // Update window size
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

  // Find and track target element
  useEffect(() => {
    if (!isActive || !currentStep) {
      setTargetRect(null);
      return;
    }

    let retryCount = 0;
    const maxRetries = 30; // Max 30 retries (~500ms with RAF)
    let rafId: number | null = null;
    let lastUpdateTime = 0;
    const UPDATE_INTERVAL = 100; // ms between position updates

    const updateTargetRect = (timestamp: number = performance.now()) => {
      // Throttle updates to 100ms to prevent excessive DOM queries
      if (timestamp - lastUpdateTime < UPDATE_INTERVAL) {
        rafId = requestAnimationFrame(updateTargetRect);
        return;
      }
      lastUpdateTime = timestamp;

      // Handle center placement (no specific target)
      if (currentStep.placement === 'center' || currentStep.target === 'center') {
        setTargetRect(null);
        return;
      }

      const element = document.querySelector(currentStep.target);

      if (element) {
        const rect = element.getBoundingClientRect();
        const stepPadding = currentStep.spotlightPadding ?? padding;

        setTargetRect({
          x: rect.x - stepPadding,
          y: rect.y - stepPadding,
          width: rect.width + stepPadding * 2,
          height: rect.height + stepPadding * 2,
        });

        // Scroll element into view if needed
        const isInViewport =
          rect.top >= 0 &&
          rect.left >= 0 &&
          rect.bottom <= window.innerHeight &&
          rect.right <= window.innerWidth;

        if (!isInViewport) {
          element.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center',
          });
        }
        retryCount = 0; // Reset on success

        // Continue updating position for layout changes
        rafId = requestAnimationFrame(updateTargetRect);
      } else {
        // Element not found, retry with limit
        retryCount++;
        if (retryCount < maxRetries) {
          rafId = requestAnimationFrame(updateTargetRect);
        } else {
          // Fallback: show center overlay if element never found
          logger.warn(`[Tour] Element not found after ${maxRetries} retries: ${currentStep.target}`);
          setTargetRect(null);
        }
      }
    };

    // Initial update
    rafId = requestAnimationFrame(updateTargetRect);

    return () => {
      // Cleanup RAF on unmount or step change
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isActive, currentStep, currentStepIndex, padding]);

  if (!isActive) return null;

  // SVG mask for the spotlight effect
  const renderSpotlightMask = () => {
    if (!targetRect) {
      // Full overlay for center placement
      return (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="fixed inset-0 z-[9998]"
          style={{
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(4px)',
          }}
        />
      );
    }

    return (
      <motion.svg
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="fixed inset-0 z-[9998] pointer-events-none"
        width={windowSize.width}
        height={windowSize.height}
        style={{ pointerEvents: 'none' }}
      >
        <defs>
          <mask id="spotlight-mask">
            {/* White = visible, Black = hidden */}
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
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
                stiffness: 300,
                damping: 30,
              }}
              rx={borderRadius}
              ry={borderRadius}
              fill="black"
            />
          </mask>

          {/* Glow effect */}
          <filter id="spotlight-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Dark overlay with cutout */}
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.85)"
          mask="url(#spotlight-mask)"
          style={{ backdropFilter: 'blur(4px)' }}
        />

        {/* Subtle glowing border around spotlight - Apple style (no pulse, gentle glow) */}
        <motion.rect
          initial={{
            x: targetRect.x,
            y: targetRect.y,
            width: targetRect.width,
            height: targetRect.height,
            opacity: 0.5,
          }}
          animate={{
            x: targetRect.x,
            y: targetRect.y,
            width: targetRect.width,
            height: targetRect.height,
            opacity: [0.5, 0.8, 0.5],
          }}
          transition={{
            x: { type: 'spring', stiffness: 300, damping: 30 },
            y: { type: 'spring', stiffness: 300, damping: 30 },
            width: { type: 'spring', stiffness: 300, damping: 30 },
            height: { type: 'spring', stiffness: 300, damping: 30 },
            opacity: { duration: 2, repeat: Infinity, ease: 'easeInOut' },
          }}
          rx={borderRadius}
          ry={borderRadius}
          fill="none"
          stroke="hsl(84 81% 63%)"
          strokeWidth="2"
          filter="url(#spotlight-glow)"
        />
      </motion.svg>
    );
  };

  // Click blocker overlay (allows clicking only on highlighted element)
  const renderClickBlocker = () => {
    if (!targetRect) {
      // For center placement, block all clicks except the tooltip
      return (
        <div
          className="fixed inset-0 z-[9997]"
          onClick={(e) => e.stopPropagation()}
        />
      );
    }

    return (
      <>
        {/* Top blocker */}
        <div
          className="fixed left-0 right-0 top-0 z-[9997]"
          style={{ height: targetRect.y }}
          onClick={(e) => e.stopPropagation()}
        />
        {/* Bottom blocker */}
        <div
          className="fixed left-0 right-0 bottom-0 z-[9997]"
          style={{ top: targetRect.y + targetRect.height }}
          onClick={(e) => e.stopPropagation()}
        />
        {/* Left blocker */}
        <div
          className="fixed left-0 top-0 bottom-0 z-[9997]"
          style={{ width: targetRect.x }}
          onClick={(e) => e.stopPropagation()}
        />
        {/* Right blocker */}
        <div
          className="fixed top-0 bottom-0 right-0 z-[9997]"
          style={{ left: targetRect.x + targetRect.width }}
          onClick={(e) => e.stopPropagation()}
        />
      </>
    );
  };

  return (
    <AnimatePresence>
      {isActive && (
        <>
          {renderSpotlightMask()}
          {renderClickBlocker()}
        </>
      )}
    </AnimatePresence>
  );
}

// Export target rect for tooltip positioning
export function useSpotlightRect() {
  const { isActive, currentTour, currentStepIndex } = useOnboardingTour();
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const currentStep = currentTour?.steps[currentStepIndex];

  useEffect(() => {
    if (!isActive || !currentStep) {
      setTargetRect(null);
      return;
    }

    if (currentStep.placement === 'center' || currentStep.target === 'center') {
      setTargetRect(null);
      return;
    }

    let rafId: number | null = null;
    let lastUpdateTime = 0;
    const UPDATE_INTERVAL = 100; // ms between updates

    const updateRect = (timestamp: number = performance.now()) => {
      // Throttle updates to prevent excessive DOM queries
      if (timestamp - lastUpdateTime < UPDATE_INTERVAL) {
        rafId = requestAnimationFrame(updateRect);
        return;
      }
      lastUpdateTime = timestamp;

      const element = document.querySelector(currentStep.target);
      if (element) {
        setTargetRect(element.getBoundingClientRect());
      }

      // Continue tracking position changes
      rafId = requestAnimationFrame(updateRect);
    };

    // Start tracking
    rafId = requestAnimationFrame(updateRect);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [isActive, currentStep, currentStepIndex]);

  return targetRect;
}
