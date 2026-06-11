import { useEffect, useState, useRef, useMemo } from 'react';
import { logger } from '@/utils/logger';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogBody,
} from '@/components/ui/responsive-dialog';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ordersService } from '@/services/orders.service';
import { productsService } from '@/services/products.service';
import { carriersService } from '@/services/carriers.service';
import type { Order, Product } from '@/types';
import type { Carrier } from '@/services/carriers.service';
import { formatCurrency, formatCurrencyOrFallback } from '@/utils/currency';

interface MetricDetailModalProps {
  metric: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MetricDetailModal({ metric, open, onOpenChange }: MetricDetailModalProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();

    const loadData = async () => {
      setIsLoading(true);
      try {
        const [ordersResponse, productsData, carriersData] = await Promise.all([
          ordersService.getAll(),
          productsService.getAll(),
          carriersService.getAll(),
        ]);
        if (controller.signal.aborted || !isMountedRef.current) return;
        setOrders(ordersResponse.data || []);
        setProducts(productsData.data || []);
        setCarriers(carriersData);
      } catch (error) {
        if (controller.signal.aborted || !isMountedRef.current) return;
        logger.error('Error loading metric detail data:', error);
      } finally {
        if (!controller.signal.aborted && isMountedRef.current) setIsLoading(false);
      }
    };
    loadData();

    return () => {
      controller.abort();
    };
  }, [open]);

  // Aggregate orders by day for chart data (replaces Math.random)
  const ordersByDay = useMemo(() => {
    const dayMap: Record<string, number> = {};
    for (const o of orders) {
      const date = o.created_at ? new Date(o.created_at).toISOString().split('T')[0] : null;
      if (date) {
        dayMap[date] = (dayMap[date] || 0) + 1;
      }
    }
    return Object.entries(dayMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7)
      .map(([date, count]) => ({
        day: new Date(date + 'T12:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }),
        orders: count,
      }));
  }, [orders]);

  const renderContent = () => {
    if (isLoading) {
      return (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-lg" />
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        </div>
      );
    }
    switch (metric) {
      case 'orders':
        return (
          <div className="space-y-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={ordersByDay}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="orders" fill="hsl(84, 81%, 63%)" />
              </BarChart>
            </ResponsiveContainer>

            {/* Mobile: cards. Desktop: table. No horizontal scroll on mobile. */}
            <div className="space-y-2 lg:hidden">
              {orders.slice(0, 10).map(o => (
                <div
                  key={o.id}
                  className="flex items-center justify-between rounded-xl border border-border/40 bg-card p-3"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-[13px] font-semibold truncate">
                      {o.id.substring(0, 10)}
                    </p>
                    <p className="text-[15px] truncate">{o.customer}</p>
                  </div>
                  <span className="text-[15px] font-semibold tabular-nums shrink-0">
                    {formatCurrencyOrFallback(o.total, 'Sin datos')}
                  </span>
                </div>
              ))}
            </div>
            <div className="hidden lg:block max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left p-2">ID</th>
                    <th className="text-left p-2">Cliente</th>
                    <th className="text-right p-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.slice(0, 10).map(o => (
                    <tr key={o.id} className="border-b">
                      <td className="p-2 font-mono">{o.id}</td>
                      <td className="p-2">{o.customer}</td>
                      <td className="text-right p-2 tabular-nums">
                        {formatCurrencyOrFallback(o.total, 'Sin datos')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );

      case 'delivery':
        return (
          <div className="space-y-4">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={carriers
                .filter(c => c.delivery_rate != null && Number.isFinite(Number(c.delivery_rate)))
                .slice(0, 5)
                .map(c => ({
                  name: (c.carrier_name || c.name || 'Sin nombre').slice(0, 15),
                  rate: Number(c.delivery_rate),
                }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="rate" fill="hsl(142, 76%, 45%)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        );

      case 'margin':
        return (
          <div className="space-y-4">
            <div className="grid gap-2 max-h-[60vh] overflow-y-auto">
              {products.sort((a, b) => b.profitability - a.profitability).map(p => (
                <div
                  key={p.id}
                  className="flex items-center justify-between p-3 bg-muted/30 rounded-xl"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-[15px] truncate">{p.name}</p>
                    <p className="text-[13px] text-muted-foreground tabular-nums">
                      Ventas: {p.sales}
                    </p>
                  </div>
                  <Badge
                    variant={p.profitability > 40 ? 'default' : 'secondary'}
                    className="tabular-nums shrink-0"
                  >
                    {p.profitability}%
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        );

      default:
        return <p className="text-muted-foreground text-[15px]">Detalles no disponibles</p>;
    }
  };

  const getTitle = () => {
    switch (metric) {
      case 'orders': return 'Detalle de Pedidos';
      case 'delivery': return 'Tasa de Entrega por Transportadora';
      case 'margin': return 'Rentabilidad por Producto';
      default: return 'Detalles';
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopMaxWidth="max-w-3xl">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{getTitle()}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>{renderContent()}</ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
