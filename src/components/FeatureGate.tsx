/**
 * FeatureGate Component
 *
 * A wrapper component that checks if the user's plan has access to a feature.
 * If not, it shows a professional upgrade prompt instead of the children.
 *
 * IMPORTANT: This component renders a loading skeleton IMMEDIATELY while
 * checking subscription status to prevent any flash of content or lag.
 *
 * Usage:
 *   <FeatureGate feature="warehouse">
 *     <WarehouseContent />
 *   </FeatureGate>
 *
 * Or for page-level blocking:
 *   const { hasFeature, loading } = useSubscription();
 *   if (loading) return <FeatureGateLoading />;
 *   if (!hasFeature('warehouse')) {
 *     return <FeatureBlockedPage feature="warehouse" />;
 *   }
 */

import { ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Lock,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Check,
  ShieldCheck,
  Package,
  Rocket,
  Crown,
  Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSubscription, PlanFeature, FEATURE_NAMES, FEATURE_MIN_PLAN } from '@/contexts/SubscriptionContext';

// Plan display info with enhanced styling
const PLAN_INFO: Record<string, {
  name: string;
  color: string;
  bgColor: string;
  borderColor: string;
  iconColor: string;
  price: number;
  icon: React.ElementType;
}> = {
  starter: {
    name: 'Starter',
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-950/40',
    borderColor: 'border-blue-200 dark:border-blue-800',
    iconColor: 'text-blue-500',
    price: 29,
    icon: Rocket
  },
  growth: {
    name: 'Growth',
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-50 dark:bg-purple-950/40',
    borderColor: 'border-purple-200 dark:border-purple-800',
    iconColor: 'text-purple-500',
    price: 79,
    icon: Sparkles
  },
  professional: {
    name: 'Professional',
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-950/40',
    borderColor: 'border-amber-200 dark:border-amber-800',
    iconColor: 'text-amber-500',
    price: 169,
    icon: Crown
  },
};

// Features included in each plan upgrade
const PLAN_HIGHLIGHTS: Record<string, string[]> = {
  starter: [
    'Almacén y Picking & Packing',
    'Sistema de Devoluciones',
    'Gestión de Mercadería',
    'Etiquetas de Envío 4x6',
    'Importar desde Shopify',
    'Equipo de hasta 3 usuarios',
  ],
  growth: [
    'Todo de Starter incluido',
    'Sincronización bidireccional Shopify',
    'Alertas Inteligentes automáticas',
    'Seguimiento de Campañas',
    'Reportes PDF y Excel',
    'Equipo de hasta 10 usuarios',
  ],
  professional: [
    'Todo de Growth incluido',
    'API completa (lectura y escritura)',
    'Webhooks personalizados',
    'Roles personalizados por usuario',
    'Multi-tienda (hasta 3 tiendas)',
    'Equipo de hasta 25 usuarios',
  ],
};

interface FeatureGateProps {
  feature: PlanFeature;
  children: ReactNode;
  /** If true, shows a full-page blocked state instead of hiding content */
  fullPage?: boolean;
  /** Optional custom loading component */
  loadingFallback?: ReactNode;
}

/**
 * FeatureGateLoading - Professional loading state shown while checking subscription
 *
 * This is shown IMMEDIATELY to prevent any flash of unauthorized content.
 */
