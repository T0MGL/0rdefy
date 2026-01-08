import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDemoTour } from './DemoTourProvider';

interface SpotlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function DemoTourOverlay() {
  const { isActive, currentStep, isTransitioning } = useDemoTour();
  const [targetRect, setTargetRect] = useState<SpotlightRect | null>(null);
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });

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

    // Center placement means no spotlight on specific element
    if (currentStep.placement === 'center' || !currentStep.target) {
      setTargetRect(null);
      return;
    }

    const padding = 12;
    let retryCount = 0;
    const maxRetries = 50;

    const updateTargetRect = () => {
      const element = document.querySelector(currentStep.target!);

      if (element) {
        const rect = element.getBoundingClientRect();
        setTargetRect({
          x: rect.x - padding,
          y: rect.y - padding,
          width: rect.width + padding * 2,
          height: rect.height + padding * 2,
        });

        // Scroll into view if needed
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
      } else {
        retryCount++;
        if (retryCount < maxRetries) {
          requestAnimationFrame(updateTargetRect);
        } else {
          setTargetRect(null);
        }
      }
    };

    updateTargetRect();
    const interval = setInterval(updateTargetRect, 200);

    return () => clearInterval(interval);
  }, [isActive, currentStep]);

  if (!isActive) return null;

  // Full overlay for center placement
  if (!targetRect) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="fixed inset-0 z-[9998] pointer-events-auto"
          style={{
            background: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(4px)',
          }}
        />
      </AnimatePresence>
    );
  }

  // SVG spotlight mask for targeted elements
  return (
    <AnimatePresence>
      <motion.div
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
        >
          <defs>
            <mask id="demo-spotlight-mask">
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
                rx={12}
                ry={12}
                fill="black"
              />
            </mask>

            <filter id="demo-spotlight-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Dark overlay with cutout */}
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="rgba(0, 0, 0, 0.8)"
            mask="url(#demo-spotlight-mask)"
          />

          {/* Glowing border around spotlight */}
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
              opacity: [0.4, 0.7, 0.4],
            }}
            transition={{
              x: { type: 'spring', stiffness: 300, damping: 30 },
              y: { type: 'spring', stiffness: 300, damping: 30 },
              width: { type: 'spring', stiffness: 300, damping: 30 },
              height: { type: 'spring', stiffness: 300, damping: 30 },
              opacity: { duration: 2, repeat: Infinity, ease: 'easeInOut' },
            }}
            rx={12}
            ry={12}
            fill="none"
            stroke="hsl(84 81% 60%)"
            strokeWidth="2"
            filter="url(#demo-spotlight-glow)"
          />
        </svg>

        {/* Click blockers around spotlight */}
        <div
          className="fixed left-0 right-0 top-0"
          style={{ height: targetRect.y }}
          onClick={(e) => e.stopPropagation()}
        />
        <div
          className="fixed left-0 right-0 bottom-0"
          style={{ top: targetRect.y + targetRect.height }}
          onClick={(e) => e.stopPropagation()}
        />
        <div
          className="fixed left-0 top-0 bottom-0"
          style={{ width: targetRect.x }}
          onClick={(e) => e.stopPropagation()}
        />
        <div
          className="fixed top-0 bottom-0 right-0"
          style={{ left: targetRect.x + targetRect.width }}
          onClick={(e) => e.stopPropagation()}
        />
      </motion.div>
    </AnimatePresence>
  );
}
