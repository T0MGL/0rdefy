import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { billingService, Plan } from '@/services/billing.service';
import {
  Check,
  Zap,
  Sparkles,
  Crown,
  Rocket,
  ArrowRight,
  Gift,
  Clock,
  Users,
  Package,
  ShoppingCart,
  Loader2,
} from 'lucide-react';

// Plan icons mapping
const planIcons: Record<string, React.ReactNode> = {
  free: <Zap className="w-6 h-6" />,
  starter: <Rocket className="w-6 h-6" />,
  growth: <Sparkles className="w-6 h-6" />,
  professional: <Crown className="w-6 h-6" />,
};

// Plan colors
const planColors: Record<string, string> = {
  free: 'from-slate-500 to-slate-600',
  starter: 'from-blue-500 to-blue-600',
  growth: 'from-purple-500 to-purple-600',
  professional: 'from-amber-500 to-amber-600',
};

// Feature highlights per plan
const planHighlights: Record<string, string[]> = {
  free: [
    'Dashboard basico',
    'Hasta 50 pedidos/mes',
    '100 productos',
    '1 usuario',
  ],
  starter: [
    'Todo de Free +',
    '500 pedidos/mes',
    'Almacen y Devoluciones',
    'Etiquetas de envio',
    'Importar desde Shopify',
    '3 usuarios',
    '14 dias de prueba gratis',
  ],
  growth: [
    'Todo de Starter +',
    '2,000 pedidos/mes',
    'Sync bidireccional Shopify',
    'Alertas inteligentes',
    'Tracking de campanas',
    'API (lectura)',
    '10 usuarios',
    '14 dias de prueba gratis',
  ],
  professional: [
    'Todo de Growth +',
    '10,000 pedidos/mes',
    'Multi-tienda (3)',
    'Roles personalizados',
    'API completa',
    'Webhooks',
    '25 usuarios',
  ],
};