export function FeatureGateLoading() {
  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center p-4">
      <div className="max-w-lg w-full text-center space-y-6">
        {/* Animated loading icon */}
        <div className="relative mx-auto w-20 h-20">
          <div className="absolute inset-0 bg-primary/10 rounded-full animate-pulse" />
          <div className="relative flex items-center justify-center w-20 h-20 bg-card rounded-full border border-border shadow-lg">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        </div>

        {/* Loading message */}
        <div className="space-y-2">
          <Skeleton className="h-6 w-48 mx-auto" />
          <Skeleton className="h-4 w-64 mx-auto" />
        </div>

        {/* Skeleton cards */}
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

/**
 * FeatureGate - Conditionally render children based on plan feature access
 *
 * CRITICAL: Shows loading state IMMEDIATELY to prevent any content flash.
 * The page never renders unauthorized content even for a millisecond.
 */
export function FeatureGate({ feature, children, fullPage = false, loadingFallback }: FeatureGateProps) {
  const { hasFeature, shouldShowLockedFeatures, loading } = useSubscription();

  // IMPORTANT: Show loading state IMMEDIATELY to prevent flash of content
  // This ensures the user never sees unauthorized content
  if (loading) {
    if (loadingFallback) return <>{loadingFallback}</>;
    if (fullPage) return <FeatureGateLoading />;
    return null;
  }

  if (hasFeature(feature)) {
    return <>{children}</>;
  }

  // If user is a collaborator (shouldn't see locked features), show nothing
  if (!shouldShowLockedFeatures) {
    return null;
  }

  // Show blocked page for owners
  if (fullPage) {
    return <FeatureBlockedPage feature={feature} />;
  }

  // For inline gates, show a small locked indicator
  return <FeatureLockedInline feature={feature} />;
}

/**
 * FeatureBlockedPage - Professional full-page upgrade prompt
 *
 * Matches the quality and style of the ErrorBoundary component.
 * Designed to be reassuring and professional, not alarming.
 */
export function FeatureBlockedPage({ feature }: { feature: PlanFeature }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { subscription, canUpgrade } = useSubscription();

  const minPlan = FEATURE_MIN_PLAN[feature];
  const planInfo = PLAN_INFO[minPlan] || PLAN_INFO.starter;
  const displayName = FEATURE_NAMES[feature] || feature;
  const currentPlan = subscription?.plan?.toLowerCase() || 'free';
  const highlights = PLAN_HIGHLIGHTS[minPlan] || PLAN_HIGHLIGHTS.starter;
  const PlanIcon = planInfo.icon;

  const handleUpgrade = () => {
    // Navigate to settings with subscription section pre-selected
    navigate('/settings', {
      state: {
        openSection: 'subscription',
        fromFeature: feature,
        returnPath: location.pathname
      }
    });
  };

  const handleGoBack = () => {
    if (window.history.length > 2) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  return (
    <div className="min-h-[calc(100vh-80px)] flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
      <div className="max-w-lg w-full text-center space-y-6">
        {/* Animated Icon */}
        <div className="relative mx-auto w-24 h-24">
          <div className={`absolute inset-0 ${planInfo.bgColor} rounded-full animate-pulse`} />
          <div className="relative flex items-center justify-center w-24 h-24 bg-card rounded-full border border-border shadow-lg">
            <div className="relative">
              <Lock className="w-10 h-10 text-muted-foreground" />
              <div className={`absolute -bottom-1 -right-1 w-6 h-6 ${planInfo.bgColor} rounded-full flex items-center justify-center border ${planInfo.borderColor}`}>
                <PlanIcon className={`w-3.5 h-3.5 ${planInfo.iconColor}`} />
              </div>
            </div>
          </div>
        </div>

        {/* Main Message */}
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold text-foreground">
            {displayName}
          </h1>
          <p className="text-muted-foreground text-base leading-relaxed max-w-md mx-auto">
            Esta funcionalidad está disponible a partir del plan{' '}
            <span className={`font-semibold ${planInfo.color}`}>
              {planInfo.name}
            </span>
          </p>
        </div>

        {/* Current Plan Badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-card border border-border rounded-full text-sm">
          <span className="text-muted-foreground">Tu plan actual:</span>
          <span className="font-medium capitalize text-foreground">{currentPlan}</span>
        </div>

        {/* Reassurance Cards - Same style as ErrorBoundary */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
          <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                <Package className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-foreground text-sm font-medium">Tus datos están seguros</p>
                <p className="text-muted-foreground text-xs mt-0.5">Ningún pedido se perderá</p>
              </div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                <ShieldCheck className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-foreground text-sm font-medium">Upgrade instantáneo</p>
                <p className="text-muted-foreground text-xs mt-0.5">Actívalo en segundos</p>
              </div>
            </div>
          </div>
        </div>

        {/* Plan Highlights Card */}
        <div className={`rounded-xl ${planInfo.bgColor} border ${planInfo.borderColor} p-5 text-left`}>
          <div className="mb-4 flex items-center gap-2">
            <PlanIcon className={`h-5 w-5 ${planInfo.iconColor}`} />
            <span className="font-semibold text-foreground">
              Plan {planInfo.name} incluye:
            </span>
            <span className={`ml-auto text-sm font-bold ${planInfo.color}`}>
              ${planInfo.price}/mes
            </span>
          </div>
          <ul className="space-y-2.5">
            {highlights.map((item, index) => (
              <li key={index} className="flex items-center gap-2.5 text-sm">
                <div className="w-5 h-5 rounded-full bg-primary/10 dark:bg-primary/30 flex items-center justify-center flex-shrink-0">
                  <Check className="h-3 w-3 text-primary dark:text-primary" />
                </div>
                <span className="text-foreground">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          {canUpgrade ? (
            <Button
              onClick={handleUpgrade}
              size="lg"
              className="px-8 gap-2 shadow-lg shadow-primary/25"
            >
              Ver planes y actualizar
              <ArrowRight className="w-4 h-4" />
            </Button>
          ) : (
            <div className="bg-muted/50 rounded-lg px-4 py-3 text-sm text-muted-foreground max-w-sm">
              <p className="font-medium text-foreground mb-1">Contacta a tu administrador</p>
              <p>Solo el propietario de la tienda puede actualizar el plan.</p>
            </div>
          )}
          <Button
            onClick={handleGoBack}
            variant="outline"
            size="lg"
            className="px-6 gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver
          </Button>
        </div>

        {/* Footer Help */}
        <p className="text-muted-foreground/60 text-xs pt-2">
          ¿Tienes dudas? Escríbenos a <span className="text-muted-foreground">soporte@ordefy.io</span>
        </p>
      </div>
    </div>
  );
}

/**
 * FeatureLockedInline - Compact inline indicator for locked features
 */
export function FeatureLockedInline({ feature }: { feature: PlanFeature }) {
  const navigate = useNavigate();
  const location = useLocation();
  const minPlan = FEATURE_MIN_PLAN[feature];
  const planInfo = PLAN_INFO[minPlan] || PLAN_INFO.starter;
  const displayName = FEATURE_NAMES[feature] || feature;
  const PlanIcon = planInfo.icon;

  const handleUpgrade = () => {
    navigate('/settings', {
      state: {
        openSection: 'subscription',
        fromFeature: feature,
        returnPath: location.pathname
      }
    });
  };

  return (
    <div className={`rounded-xl border ${planInfo.borderColor} ${planInfo.bgColor} p-4`}>
      <div className="flex items-center gap-3">
        <div className="relative">
          <Lock className={`h-5 w-5 ${planInfo.color}`} />
          <PlanIcon className={`absolute -bottom-1 -right-1 h-3 w-3 ${planInfo.iconColor}`} />
        </div>
        <div className="flex-1">
          <p className="font-medium text-sm text-foreground">{displayName}</p>
          <p className="text-xs text-muted-foreground">
            Disponible desde plan {planInfo.name}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleUpgrade}
          className="gap-1.5"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Upgrade
        </Button>
      </div>
    </div>
  );
}

export default FeatureGate;
