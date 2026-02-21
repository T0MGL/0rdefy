/**
 * First-Time Tooltip Component
 * Shows contextual tips when users visit a module for the first time
 *
 * IMPORTANT: This component uses a portal to render in the body to avoid
 * z-index and overflow issues with parent containers.
 */

import { useState, useEffect, ReactNode, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Lightbulb, ChevronRight, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { onboardingService } from '@/services/onboarding.service';

interface TooltipStep {
  title: string;
  description: string;
  icon?: ReactNode;
}

interface FirstTimeTooltipProps {
  moduleId: string;
  moduleName: string;
  steps: TooltipStep[];
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  children?: ReactNode;
  onComplete?: () => void;
}

// Tooltip dimensions for positioning calculations
const TOOLTIP_WIDTH = 320;
const TOOLTIP_MARGIN = 16;
const ARROW_SIZE = 12;
const ESTIMATED_TOOLTIP_HEIGHT = 240;

export function FirstTimeTooltip({
  moduleId,
  moduleName,
  steps,
  position = 'bottom',
  className,
  children,
  onComplete,
}: FirstTimeTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const [actualPosition, setActualPosition] = useState(position);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Calculate position based on trigger element
  const calculatePosition = useCallback(() => {
    if (!triggerRef.current || typeof window === 'undefined') return;

    const rect = triggerRef.current.getBoundingClientRect();

    const visualViewport = window.visualViewport;
    const viewportWidth = visualViewport?.width ?? window.innerWidth;
    const viewportHeight = visualViewport?.height ?? window.innerHeight;

    const tooltipHeight = tooltipRef.current?.offsetHeight ?? ESTIMATED_TOOLTIP_HEIGHT;
    const tooltipWidth = Math.min(TOOLTIP_WIDTH, viewportWidth - TOOLTIP_MARGIN * 2);
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

    const placements: Array<'top' | 'bottom' | 'left' | 'right'> = [
      position,
      'bottom',
      'top',
      'right',
      'left',
    ].filter((value, index, arr) => arr.indexOf(value) === index) as Array<'top' | 'bottom' | 'left' | 'right'>;

    const getCoordinates = (placement: 'top' | 'bottom' | 'left' | 'right') => {
      switch (placement) {
        case 'bottom':
          return {
            top: rect.bottom + ARROW_SIZE,
            left: rect.left + rect.width / 2 - tooltipWidth / 2,
          };
        case 'top':
          return {
            top: rect.top - tooltipHeight - ARROW_SIZE,
            left: rect.left + rect.width / 2 - tooltipWidth / 2,
          };
        case 'left':
          return {
            top: rect.top + rect.height / 2 - tooltipHeight / 2,
            left: rect.left - tooltipWidth - ARROW_SIZE,
          };
        case 'right':
          return {
            top: rect.top + rect.height / 2 - tooltipHeight / 2,
            left: rect.right + ARROW_SIZE,
          };
      }
    };

    const fitsInViewport = (top: number, left: number) =>
      top >= TOOLTIP_MARGIN &&
      left >= TOOLTIP_MARGIN &&
      top + tooltipHeight <= viewportHeight - TOOLTIP_MARGIN &&
      left + tooltipWidth <= viewportWidth - TOOLTIP_MARGIN;

    let finalPlacement = placements[0];
    let finalCoordinates = getCoordinates(finalPlacement);

    for (const candidate of placements) {
      const coordinates = getCoordinates(candidate);
      if (fitsInViewport(coordinates.top, coordinates.left)) {
        finalPlacement = candidate;
        finalCoordinates = coordinates;
        break;
      }
    }

    const maxTop = Math.max(TOOLTIP_MARGIN, viewportHeight - tooltipHeight - TOOLTIP_MARGIN);
    const maxLeft = Math.max(TOOLTIP_MARGIN, viewportWidth - tooltipWidth - TOOLTIP_MARGIN);

    setTooltipPosition({
      top: clamp(finalCoordinates.top, TOOLTIP_MARGIN, maxTop),
      left: clamp(finalCoordinates.left, TOOLTIP_MARGIN, maxLeft),
    });
    setActualPosition(finalPlacement);
  }, [position]);

  useEffect(() => {
    checkFirstVisit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId]);

  useEffect(() => {
    if (isVisible) {
      calculatePosition();
      const rafId = window.requestAnimationFrame(calculatePosition);

      // Recalculate on scroll/resize
      window.addEventListener('scroll', calculatePosition, true);
      window.addEventListener('resize', calculatePosition);
      window.visualViewport?.addEventListener('resize', calculatePosition);
      window.visualViewport?.addEventListener('scroll', calculatePosition);
      return () => {
        window.cancelAnimationFrame(rafId);
        window.removeEventListener('scroll', calculatePosition, true);
        window.removeEventListener('resize', calculatePosition);
        window.visualViewport?.removeEventListener('resize', calculatePosition);
        window.visualViewport?.removeEventListener('scroll', calculatePosition);
      };
    }
  }, [isVisible, calculatePosition, currentStep]);

  async function checkFirstVisit() {
    setIsLoading(true);
    let mounted = true;
    try {
      // Use async API call to get accurate state from database
      const isFirstVisit = await onboardingService.shouldShowTipAsync(moduleId);
      if (mounted) setIsVisible(isFirstVisit);
    } catch {
      // On error, default to not showing
      if (mounted) setIsVisible(false);
    } finally {
      if (mounted) setIsLoading(false);
    }
    return () => { mounted = false; };
  }

  async function handleDismiss() {
    setIsVisible(false);
    onComplete?.();
    await onboardingService.markVisited(moduleId);
  }

  async function handleNext() {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      await handleDismiss();
    }
  }

  function handlePrev() {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  }

  if (isLoading || !isVisible) {
    return <div ref={triggerRef} className={cn('inline-block', className)}>{children}</div>;
  }

  const step = steps[currentStep];

  // Arrow positioning classes
  const arrowClasses = cn(
    'absolute w-3 h-3 bg-card border-2 border-primary/20 transform rotate-45',
    actualPosition === 'top' && 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 border-t-0 border-l-0',
    actualPosition === 'bottom' && 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 border-b-0 border-r-0',
    actualPosition === 'left' && 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 border-t-0 border-r-0',
    actualPosition === 'right' && 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 border-b-0 border-l-0'
  );

  const tooltipContent = (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.2 }}
          className="fixed z-[9999]"
          ref={tooltipRef}
          style={{
            top: tooltipPosition.top,
            left: tooltipPosition.left,
            width: TOOLTIP_WIDTH,
            maxWidth: `calc(100vw - ${TOOLTIP_MARGIN * 2}px)`,
          }}
        >
          <Card className="p-4 shadow-xl border-2 border-primary/20 bg-card">
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="p-1.5 bg-primary/10 rounded-md flex-shrink-0">
                  <Lightbulb className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground truncate">Guía de {moduleName}</p>
                  <p className="text-sm font-medium truncate">{step.title}</p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0 ml-2"
                onClick={handleDismiss}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Content */}
            <div className="mb-4">
              {step.icon && (
                <div className="mb-2">{step.icon}</div>
              )}
              <p className="text-sm text-muted-foreground">{step.description}</p>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2">
              {/* Step indicators */}
              <div className="flex gap-1 flex-shrink-0">
                {steps.map((_, index) => (
                  <div
                    key={index}
                    className={cn(
                      'w-2 h-2 rounded-full transition-colors',
                      index === currentStep
                        ? 'bg-primary'
                        : index < currentStep
                        ? 'bg-primary/50'
                        : 'bg-muted'
                    )}
                  />
                ))}
              </div>

              {/* Navigation */}
              <div className="flex items-center gap-1 flex-shrink-0">
                {currentStep > 0 && (
                  <Button variant="ghost" size="sm" className="h-8 px-2" onClick={handlePrev}>
                    <ChevronLeft className="w-4 h-4" />
                    <span className="hidden sm:inline ml-1">Anterior</span>
                  </Button>
                )}
                <Button size="sm" className="h-8" onClick={handleNext}>
                  {currentStep === steps.length - 1 ? (
                    '¡Entendido!'
                  ) : (
                    <>
                      <span className="hidden sm:inline">Siguiente</span>
                      <span className="sm:hidden">Sig.</span>
                      <ChevronRight className="w-4 h-4 ml-1" />
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Arrow pointer */}
            <div className={arrowClasses} />
          </Card>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      <div ref={triggerRef} className={cn('inline-block', className)}>
        {children}
      </div>
      {typeof document !== 'undefined' && createPortal(tooltipContent, document.body)}
    </>
  );
}

