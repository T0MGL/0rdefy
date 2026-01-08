import { useEffect, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useOnboardingTour, Tour } from '@/contexts/OnboardingTourContext';
import { Spotlight } from './Spotlight';
import { TourStepTooltip } from './TourStep';
import { TourProgress } from './TourProgress';
import { useAuth } from '@/contexts/AuthContext';
import confetti from 'canvas-confetti';

// Minimal confetti burst - Apple style
const triggerMinimalConfetti = () => {
  // First burst - subtle from center
  confetti({
    particleCount: 50,
    spread: 60,
    origin: { x: 0.5, y: 0.4 },
    colors: ['#C1E94E', '#84cc16', '#22c55e'],
    ticks: 150,
    gravity: 1.2,
    scalar: 0.9,
    drift: 0,
  });

  // Delayed second burst - even more subtle
  setTimeout(() => {
    confetti({
      particleCount: 25,
      spread: 45,
      origin: { x: 0.5, y: 0.5 },
      colors: ['#C1E94E', '#a3e635'],
      ticks: 100,
      gravity: 1.5,
      scalar: 0.7,
    });
  }, 150);
};

// Celebration confetti for tour completion
const triggerCelebrationConfetti = () => {
  confetti({
    particleCount: 80,
    spread: 70,
    origin: { y: 0.6 },
    colors: ['#C1E94E', '#84cc16', '#22c55e', '#10b981'],
    ticks: 200,
  });
};

// Main Owner Tour - Full onboarding experience
export const ownerTour: Tour = {
  id: 'owner-onboarding',
  name: 'Tour de Bienvenida',
  steps: [
    {
      id: 'welcome',
      target: 'center',
      title: 'Bienvenido a Ordefy',
      description: 'Tu centro de control para gestionar pedidos, inventario y logistica. Te mostraremos las funciones principales en menos de 2 minutos.',
      placement: 'center',
    },
    {
      id: 'dashboard-metrics',
      target: '[data-tour="dashboard-metrics"]',
      title: 'Metricas en Tiempo Real',
      description: 'Aqui veras el resumen de tus ventas, beneficios y tasa de entrega. Los datos se actualizan automaticamente.',
      placement: 'bottom',
      spotlightPadding: 12,
    },
    {
      id: 'quick-actions',
      target: '[data-tour="quick-actions"]',
      title: 'Acciones Rapidas',
      description: 'Accesos directos a las tareas mas comunes: crear pedidos, agregar productos, rastrear envios y ver pendientes.',
      placement: 'bottom',
      spotlightPadding: 12,
    },
    {
      id: 'sidebar-integrations',
      target: '[data-tour="sidebar-integrations"]',
      title: 'Conecta tu Tienda',
      description: 'Este es el paso mas importante. Conecta tu tienda Shopify para importar productos, clientes y recibir pedidos automaticamente.',
      placement: 'right',
      spotlightPadding: 8,
      action: {
        label: 'Ir a Integraciones',
        onClick: () => {
          // Navigation handled by the tour component
        },
      },
    },
    {
      id: 'sidebar-orders',
      target: '[data-tour="sidebar-orders"]',
      title: 'Gestion de Pedidos',
      description: 'Todos tus pedidos en un solo lugar. Confirma, prepara y despacha con un flujo optimizado.',
      placement: 'right',
      spotlightPadding: 8,
    },
    {
      id: 'sidebar-warehouse',
      target: '[data-tour="sidebar-warehouse"]',
      title: 'Almacen Inteligente',
      description: 'Sistema de picking y packing para preparar multiples pedidos a la vez. El stock se actualiza automaticamente.',
      placement: 'right',
      spotlightPadding: 8,
    },
    {
      id: 'sidebar-products',
      target: '[data-tour="sidebar-products"]',
      title: 'Catalogo de Productos',
      description: 'Gestiona tu inventario. Si conectas Shopify, tus productos se sincronizaran automaticamente.',
      placement: 'right',
      spotlightPadding: 8,
    },
    {
      id: 'complete',
      target: 'center',
      title: '¡Todo Listo!',
      description: 'Ya conoces lo esencial. Te recomendamos conectar tu tienda Shopify como primer paso. ¿Empezamos?',
      placement: 'center',
      action: {
        label: 'Conectar Shopify',
        onClick: () => {
          // Navigation handled by the tour component
        },
      },
    },
  ],
};

// Collaborator Tour - Simplified version based on role
export const collaboratorTour: Tour = {
  id: 'collaborator-onboarding',
  name: 'Tour de Colaborador',
  steps: [
    {
      id: 'welcome',
      target: 'center',
      title: 'Bienvenido al Equipo',
      description: 'Has sido invitado como colaborador. Te mostraremos las funciones disponibles segun tu rol.',
      placement: 'center',
    },
    {
      id: 'dashboard',
      target: '[data-tour="dashboard-metrics"]',
      title: 'Panel de Control',
      description: 'Aqui puedes ver un resumen de las metricas principales del negocio.',
      placement: 'bottom',
      spotlightPadding: 12,
    },
    {
      id: 'complete',
      target: 'center',
      title: '¡Listo para Trabajar!',
      description: 'Ya conoces lo basico. Las funciones disponibles dependen de los permisos asignados por el administrador.',
      placement: 'center',
    },
  ],
};