export default function OnboardingPlan() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { user, currentStore } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');
  const [isProcessing, setIsProcessing] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);

  // Capture referral code from URL or localStorage
  useEffect(() => {
    const refFromUrl = searchParams.get('ref');
    const refFromStorage = localStorage.getItem('pending_referral_code');

    if (refFromUrl) {
      setReferralCode(refFromUrl);
    } else if (refFromStorage) {
      setReferralCode(refFromStorage);
    }
  }, [searchParams]);

  // Load plans
  useEffect(() => {
    async function loadPlans() {
      try {
        const data = await billingService.getPlans();
        setPlans(data);
      } catch (error) {
        console.error('Error loading plans:', error);
        // Fallback plans if API fails
        setPlans([
          { plan: 'free', priceMonthly: 0, priceAnnual: 0, has_trial: false, trial_days: 0 } as Plan,
          { plan: 'starter', priceMonthly: 2900, priceAnnual: 28800, has_trial: true, trial_days: 14 } as Plan,
          { plan: 'growth', priceMonthly: 7900, priceAnnual: 79200, has_trial: true, trial_days: 14 } as Plan,
          { plan: 'professional', priceMonthly: 16900, priceAnnual: 170400, has_trial: false, trial_days: 0 } as Plan,
        ]);
      } finally {
        setIsLoading(false);
      }
    }
    loadPlans();
  }, []);

  const handleSelectPlan = async (planName: string) => {
    if (planName === 'free') {
      // Free plan - just go to dashboard
      localStorage.removeItem('pending_referral_code');
      toast({
        title: "Plan Free activado",
        description: "Puedes mejorar tu plan en cualquier momento desde Configuracion.",
      });
      navigate('/', { replace: true });
      return;
    }

    setSelectedPlan(planName);
    setIsProcessing(true);

    try {
      const { url } = await billingService.createCheckout({
        plan: planName,
        billingCycle,
        referralCode: referralCode || undefined,
      });

      if (url) {
        // Clear referral code before redirect
        localStorage.removeItem('pending_referral_code');
        window.location.href = url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (error: any) {
      console.error('Checkout error:', error);
      toast({
        title: "Error al procesar",
        description: error.message || "No se pudo iniciar el proceso de pago. Intenta de nuevo.",
        variant: "destructive",
      });
      setSelectedPlan(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSkip = () => {
    localStorage.removeItem('pending_referral_code');
    toast({
      title: "Bienvenido a Ordefy",
      description: "Puedes mejorar tu plan en cualquier momento desde Configuracion.",
    });
    navigate('/', { replace: true });
  };

  const formatPrice = (dollars: number) => {
    // API already returns prices in dollars, not cents
    return dollars.toFixed(0);
  };

  const getMonthlyEquivalent = (annualDollars: number) => {
    // API already returns prices in dollars, not cents
    return (annualDollars / 12).toFixed(2);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Cargando planes...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="bg-primary/10 rounded-xl p-2">
              <Zap className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-3xl font-bold">Ordefy</h1>
          </div>
          <h2 className="text-2xl font-semibold mb-2">
            Bienvenido{user?.name ? `, ${user.name.split(' ')[0]}` : ''}!
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Elige el plan que mejor se adapte a tu negocio. Puedes cambiar o cancelar en cualquier momento.
          </p>
        </motion.div>

        {/* Referral Banner */}
        {referralCode && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-6 p-4 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg max-w-xl mx-auto"
          >
            <div className="flex items-center gap-2 justify-center">
              <Gift className="w-5 h-5 text-green-600" />
              <span className="font-semibold text-green-700 dark:text-green-400">
                20% de descuento aplicado en tu primer mes
              </span>
              <Badge variant="secondary" className="bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300">
                {referralCode}
              </Badge>
            </div>
          </motion.div>
        )}

        {/* Billing Toggle */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="flex items-center justify-center gap-4 mb-8"
        >
          <Label
            htmlFor="billing-toggle"
            className={`cursor-pointer ${billingCycle === 'monthly' ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
          >
            Mensual
          </Label>
          <Switch
            id="billing-toggle"
            checked={billingCycle === 'annual'}
            onCheckedChange={(checked) => setBillingCycle(checked ? 'annual' : 'monthly')}
          />
          <Label
            htmlFor="billing-toggle"
            className={`cursor-pointer flex items-center gap-2 ${billingCycle === 'annual' ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
          >
            Anual
            <Badge variant="secondary" className="bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300">
              15% OFF
            </Badge>
          </Label>
        </motion.div>

        {/* Plans Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 max-w-5xl mx-auto">
          {['starter', 'growth', 'professional'].map((planName, index) => {
            const plan = plans.find(p => p.plan === planName);
            const isPopular = planName === 'growth';
            const isSelected = selectedPlan === planName;
            const price = billingCycle === 'monthly'
              ? plan?.priceMonthly || 0
              : plan?.priceAnnual || 0;

            return (
              <motion.div
                key={planName}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 * (index + 1) }}
              >
                <Card
                  className={`relative h-full flex flex-col ${
                    isPopular ? 'border-purple-500 border-2 shadow-lg' : ''
                  } ${isSelected ? 'ring-2 ring-primary' : ''}`}
                >
                  {isPopular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className="bg-purple-500 text-white">
                        Mas Popular
                      </Badge>
                    </div>
                  )}

                  <CardHeader className="pb-4">
                    <div className={`w-12 h-12 rounded-lg bg-gradient-to-br ${planColors[planName]} flex items-center justify-center text-white mb-3`}>
                      {planIcons[planName]}
                    </div>
                    <CardTitle className="capitalize">{planName}</CardTitle>
                    <CardDescription>
                      {planName === 'free' && 'Para probar la plataforma'}
                      {planName === 'starter' && 'Para pequenos negocios'}
                      {planName === 'growth' && 'Para negocios en crecimiento'}
                      {planName === 'professional' && 'Para operaciones avanzadas'}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="flex-1">
                    {/* Price */}
                    <div className="mb-4">
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-bold">
                          ${billingCycle === 'monthly' ? formatPrice(price) : getMonthlyEquivalent(price)}
                        </span>
                        <span className="text-muted-foreground">/mes</span>
                      </div>
                      {billingCycle === 'annual' && (
                        <p className="text-sm text-muted-foreground">
                          ${formatPrice(price)} facturado anualmente
                        </p>
                      )}
                    </div>

                    {/* Trial Badge */}
                    {plan?.has_trial && plan.trial_days > 0 && (
                      <div className="mb-4 flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                        <Clock className="w-4 h-4" />
                        <span>{plan.trial_days} dias de prueba gratis</span>
                      </div>
                    )}

                    {/* Features */}
                    <ul className="space-y-2">
                      {planHighlights[planName]?.map((feature, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm">
                          <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>

                  <CardFooter>
                    <Button
                      className="w-full"
                      variant={isPopular ? 'default' : 'secondary'}
                      onClick={() => handleSelectPlan(planName)}
                      disabled={isProcessing}
                    >
                      {isProcessing && selectedPlan === planName ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Procesando...
                        </>
                      ) : plan?.has_trial ? (
                        <>
                          Probar {plan.trial_days} dias gratis
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </>
                      ) : (
                        <>
                          Elegir {planName}
                          <ArrowRight className="w-4 h-4 ml-2" />
                        </>
                      )}
                    </Button>
                  </CardFooter>
                </Card>
              </motion.div>
            );
          })}
        </div>

        {/* Quick Stats */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="grid grid-cols-3 gap-4 max-w-2xl mx-auto mb-8"
        >
          <div className="text-center p-4 rounded-lg bg-card border">
            <Users className="w-6 h-6 mx-auto mb-2 text-primary" />
            <div className="text-2xl font-bold">500+</div>
            <div className="text-sm text-muted-foreground">Negocios activos</div>
          </div>
          <div className="text-center p-4 rounded-lg bg-card border">
            <ShoppingCart className="w-6 h-6 mx-auto mb-2 text-primary" />
            <div className="text-2xl font-bold">50K+</div>
            <div className="text-sm text-muted-foreground">Pedidos procesados</div>
          </div>
          <div className="text-center p-4 rounded-lg bg-card border">
            <Package className="w-6 h-6 mx-auto mb-2 text-primary" />
            <div className="text-2xl font-bold">99.9%</div>
            <div className="text-sm text-muted-foreground">Uptime garantizado</div>
          </div>
        </motion.div>

        {/* Skip Link */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-center"
        >
          <button
            onClick={handleSkip}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Continuar con el plan gratuito por ahora
          </button>
        </motion.div>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="mt-8 text-center text-xs text-muted-foreground"
        >
          <p>Puedes cambiar o cancelar tu plan en cualquier momento.</p>
          <p className="mt-1">Pagos seguros procesados por Stripe.</p>
        </motion.div>
      </div>
    </div>
  );
}
