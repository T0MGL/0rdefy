import { useEffect, useState, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDemoTour } from './DemoTourProvider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  Store,
  Wrench,
  Loader2,
} from 'lucide-react';
import { shopifyService } from '@/services/shopify.service';

// Lazy load interactive step components - only loaded when tour is active
const CarrierStep = lazy(() => import('./steps/CarrierStep').then(m => ({ default: m.CarrierStep })));
const ProductStep = lazy(() => import('./steps/ProductStep').then(m => ({ default: m.ProductStep })));
const OrderStep = lazy(() => import('./steps/OrderStep').then(m => ({ default: m.OrderStep })));
const ConfirmStep = lazy(() => import('./steps/ConfirmStep').then(m => ({ default: m.ConfirmStep })));
const WarehouseStep = lazy(() => import('./steps/WarehouseStep').then(m => ({ default: m.WarehouseStep })));
const LabelStep = lazy(() => import('./steps/LabelStep').then(m => ({ default: m.LabelStep })));
const DispatchStep = lazy(() => import('./steps/DispatchStep').then(m => ({ default: m.DispatchStep })));
const MerchandiseStep = lazy(() => import('./steps/MerchandiseStep').then(m => ({ default: m.MerchandiseStep })));
const CompletionStep = lazy(() => import('./steps/CompletionStep').then(m => ({ default: m.CompletionStep })));
const ShopifyStep = lazy(() => import('./steps/ShopifyStep').then(m => ({ default: m.ShopifyStep })));

// Map step IDs to interactive components
const interactiveSteps: Record<string, React.LazyExoticComponent<React.ComponentType<{ onComplete?: () => void }>>> = {
  'create-carrier': CarrierStep,
  'create-product': ProductStep,
  'create-order': OrderStep,
  'confirm-order': ConfirmStep,
  'picking': WarehouseStep,
  'print-label': LabelStep,
  'dispatch': DispatchStep,
  'merchandise': MerchandiseStep,
  'completion': CompletionStep,
  'connect-shopify': ShopifyStep,
};

// Loading fallback for lazy loaded steps
const StepLoadingFallback = () => (
  <div className="fixed z-[10002] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
    <div className="bg-card border border-border rounded-2xl shadow-2xl p-8 flex items-center gap-3">
      <Loader2 className="w-5 h-5 animate-spin text-primary" />
      <span className="text-sm text-muted-foreground">Cargando...</span>
    </div>
  </div>
);

interface TooltipPosition {
  top?: number | string;
  bottom?: number | string;
  left?: number | string;
  right?: number | string;
  transform?: string;
}

