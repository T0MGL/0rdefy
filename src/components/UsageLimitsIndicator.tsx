import { useNavigate } from 'react-router-dom';
import { AlertTriangle, TrendingUp } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { cn } from '@/lib/utils';

interface UsageLimitsIndicatorProps {
  showUpgradeButton?: boolean;
  compact?: boolean;
  className?: string;
}

export function UsageLimitsIndicator({
  showUpgradeButton = true,
  compact = false,
  className,
}: UsageLimitsIndicatorProps) {
  const navigate = useNavigate();
  const { usage, subscription, canUpgrade, loading } = useSubscription();

  if (loading || !usage) return null;

  const { orders, products, users } = usage;
  const currentPlan = subscription?.plan || 'free';

  // Check if any limit is near (>= 80%) or at (>= 100%)
  const isNearLimit = orders.percentage >= 80 || products.percentage >= 80;
  const isAtLimit = orders.percentage >= 100 || products.percentage >= 100;

  // Don't show if not near any limit
  if (!isNearLimit && !compact) return null;

  const getProgressColor = (percentage: number) => {
    if (percentage >= 100) return 'bg-red-500';
    if (percentage >= 80) return 'bg-amber-500';
    return 'bg-primary';
  };

  if (compact) {
    // Compact version for header or small spaces
    return (
      <div className={cn('flex items-center gap-4 text-sm', className)}>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Ordenes:</span>
          <span className={cn(
            'font-medium',
            orders.percentage >= 100 ? 'text-red-500' :
            orders.percentage >= 80 ? 'text-amber-500' : ''
          )}>
            {orders.used}/{orders.limit === -1 ? '∞' : orders.limit}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Productos:</span>
          <span className={cn(
            'font-medium',
            products.percentage >= 100 ? 'text-red-500' :
            products.percentage >= 80 ? 'text-amber-500' : ''
          )}>
            {products.used}/{products.limit === -1 ? '∞' : products.limit}
          </span>
        </div>
      </div>
    );
  }

  return (
    <Card className={cn(
      'border-l-4',
      isAtLimit ? 'border-l-red-500 bg-red-50/50 dark:bg-red-950/20' :
      isNearLimit ? 'border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20' : '',
      className
    )}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isAtLimit ? (
              <AlertTriangle className="h-5 w-5 text-red-500" />
            ) : (
              <TrendingUp className="h-5 w-5 text-amber-500" />
            )}
            <CardTitle className="text-base">
              {isAtLimit ? 'Limite alcanzado' : 'Cerca del limite'}
            </CardTitle>
          </div>
          <span className="text-xs text-muted-foreground uppercase font-medium">
            Plan {currentPlan}
          </span>
        </div>
        <CardDescription>
          {isAtLimit
            ? 'Has alcanzado el limite de tu plan. Actualiza para continuar.'
            : 'Te estas acercando al limite de tu plan este mes.'
          }
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Orders usage */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Ordenes este mes</span>
            <span className={cn(
              'font-medium',
              orders.percentage >= 100 ? 'text-red-500' :
              orders.percentage >= 80 ? 'text-amber-500' : ''
            )}>
              {orders.used} / {orders.limit === -1 ? '∞' : orders.limit}
            </span>
          </div>
          <Progress
            value={Math.min(orders.percentage, 100)}
            className="h-2"
            indicatorClassName={getProgressColor(orders.percentage)}
          />
        </div>

        {/* Products usage */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Productos</span>
            <span className={cn(
              'font-medium',
              products.percentage >= 100 ? 'text-red-500' :
              products.percentage >= 80 ? 'text-amber-500' : ''
            )}>
              {products.used} / {products.limit === -1 ? '∞' : products.limit}
            </span>
          </div>
          <Progress
            value={Math.min(products.percentage, 100)}
            className="h-2"
            indicatorClassName={getProgressColor(products.percentage)}
          />
        </div>

        {/* Users usage */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Usuarios</span>
            <span className={cn(
              'font-medium',
              users.percentage >= 100 ? 'text-red-500' :
              users.percentage >= 80 ? 'text-amber-500' : ''
            )}>
              {users.used} / {users.limit === -1 ? '∞' : users.limit}
            </span>
          </div>
          <Progress
            value={Math.min(users.percentage, 100)}
            className="h-2"
            indicatorClassName={getProgressColor(users.percentage)}
          />
        </div>

        {/* Upgrade button */}
        {showUpgradeButton && canUpgrade && (
          <Button
            onClick={() => navigate('/billing')}
            className="w-full mt-2"
            variant={isAtLimit ? 'default' : 'outline'}
          >
            {isAtLimit ? 'Actualizar plan ahora' : 'Ver planes'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
