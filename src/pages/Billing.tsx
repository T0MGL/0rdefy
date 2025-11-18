import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { SUBSCRIPTION_PLANS } from '@/lib/constants';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { Check, CreditCard, Download, Crown } from 'lucide-react';

export default function Billing() {
  const [currentPlan] = useLocalStorage('subscription_plan', 'free');
  const [usage] = useLocalStorage('monthly_usage', { orders: 45, limit: 100 });

  const activePlan = SUBSCRIPTION_PLANS.find(p => p.id === currentPlan) || SUBSCRIPTION_PLANS[0];
  const usagePercentage = (usage.orders / usage.limit) * 100;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold">Facturación y Planes</h2>
        <p className="text-muted-foreground">Gestiona tu suscripción y métodos de pago</p>
      </div>

      {/* Current Plan Card */}
      <Card className="p-6 bg-gradient-to-br from-primary/10 via-primary/5 to-background border-primary/20">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-2xl font-bold">{activePlan.name}</h3>
              <Badge className="bg-primary text-primary-foreground">
                Plan Actual
              </Badge>
            </div>
            <p className="text-3xl font-bold text-primary">
              {activePlan.price === null ? (
                'Contactar'
              ) : activePlan.price === 0 ? (
                'Gratis'
              ) : (
                `$${activePlan.price}/mes`
              )}
            </p>
          </div>
          {activePlan.id !== 'enterprise' && (
            <Button className="gap-2">
              <Crown size={18} />
              Mejorar Plan
            </Button>
          )}
        </div>

        {/* Usage */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Uso de pedidos este mes</span>
            <span className="font-semibold">
              {usage.orders} / {usage.limit}
            </span>
          </div>
          <Progress value={usagePercentage} className="h-2" />
          {usagePercentage > 80 && (
            <p className="text-sm text-yellow-600">
              Te estás acercando al límite. Considera mejorar tu plan.
            </p>
          )}
        </div>

        {/* Features */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-3">
          {activePlan.features.map((feature, index) => (
            <div key={index} className="flex items-start gap-2 text-sm">
              <Check className="text-primary mt-0.5 shrink-0" size={16} />
              <span>{feature}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Plans Comparison */}
      <div>
        <h3 className="text-xl font-bold mb-4">Comparar Planes</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {SUBSCRIPTION_PLANS.map((plan) => (
            <Card
              key={plan.id}
              className={`p-6 relative ${
                plan.popular ? 'border-primary border-2' : ''
              } ${plan.id === currentPlan ? 'bg-muted/50' : ''}`}
            >
              {plan.popular && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary">
                  Más Popular
                </Badge>
              )}
              
              <div className="text-center mb-4">
                <h4 className="font-bold text-lg mb-2">{plan.name}</h4>
                <div className="text-3xl font-bold mb-1">
                  {plan.price === null ? (
                    'Custom'
                  ) : plan.price === 0 ? (
                    'Gratis'
                  ) : (
                    `$${plan.price}`
                  )}
                </div>
                {plan.price !== null && (
                  <p className="text-sm text-muted-foreground">por mes</p>
                )}
              </div>

              <ul className="space-y-2 mb-6">
                {plan.features.slice(0, 5).map((feature, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm">
                    <Check className="text-primary mt-0.5 shrink-0" size={14} />
                    <span className="text-muted-foreground">{feature}</span>
                  </li>
                ))}
                {plan.features.length > 5 && (
                  <li className="text-sm text-muted-foreground pl-5">
                    +{plan.features.length - 5} más...
                  </li>
                )}
              </ul>

              <Button
                variant={plan.id === currentPlan ? 'outline' : 'default'}
                className="w-full"
                disabled={plan.id === currentPlan}
              >
                {plan.id === currentPlan ? 'Plan Actual' : plan.price === null ? 'Contactar' : 'Seleccionar'}
              </Button>
            </Card>
          ))}
        </div>
      </div>

      {/* Billing History */}
      <div>
        <h3 className="text-xl font-bold mb-4">Historial de Facturación</h3>
        <Card>
          <div className="p-6">
            <div className="text-center py-12">
              <CreditCard className="text-muted-foreground mx-auto mb-4" size={48} />
              <h4 className="text-lg font-semibold mb-2">No hay facturas aún</h4>
              <p className="text-muted-foreground">
                Tus facturas aparecerán aquí una vez que realices un pago.
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Payment Method */}
      <div>
        <h3 className="text-xl font-bold mb-4">Método de Pago</h3>
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded bg-muted flex items-center justify-center">
                <CreditCard className="text-muted-foreground" size={24} />
              </div>
              <div>
                <p className="font-medium">No hay método de pago configurado</p>
                <p className="text-sm text-muted-foreground">
                  Agrega una tarjeta para mejorar tu plan
                </p>
              </div>
            </div>
            <Button variant="outline" disabled>
              Agregar Tarjeta
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
