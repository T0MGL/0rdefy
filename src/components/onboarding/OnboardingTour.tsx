import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useOnboardingTour, Tour } from '@/contexts/OnboardingTourContext';
import { useAuth, Role, Module, Permission } from '@/contexts/AuthContext';
import confetti from 'canvas-confetti';
import {
  ShoppingBag,
  Package,
  Truck,
  Link2,
  X,
  ArrowRight,
  Sparkles,
  Users,
  BarChart3,
  PackageOpen,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Role labels in Spanish for display
const ROLE_LABELS: Record<Role, string> = {
  [Role.OWNER]: 'Propietario',
  [Role.ADMIN]: 'Administrador',
  [Role.LOGISTICS]: 'Logística',
  [Role.CONFIRMADOR]: 'Confirmador',
  [Role.CONTADOR]: 'Contador',
  [Role.INVENTARIO]: 'Inventario',
};

// Feature configuration with module requirements
interface FeatureConfig {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  route: string;
  module: Module;
  permission?: Permission;
  primary?: boolean;
}

// All available features for the welcome modal
const ALL_FEATURES: FeatureConfig[] = [
  {
    id: 'shopify',
    icon: <Link2 className="w-5 h-5" />,
    title: 'Conectar Shopify',
    description: 'Importa productos, clientes y sincroniza pedidos automaticamente',
    route: '/integrations',
    module: Module.INTEGRATIONS,
    permission: Permission.VIEW,
    primary: true,
  },
  {
    id: 'products',
    icon: <Package className="w-5 h-5" />,
    title: 'Agregar Productos',
    description: 'Crea tu catalogo manualmente si no usas Shopify',
    route: '/products',
    module: Module.PRODUCTS,
    permission: Permission.CREATE,
  },
  {
    id: 'orders',
    icon: <ShoppingBag className="w-5 h-5" />,
    title: 'Ver Pedidos',
    description: 'Gestiona el flujo completo: confirmar, preparar, despachar',
    route: '/orders',
    module: Module.ORDERS,
    permission: Permission.VIEW,
  },
  {
    id: 'warehouse',
    icon: <Truck className="w-5 h-5" />,
    title: 'Ver Almacen',
    description: 'Accede al sistema de picking y packing',
    route: '/warehouse',
    module: Module.WAREHOUSE,
    permission: Permission.VIEW,
  },
  {
    id: 'returns',
    icon: <RotateCcw className="w-5 h-5" />,
    title: 'Gestionar Devoluciones',
    description: 'Procesa devoluciones y ajustes de inventario',
    route: '/returns',
    module: Module.RETURNS,
    permission: Permission.VIEW,
  },
  {
    id: 'merchandise',
    icon: <PackageOpen className="w-5 h-5" />,
    title: 'Recibir Mercaderia',
    description: 'Registra envios entrantes de proveedores',
    route: '/merchandise',
    module: Module.MERCHANDISE,
    permission: Permission.VIEW,
  },
  {
    id: 'customers',
    icon: <Users className="w-5 h-5" />,
    title: 'Ver Clientes',
    description: 'Gestiona tu base de clientes y sus pedidos',
    route: '/customers',
    module: Module.CUSTOMERS,
    permission: Permission.VIEW,
  },
  {
    id: 'analytics',
    icon: <BarChart3 className="w-5 h-5" />,
    title: 'Ver Reportes',
    description: 'Analiza ventas, margenes y metricas de tu negocio',
    route: '/dashboard',
    module: Module.ANALYTICS,
    permission: Permission.VIEW,
  },
];

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
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 sm:gap-3',
        'p-3 sm:p-4 rounded-lg sm:rounded-xl',
        'text-left transition-all',
        'border border-border/50 hover:border-primary/30',
        'active:scale-[0.99]', // Touch feedback
        primary
          ? 'bg-primary/10 hover:bg-primary/15 border-primary/20'
          : 'bg-card/50 hover:bg-muted/50'
      )}
    >
      <div className={cn(
        'w-9 h-9 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center flex-shrink-0',
        primary ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
      )}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <h4 className={cn(
          'font-medium text-sm truncate',
          primary ? 'text-primary' : 'text-card-foreground'
        )}>
          {title}
        </h4>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 sm:line-clamp-2">
          {description}
        </p>
      </div>
      <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
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
  const currentRole = permissions.currentRole;

  // Filter features based on user permissions
  const availableFeatures = useMemo(() => {
    if (!currentRole) return [];

    // For owners, show the standard owner features
    if (isOwner) {
      return ALL_FEATURES.filter(f =>
        ['shopify', 'products', 'orders'].includes(f.id)
      );
    }

    // For collaborators, filter by actual permissions
    const filtered = ALL_FEATURES.filter(feature => {
      const permission = feature.permission || Permission.VIEW;
      return permissions.hasPermission(feature.module, permission);
    });

    // Sort: primary first, then by most relevant for the role
    return filtered.slice(0, 3).map((f, index) => ({
      ...f,
      primary: index === 0, // First one is primary
    }));
  }, [currentRole, isOwner, permissions]);

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
        className={cn(
          'fixed inset-0 z-[10000]',
          'flex items-center justify-center',
          'bg-black/70 backdrop-blur-sm',
          'p-3 sm:p-4' // Smaller padding on mobile
        )}
        onClick={(e) => {
          if (e.target === e.currentTarget) handleClose();
        }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className={cn(
            'bg-card border border-border rounded-xl sm:rounded-2xl shadow-2xl',
            'w-full max-w-lg',
            'max-h-[90vh] overflow-y-auto', // Scrollable if content is too tall
            'overscroll-contain' // Prevent scroll chaining
          )}
        >
          {/* Header */}
          <div className="relative bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-4 sm:p-6 pb-3 sm:pb-4">
            <button
              onClick={handleClose}
              className="absolute top-3 right-3 sm:top-4 sm:right-4 p-2 rounded-full hover:bg-muted/50 transition-colors"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>

            <div className="flex items-center gap-3 pr-8">
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg sm:text-xl font-bold text-card-foreground truncate">
                  {isOwner ? '¡Bienvenido a Ordefy!' : '¡Bienvenido al equipo!'}
                </h2>
                <p className="text-xs sm:text-sm text-muted-foreground truncate">
                  {isOwner
                    ? 'Tu tienda esta lista. ¿Por donde empezamos?'
                    : `Rol: ${currentRole ? ROLE_LABELS[currentRole] : 'Colaborador'}`
                  }
                </p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-4 sm:p-6 pt-3 sm:pt-4 space-y-2 sm:space-y-3">
            {!isOwner && (
              <p className="text-xs sm:text-sm text-muted-foreground mb-3 sm:mb-4">
                Estas son las funciones disponibles segun tu rol.
              </p>
            )}

            {availableFeatures.length > 0 ? (
              availableFeatures.map((feature) => (
                <FeatureCard
                  key={feature.id}
                  icon={feature.icon}
                  title={feature.title}
                  description={feature.description}
                  onClick={() => handleNavigate(feature.route)}
                  primary={feature.primary}
                />
              ))
            ) : (
              <p className="text-xs sm:text-sm text-muted-foreground text-center py-4">
                Explora el menu lateral para ver tus modulos disponibles.
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 sm:px-6 pb-4 sm:pb-6">
            <Button
              variant="ghost"
              className="w-full text-muted-foreground hover:text-foreground text-sm"
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
