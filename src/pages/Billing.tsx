/**
 * Billing Page
 *
 * Manages subscription, plans, usage, and referrals
 */

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CreditCard,
  Check,
  X,
  Zap,
  Users,
  Package,
  ShoppingCart,
  ArrowRight,
  Crown,
  Sparkles,
  Gift,
  Copy,
  AlertCircle,
  CheckCircle2,
  Clock,
  TrendingUp,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { billingService, type Plan } from '@/services/billing.service';

interface BillingProps {
  embedded?: boolean; // Hide header when embedded in Settings
}

export default function Billing({ embedded = false }: BillingProps) {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [isAnnual, setIsAnnual] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [discountCode, setDiscountCode] = useState('');
  const [referralCode, setReferralCode] = useState('');

  // Check for success/cancel from Stripe
  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      toast.success('Subscription activada exitosamente!');
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
    }
    if (searchParams.get('canceled') === 'true') {
      toast.info('Checkout cancelado');
    }
  }, [searchParams, queryClient]);

  // Fetch subscription data
  const { data: subscriptionData, isLoading } = useQuery({
    queryKey: ['subscription'],
    queryFn: billingService.getSubscription,
  });

  // Fetch referral stats
  const { data: referralStats } = useQuery({
    queryKey: ['referralStats'],
    queryFn: billingService.getReferralStats,
  });

  // Checkout mutation
  const checkoutMutation = useMutation({
    mutationFn: billingService.createCheckout,
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al iniciar checkout');
    },
  });

  // Portal mutation
  const portalMutation = useMutation({
    mutationFn: billingService.createPortal,
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al abrir portal');
    },
  });

  // Cancel mutation
  const cancelMutation = useMutation({
    mutationFn: billingService.cancelSubscription,
    onSuccess: () => {
      toast.success('Subscription cancelada. Tendras acceso hasta el fin del periodo.');
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al cancelar');
    },
  });

  // Reactivate mutation
  const reactivateMutation = useMutation({
    mutationFn: billingService.reactivateSubscription,
    onSuccess: () => {
      toast.success('Subscription reactivada!');
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
    },
    onError: (error: any) => {
      toast.error(error.message || 'Error al reactivar');
    },
  });

  const handleUpgrade = (planKey: string) => {
    setSelectedPlan(planKey);
    checkoutMutation.mutate({
      plan: planKey,
      billingCycle: isAnnual ? 'annual' : 'monthly',
      discountCode: discountCode || undefined,
      referralCode: referralCode || undefined,
    });
  };

  const copyReferralLink = () => {
    if (referralStats?.code) {
      const link = `${window.location.origin}/r/${referralStats.code}`;
      navigator.clipboard.writeText(link);
      toast.success('Link copiado!');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const subscription = subscriptionData?.subscription;
  const usage = subscriptionData?.usage;
  const allPlans = subscriptionData?.allPlans || [];
  const currentPlan = subscription?.plan || 'free';

  return (
    <div className={embedded ? "space-y-6" : "container mx-auto py-6 space-y-8"}>
      {/* Header - only show when not embedded */}
      {!embedded && (
        <div>
          <h1 className="text-3xl font-bold">Suscripción</h1>
          <p className="text-muted-foreground mt-1">
            Administra tu plan, uso y referidos
          </p>
        </div>
      )}

      <Tabs defaultValue="plans" className="space-y-6">
        <TabsList>
          <TabsTrigger value="plans">Planes</TabsTrigger>
          <TabsTrigger value="usage">Uso</TabsTrigger>
          <TabsTrigger value="referrals">Referidos</TabsTrigger>
        </TabsList>

        {/* Plans Tab */}
        <TabsContent value="plans" className="space-y-6">
          {/* Current Plan Status */}
          {subscription && subscription.plan !== 'free' && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Crown className="h-5 w-5 text-yellow-500" />
                      Plan Actual: {subscription.planDetails?.name || subscription.plan}
                    </CardTitle>
                    <CardDescription>
                      {subscription.status === 'trialing' ? (
                        <span className="flex items-center gap-1 text-blue-600">
                          <Clock className="h-4 w-4" />
                          Periodo de prueba hasta{' '}
                          {subscription.trialEndsAt
                            ? new Date(subscription.trialEndsAt).toLocaleDateString()
                            : 'N/A'}
                        </span>
                      ) : subscription.cancelAtPeriodEnd ? (
                        <span className="flex items-center gap-1 text-orange-600">
                          <AlertCircle className="h-4 w-4" />
                          Se cancelara el{' '}
                          {subscription.currentPeriodEnd
                            ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
                            : 'N/A'}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-green-600">
                          <CheckCircle2 className="h-4 w-4" />
                          Activo - Proxima facturacion:{' '}
                          {subscription.currentPeriodEnd
                            ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
                            : 'N/A'}
                        </span>
                      )}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    {subscription.cancelAtPeriodEnd ? (
                      <Button
                        variant="default"
                        onClick={() => reactivateMutation.mutate()}
                        disabled={reactivateMutation.isPending}
                      >
                        Reactivar
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => portalMutation.mutate()}
                          disabled={portalMutation.isPending}
                        >
                          <CreditCard className="h-4 w-4 mr-2" />
                          Administrar Pago
                        </Button>
                        <Button
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => cancelMutation.mutate()}
                          disabled={cancelMutation.isPending}
                        >
                          Cancelar Plan
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
            </Card>
          )}

          {/* Trial Alert */}
          {subscription?.status === 'trialing' && (
            <Alert>
              <Clock className="h-4 w-4" />
              <AlertTitle>Periodo de prueba activo</AlertTitle>
              <AlertDescription>
                Tienes acceso completo a todas las funciones de {subscription.planDetails?.name}.
                Tu prueba termina el{' '}
                {subscription.trialEndsAt
                  ? new Date(subscription.trialEndsAt).toLocaleDateString()
                  : 'pronto'}
                . Despues se cobrara automaticamente.
              </AlertDescription>
            </Alert>
          )}

          {/* Billing Toggle */}
          <div className="flex items-center justify-center gap-4 py-4">
            <span className={!isAnnual ? 'font-medium' : 'text-muted-foreground'}>
              Mensual
            </span>
            <Switch checked={isAnnual} onCheckedChange={setIsAnnual} />
            <span className={isAnnual ? 'font-medium' : 'text-muted-foreground'}>
              Anual
            </span>
            {isAnnual && (
              <Badge variant="secondary" className="bg-green-100 text-green-700">
                Ahorra 15%
              </Badge>
            )}
          </div>

          {/* Discount Code */}
          <div className="flex items-center justify-center gap-4">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Codigo de descuento"
                value={discountCode}
                onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
                className="w-48"
              />
              <Input
                placeholder="Codigo de referido"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                className="w-48"
              />
            </div>
          </div>

          {/* Plans Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {allPlans.map((plan: Plan) => {
              const isCurrentPlan = currentPlan === plan.plan;
              const isGrowth = plan.plan === 'growth';
              const canUpgrade = getPlanOrder(plan.plan) > getPlanOrder(currentPlan);
              const canDowngrade = getPlanOrder(plan.plan) < getPlanOrder(currentPlan);
              // Use fixed prices from database (already rounded)
              const monthlyPrice = plan.priceMonthly / 100; // Convert cents to dollars
              const annualMonthlyPrice = (plan.priceAnnual / 12) / 100; // Monthly equivalent of annual price
              const displayPrice = isAnnual ? annualMonthlyPrice : monthlyPrice;

              return (
                <Card
                  key={plan.plan}
                  className={`relative ${
                    isGrowth ? 'border-primary shadow-lg' : ''
                  } ${isCurrentPlan ? 'border-green-500' : ''}`}
                >
                  {isGrowth && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary">
                      Mas Popular
                    </Badge>
                  )}
                  {isCurrentPlan && (
                    <Badge className="absolute -top-3 right-4 bg-green-500">
                      Plan Actual
                    </Badge>
                  )}

                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      {plan.plan === 'free' && <Zap className="h-5 w-5" />}
                      {plan.plan === 'starter' && <Sparkles className="h-5 w-5" />}
                      {plan.plan === 'growth' && <TrendingUp className="h-5 w-5" />}
                      {plan.plan === 'professional' && <Crown className="h-5 w-5" />}
                      {getPlanDisplayName(plan.plan)}
                    </CardTitle>
                    <CardDescription>
                      {getPlanDescription(plan.plan)}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    {/* Price */}
                    <div className="text-center">
                      {isAnnual && plan.plan !== 'free' && (
                        <div className="text-sm text-muted-foreground line-through mb-1">
                          ${monthlyPrice.toFixed(0)}/mes
                        </div>
                      )}
                      <span className="text-4xl font-bold">
                        ${displayPrice.toFixed(0)}
                      </span>
                      <span className="text-muted-foreground">/mes</span>
                      {isAnnual && plan.plan !== 'free' && (
                        <p className="text-xs text-muted-foreground mt-1">
                          ${(plan.priceAnnual / 100).toFixed(0)} facturado anualmente
                        </p>
                      )}
                    </div>

                    {/* Trial Badge */}
                    {plan.has_trial && plan.plan !== 'free' && (
                      <Badge variant="outline" className="w-full justify-center">
                        <Gift className="h-3 w-3 mr-1" />
                        14 dias gratis
                      </Badge>
                    )}

                    <Separator />

                    {/* Limits */}
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span>
                          {plan.max_users === -1 ? 'Ilimitados' : plan.max_users} usuarios
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                        <span>
                          {plan.max_orders_per_month === -1
                            ? 'Ilimitados'
                            : plan.max_orders_per_month.toLocaleString()}{' '}
                          pedidos/mes
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-muted-foreground" />
                        <span>
                          {plan.max_products === -1
                            ? 'Ilimitados'
                            : plan.max_products.toLocaleString()}{' '}
                          productos
                        </span>
                      </div>
                    </div>

                    <Separator />

                    {/* Features */}
                    <div className="space-y-2 text-sm">
                      {renderFeature('Warehouse', plan.has_warehouse)}
                      {renderFeature('Devoluciones', plan.has_returns)}
                      {renderFeature('Mercaderia', plan.has_merchandise)}
                      {renderFeature('Etiquetas de envio', plan.has_shipping_labels)}
                      {renderFeature('Shopify Import', plan.has_shopify_import)}
                      {renderFeature('Shopify Sync', plan.has_shopify_bidirectional)}
                      {renderFeature('Smart Alerts', plan.has_smart_alerts)}
                      {renderFeature('API Access', plan.has_api_read || plan.has_api_write)}
                    </div>
                  </CardContent>

                  <CardFooter>
                    {isCurrentPlan ? (
                      <Button className="w-full" disabled variant="outline">
                        Plan Actual
                      </Button>
                    ) : canUpgrade ? (
                      <Button
                        className="w-full"
                        onClick={() => handleUpgrade(plan.plan)}
                        disabled={checkoutMutation.isPending && selectedPlan === plan.plan}
                      >
                        {checkoutMutation.isPending && selectedPlan === plan.plan ? (
                          'Cargando...'
                        ) : (
                          <>
                            {plan.has_trial ? 'Probar Gratis' : 'Upgrade'}
                            <ArrowRight className="h-4 w-4 ml-2" />
                          </>
                        )}
                      </Button>
                    ) : canDowngrade ? (
                      <Button className="w-full" variant="outline" disabled>
                        Contactar para Downgrade
                      </Button>
                    ) : (
                      <Button className="w-full" variant="outline" disabled>
                        No disponible
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* Usage Tab */}
        <TabsContent value="usage" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Orders Usage */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="h-5 w-5" />
                  Pedidos este mes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-3xl font-bold">
                  {usage?.orders.used.toLocaleString() || 0}
                  <span className="text-lg font-normal text-muted-foreground">
                    {' '}
                    /{' '}
                    {usage?.orders.limit === Infinity
                      ? '∞'
                      : usage?.orders.limit.toLocaleString()}
                  </span>
                </div>
                <Progress
                  value={Math.min(usage?.orders.percentage || 0, 100)}
                  className={getProgressColor(usage?.orders.percentage || 0)}
                />
                {(usage?.orders.percentage || 0) >= 80 && (
                  <p className="text-sm text-orange-600">
                    <AlertCircle className="h-4 w-4 inline mr-1" />
                    Estas cerca del limite
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Products Usage */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  Productos
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-3xl font-bold">
                  {usage?.products.used.toLocaleString() || 0}
                  <span className="text-lg font-normal text-muted-foreground">
                    {' '}
                    /{' '}
                    {usage?.products.limit === Infinity
                      ? '∞'
                      : usage?.products.limit.toLocaleString()}
                  </span>
                </div>
                <Progress
                  value={Math.min(usage?.products.percentage || 0, 100)}
                  className={getProgressColor(usage?.products.percentage || 0)}
                />
              </CardContent>
            </Card>

            {/* Users Usage */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Usuarios
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-3xl font-bold">
                  {usage?.users.used || 0}
                  <span className="text-lg font-normal text-muted-foreground">
                    {' '}
                    /{' '}
                    {usage?.users.limit === Infinity
                      ? '∞'
                      : usage?.users.limit}
                  </span>
                </div>
                <Progress
                  value={Math.min(usage?.users.percentage || 0, 100)}
                  className={getProgressColor(usage?.users.percentage || 0)}
                />
              </CardContent>
            </Card>
          </div>

          {/* Upgrade CTA */}
          {currentPlan !== 'professional' && (usage?.orders.percentage || 0) >= 70 && (
            <Alert>
              <TrendingUp className="h-4 w-4" />
              <AlertTitle>Necesitas mas capacidad?</AlertTitle>
              <AlertDescription className="flex items-center justify-between">
                <span>
                  Upgrade tu plan para obtener mas pedidos, productos y usuarios.
                </span>
                <Button size="sm" onClick={() => handleUpgrade(getNextPlan(currentPlan))}>
                  Ver Planes
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        {/* Referrals Tab */}
        <TabsContent value="referrals" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gift className="h-5 w-5" />
                Programa de Referidos
              </CardTitle>
              <CardDescription>
                Invita amigos y gana $10 de credito por cada uno que se suscriba.
                Ellos obtienen 20% de descuento en su primer mes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Referral Link */}
              <div className="space-y-2">
                <Label>Tu link de referido</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={
                      referralStats?.code
                        ? `${window.location.origin}/r/${referralStats.code}`
                        : 'Generando...'
                    }
                    className="font-mono"
                  />
                  <Button variant="outline" onClick={copyReferralLink}>
                    <Copy className="h-4 w-4 mr-2" />
                    Copiar
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-2xl font-bold">
                    {referralStats?.totalSignups || 0}
                  </div>
                  <div className="text-sm text-muted-foreground">Registrados</div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-2xl font-bold">
                    {referralStats?.totalConversions || 0}
                  </div>
                  <div className="text-sm text-muted-foreground">Pagaron</div>
                </div>
                <div className="text-center p-4 bg-muted rounded-lg">
                  <div className="text-2xl font-bold">
                    ${referralStats?.totalCreditsEarned?.toFixed(2) || '0.00'}
                  </div>
                  <div className="text-sm text-muted-foreground">Total Ganado</div>
                </div>
                <div className="text-center p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">
                    ${referralStats?.availableCredits?.toFixed(2) || '0.00'}
                  </div>
                  <div className="text-sm text-muted-foreground">Credito Disponible</div>
                </div>
              </div>

              {/* Referral History */}
              {referralStats?.referrals && referralStats.referrals.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Label>Historial de Referidos</Label>
                    <div className="space-y-2">
                      {referralStats.referrals.map((ref: any) => (
                        <div
                          key={ref.id}
                          className="flex items-center justify-between p-3 bg-muted rounded-lg"
                        >
                          <div>
                            <div className="font-medium">{ref.referred?.name || 'Usuario'}</div>
                            <div className="text-sm text-muted-foreground">
                              {new Date(ref.signed_up_at).toLocaleDateString()}
                            </div>
                          </div>
                          <div className="text-right">
                            {ref.first_payment_at ? (
                              <Badge variant="default" className="bg-green-500">
                                <Check className="h-3 w-3 mr-1" />
                                +$10
                              </Badge>
                            ) : (
                              <Badge variant="secondary">
                                <Clock className="h-3 w-3 mr-1" />
                                Pendiente
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* How it works */}
          <Card>
            <CardHeader>
              <CardTitle>Como Funciona</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center space-y-2">
                  <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                    <span className="text-xl font-bold text-primary">1</span>
                  </div>
                  <h3 className="font-medium">Comparte tu Link</h3>
                  <p className="text-sm text-muted-foreground">
                    Envia tu link de referido a amigos o colegas
                  </p>
                </div>
                <div className="text-center space-y-2">
                  <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                    <span className="text-xl font-bold text-primary">2</span>
                  </div>
                  <h3 className="font-medium">Ellos se Registran</h3>
                  <p className="text-sm text-muted-foreground">
                    Obtienen 20% de descuento en su primer mes
                  </p>
                </div>
                <div className="text-center space-y-2">
                  <div className="h-12 w-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                    <span className="text-xl font-bold text-primary">3</span>
                  </div>
                  <h3 className="font-medium">Tu Ganas $10</h3>
                  <p className="text-sm text-muted-foreground">
                    Cuando paguen su primer mes, recibiras $10 de credito
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Helper functions
function getPlanOrder(plan: string): number {
  const order: Record<string, number> = {
    free: 0,
    starter: 1,
    growth: 2,
    professional: 3,
  };
  return order[plan] || 0;
}

function getPlanDisplayName(plan: string): string {
  const names: Record<string, string> = {
    free: 'Free',
    starter: 'Starter',
    growth: 'Growth',
    professional: 'Professional',
  };
  return names[plan] || plan;
}

function getPlanDescription(plan: string): string {
  const descriptions: Record<string, string> = {
    free: 'Para empezar a probar',
    starter: 'Para pequeños negocios',
    growth: 'Para negocios en expansion',
    professional: 'Para operaciones avanzadas',
  };
  return descriptions[plan] || '';
}

function getNextPlan(currentPlan: string): string {
  const next: Record<string, string> = {
    free: 'starter',
    starter: 'growth',
    growth: 'professional',
    professional: 'professional',
  };
  return next[currentPlan] || 'starter';
}

function getProgressColor(percentage: number): string {
  if (percentage >= 90) return '[&>div]:bg-red-500';
  if (percentage >= 80) return '[&>div]:bg-orange-500';
  if (percentage >= 70) return '[&>div]:bg-yellow-500';
  return '';
}

function renderFeature(name: string, enabled: boolean) {
  return (
    <div className="flex items-center gap-2">
      {enabled ? (
        <Check className="h-4 w-4 text-green-500" />
      ) : (
        <X className="h-4 w-4 text-muted-foreground" />
      )}
      <span className={!enabled ? 'text-muted-foreground' : ''}>{name}</span>
    </div>
  );
}
