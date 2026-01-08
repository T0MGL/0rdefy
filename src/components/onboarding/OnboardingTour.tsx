import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useOnboardingTour, Tour } from '@/contexts/OnboardingTourContext';
import { useAuth, Role } from '@/contexts/AuthContext';
import confetti from 'canvas-confetti';
import {
  ShoppingBag,
  Package,
  Truck,
  Link2,
  X,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Minimal confetti burst - Apple style
const triggerMinimalConfetti = () => {
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

// Empty tours for compatibility - we're using WelcomeModal instead
export const ownerTour: Tour = {
  id: 'owner-onboarding',
  name: 'Tour de Bienvenida',
  steps: [],
};

export const collaboratorTour: Tour = {
  id: 'collaborator-onboarding',
  name: 'Tour de Colaborador',
  steps: [],
};

interface OnboardingTourProps {
  autoStart?: boolean;
}

// Main component - now just renders the Welcome Modal
export function OnboardingTour({ autoStart = true }: OnboardingTourProps) {
  const { justFinished, clearJustFinished } = useOnboardingTour();

  // Trigger confetti when tour finishes
  useEffect(() => {
    if (justFinished) {
      const timer = setTimeout(() => {
        triggerMinimalConfetti();
        clearJustFinished();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [justFinished, clearJustFinished]);

  return <WelcomeModal autoShow={autoStart} />;
}

// Feature card for the welcome modal
interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick?: () => void;
  primary?: boolean;
}

function FeatureCard({ icon, title, description, onClick, primary }: FeatureCardProps) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        'flex items-start gap-3 p-4 rounded-xl text-left transition-all',
        'border border-border/50 hover:border-primary/30',
        primary
          ? 'bg-primary/10 hover:bg-primary/15 border-primary/20'
          : 'bg-card/50 hover:bg-muted/50'
      )}
    >
      <div className={cn(
        'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
        primary ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
      )}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className={cn(
          'font-medium text-sm',
          primary ? 'text-primary' : 'text-card-foreground'
        )}>
          {title}
        </h4>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
          {description}
        </p>
      </div>
      <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
    </motion.button>
  );
}

// Welcome modal - simple, one-time, non-invasive
interface WelcomeModalProps {
  autoShow?: boolean;
}

export function WelcomeModal({ autoShow = true }: WelcomeModalProps) {
  const navigate = useNavigate();
  const { skipTour, hasCompletedTour } = useOnboardingTour();
  const { permissions, currentStore } = useAuth();
  const [showWelcome, setShowWelcome] = useState(false);

  const isOwner = permissions.currentRole === Role.OWNER;

  useEffect(() => {
    if (!autoShow) return;
    if (hasCompletedTour) return;
    if (!currentStore) return;

    // Check if user just completed onboarding
    const onboardingCompleted = localStorage.getItem('onboarding_completed');
    const welcomeSeen = localStorage.getItem('ordefy_welcome_modal_seen');

    if (onboardingCompleted === 'true' && !welcomeSeen) {
      // Delay to let dashboard render
      const timer = setTimeout(() => {
        setShowWelcome(true);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [autoShow, hasCompletedTour, currentStore]);

  const handleClose = () => {
    localStorage.setItem('ordefy_welcome_modal_seen', 'true');
    setShowWelcome(false);
    skipTour(); // Mark as completed
  };

  const handleNavigate = (path: string) => {
    localStorage.setItem('ordefy_welcome_modal_seen', 'true');
    setShowWelcome(false);
    skipTour();
    navigate(path);
  };

  if (!showWelcome) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) handleClose();
        }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
        >
          {/* Header */}
          <div className="relative bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-6 pb-4">
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-muted/50 transition-colors"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>

            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-card-foreground">
                  {isOwner ? '¡Bienvenido a Ordefy!' : '¡Bienvenido al equipo!'}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {isOwner
                    ? 'Tu tienda esta lista. ¿Por donde empezamos?'
                    : `Rol: ${permissions.currentRole}`
                  }
                </p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-6 pt-4 space-y-3">
            {isOwner ? (
              // Owner view - show key actions
              <>
                <FeatureCard
                  icon={<Link2 className="w-5 h-5" />}
                  title="Conectar Shopify"
                  description="Importa productos, clientes y sincroniza pedidos automaticamente"
                  onClick={() => handleNavigate('/integrations')}
                  primary
                />
                <FeatureCard
                  icon={<Package className="w-5 h-5" />}
                  title="Agregar Productos"
                  description="Crea tu catalogo manualmente si no usas Shopify"
                  onClick={() => handleNavigate('/products')}
                />
                <FeatureCard
                  icon={<ShoppingBag className="w-5 h-5" />}
                  title="Ver Pedidos"
                  description="Gestiona el flujo completo: confirmar, preparar, despachar"
                  onClick={() => handleNavigate('/orders')}
                />
              </>
            ) : (
              // Collaborator view - show relevant actions based on role
              <>
                <p className="text-sm text-muted-foreground mb-4">
                  Las funciones disponibles dependen de los permisos asignados.
                  Explora el menu lateral para ver tus modulos.
                </p>
                <FeatureCard
                  icon={<ShoppingBag className="w-5 h-5" />}
                  title="Ir a Pedidos"
                  description="Comienza a gestionar los pedidos de la tienda"
                  onClick={() => handleNavigate('/orders')}
                  primary
                />
                <FeatureCard
                  icon={<Truck className="w-5 h-5" />}
                  title="Ver Almacen"
                  description="Accede al sistema de picking y packing"
                  onClick={() => handleNavigate('/warehouse')}
                />
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 pb-6">
            <Button
              variant="ghost"
              className="w-full text-muted-foreground hover:text-foreground"
              onClick={handleClose}
            >
              Explorar por mi cuenta
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
