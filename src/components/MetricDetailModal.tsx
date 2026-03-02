import { useEffect, useState, useRef, useMemo } from 'react';
import { logger } from '@/utils/logger';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { ordersService } from '@/services/orders.service';
import { productsService } from '@/services/products.service';
import { carriersService } from '@/services/carriers.service';
import type { Order, Product, Carrier } from '@/types';
import { formatCurrency } from '@/utils/currency';

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
          <div className="h-48 bg-muted animate-pulse rounded" />
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 bg-muted animate-pulse rounded" />
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
            
            <div className="max-h-64 overflow-y-auto">
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
                      <td className="text-right p-2">{formatCurrency(o.total ?? 0)}</td>
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
              <BarChart data={carriers.slice(0, 5).map(c => ({
                name: c.carrier_name.slice(0, 15),
                rate: c.delivery_rate || 0
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
            <div className="grid gap-2 max-h-96 overflow-y-auto">
              {products.sort((a, b) => b.profitability - a.profitability).map(p => (
                <div key={p.id} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                  <div>
                    <p className="font-medium text-sm">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Ventas: {p.sales}
                    </p>
                  </div>
                  <Badge variant={p.profitability > 40 ? 'default' : 'secondary'}>
                    {p.profitability}%
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        );
        
      default:
        return <p className="text-muted-foreground">Detalles no disponibles</p>;
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
        </DialogHeader>
        {renderContent()}
      </DialogContent>
    </Dialog>
  );
}