/**
 * Page-level welcome banner for first-time visits
 *
 * Auto-hides when ANY of these conditions are met:
 * A) User clicks X (manual dismiss)
 * B) User has visited 3 times
 * C) User completes first action (call onboardingService.markFirstActionCompleted)
 *
 * ARCHITECTURE: Uses async API check on mount to prevent FOUC (flash of unstyled content)
 * - Initial state is 'loading' (null) - nothing rendered
 * - After API response: either show (true) or hide (false)
 * - No flash because we never go from false → true
 */

interface FirstTimeWelcomeBannerProps {
  moduleId: string;
  title: string;
  description: string;
  tips: string[];
  onDismiss?: () => void;
}

export function FirstTimeWelcomeBanner({
  moduleId,
  title,
  description,
  tips,
  onDismiss,
}: FirstTimeWelcomeBannerProps) {
  // null = loading, true = visible, false = hidden
  const [isVisible, setIsVisible] = useState<boolean | null>(null);
  const hasIncrementedRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    hasIncrementedRef.current = false;

    async function checkAndShow() {
      try {
        // Use async version to get accurate state from API
        const shouldShow = await onboardingService.shouldShowTipAsync(moduleId);

        if (!mounted) return;

        setIsVisible(shouldShow);

        // Increment visit count only once per mount, and only if showing
        if (shouldShow && !hasIncrementedRef.current) {
          hasIncrementedRef.current = true;
          onboardingService.incrementVisitCount(moduleId);
        }
      } catch {
        // On error, default to not showing (better UX than flickering)
        if (mounted) {
          setIsVisible(false);
        }
      }
    }

    checkAndShow();

    return () => {
      mounted = false;
    };
  }, [moduleId]);

  async function handleDismiss() {
    setIsVisible(false);
    onDismiss?.();
    // Mark as manually dismissed
    await onboardingService.dismissModuleTip(moduleId);
  }

  // Loading state or hidden - render nothing
  if (isVisible !== true) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
        className="relative"
      >
        <Card className="p-3 sm:p-4 mb-4 sm:mb-6 border-2 border-primary/20 bg-gradient-to-r from-primary/5 via-background to-primary/5 overflow-hidden">
          {/* Close button - absolute positioned for better mobile layout */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 h-7 w-7 z-10"
            onClick={() => handleDismiss()}
          >
            <X className="w-4 h-4" />
          </Button>

          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 pr-8 sm:pr-10">
            {/* Icon - hidden on very small screens, shown on sm+ */}
            <div className="hidden sm:flex p-2 bg-primary/10 rounded-lg h-fit flex-shrink-0">
              <Lightbulb className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              {/* Title with icon on mobile */}
              <div className="flex items-center gap-2 mb-1">
                <div className="sm:hidden p-1.5 bg-primary/10 rounded-md flex-shrink-0">
                  <Lightbulb className="w-4 h-4 text-primary" />
                </div>
                <h3 className="font-semibold text-sm sm:text-base truncate">{title}</h3>
              </div>

              <p className="text-xs sm:text-sm text-muted-foreground mb-2 sm:mb-3 line-clamp-2">
                {description}
              </p>

              {/* Tips - horizontal scroll on mobile, wrap on desktop */}
              <div className="flex gap-1.5 sm:gap-2 overflow-x-auto pb-1 sm:pb-0 sm:flex-wrap scrollbar-hide">
                {tips.map((tip, index) => (
                  <span
                    key={index}
                    className="text-xs px-2 py-1 bg-muted rounded-full text-muted-foreground whitespace-nowrap flex-shrink-0"
                  >
                    {tip}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Pre-configured tooltips for common modules
 */

export const ordersTooltipSteps: TooltipStep[] = [
  {
    title: '¡Bienvenido a Pedidos!',
    description: 'Aquí gestionas todas tus ventas. Puedes crear, confirmar y dar seguimiento a cada pedido.',
  },
  {
    title: 'Estados de Pedido',
    description: 'Los pedidos pasan por varios estados: Pendiente → Confirmado → En Preparación → Listo → Enviado → Entregado.',
  },
  {
    title: 'Acciones Rápidas',
    description: 'Usa los filtros para encontrar pedidos y las acciones en masa para procesar múltiples pedidos a la vez.',
  },
];

export const productsTooltipSteps: TooltipStep[] = [
  {
    title: '¡Bienvenido a Productos!',
    description: 'Aquí gestionas tu catálogo completo. Cada producto tiene precio, costo y stock.',
  },
  {
    title: 'Control de Stock',
    description: 'El stock se actualiza automáticamente cuando se preparan pedidos. También puedes ajustarlo manualmente.',
  },
  {
    title: 'Sincronización',
    description: 'Si tienes Shopify, los productos se sincronizan automáticamente en ambas direcciones.',
  },
];

export const warehouseTooltipSteps: TooltipStep[] = [
  {
    title: '¡Bienvenido al Almacén!',
    description: 'Aquí preparas pedidos para envío mediante el proceso de Picking y Packing.',
  },
  {
    title: 'Picking',
    description: 'Selecciona pedidos confirmados y crea una sesión de picking para recolectar todos los productos juntos.',
  },
  {
    title: 'Packing',
    description: 'Una vez recolectados, empaca cada pedido individualmente. Al completar, el pedido queda listo para enviar.',
  },
];

export const customersTooltipSteps: TooltipStep[] = [
  {
    title: '¡Bienvenido a Clientes!',
    description: 'Aquí gestionas tu base de clientes con todos sus datos de contacto y dirección.',
  },
  {
    title: 'Historial de Compras',
    description: 'Cada cliente tiene un historial de pedidos que te ayuda a entender sus preferencias.',
  },
  {
    title: 'Datos de Envío',
    description: 'Guarda la dirección completa para crear pedidos más rápido y evitar errores de envío.',
  },
];

export default FirstTimeTooltip;
