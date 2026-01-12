/**
 * First-Time Tooltip Component
 * Shows contextual tips when users visit a module for the first time
 */

import { useState, useEffect, ReactNode } from 'react';
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

  useEffect(() => {
    checkFirstVisit();
  }, [moduleId]);

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

  // Position styles
  const positionStyles = {
    top: 'bottom-full mb-2',
    bottom: 'top-full mt-2',
    left: 'right-full mr-2',
    right: 'left-full ml-2',
  };

  if (isLoading || !isVisible) {
    return <>{children}</>;
  }

  const step = steps[currentStep];

  return (
    <div className={cn('relative inline-block', className)}>
      {children}

      <AnimatePresence>
        {isVisible && (
          <motion.div
            initial={{ opacity: 0, y: position === 'top' ? 10 : -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: position === 'top' ? 10 : -10 }}
            transition={{ duration: 0.2 }}
            className={cn(
              'absolute z-50 w-80',
              positionStyles[position]
            )}
          >
            <Card className="p-4 shadow-lg border-2 border-primary/20 bg-card">
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-primary/10 rounded-md">
                    <Lightbulb className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Guía de {moduleName}</p>
                    <p className="text-sm font-medium">{step.title}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 -mr-1 -mt-1"
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
              <div className="flex items-center justify-between">
                {/* Step indicators */}
                <div className="flex gap-1">
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
                <div className="flex items-center gap-2">
                  {currentStep > 0 && (
                    <Button variant="ghost" size="sm" onClick={handlePrev}>
                      <ChevronLeft className="w-4 h-4 mr-1" />
                      Anterior
                    </Button>
                  )}
                  <Button size="sm" onClick={handleNext}>
                    {currentStep === steps.length - 1 ? (
                      '¡Entendido!'
                    ) : (
                      <>
                        Siguiente
                        <ChevronRight className="w-4 h-4 ml-1" />
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Arrow pointer */}
              <div className={cn(
                'absolute w-3 h-3 bg-card border-2 border-primary/20 transform rotate-45',
                position === 'top' && 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 border-t-0 border-l-0',
                position === 'bottom' && 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 border-b-0 border-r-0',
                position === 'left' && 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2 border-t-0 border-r-0',
                position === 'right' && 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 border-b-0 border-l-0'
              )} />
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card className="p-4 mb-6 border-2 border-primary/20 bg-gradient-to-r from-primary/5 via-background to-primary/5">
          <div className="flex items-start justify-between">
            <div className="flex gap-4">
              <div className="p-2 bg-primary/10 rounded-lg">
                <Lightbulb className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">{title}</h3>
                <p className="text-sm text-muted-foreground mb-3">{description}</p>
                <div className="flex flex-wrap gap-2">
                  {tips.map((tip, index) => (
                    <span
                      key={index}
                      className="text-xs px-2 py-1 bg-muted rounded-full text-muted-foreground"
                    >
                      {tip}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => handleDismiss()}>
              <X className="w-4 h-4" />
            </Button>
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
