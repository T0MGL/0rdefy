import { useNavigate } from 'react-router-dom';
import { AlertTriangle, TrendingUp, ArrowRight } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useSubscription } from '@/contexts/SubscriptionContext';

type LimitType = 'orders' | 'products' | 'users';

interface LimitReachedAlertProps {
  type: LimitType;
  className?: string;
}

const LIMIT_MESSAGES: Record<LimitType, {
  title: string;
  nearLimit: string;
  atLimit: string;
  entityName: string;
}> = {
  orders: {
    title: 'Pedidos',
    nearLimit: 'Te estas acercando al limite de pedidos de tu plan este mes.',
    atLimit: 'Has alcanzado el limite de pedidos de tu plan. No puedes crear nuevos pedidos hasta el proximo mes o actualizar tu plan.',
    entityName: 'pedidos',
  },
  products: {
    title: 'Productos',
    nearLimit: 'Te estas acercando al limite de productos de tu plan.',
    atLimit: 'Has alcanzado el limite de productos de tu plan. No puedes crear nuevos productos hasta actualizar tu plan.',
    entityName: 'productos',
  },
  users: {
    title: 'Usuarios',
    nearLimit: 'Te estas acercando al limite de usuarios de tu plan.',
    atLimit: 'Has alcanzado el limite de usuarios de tu plan. No puedes invitar mas usuarios hasta actualizar tu plan.',
    entityName: 'usuarios',
  },
};

/**
 * Alert component that shows when user is near or at a plan limit.
 * Use this in pages where the limit matters (e.g., Orders page, Products page)
 */
export function LimitReachedAlert({ type, className }: LimitReachedAlertProps) {
  const navigate = useNavigate();
  const { usage, isNearLimit, isAtLimit, canUpgrade, subscription } = useSubscription();

  // Don't show if no usage data
  if (!usage) return null;

  const isNear = isNearLimit(type);
  const isAt = isAtLimit(type);

  // Don't show if not near any limit
  if (!isNear && !isAt) return null;

  const messages = LIMIT_MESSAGES[type];
  const usageData = usage[type];
  const currentPlan = subscription?.plan || 'free';

  return (
    <Alert
      variant={isAt ? 'destructive' : 'default'}
      className={className}
    >
      {isAt ? (
        <AlertTriangle className="h-4 w-4" />
      ) : (
        <TrendingUp className="h-4 w-4" />
      )}
      <AlertTitle className="flex items-center justify-between">
        <span>
          {isAt ? 'Limite alcanzado' : 'Cerca del limite'} - {messages.title}
        </span>
        <span className="text-xs font-normal text-muted-foreground">
          {usageData.used}/{usageData.limit === -1 ? '∞' : usageData.limit} {messages.entityName}
        </span>
      </AlertTitle>
      <AlertDescription className="flex items-center justify-between">
        <span>{isAt ? messages.atLimit : messages.nearLimit}</span>
        {canUpgrade && (
          <Button
            variant={isAt ? 'default' : 'outline'}
            size="sm"
            onClick={() => navigate('/billing')}
            className="ml-4 shrink-0"
          >
            {isAt ? 'Actualizar plan' : 'Ver planes'}
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Hook to check if a specific action should be blocked
 */
export function useLimitCheck(type: LimitType) {
  const { isAtLimit, usage, canUpgrade, subscription } = useSubscription();

  const isBlocked = isAtLimit(type);
  const usageData = usage?.[type];
  const currentPlan = subscription?.plan || 'free';

  return {
    isBlocked,
    used: usageData?.used ?? 0,
    limit: usageData?.limit ?? 0,
    percentage: usageData?.percentage ?? 0,
    canUpgrade,
    currentPlan,
  };
}
