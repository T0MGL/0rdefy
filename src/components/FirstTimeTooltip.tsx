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

  // Calculate position based on trigger element
  const calculatePosition = useCallback(() => {
    if (!triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = 0;
    let left = 0;
    let finalPosition = position;

    // Calculate initial position
    switch (position) {
      case 'bottom':
        top = rect.bottom + ARROW_SIZE;
        left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
        break;
      case 'top':
        top = rect.top - ARROW_SIZE;
        left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
        break;
      case 'left':
        top = rect.top + rect.height / 2;
        left = rect.left - TOOLTIP_WIDTH - ARROW_SIZE;
        break;
      case 'right':
        top = rect.top + rect.height / 2;
        left = rect.right + ARROW_SIZE;
        break;
    }

    // Adjust horizontal position to stay within viewport
    if (left < TOOLTIP_MARGIN) {
      left = TOOLTIP_MARGIN;
    } else if (left + TOOLTIP_WIDTH > viewportWidth - TOOLTIP_MARGIN) {
      left = viewportWidth - TOOLTIP_WIDTH - TOOLTIP_MARGIN;
    }

    // Adjust vertical position if needed (flip to opposite side)
    if (position === 'bottom' && top + 200 > viewportHeight) {
      finalPosition = 'top';
      top = rect.top - ARROW_SIZE - 200; // Estimate tooltip height
    } else if (position === 'top' && top < 200) {
      finalPosition = 'bottom';
      top = rect.bottom + ARROW_SIZE;
    }

    // Ensure minimum top
    if (top < TOOLTIP_MARGIN) {
      top = TOOLTIP_MARGIN;
    }

    setTooltipPosition({ top, left });
    setActualPosition(finalPosition);
  }, [position]);

  useEffect(() => {
    checkFirstVisit();
  }, [moduleId]);

  useEffect(() => {
    if (isVisible) {
      calculatePosition();
      // Recalculate on scroll/resize
      window.addEventListener('scroll', calculatePosition, true);
      window.addEventListener('resize', calculatePosition);
      return () => {
        window.removeEventListener('scroll', calculatePosition, true);
        window.removeEventListener('resize', calculatePosition);
      };
    }
  }, [isVisible, calculatePosition]);

  async function checkFirstVisit() {
    setIsLoading(true);
    try {
      const isFirstVisit = onboardingService.isFirstVisit(moduleId);
      setIsVisible(isFirstVisit);
    } finally {
      setIsLoading(false);
    }
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
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Check if should show using combined logic
    const shouldShow = onboardingService.shouldShowTip(moduleId);
    setIsVisible(shouldShow);

    // Increment visit count each time user visits this module
    if (shouldShow) {
      onboardingService.incrementVisitCount(moduleId);
    }
  }, [moduleId]);

  async function handleDismiss() {
    setIsVisible(false);
    onDismiss?.();
    // Mark as manually dismissed
    await onboardingService.dismissModuleTip(moduleId);
  }

  if (!isVisible) {
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
