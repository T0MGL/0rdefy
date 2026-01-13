import { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  ChevronDown,
  ChevronUp,
  TrendingUp,
  TrendingDown,
  ShoppingBag,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  Package2
} from 'lucide-react';
import { ordersService } from '@/services/orders.service';
import { analyticsService } from '@/services/analytics.service';
import { useDateRange } from '@/contexts/DateRangeContext';
import type { Order, DashboardOverview } from '@/types';

export function DailySummary() {
  const [isOpen, setIsOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Use global date range context
  const { selectedRange, getDateRange } = useDateRange();

  // Calculate date ranges from global context
  const dateRange = useMemo(() => {
    const range = getDateRange();
    return {
      startDate: range.from.toISOString().split('T')[0],
      endDate: range.to.toISOString().split('T')[0],
    };
  }, [getDateRange]);

  // Get title based on selected range
  const getSummaryTitle = () => {
    switch (selectedRange) {
      case 'today':
        return 'Resumen Ejecutivo del Día';
      case '7d':
        return 'Resumen Ejecutivo de la Semana';
      case '30d':
        return 'Resumen Ejecutivo del Mes';
      case 'custom':
        return 'Resumen Ejecutivo Personalizado';
      default:
        return 'Resumen Ejecutivo';
    }
  };

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const dateParams = {
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
        };

        const [ordersResponse, overviewData] = await Promise.all([
          ordersService.getAll(dateParams),
          analyticsService.getOverview(dateParams),
        ]);
        setOrders(ordersResponse.data || []);
        setOverview(overviewData);
      } catch (error) {
        console.error('Error loading daily summary data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, [dateRange]);

  if (isLoading || !overview) {
    return (
      <Card className="p-6 bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="h-6 w-64 bg-muted animate-pulse rounded" />
            <div className="h-4 w-48 bg-muted animate-pulse rounded" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="p-4 bg-card rounded-lg border space-y-2">
                <div className="h-5 w-5 bg-muted animate-pulse rounded" />
                <div className="h-8 w-20 bg-muted animate-pulse rounded" />
                <div className="h-3 w-24 bg-muted animate-pulse rounded" />
              </div>
            ))}
          </div>
        </div>
      </Card>
    );
  }

  // ===== USAR DATOS DEL OVERVIEW (YA FILTRADOS POR FECHA) =====
  // El overview ya contiene las métricas del período seleccionado y las comparativas con el período anterior

  // Contar pedidos pendientes en el período seleccionado
  const pendingConfirmation = orders.filter(o => o.status === 'pending' && !o.confirmedByWhatsApp);

  // Contar pedidos en preparación en el período seleccionado
  const inPreparation = orders.filter(o => o.status === 'in_preparation');

  // Obtener el label correcto basado en el período seleccionado
  const getMetricLabel = (baseLabel: string) => {
    switch (selectedRange) {
      case 'today':
        return baseLabel.replace('Nuevos', 'del Día').replace('del Período', 'del Día');
      case '7d':
        return baseLabel.replace('Nuevos', 'de la Semana').replace('del Período', 'de la Semana');
      case '30d':
        return baseLabel.replace('Nuevos', 'del Mes').replace('del Período', 'del Mes');
      case 'custom':
        return baseLabel.replace('Nuevos', 'del Período').replace('del Día', 'del Período');
      default:
        return baseLabel;
    }
  };

  const metrics = [
    {
      label: getMetricLabel('Pedidos Nuevos'),
      value: overview.totalOrders,
      change: overview.changes?.totalOrders !== null ? overview.changes?.totalOrders : null,
      icon: ShoppingBag,
      trend: overview.changes?.totalOrders !== null ? (overview.changes.totalOrders >= 0 ? 'up' as const : 'down' as const) : undefined,
    },
    {
      label: getMetricLabel('Ventas del Período'),
      value: `Gs. ${overview.revenue.toLocaleString()}`,
      change: overview.changes?.revenue !== null ? overview.changes?.revenue : null,
      icon: DollarSign,
      trend: overview.changes?.revenue !== null ? (overview.changes.revenue >= 0 ? 'up' as const : 'down' as const) : undefined,
    },
    {
      label: 'Pendientes Confirmar',
      value: pendingConfirmation.length,
      change: null, // No tiene sentido comparar pendientes con período anterior
      icon: AlertTriangle,
      trend: undefined,
    },
    {
      label: 'En Preparación',
      value: inPreparation.length,
      change: null, // No tiene sentido comparar en preparación con período anterior
      icon: Package2,
      trend: undefined,
    },
  ];
  
  return (
    <Card className="p-6 bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">{getSummaryTitle()}</h3>
            <p className="text-sm text-muted-foreground">
              {selectedRange === 'custom'
                ? `${new Date(dateRange.startDate).toLocaleDateString('es-ES')} - ${new Date(dateRange.endDate).toLocaleDateString('es-ES')}`
                : new Date().toLocaleDateString('es-ES', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })
              }
            </p>
          </div>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              {isOpen ? 'Ocultar' : 'Ver detalles'}
              {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </Button>
          </CollapsibleTrigger>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {metrics.map((metric, i) => {
            const Icon = metric.icon;
            const shouldShowChange = metric.change !== null && metric.trend !== undefined &&
              (typeof metric.value === 'number' ? metric.value !== 0 : true);

            return (
              <div key={i} className="p-4 bg-card rounded-lg border">
                <div className="flex items-center justify-between mb-2">
                  <Icon size={20} className="text-primary" />
                  {shouldShowChange && (
                    <Badge
                      variant="outline"
                      className={metric.trend === 'up' ? 'text-green-600' : 'text-red-600'}
                    >
                      {metric.trend === 'up' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                      {Math.abs(metric.change!)}%
                    </Badge>
                  )}
                </div>
                <p className="text-2xl font-bold">{metric.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{metric.label}</p>
              </div>
            );
          })}
        </div>
        
        <CollapsibleContent className="mt-4">
          <div className="grid md:grid-cols-2 gap-4 pt-4 border-t">
            <div>
              <h4 className="font-semibold mb-2">Alertas Importantes</h4>
              <ul className="space-y-2 text-sm">
                {pendingConfirmation.length > 0 && (
                  <li className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-yellow-600 mt-0.5" />
                    <span>{pendingConfirmation.length} pedidos pendientes de confirmación</span>
                  </li>
                )}
                <li className="flex items-start gap-2">
                  <CheckCircle size={16} className="text-green-600 mt-0.5" />
                  <span>Tasa de entrega: {overview.deliveryRate}%</span>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Estado General</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Margen de Beneficio</span>
                  <span className="font-semibold">{overview.profitMargin}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Beneficio Neto</span>
                  <span className="font-semibold">Gs. {overview.netProfit.toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
