/**
 * FeatureGate Component
 *
 * A wrapper component that checks if the user's plan has access to a feature.
 * If not, it shows an upgrade prompt instead of the children.
 *
 * Usage:
 *   <FeatureGate feature="warehouse">
 *     <WarehouseContent />
 *   </FeatureGate>
 *
 * Or for page-level blocking:
 *   const { hasFeature } = useSubscription();
 *   if (!hasFeature('warehouse')) {
 *     return <FeatureBlockedPage feature="warehouse" />;
 *   }
 */

import { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, Sparkles, ArrowRight, Check, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useSubscription, PlanFeature, FEATURE_NAMES, FEATURE_MIN_PLAN } from '@/contexts/SubscriptionContext';

// Plan display info
const PLAN_INFO: Record<string, { name: string; color: string; bgColor: string; price: number }> = {
  starter: { name: 'Starter', color: 'text-blue-600', bgColor: 'bg-blue-50 dark:bg-blue-950/30', price: 29 },
  growth: { name: 'Growth', color: 'text-purple-600', bgColor: 'bg-purple-50 dark:bg-purple-950/30', price: 79 },
  professional: { name: 'Professional', color: 'text-amber-600', bgColor: 'bg-amber-50 dark:bg-amber-950/30', price: 169 },
};

// Features included in each plan upgrade
const PLAN_HIGHLIGHTS: Record<string, string[]> = {
  starter: [
    'Almacen y Picking',
    'Devoluciones',
    'Mercaderia',
    'Etiquetas de Envio',
    'Importar desde Shopify',
    'Hasta 3 usuarios',
  ],
  growth: [
    'Todo de Starter',
    'Sincronizacion Shopify bidireccional',
    'Alertas Inteligentes',
    'Seguimiento de Campanas',
    'Reportes PDF/Excel',
    'Hasta 10 usuarios',
  ],
  professional: [
    'Todo de Growth',
    'API completa',
    'Webhooks personalizados',
    'Roles personalizados',
    'Multi-tienda (3)',
    'Hasta 25 usuarios',
  ],
};

interface FeatureGateProps {
  feature: PlanFeature;
  children: ReactNode;
  /** If true, shows a full-page blocked state instead of hiding content */
  fullPage?: boolean;
}

/**
 * FeatureGate - Conditionally render children based on plan feature access
 */
export function FeatureGate({ feature, children, fullPage = false }: FeatureGateProps) {
  const { hasFeature, shouldShowLockedFeatures } = useSubscription();

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
 * FeatureBlockedPage - Full-page component shown when a page requires upgrade
 */
export function FeatureBlockedPage({ feature }: { feature: PlanFeature }) {
  const navigate = useNavigate();
  const { subscription, canUpgrade } = useSubscription();

  const minPlan = FEATURE_MIN_PLAN[feature];
  const planInfo = PLAN_INFO[minPlan] || PLAN_INFO.starter;
  const displayName = FEATURE_NAMES[feature] || feature;
  const currentPlan = subscription?.plan?.toLowerCase() || 'free';
  const highlights = PLAN_HIGHLIGHTS[minPlan] || PLAN_HIGHLIGHTS.starter;

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center p-4">
      <Card className="max-w-lg w-full p-8 text-center">
        {/* Icon */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
          <Lock className="h-10 w-10 text-primary" />
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold mb-2">
          {displayName}
        </h1>
        <p className="text-muted-foreground mb-6">
          Esta funcionalidad esta disponible desde el plan{' '}
          <span className={`font-semibold ${planInfo.color}`}>
            {planInfo.name}
          </span>
        </p>

        {/* Plan highlights */}
        <div className={`rounded-lg ${planInfo.bgColor} p-5 mb-6 text-left`}>
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className={`h-5 w-5 ${planInfo.color}`} />
            <span className="font-semibold">
              Plan {planInfo.name} incluye:
            </span>
          </div>
          <ul className="space-y-2">
            {highlights.map((item, index) => (
              <li key={index} className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Current plan indicator */}
        <p className="text-sm text-muted-foreground mb-6">
          Actualmente estas en el plan{' '}
          <span className="font-medium capitalize">{currentPlan}</span>
        </p>

        {/* Actions */}
        <div className="flex flex-col gap-3">
          {canUpgrade ? (
            <Button
              onClick={() => navigate('/billing')}
              className="w-full gap-2"
              size="lg"
            >
              Ver planes y precios
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              Contacta al administrador de tu tienda para actualizar el plan.
            </p>
          )}
          <Button
            variant="ghost"
            onClick={() => navigate(-1)}
            className="w-full gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Button>
        </div>
      </Card>
    </div>
  );
}

/**
 * FeatureLockedInline - Small inline indicator for locked features
 */
export function FeatureLockedInline({ feature }: { feature: PlanFeature }) {
  const navigate = useNavigate();
  const minPlan = FEATURE_MIN_PLAN[feature];
  const planInfo = PLAN_INFO[minPlan] || PLAN_INFO.starter;
  const displayName = FEATURE_NAMES[feature] || feature;

  return (
    <div className={`rounded-lg border p-4 ${planInfo.bgColor}`}>
      <div className="flex items-center gap-3">
        <Lock className={`h-5 w-5 ${planInfo.color}`} />
        <div className="flex-1">
          <p className="font-medium text-sm">{displayName}</p>
          <p className="text-xs text-muted-foreground">
            Disponible en plan {planInfo.name}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/billing')}
        >
          Upgrade
        </Button>
      </div>
    </div>
  );
}

export default FeatureGate;