export function DemoTourTooltip() {
  const {
    isActive,
    currentStep,
    currentStepIndex,
    totalSteps,
    path,
    setPath,
    nextStep,
    prevStep,
    completeTour,
    isTransitioning,
  } = useDemoTour();

  const [tooltipPosition, setTooltipPosition] = useState<TooltipPosition>({});
  const [isShopifyConnected, setIsShopifyConnected] = useState<boolean | null>(null);
  const [isCheckingShopify, setIsCheckingShopify] = useState(false);
  const [hasScroll, setHasScroll] = useState(false); // Track if tooltip has scrollable content
  const [isAtBottom, setIsAtBottom] = useState(false); // Track if scrolled to bottom
  const tooltipRef = useRef<HTMLDivElement>(null); // Track tooltip dimensions

  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === totalSteps - 1;
  // Welcome step with path selection (only for owners/admins who need to choose Shopify vs Manual)
  const isWelcomeStepWithPathSelection = currentStep?.id === 'welcome' && path === null;
  // Welcome step for collaborators (shows simple welcome without path selection)
  const isCollaboratorWelcome = currentStep?.id === 'welcome' && path === 'collaborator';

  // Check if Shopify is already connected (for welcome step)
  useEffect(() => {
    if (!isWelcomeStepWithPathSelection) return;
    if (isShopifyConnected !== null) return; // Already checked

    const checkShopifyConnection = async () => {
      setIsCheckingShopify(true);
      try {
        const response = await shopifyService.getIntegration();
        setIsShopifyConnected(response.success && !!response.integration);
      } catch (error) {
        setIsShopifyConnected(false);
      } finally {
        setIsCheckingShopify(false);
      }
    };

    checkShopifyConnection();
  }, [isWelcomeStepWithPathSelection, isShopifyConnected]);

  // Calculate tooltip position with smart viewport constraints
  useEffect(() => {
    if (!isActive || !currentStep) return;

    // Center placement
    if (currentStep.placement === 'center' || !currentStep.target) {
      setTooltipPosition({
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      });
      return;
    }

    const updatePosition = () => {
      const element = document.querySelector(currentStep.target!);
      if (!element || !tooltipRef.current) return;

      const rect = element.getBoundingClientRect();

      // Get REAL tooltip dimensions (not hardcoded)
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const tooltipWidth = tooltipRect.width || 400; // Fallback to expected width
      const tooltipHeight = tooltipRect.height || 300; // Dynamic height

      const padding = 16; // Minimum distance from viewport edges
      const arrowOffset = 20;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      // Helper: Check if position fits in viewport
      const fitsInViewport = (pos: { top?: number; left?: number }) => {
        if (pos.top !== undefined && pos.left !== undefined) {
          return (
            pos.top >= padding &&
            pos.left >= padding &&
            pos.top + tooltipHeight <= viewportHeight - padding &&
            pos.left + tooltipWidth <= viewportWidth - padding
          );
        }
        return false;
      };

      // Try placements in order of preference
      const placements: Array<'bottom' | 'top' | 'right' | 'left'> =
        currentStep.placement === 'center'
          ? ['bottom', 'top', 'right', 'left']
          : [currentStep.placement || 'bottom', 'top', 'right', 'left'];

      let finalPosition: TooltipPosition | null = null;

      for (const placement of placements) {
        let proposedPosition: { top?: number; left?: number } = {};

        switch (placement) {
          case 'top':
            proposedPosition = {
              top: rect.top - tooltipHeight - arrowOffset,
              left: rect.left + rect.width / 2 - tooltipWidth / 2,
            };
            break;
          case 'bottom':
            proposedPosition = {
              top: rect.bottom + arrowOffset,
              left: rect.left + rect.width / 2 - tooltipWidth / 2,
            };
            break;
          case 'left':
            proposedPosition = {
              top: rect.top + rect.height / 2 - tooltipHeight / 2,
              left: rect.left - tooltipWidth - arrowOffset,
            };
            break;
          case 'right':
            proposedPosition = {
              top: rect.top + rect.height / 2 - tooltipHeight / 2,
              left: rect.right + arrowOffset,
            };
            break;
        }

        // Constrain to viewport with padding
        const constrainedPosition = {
          top: Math.max(
            padding,
            Math.min(proposedPosition.top || 0, viewportHeight - tooltipHeight - padding)
          ),
          left: Math.max(
            padding,
            Math.min(proposedPosition.left || 0, viewportWidth - tooltipWidth - padding)
          ),
        };

        // Check if this constrained position actually fits
        if (fitsInViewport(constrainedPosition)) {
          finalPosition = constrainedPosition;
          break; // Found a good position
        }
      }

      // If no placement works, force center as fallback
      if (!finalPosition) {
        setTooltipPosition({
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
        });
      } else {
        setTooltipPosition(finalPosition);
      }
    };

    // Initial position calculation with small delay to ensure ref is ready
    const initialTimeout = setTimeout(updatePosition, 50);
    updatePosition(); // Try immediately as well

    // Update position on scroll/resize/interval
    const interval = setInterval(updatePosition, 200);
    window.addEventListener('scroll', updatePosition, true); // Capture phase for all scrolls
    window.addEventListener('resize', updatePosition);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isActive, currentStep, currentStepIndex]);

  // Detect scrollable content and scroll position
  useEffect(() => {
    if (!isActive || !tooltipRef.current) return;

    const tooltipElement = tooltipRef.current;

    const checkScroll = () => {
      if (!tooltipElement) return;

      const hasScrollableContent = tooltipElement.scrollHeight > tooltipElement.clientHeight;
      setHasScroll(hasScrollableContent);

      // Check if scrolled to bottom (within 10px threshold)
      const isScrolledToBottom =
        tooltipElement.scrollHeight - tooltipElement.scrollTop - tooltipElement.clientHeight < 10;
      setIsAtBottom(isScrolledToBottom);
    };

    checkScroll();

    // Listen to scroll events on the tooltip
    tooltipElement.addEventListener('scroll', checkScroll);

    const interval = setInterval(checkScroll, 500);

    return () => {
      tooltipElement.removeEventListener('scroll', checkScroll);
      clearInterval(interval);
    };
  }, [isActive, currentStepIndex]);

  // Keyboard navigation
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't interfere with path selection (only for owner/admin welcome)
      if (isWelcomeStepWithPathSelection) return;

      switch (e.key) {
        case 'ArrowRight':
        case 'Enter':
          e.preventDefault();
          if (isLastStep) {
            completeTour();
          } else {
            nextStep();
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (!isFirstStep) prevStep();
          break;
        case 'Escape':
          // Let skipTour handle this via progress bar
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, nextStep, prevStep, completeTour, isFirstStep, isLastStep, isWelcomeStepWithPathSelection]);

  if (!isActive || !currentStep) return null;

  // Check if this step has an interactive component
  // Only show interactive components for owner/admin paths (shopify/manual), NOT for collaborators
  const InteractiveComponent = interactiveSteps[currentStep.id];
  const isOwnerPath = path === 'shopify' || path === 'manual';
  if (InteractiveComponent && isOwnerPath) {
    return (
      <Suspense fallback={<StepLoadingFallback />}>
        <InteractiveComponent />
      </Suspense>
    );
  }

  // Welcome step with path selection (for owners/admins)
  if (isWelcomeStepWithPathSelection) {
    // Show loading while checking Shopify connection
    if (isCheckingShopify) {
      return (
        <AnimatePresence mode="wait">
          <motion.div
            key="welcome-loading"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="fixed z-[10002] w-[480px] max-w-[calc(100vw-32px)]"
            style={{
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div className="bg-card border border-border rounded-2xl shadow-2xl p-8 flex items-center justify-center gap-3">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Cargando...</span>
            </div>
          </motion.div>
        </AnimatePresence>
      );
    }

    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="welcome-path-selection"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', stiffness: 350, damping: 35 }}
          className="fixed z-[10002] w-[480px] max-w-[calc(100vw-32px)] max-h-[min(700px,calc(100vh-64px))] overflow-y-auto bg-card border border-border rounded-2xl shadow-2xl scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
          style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          {/* Header */}
          <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-6 pb-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-2xl font-bold text-card-foreground mb-2">
              {currentStep.title}
            </h2>
            <p className="text-muted-foreground">
              {currentStep.description}
            </p>
          </div>

          {/* Path selection */}
          <div className="p-6 pt-4 space-y-3">
            <p className="text-sm font-medium text-card-foreground mb-4 text-center">
              {isShopifyConnected ? '¿Qué quieres aprender?' : '¿Cómo quieres empezar?'}
            </p>

            {/* Shopify option - Show connected state or connect option */}
            {isShopifyConnected ? (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setPath('shopify')}
                className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-card-foreground">
                    Shopify Conectado
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Aprende a gestionar pedidos sincronizados
                  </p>
                </div>
                <ArrowRight className="w-5 h-5 text-primary flex-shrink-0" />
              </motion.button>
            ) : (
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setPath('shopify')}
                className="w-full flex items-center gap-4 p-4 rounded-xl border-2 border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
                  <Store className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold text-card-foreground">
                    Conectar Shopify
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Importa productos, clientes y pedidos automáticamente
                  </p>
                </div>
                <ArrowRight className="w-5 h-5 text-primary flex-shrink-0" />
              </motion.button>
            )}

            {/* Manual option */}
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setPath('manual')}
              className="w-full flex items-center gap-4 p-4 rounded-xl border border-border hover:border-muted-foreground/30 hover:bg-muted/50 transition-all text-left"
            >
              <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                <Wrench className="w-6 h-6 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-card-foreground">
                  {isShopifyConnected ? 'Tour completo' : 'Configurar manualmente'}
                </h4>
                <p className="text-sm text-muted-foreground">
                  {isShopifyConnected
                    ? 'Aprende el flujo completo desde crear pedido hasta despacho'
                    : 'Te guiamos paso a paso para crear tu primera operación'
                  }
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
            </motion.button>
          </div>

          {/* Footer hint */}
          <div className="px-6 pb-6 pt-2">
            <p className="text-xs text-muted-foreground/60 text-center">
              Podrás cambiar la configuración en cualquier momento
            </p>
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  // Welcome step for collaborators (simple welcome without path selection)
  if (isCollaboratorWelcome) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="collaborator-welcome"
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: 'spring', stiffness: 350, damping: 35 }}
          className="fixed z-[10002] w-[480px] max-w-[calc(100vw-32px)] max-h-[min(700px,calc(100vh-64px))] overflow-y-auto bg-card border border-border rounded-2xl shadow-2xl scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
          style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          {/* Header */}
          <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-6 pb-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-2xl font-bold text-card-foreground mb-2">
              {currentStep.title}
            </h2>
            <p className="text-muted-foreground">
              {currentStep.description}
            </p>
          </div>

          {/* Quick overview */}
          <div className="p-6 pt-4 space-y-4">
            <p className="text-sm text-center text-muted-foreground">
              Te mostraremos las herramientas principales para tu rol
            </p>

            {/* Start button */}
            <Button
              onClick={nextStep}
              className="w-full gap-2 h-12 text-base"
            >
              Comenzar Tour
              <ArrowRight className="w-5 h-5" />
            </Button>
          </div>

          {/* Footer hint */}
          <div className="px-6 pb-6 pt-0">
            <p className="text-xs text-muted-foreground/60 text-center">
              Usa <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">Enter</kbd> para avanzar
            </p>
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  // Regular step tooltip
  return (
    <AnimatePresence mode="wait">
      <motion.div
        ref={tooltipRef}
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
          'fixed z-[10002] w-[400px] max-w-[calc(100vw-32px)]',
          'bg-card border border-border rounded-2xl shadow-2xl',
          // Smart max-height: respect safe areas and ensure buttons always visible
          tooltipPosition.transform?.includes('translate(-50%, -50%)')
            ? 'max-h-[min(600px,calc(100vh-80px))]' // Centered: generous height
            : 'max-h-[calc(100vh-100px)]', // Positioned: conservative height
          'overflow-y-auto scroll-smooth scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent'
        )}
        style={tooltipPosition}
      >
        {/* Scroll indicator - subtle gradient at bottom when scrollable and not at bottom */}
        {hasScroll && !isAtBottom && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-card via-card/80 to-transparent pointer-events-none z-10 rounded-b-2xl"
          />
        )}

        {/* Header with gradient */}
        <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <span className="text-xs font-medium text-muted-foreground">
              Paso {currentStepIndex + 1} de {totalSteps}
            </span>
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
        </div>

        {/* Footer with navigation */}
        <div className="px-4 pb-4">
          {/* Progress dots */}
          <div className="flex items-center justify-center gap-1.5 mb-4">
            {Array.from({ length: totalSteps }).map((_, index) => (
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
            {!isFirstStep && (
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 gap-2"
                onClick={prevStep}
              >
                <ArrowLeft className="w-4 h-4" />
                Anterior
              </Button>
            )}

            <Button
              size="sm"
              className={cn(
                'gap-2 bg-primary hover:bg-primary/90 text-primary-foreground',
                isFirstStep ? 'flex-1' : 'flex-1'
              )}
              onClick={isLastStep ? completeTour : nextStep}
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
            {' '}<kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">←</kbd>{' '}
            <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">→</kbd> para navegar
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
