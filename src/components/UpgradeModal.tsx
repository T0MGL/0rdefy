import { useNavigate } from 'react-router-dom';
import { Lock, Sparkles, ArrowRight, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useSubscription, PlanFeature, FEATURE_NAMES, FEATURE_MIN_PLAN } from '@/contexts/SubscriptionContext';

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  feature?: PlanFeature;
  featureName?: string; // Custom name override
}

// Plan display info
const PLAN_INFO: Record<string, { name: string; color: string; price: number }> = {
  starter: { name: 'Starter', color: 'text-blue-500', price: 29 },
  growth: { name: 'Growth', color: 'text-purple-500', price: 79 },
  professional: { name: 'Professional', color: 'text-amber-500', price: 169 },
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

export function UpgradeModal({ open, onClose, feature, featureName }: UpgradeModalProps) {
  const navigate = useNavigate();
  const { subscription } = useSubscription();

  // Determine the minimum plan needed for this feature
  const minPlan = feature ? FEATURE_MIN_PLAN[feature] : 'starter';
  const planInfo = PLAN_INFO[minPlan] || PLAN_INFO.starter;
  const displayName = featureName || (feature ? FEATURE_NAMES[feature] : 'esta funcionalidad');
  const currentPlan = subscription?.plan?.toLowerCase() || 'free';
  const highlights = PLAN_HIGHLIGHTS[minPlan] || PLAN_HIGHLIGHTS.starter;

  const handleUpgrade = () => {
    onClose();
    navigate('/billing');
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center sm:text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-7 w-7 text-primary" />
          </div>
          <DialogTitle className="text-xl">
            Desbloquea {displayName}
          </DialogTitle>
          <DialogDescription className="text-base">
            Esta funcionalidad esta disponible desde el plan{' '}
            <span className={`font-semibold ${planInfo.color}`}>
              {planInfo.name}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="my-4 rounded-lg border bg-muted/30 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className={`h-5 w-5 ${planInfo.color}`} />
            <span className="font-semibold">
              Plan {planInfo.name} incluye:
            </span>
          </div>
          <ul className="space-y-2">
            {highlights.map((item, index) => (
              <li key={index} className="flex items-center gap-2 text-sm text-muted-foreground">
                <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="text-center text-sm text-muted-foreground">
          <span>Actualmente estas en el plan </span>
          <span className="font-medium capitalize">{currentPlan}</span>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            onClick={handleUpgrade}
            className="w-full gap-2"
            size="lg"
          >
            Ver planes y precios
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            onClick={onClose}
            className="w-full"
          >
            Ahora no
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ================================================================
// Hook for easy modal management
// ================================================================

import { useState, useCallback } from 'react';

interface UseUpgradeModalReturn {
  isOpen: boolean;
  feature: PlanFeature | undefined;
  featureName: string | undefined;
  openModal: (feature?: PlanFeature, featureName?: string) => void;
  closeModal: () => void;
  UpgradeModalComponent: React.FC;
}

export function useUpgradeModal(): UseUpgradeModalReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [feature, setFeature] = useState<PlanFeature | undefined>();
  const [featureName, setFeatureName] = useState<string | undefined>();

  const openModal = useCallback((feat?: PlanFeature, name?: string) => {
    setFeature(feat);
    setFeatureName(name);
    setIsOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsOpen(false);
  }, []);

  const UpgradeModalComponent = useCallback(() => (
    <UpgradeModal
      open={isOpen}
      onClose={closeModal}
      feature={feature}
      featureName={featureName}
    />
  ), [isOpen, closeModal, feature, featureName]);

  return {
    isOpen,
    feature,
    featureName,
    openModal,
    closeModal,
    UpgradeModalComponent,
  };
}
