/**
 * PlanUpgradeBlocker Component
 *
 * A professional, full-page component that blocks access to features
 * not included in the user's current plan. Designed to match the
 * quality level of a $150k SaaS product.
 *
 * Features:
 * - Instant blocking (no page load, then block)
 * - Reassuring messaging about data safety
 * - Direct navigation to subscription settings
 * - Professional design matching ErrorBoundary style
 */

import { useNavigate, useLocation } from 'react-router-dom';
import {
  Lock,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Package,
  Rocket,
  Check,
  Crown
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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

interface PlanUpgradeBlockerProps {
  feature: PlanFeature;
  /** Optional: Custom title override */
  title?: string;
  /** Optional: Custom description override */
  description?: string;
}

/**
 * PlanUpgradeBlocker - Full-page professional upgrade prompt
 *
 * Use this component when a user tries to access a feature they don't have.
 * It provides a calming, professional experience that encourages upgrades
 * without causing anxiety about data loss.
 */
export function PlanUpgradeBlocker({ feature, title, description }: PlanUpgradeBlockerProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { subscription, canUpgrade } = useSubscription();

  const minPlan = FEATURE_MIN_PLAN[feature];
  const planInfo = PLAN_INFO[minPlan] || PLAN_INFO.starter;
  const displayName = title || FEATURE_NAMES[feature] || feature;
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
    // Try to go back, or go to dashboard if no history
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
            {description || (
              <>
                Esta funcionalidad está disponible a partir del plan{' '}
                <span className={`font-semibold ${planInfo.color}`}>
                  {planInfo.name}
                </span>
              </>
            )}
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
                <div className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                  <Check className="h-3 w-3 text-green-600 dark:text-green-400" />
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
            <div className="bg-muted/50 rounded-lg px-4 py-3 text-sm text-muted-foreground">
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
 * LimitReachedBlocker - For when users hit their plan limits (orders, products, users)
 */
interface LimitReachedBlockerProps {
  limitType: 'orders' | 'products' | 'users';
  current: number;
  limit: number;
}

export function LimitReachedBlocker({ limitType, current, limit }: LimitReachedBlockerProps) {
  const navigate = useNavigate();
  const { canUpgrade } = useSubscription();

  const limitInfo = {
    orders: {
      title: 'Límite de Pedidos Alcanzado',
      description: 'Has alcanzado el máximo de pedidos permitidos en tu plan actual este mes.',
      icon: Package,
    },
    products: {
      title: 'Límite de Productos Alcanzado',
      description: 'Has alcanzado el máximo de productos permitidos en tu plan actual.',
      icon: Package,
    },
    users: {
      title: 'Límite de Usuarios Alcanzado',
      description: 'Has alcanzado el máximo de usuarios permitidos en tu plan actual.',
      icon: ShieldCheck,
    },
  };

  const info = limitInfo[limitType];
  const LimitIcon = info.icon;

  const handleUpgrade = () => {
    navigate('/settings', {
      state: {
        openSection: 'subscription',
        fromLimit: limitType
      }
    });
  };

  return (
    <div className="min-h-[calc(100vh-80px)] flex items-center justify-center bg-gradient-to-br from-amber-500/5 via-background to-amber-500/10 p-4">
      <div className="max-w-lg w-full text-center space-y-6">
        {/* Icon */}
        <div className="relative mx-auto w-24 h-24">
          <div className="absolute inset-0 bg-amber-100 dark:bg-amber-950/40 rounded-full animate-pulse" />
          <div className="relative flex items-center justify-center w-24 h-24 bg-card rounded-full border border-amber-200 dark:border-amber-800 shadow-lg">
            <LimitIcon className="w-10 h-10 text-amber-600 dark:text-amber-400" />
          </div>
        </div>

        {/* Message */}
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold text-foreground">{info.title}</h1>
          <p className="text-muted-foreground text-base leading-relaxed max-w-md mx-auto">
            {info.description}
          </p>
        </div>

        {/* Usage Display */}
        <div className="inline-flex items-center gap-3 px-5 py-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl">
          <span className="text-amber-700 dark:text-amber-300 font-mono text-lg font-bold">
            {current}/{limit}
          </span>
          <span className="text-amber-600 dark:text-amber-400 text-sm">
            {limitType === 'orders' ? 'pedidos este mes' : limitType === 'products' ? 'productos' : 'usuarios'}
          </span>
        </div>

        {/* Reassurance */}
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm max-w-sm mx-auto">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="w-4 h-4 text-green-600 dark:text-green-400" />
            </div>
            <div className="text-left">
              <p className="text-foreground text-sm font-medium">Tus datos están seguros</p>
              <p className="text-muted-foreground text-xs mt-0.5">
                No perderás ningún pedido ni información existente
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          {canUpgrade ? (
            <Button
              onClick={handleUpgrade}
              size="lg"
              className="px-8 gap-2 bg-amber-600 hover:bg-amber-700 shadow-lg shadow-amber-500/25"
            >
              Aumentar límites
              <ArrowRight className="w-4 h-4" />
            </Button>
          ) : (
            <div className="bg-muted/50 rounded-lg px-4 py-3 text-sm text-muted-foreground">
              <p>Contacta a tu administrador para actualizar el plan.</p>
            </div>
          )}
          <Button
            onClick={() => navigate(-1)}
            variant="outline"
            size="lg"
            className="px-6 gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Volver
          </Button>
        </div>

        <p className="text-muted-foreground/60 text-xs pt-2">
          ¿Necesitas ayuda? <span className="text-muted-foreground">soporte@ordefy.io</span>
        </p>
      </div>
    </div>
  );
}

export default PlanUpgradeBlocker;
