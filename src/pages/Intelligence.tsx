import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { RevenueIntelligence } from '@/components/RevenueIntelligence';
import { useSubscription } from '@/contexts/SubscriptionContext';

export default function Intelligence() {
  const navigate = useNavigate();
  const { hasFeature, canUpgrade } = useSubscription();
  const hasAccess = hasFeature('revenue_intelligence');

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 -ml-2"
            onClick={() => navigate('/')}
          >
            <ArrowLeft size={16} />
            Volver
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Análisis avanzado
            </h1>
            <p className="text-sm text-muted-foreground">
              Top productos, márgenes por SKU, comparativos y exportables.
            </p>
          </div>
        </div>
      </header>

      {hasAccess ? (
        <RevenueIntelligence />
      ) : (
        <Card className="p-8 border-primary/30 bg-card">
          <div className="flex flex-col items-start gap-4 max-w-2xl">
            <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
              <BarChart3 size={24} className="text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-card-foreground">
                Inteligencia de ingresos requiere Starter+
              </h2>
              <p className="text-sm text-muted-foreground mt-2">
                Accedé a top productos, márgenes por SKU, comparativos y exportables
                desde un plan Starter o superior.
              </p>
            </div>
            {canUpgrade && (
              <Button
                className="gap-2"
                onClick={() =>
                  navigate('/settings', {
                    state: {
                      openSection: 'subscription',
                      fromFeature: 'revenue_intelligence',
                      returnPath: '/intelligence',
                    },
                  })
                }
              >
                Ver planes
                <ArrowRight size={14} />
              </Button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
