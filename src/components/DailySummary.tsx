import { useState, useEffect } from 'react';
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
  CheckCircle
} from 'lucide-react';
import { ordersService } from '@/services/orders.service';
import { analyticsService } from '@/services/analytics.service';
import type { Order, DashboardOverview } from '@/types';

export function DailySummary() {
  const [isOpen, setIsOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const [ordersData, overviewData] = await Promise.all([
          ordersService.getAll(),
          analyticsService.getOverview(),
        ]);
        setOrders(ordersData);
        setOverview(overviewData);
      } catch (error) {
        console.error('Error loading daily summary data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, []);

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

  // Calcular métricas del día y del día anterior
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const todayOrders = orders.filter(o => {
    const orderDate = new Date(o.date);
    orderDate.setHours(0, 0, 0, 0);
    return orderDate.getTime() === today.getTime();
  });

  const yesterdayOrders = orders.filter(o => {
    const orderDate = new Date(o.date);
    orderDate.setHours(0, 0, 0, 0);
    return orderDate.getTime() === yesterday.getTime();
  });

  const pendingConfirmation = orders.filter(o => o.status === 'pending' && !o.confirmedByWhatsApp);
  const todaySales = todayOrders.reduce((sum, o) => sum + o.total, 0);
  const yesterdaySales = yesterdayOrders.reduce((sum, o) => sum + o.total, 0);

  // Calcular cambios porcentuales
  const calculateChange = (current: number, previous: number): number | null => {
    if (previous === 0) return null;
    return parseFloat((((current - previous) / previous) * 100).toFixed(1));
  };

  const ordersChange = calculateChange(todayOrders.length, yesterdayOrders.length);
  const salesChange = calculateChange(todaySales, yesterdaySales);

  const metrics = [
    {
      label: 'Pedidos Nuevos',
      value: todayOrders.length,
      change: ordersChange,
      icon: ShoppingBag,
      trend: ordersChange !== null ? (ordersChange >= 0 ? 'up' as const : 'down' as const) : undefined,
    },
    {
      label: 'Ventas del Día',
      value: `Gs. ${todaySales.toLocaleString()}`,
      change: salesChange,
      icon: DollarSign,
      trend: salesChange !== null ? (salesChange >= 0 ? 'up' as const : 'down' as const) : undefined,
    },
    {
      label: 'Pendientes Confirmar',
      value: pendingConfirmation.length,
      change: null, // No tiene sentido comparar pendientes con día anterior
      icon: AlertTriangle,
      trend: undefined,
    },
    {
      label: 'ROAS Promedio',
      value: `${overview.roi}x`,
      change: overview.changes?.roi !== null ? overview.changes?.roi : null,
      icon: CheckCircle,
      trend: overview.changes?.roi !== null ? (overview.changes?.roi >= 0 ? 'up' as const : 'down' as const) : undefined,
    },
  ];
  
  return (
    <Card className="p-6 bg-gradient-to-r from-primary/10 to-primary/5 border-primary/20">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold">Resumen Ejecutivo del Día</h3>
            <p className="text-sm text-muted-foreground">
              {new Date().toLocaleDateString('es-ES', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              })}
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
