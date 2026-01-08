import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOnboardingTour, TourStep as TourStepType } from '@/contexts/OnboardingTourContext';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ArrowLeft,
  ArrowRight,
  X,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';

interface TooltipPosition {
  top?: number | string;
  bottom?: number | string;
  left?: number | string;
  right?: number | string;
  transform?: string;
}

export function TourStepTooltip() {
  const {
    isActive,
    currentTour,
    currentStepIndex,
    nextStep,
    prevStep,
    skipTour,
    isTransitioning,
  } = useOnboardingTour();

  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition>({});

  const currentStep = currentTour?.steps[currentStepIndex];
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentTour ? currentStepIndex === currentTour.steps.length - 1 : false;
  const totalSteps = currentTour?.steps.length || 0;

  // Find target element and calculate position
  useEffect(() => {
    if (!isActive || !currentStep) {
      setTargetRect(null);
      return;
    }

    const updatePosition = () => {
      // Center placement - position in middle of screen
      if (currentStep.placement === 'center' || currentStep.target === 'center') {
        setTargetRect(null);
        setTooltipPosition({
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        });
        return;
      }

      const element = document.querySelector(currentStep.target);
      if (!element) return;

      const rect = element.getBoundingClientRect();
      setTargetRect(rect);

      const tooltipWidth = 400;
      const tooltipHeight = 250; // Estimated
      const padding = 16;
      const arrowOffset = 24;

      let position: TooltipPosition = {};

      // Calculate best placement
      const placement = currentStep.placement || 'bottom';

      switch (placement) {
        case 'top':
          position = {
            bottom: window.innerHeight - rect.top + arrowOffset,
            left: Math.max(
              padding,
              Math.min(
                rect.left + rect.width / 2 - tooltipWidth / 2,
                window.innerWidth - tooltipWidth - padding
              )
            ),
          };
          break;

        case 'bottom':
          position = {
            top: rect.bottom + arrowOffset,
            left: Math.max(
              padding,
              Math.min(
                rect.left + rect.width / 2 - tooltipWidth / 2,
                window.innerWidth - tooltipWidth - padding
              )
            ),
          };
          break;

        case 'left':
          position = {
            top: Math.max(
              padding,
              Math.min(
                rect.top + rect.height / 2 - tooltipHeight / 2,
                window.innerHeight - tooltipHeight - padding
              )
            ),
            right: window.innerWidth - rect.left + arrowOffset,
          };
          break;

        case 'right':
          position = {
            top: Math.max(
              padding,
              Math.min(
                rect.top + rect.height / 2 - tooltipHeight / 2,
                window.innerHeight - tooltipHeight - padding
              )
            ),
            left: rect.right + arrowOffset,
          };
          break;

        default:
          position = {
            top: rect.bottom + arrowOffset,
            left: Math.max(
              padding,
              Math.min(
                rect.left + rect.width / 2 - tooltipWidth / 2,
                window.innerWidth - tooltipWidth - padding
              )
            ),
          };
      }

      setTooltipPosition(position);
    };

    updatePosition();
    const interval = setInterval(updatePosition, 100);

    return () => clearInterval(interval);
  }, [isActive, currentStep, currentStepIndex]);

  // Keyboard navigation
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'Enter':
          e.preventDefault();
          nextStep();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (!isFirstStep) prevStep();
          break;
        case 'Escape':
          e.preventDefault();
          skipTour();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, nextStep, prevStep, skipTour, isFirstStep]);

  if (!isActive || !currentStep) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={currentStepIndex}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: -4 }}
        transition={{
          type: 'spring',
          stiffness: 350,
          damping: 35,
          mass: 0.8,
        }}
        className={cn(
          'fixed z-[10000] w-[400px] max-w-[calc(100vw-32px)]',
          'bg-card border border-border rounded-2xl shadow-2xl',
          'overflow-hidden'
        )}
        style={tooltipPosition}
      >
        {/* Header with gradient */}
        <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4 pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <div>
                <span className="text-xs font-medium text-muted-foreground">
                  Paso {currentStepIndex + 1} de {totalSteps}
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="w-8 h-8 rounded-full hover:bg-destructive/10 hover:text-destructive"
              onClick={skipTour}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 pt-2">
          <h3 className="text-lg font-semibold text-card-foreground mb-2">
            {currentStep.title}
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {currentStep.description}
          </p>

          {/* Custom action button */}
          {currentStep.action && (
            <Button
              variant="outline"
              className="mt-4 w-full gap-2 border-primary/30 hover:bg-primary/10 hover:border-primary"
              onClick={currentStep.action.onClick}
            >
              {currentStep.action.label}
            </Button>
          )}
        </div>

        {/* Footer with navigation */}
        <div className="px-4 pb-4">
          {/* Progress dots */}
          <div className="flex items-center justify-center gap-1.5 mb-4">
            {currentTour?.steps.map((_, index) => (
              <motion.div
                key={index}
                className={cn(
                  'h-1.5 rounded-full transition-all duration-300',
                  index === currentStepIndex
                    ? 'w-6 bg-primary'
                    : index < currentStepIndex
                    ? 'w-1.5 bg-primary/50'
                    : 'w-1.5 bg-muted'
                )}
              />
            ))}
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center gap-2">
            {!isFirstStep ? (
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 gap-2"
                onClick={prevStep}
              >
                <ArrowLeft className="w-4 h-4" />
                Anterior
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 text-muted-foreground"
                onClick={skipTour}
              >
                Omitir tour
              </Button>
            )}

            <Button
              size="sm"
              className="flex-1 gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={nextStep}
            >
              {isLastStep ? (
                <>
                  Finalizar
                  <CheckCircle2 className="w-4 h-4" />
                </>
              ) : (
                <>
                  Siguiente
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          </div>

          {/* Keyboard hint */}
          <p className="text-[10px] text-muted-foreground/60 text-center mt-3">
            Usa <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">Enter</kbd> para avanzar
            {' '}<kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">Esc</kbd> para salir
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

// Arrow component pointing to target
export function TourArrow() {
  const { isActive, currentTour, currentStepIndex } = useOnboardingTour();
  const [arrowStyle, setArrowStyle] = useState<React.CSSProperties>({});
  const [visible, setVisible] = useState(false);

  const currentStep = currentTour?.steps[currentStepIndex];

  useEffect(() => {
    if (!isActive || !currentStep) {
      setVisible(false);
      return;
    }

    if (currentStep.placement === 'center' || currentStep.target === 'center') {
      setVisible(false);
      return;
    }

    const element = document.querySelector(currentStep.target);
    if (!element) {
      setVisible(false);
      return;
    }

    // Arrow is now handled by CSS pseudo-element on tooltip
    // This component can be extended for more complex arrow animations
    setVisible(false);
  }, [isActive, currentStep]);

  if (!visible) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed z-[9999] pointer-events-none"
      style={arrowStyle}
    >
      {/* Arrow SVG could go here */}
    </motion.div>
  );
}