interface OnboardingTourProps {
  autoStart?: boolean;
}

export function OnboardingTour({ autoStart = true }: OnboardingTourProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    isActive,
    currentTour,
    currentStepIndex,
    hasCompletedTour,
    justFinished,
    startTour,
    completeTour,
    clearJustFinished,
  } = useOnboardingTour();
  const { currentStore, permissions } = useAuth();

  // Get current step
  const currentStep = currentTour?.steps[currentStepIndex];

  // Trigger confetti when tour finishes (completed or skipped)
  useEffect(() => {
    if (justFinished) {
      // Small delay for smooth transition
      const timer = setTimeout(() => {
        triggerMinimalConfetti();
        clearJustFinished();
      }, 100);

      return () => clearTimeout(timer);
    }
  }, [justFinished, clearJustFinished]);

  // Auto-start tour for new users
  useEffect(() => {
    if (!autoStart) return;
    if (hasCompletedTour) return;
    if (isActive) return;
    if (!currentStore) return;

    // Only start on dashboard
    if (location.pathname !== '/') return;

    // Check if user just completed onboarding
    const onboardingCompleted = localStorage.getItem('onboarding_completed');
    const tourStarted = localStorage.getItem('ordefy_onboarding_tour_started');

    if (onboardingCompleted === 'true' && !tourStarted) {
      // Mark that we're starting the tour
      localStorage.setItem('ordefy_onboarding_tour_started', 'true');

      // Delay to let dashboard render properly
      const timer = setTimeout(() => {
        // Dispatch event to ensure sidebar is expanded
        window.dispatchEvent(new CustomEvent('expandSidebarForTour'));

        // Check if user is owner or collaborator
        const isOwner = permissions.currentRole === 'owner';
        startTour(isOwner ? ownerTour : collaboratorTour);
      }, 800);

      return () => clearTimeout(timer);
    }
  }, [
    autoStart,
    hasCompletedTour,
    isActive,
    currentStore,
    location.pathname,
    startTour,
    permissions.currentRole,
  ]);

  // Handle navigation for steps that require it
  useEffect(() => {
    if (!isActive || !currentStep) return;

    // Handle action button clicks
    if (currentStep.id === 'sidebar-integrations' && currentStep.action) {
      currentStep.action.onClick = () => {
        completeTour();
        navigate('/integrations');
      };
    }

    if (currentStep.id === 'complete' && currentStep.action) {
      currentStep.action.onClick = () => {
        completeTour();
        navigate('/integrations');
      };
    }
  }, [isActive, currentStep, completeTour, navigate]);

  return (
    <AnimatePresence>
      {isActive && (
        <>
          {/* Dark overlay with spotlight cutout */}
          <Spotlight padding={12} borderRadius={12} />

          {/* Progress indicator at top */}
          <TourProgress variant="bar" position="top" showLabels />

          {/* Step tooltip */}
          <TourStepTooltip />
        </>
      )}
    </AnimatePresence>
  );
}

// Welcome modal for first-time users (optional - can show before tour)
export function WelcomeModal() {
  const { isActive, hasCompletedTour, startTour, skipTour } = useOnboardingTour();
  const { permissions } = useAuth();
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    // Show welcome modal only if tour hasn't started and hasn't been completed
    if (!isActive && !hasCompletedTour) {
      const hasSeenWelcome = localStorage.getItem('ordefy_welcome_seen');
      if (!hasSeenWelcome) {
        setShowWelcome(true);
      }
    }
  }, [isActive, hasCompletedTour]);

  const handleStartTour = () => {
    localStorage.setItem('ordefy_welcome_seen', 'true');
    setShowWelcome(false);
    const isOwner = permissions.currentRole === 'owner';
    startTour(isOwner ? ownerTour : collaboratorTour);
  };

  const handleSkip = () => {
    localStorage.setItem('ordefy_welcome_seen', 'true');
    setShowWelcome(false);
    skipTour();
  };

  if (!showWelcome) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-card border border-border rounded-2xl shadow-2xl max-w-md mx-4 overflow-hidden"
      >
        {/* Gradient header */}
        <div className="bg-gradient-to-br from-primary/20 via-primary/10 to-transparent p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🎉</span>
          </div>
          <h2 className="text-2xl font-bold text-card-foreground">
            ¡Bienvenido a Ordefy!
          </h2>
        </div>

        <div className="p-6 text-center">
          <p className="text-muted-foreground mb-6">
            ¿Te gustaria un tour rapido de 2 minutos para conocer las funciones principales?
          </p>

          <div className="flex flex-col gap-3">
            <button
              onClick={handleStartTour}
              className="w-full py-3 px-4 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg font-medium transition-colors"
            >
              Si, mostrame el tour
            </button>
            <button
              onClick={handleSkip}
              className="w-full py-2 px-4 text-muted-foreground hover:text-foreground transition-colors"
            >
              No, prefiero explorar solo
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

