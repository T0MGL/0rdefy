import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { analyticsService } from '@/services/analytics.service';
import { formatCurrency } from '@/utils/currency';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Calendar,
  DollarSign,
  AlertCircle,
} from 'lucide-react';

export function CashFlowProjection() {
  const [periodType, setPeriodType] = useState<'day' | 'week'>('week');
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [scenario, setScenario] = useState<'conservative' | 'moderate' | 'optimistic'>('moderate');

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodType]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const result = await analyticsService.getCashFlowTimeline(periodType);
      setData(result);
    } catch (error) {
      console.error('Error loading cash flow timeline:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4"></div>
          <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </Card>
    );
  }

  if (!data || !data.timeline || data.timeline.length === 0) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-3 text-gray-500 dark:text-gray-400">
          <AlertCircle className="w-5 h-5" />
          <p>No hay datos suficientes para proyectar el flujo de caja</p>
        </div>
      </Card>
    );
  }

  const { timeline, summary } = data;

  // Prepare chart data
  const chartData = timeline.map((period: any) => ({
    period: period.period,
    ingresos: period.revenue[scenario],
    costos: period.costs[scenario],
    flujoNeto: period.netCashFlow[scenario],
    acumulado: period.cumulativeCashFlow[scenario],
  }));

  // Calculate totals
  const totalRevenue = timeline.reduce((sum: number, p: any) => sum + p.revenue[scenario], 0);
  const totalCosts = timeline.reduce((sum: number, p: any) => sum + p.costs[scenario], 0);
  const totalNetCashFlow = totalRevenue - totalCosts;

  // Format period label
  const formatPeriodLabel = (period: string) => {
    if (periodType === 'day') {
      const date = new Date(period);
      return date.toLocaleDateString('es-AR', { month: 'short', day: 'numeric' });
    } else {
      // Format week: 2025-W01 -> Semana 1
      const weekNumber = period.split('-W')[1];
      return `Sem ${weekNumber}`;
    }
  };

  return (
    <Card className="p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Proyección de Flujo de Caja
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Estimación de cuándo se facturarán los pedidos actuales (ingresos - costos)
          </p>
        </div>

        <div className="flex gap-2">
          {/* Period Type Toggle */}
          <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-lg">
            <Button
              size="sm"
              variant={periodType === 'week' ? 'default' : 'ghost'}
              onClick={() => setPeriodType('week')}
              className="text-xs"
            >
              Semanas
            </Button>
            <Button
              size="sm"
              variant={periodType === 'day' ? 'default' : 'ghost'}
              onClick={() => setPeriodType('day')}
              className="text-xs"
            >
              Días
            </Button>
          </div>
        </div>
      </div>

      {/* Scenario Selector */}
      <div className="flex gap-2 mb-6">
        <Button
          size="sm"
          variant={scenario === 'conservative' ? 'default' : 'outline'}
          onClick={() => setScenario('conservative')}
          className="text-xs"
        >
          Conservador
        </Button>
        <Button
          size="sm"
          variant={scenario === 'moderate' ? 'default' : 'outline'}
          onClick={() => setScenario('moderate')}
          className="text-xs"
        >
          Moderado
        </Button>
        <Button
          size="sm"
          variant={scenario === 'optimistic' ? 'default' : 'outline'}
          onClick={() => setScenario('optimistic')}
          className="text-xs"
        >
          Optimista
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 mb-2">
            <TrendingUp className="w-4 h-4" />
            <span className="text-xs font-medium">Ingresos Proyectados</span>
          </div>
          <p className="text-xl font-bold text-blue-900 dark:text-blue-300">
            {formatCurrency(totalRevenue)}
          </p>
        </div>

        <div className="p-4 bg-orange-50 dark:bg-orange-950/20 rounded-lg border border-orange-200 dark:border-orange-800">
          <div className="flex items-center gap-2 text-orange-600 dark:text-orange-400 mb-2">
            <TrendingDown className="w-4 h-4" />
            <span className="text-xs font-medium">Costos Totales</span>
          </div>
          <p className="text-xl font-bold text-orange-900 dark:text-orange-300">
            {formatCurrency(totalCosts)}
          </p>
        </div>

        <div className={`p-4 rounded-lg border ${
          totalNetCashFlow >= 0
            ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800'
            : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
        }`}>
          <div className={`flex items-center gap-2 mb-2 ${
            totalNetCashFlow >= 0
              ? 'text-green-600 dark:text-green-400'
              : 'text-red-600 dark:text-red-400'
          }`}>
            <DollarSign className="w-4 h-4" />
            <span className="text-xs font-medium">Flujo Neto</span>
          </div>
          <p className={`text-xl font-bold ${
            totalNetCashFlow >= 0
              ? 'text-green-900 dark:text-green-300'
              : 'text-red-900 dark:text-red-300'
          }`}>
            {formatCurrency(totalNetCashFlow)}
          </p>
        </div>
      </div>

      {/* Chart */}
      <div className="mb-6">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
            <XAxis
              dataKey="period"
              tickFormatter={formatPeriodLabel}
              className="text-xs text-gray-600 dark:text-gray-400"
            />
            <YAxis
              tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
              className="text-xs text-gray-600 dark:text-gray-400"
            />
            <Tooltip
              formatter={(value: number) => formatCurrency(value)}
              labelFormatter={formatPeriodLabel}
              contentStyle={{
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="ingresos"
              stroke="#3b82f6"
              strokeWidth={2}
              name="Ingresos"
              dot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="costos"
              stroke="#f97316"
              strokeWidth={2}
              name="Costos"
              dot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="flujoNeto"
              stroke="#10b981"
              strokeWidth={2}
              name="Flujo Neto"
              dot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="acumulado"
              stroke="#8b5cf6"
              strokeWidth={2}
              strokeDasharray="5 5"
              name="Acumulado"
              dot={{ r: 3 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Timeline Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="text-left py-2 px-3 text-gray-600 dark:text-gray-400 font-medium">
                Período
              </th>
              <th className="text-right py-2 px-3 text-gray-600 dark:text-gray-400 font-medium">
                Pedidos
              </th>
              <th className="text-right py-2 px-3 text-gray-600 dark:text-gray-400 font-medium">
                Ingresos
              </th>
              <th className="text-right py-2 px-3 text-gray-600 dark:text-gray-400 font-medium">
                Costos
              </th>
              <th className="text-right py-2 px-3 text-gray-600 dark:text-gray-400 font-medium">
                Flujo Neto
              </th>
              <th className="text-right py-2 px-3 text-gray-600 dark:text-gray-400 font-medium">
                Acumulado
              </th>
            </tr>
          </thead>
          <tbody>
            {timeline.map((period: any, index: number) => (
              <tr
                key={period.period}
                className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50"
              >
                <td className="py-2 px-3 text-gray-900 dark:text-white font-medium">
                  {formatPeriodLabel(period.period)}
                </td>
                <td className="py-2 px-3 text-right text-gray-600 dark:text-gray-400">
                  {period.ordersCount[scenario].toFixed(1)}
                </td>
                <td className="py-2 px-3 text-right text-blue-600 dark:text-blue-400 font-medium">
                  {formatCurrency(period.revenue[scenario])}
                </td>
                <td className="py-2 px-3 text-right text-orange-600 dark:text-orange-400 font-medium">
                  {formatCurrency(period.costs[scenario])}
                </td>
                <td className={`py-2 px-3 text-right font-medium ${
                  period.netCashFlow[scenario] >= 0
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}>
                  {formatCurrency(period.netCashFlow[scenario])}
                </td>
                <td className={`py-2 px-3 text-right font-medium ${
                  period.cumulativeCashFlow[scenario] >= 0
                    ? 'text-purple-600 dark:text-purple-400'
                    : 'text-red-600 dark:text-red-400'
                }`}>
                  {formatCurrency(period.cumulativeCashFlow[scenario])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Info Footer */}
      <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
        <div className="flex items-start gap-2 text-xs text-gray-600 dark:text-gray-400">
          <Calendar className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium mb-1">Cómo funciona esta proyección:</p>
            <ul className="space-y-1 list-disc list-inside">
              <li><strong>Conservador:</strong> Considera el peor escenario (máximo tiempo de entrega, menor probabilidad)</li>
              <li><strong>Moderado:</strong> Promedio de tiempos de entrega con probabilidad estándar</li>
              <li><strong>Optimista:</strong> Mejor escenario (mínimo tiempo de entrega, mayor probabilidad)</li>
              <li>Los costos incluyen: productos, envío y gasto publicitario prorrateado</li>
              <li>La probabilidad se ajusta según el estado del pedido (delivered: 100%, shipped: 90%, etc.)</li>
            </ul>
          </div>
        </div>
      </div>
    </Card>
  );
}
