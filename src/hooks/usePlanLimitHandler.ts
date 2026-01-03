import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useSubscription } from '@/contexts/SubscriptionContext';

interface LimitReachedEvent extends CustomEvent {
  detail: {
    type: 'orders' | 'products';
    message: string;
    usage: {
      used: number;
      limit: number;
      plan: string;
    };
  };
}

interface FeatureBlockedEvent extends CustomEvent {
  detail: {
    feature: string;
    message: string;
  };
}

/**
 * Hook that listens for plan limit events and shows toast notifications.
 * Also refreshes subscription data when limits are reached.
 *
 * Usage: Call this hook once in a top-level component (e.g., App or Layout)
 */
export function usePlanLimitHandler() {
  const navigate = useNavigate();
  const { refreshSubscription, canUpgrade } = useSubscription();

  const handleLimitReached = useCallback((event: LimitReachedEvent) => {
    const { type, message, usage } = event.detail;

    // Refresh subscription data to update UI
    refreshSubscription();

    // Show toast with action button
    toast.error(`Limite alcanzado: ${type === 'orders' ? 'Pedidos' : 'Productos'}`, {
      description: message,
      duration: 8000,
      action: canUpgrade
        ? {
            label: 'Ver planes',
            onClick: () => navigate('/billing'),
          }
        : undefined,
    });
  }, [refreshSubscription, canUpgrade, navigate]);

  const handleFeatureBlocked = useCallback((event: FeatureBlockedEvent) => {
    const { feature, message } = event.detail;

    // Show toast with action button
    toast.error('Funcionalidad no disponible', {
      description: message,
      duration: 8000,
      action: canUpgrade
        ? {
            label: 'Ver planes',
            onClick: () => navigate('/billing'),
          }
        : undefined,
    });
  }, [canUpgrade, navigate]);

  useEffect(() => {
    // Add event listeners
    window.addEventListener('plan:limit-reached', handleLimitReached as EventListener);
    window.addEventListener('plan:feature-blocked', handleFeatureBlocked as EventListener);

    // Cleanup
    return () => {
      window.removeEventListener('plan:limit-reached', handleLimitReached as EventListener);
      window.removeEventListener('plan:feature-blocked', handleFeatureBlocked as EventListener);
    };
  }, [handleLimitReached, handleFeatureBlocked]);
}

export default usePlanLimitHandler;
