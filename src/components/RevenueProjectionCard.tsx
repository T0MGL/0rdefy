import { Card } from '@/components/ui/card';
import { Rocket, TrendingUp } from 'lucide-react';
import { RevenueProjection } from '@/utils/recommendationEngine';
import { formatCurrency } from '@/utils/currency';

interface RevenueProjectionCardProps {
  projection: RevenueProjection;
}

export function RevenueProjectionCard({ projection }: RevenueProjectionCardProps) {
  if (!projection.shouldShow) {
    return null;
  }

  return (
    <Card className="p-6 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 border-green-200 dark:border-green-800">
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-lg">
          <Rocket className="w-6 h-6 text-green-600 dark:text-green-400" />
        </div>

        {/* Content */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-lg font-semibold text-green-900 dark:text-green-100">
              Proyección a 30 días
            </h3>
            <div className="flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/40 rounded-full">
              <TrendingUp className="w-3 h-3 text-green-700 dark:text-green-400" />
              <span className="text-xs font-semibold text-green-700 dark:text-green-400">
                +{projection.growthRate.toFixed(1)}%
              </span>
            </div>
          </div>

          <p className="text-sm text-green-700 dark:text-green-300 mb-3">
            Si mantienes este ritmo, habrás ganado{' '}
            <span className="font-bold text-green-900 dark:text-green-100">
              {formatCurrency(projection.projectedRevenue)}
            </span>{' '}
            en los próximos 30 días
          </p>

          <div className="flex items-center gap-4 text-xs text-green-600 dark:text-green-400">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-green-500 dark:bg-green-400 rounded-full" />
              <span>Ingreso promedio diario: {formatCurrency(projection.currentRevenue / projection.daysAnalyzed)}</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-emerald-500 dark:bg-emerald-400 rounded-full" />
              <span>Últimos {projection.daysAnalyzed} días analizados</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
