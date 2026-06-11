import { Card } from '@/components/ui/card';
import { Rocket, TrendingUp } from 'lucide-react';
import { RevenueProjection } from '@/utils/recommendationEngine';
import { formatCurrency, formatPercent } from '@/utils/currency';

interface RevenueProjectionCardProps {
  projection: RevenueProjection;
}

export function RevenueProjectionCard({ projection }: RevenueProjectionCardProps) {
  if (!projection.shouldShow) {
    return null;
  }

  return (
    <Card className="p-6 bg-gradient-to-br from-primary to-primary dark:from-primary/20 dark:to-primary/20 border-primary/30 dark:border-primary">
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className="p-3 bg-primary/10 dark:bg-primary/30 rounded-lg">
          <Rocket className="w-6 h-6 text-primary dark:text-primary" />
        </div>

        {/* Content */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-semibold text-primary dark:text-primary">
              Proyección a 30 días
            </h3>
            <div className="flex items-center gap-1 px-2 py-0.5 bg-primary/10 dark:bg-primary/40 rounded-full">
              <TrendingUp className="w-3 h-3 text-primary dark:text-primary" />
              <span className="text-xs font-semibold text-primary dark:text-primary">
                +{formatPercent(projection.growthRate, 1)}
              </span>
            </div>
          </div>

          <p className="text-sm text-primary dark:text-primary mb-3">
            Si mantienes este ritmo, habrás ganado{' '}
            <span className="font-bold text-primary dark:text-primary">
              {formatCurrency(projection.projectedRevenue)}
            </span>{' '}
            en los próximos 30 días
          </p>

          <div className="flex items-center gap-4 text-xs text-primary dark:text-primary">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-primary dark:bg-primary/30 rounded-full" />
              <span>
                Ingreso promedio diario:{' '}
                {projection.daysAnalyzed > 0
                  ? formatCurrency(projection.currentRevenue / projection.daysAnalyzed)
                  : 'Sin datos'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-primary dark:bg-primary/30 rounded-full" />
              <span>Últimos {projection.daysAnalyzed} días analizados</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
