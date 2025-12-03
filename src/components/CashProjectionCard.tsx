import { Card } from '@/components/ui/card';
import { Wallet, TrendingUp, Package, Truck, Clock, Target } from 'lucide-react';

interface CashProjectionData {
  cashInHand: number;
  cashInTransit: number;
  expectedFromTransit: number;
  pipeline: {
    readyToShip: { total: number; expected: number; probability: number };
    inPreparation: { total: number; expected: number; probability: number };
    confirmed: { total: number; expected: number; probability: number };
  };
  projections: {
    conservative: number;
    moderate: number;
    optimistic: number;
  };
  futureProjections: {
    next7Days: number;
    next14Days: number;
    next30Days: number;
  };
  historicalDeliveryRate: number;
  avgDailyRevenue: number;
}

interface CashProjectionCardProps {
  projection: CashProjectionData | null;
}

export function CashProjectionCard({ projection }: CashProjectionCardProps) {
  if (!projection) {
    return null;
  }

  return (
    <Card className="p-6 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border-blue-200 dark:border-blue-800">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
            <Wallet className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-1">
              Proyección de Caja
            </h3>
            <p className="text-sm text-blue-700 dark:text-blue-300">
              Basado en histórico de entregas ({projection.historicalDeliveryRate}% tasa de entrega)
            </p>
          </div>
        </div>

        {/* Cash Status */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white dark:bg-gray-900/50 rounded-lg p-4 border border-blue-100 dark:border-blue-900">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="w-4 h-4 text-green-600 dark:text-green-400" />
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">En Caja</span>
            </div>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              Gs. {projection.cashInHand.toLocaleString()}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Pedidos entregados</p>
          </div>

          <div className="bg-white dark:bg-gray-900/50 rounded-lg p-4 border border-blue-100 dark:border-blue-900">
            <div className="flex items-center gap-2 mb-2">
              <Truck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">En Tránsito</span>
            </div>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              Gs. {projection.expectedFromTransit.toLocaleString()}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              De Gs. {projection.cashInTransit.toLocaleString()} enviados
            </p>
          </div>
        </div>

        {/* Pipeline */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3">Pipeline de Ingresos</h4>

          <div className="flex items-center justify-between bg-white dark:bg-gray-900/50 rounded-lg p-3 border border-blue-100 dark:border-blue-900">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-sm text-gray-700 dark:text-gray-300">Listos para envío</span>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                Gs. {projection.pipeline.readyToShip.expected.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {projection.pipeline.readyToShip.probability}% probabilidad
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between bg-white dark:bg-gray-900/50 rounded-lg p-3 border border-blue-100 dark:border-blue-900">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span className="text-sm text-gray-700 dark:text-gray-300">En preparación</span>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-amber-600 dark:text-amber-400">
                Gs. {projection.pipeline.inPreparation.expected.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {projection.pipeline.inPreparation.probability}% probabilidad
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between bg-white dark:bg-gray-900/50 rounded-lg p-3 border border-blue-100 dark:border-blue-900">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-orange-600 dark:text-orange-400" />
              <span className="text-sm text-gray-700 dark:text-gray-300">Confirmados</span>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-orange-600 dark:text-orange-400">
                Gs. {projection.pipeline.confirmed.expected.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {projection.pipeline.confirmed.probability}% probabilidad
              </p>
            </div>
          </div>
        </div>

        {/* Projections */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-3">Proyección Total</h4>

          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white dark:bg-gray-900/50 rounded-lg p-3 border border-blue-100 dark:border-blue-900 text-center">
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Conservadora</p>
              <p className="text-sm font-bold text-blue-900 dark:text-blue-100">
                Gs. {(projection.projections.conservative / 1000).toFixed(0)}K
              </p>
            </div>
            <div className="bg-blue-100 dark:bg-blue-900/30 rounded-lg p-3 border-2 border-blue-400 dark:border-blue-600 text-center">
              <p className="text-xs text-blue-700 dark:text-blue-300 mb-1 font-medium">Moderada</p>
              <p className="text-sm font-bold text-blue-900 dark:text-blue-100">
                Gs. {(projection.projections.moderate / 1000).toFixed(0)}K
              </p>
            </div>
            <div className="bg-white dark:bg-gray-900/50 rounded-lg p-3 border border-blue-100 dark:border-blue-900 text-center">
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Optimista</p>
              <p className="text-sm font-bold text-blue-900 dark:text-blue-100">
                Gs. {(projection.projections.optimistic / 1000).toFixed(0)}K
              </p>
            </div>
          </div>
        </div>

        {/* Future Projections */}
        <div className="bg-gradient-to-r from-blue-100 to-indigo-100 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100">
              Proyección Futura (incluye pedidos actuales + ritmo promedio)
            </h4>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-xs text-blue-700 dark:text-blue-300 mb-1">7 días</p>
              <p className="text-lg font-bold text-blue-900 dark:text-blue-100">
                Gs. {(projection.futureProjections.next7Days / 1000).toFixed(0)}K
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-blue-700 dark:text-blue-300 mb-1">14 días</p>
              <p className="text-lg font-bold text-blue-900 dark:text-blue-100">
                Gs. {(projection.futureProjections.next14Days / 1000).toFixed(0)}K
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-blue-700 dark:text-blue-300 mb-1">30 días</p>
              <p className="text-lg font-bold text-blue-900 dark:text-blue-100">
                Gs. {(projection.futureProjections.next30Days / 1000).toFixed(0)}K
              </p>
            </div>
          </div>
          <p className="text-xs text-blue-600 dark:text-blue-400 mt-3 text-center">
            Promedio diario: Gs. {projection.avgDailyRevenue.toLocaleString()} (últimos 30 días)
          </p>
        </div>
      </div>
    </Card>
  );
}
