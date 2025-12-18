import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Calendar } from './ui/calendar';
import { useState, useEffect } from 'react';
import { ordersService } from '@/services/orders.service';
import { getOrderDisplayId } from '@/utils/orderDisplay';
import type { Order } from '@/types';

const statusColors = {
  pending: 'bg-yellow-500',
  confirmed: 'bg-blue-500',
  in_preparation: 'bg-indigo-500',
  ready_to_ship: 'bg-cyan-500',
  shipped: 'bg-purple-500',
  in_transit: 'bg-purple-500',
  delivered: 'bg-primary',
  returned: 'bg-gray-500',
  cancelled: 'bg-red-500',
  incident: 'bg-orange-500',
};

export function OrdersCalendar() {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadOrders = async () => {
      setIsLoading(true);
      try {
        const ordersData = await ordersService.getAll();
        setOrders(ordersData);
      } catch (error) {
        console.error('Error loading orders:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadOrders();
  }, []);

  // Agrupar pedidos por fecha
  const ordersByDate = orders.reduce((acc, order) => {
    const date = new Date(order.date).toDateString();
    if (!acc[date]) acc[date] = [];
    acc[date].push(order);
    return acc;
  }, {} as Record<string, Order[]>);

  const selectedDateOrders = selectedDate
    ? ordersByDate[selectedDate.toDateString()] || []
    : [];

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-6 lg:col-span-2">
          <div className="h-6 w-48 bg-muted animate-pulse rounded mb-4" />
          <div className="h-80 bg-muted animate-pulse rounded" />
        </Card>
        <Card className="p-6">
          <div className="h-6 w-32 bg-muted animate-pulse rounded mb-4" />
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 bg-muted animate-pulse rounded" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Calendario */}
      <Card className="p-6 lg:col-span-2">
        <h3 className="text-lg font-semibold mb-4">Calendario de Pedidos</h3>
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={setSelectedDate}
          className="rounded-md border"
          modifiers={{
            hasOrders: (date) => {
              return !!ordersByDate[date.toDateString()];
            },
          }}
          modifiersClassNames={{
            hasOrders: 'bg-primary/10 font-bold',
          }}
        />
        <div className="mt-4 flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-primary" />
            <span className="text-muted-foreground">Días con pedidos</span>
          </div>
        </div>
      </Card>

      {/* Lista de pedidos del día seleccionado */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">
          {selectedDate
            ? selectedDate.toLocaleDateString('es-ES', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })
            : 'Selecciona una fecha'}
        </h3>
        {selectedDateOrders.length > 0 ? (
          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {selectedDateOrders.map((order) => (
              <div
                key={order.id}
                className="p-3 border border-border rounded-lg hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium">
                      {getOrderDisplayId(order)}
                    </span>
                    {order.shopify_order_id && (
                      <Badge
                        variant="outline"
                        className="bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-800 text-xs px-1.5 py-0"
                      >
                        Shopify
                      </Badge>
                    )}
                  </div>
                  <div className={`w-2 h-2 rounded-full ${statusColors[order.status]}`} />
                </div>
                <p className="text-sm font-medium">{order.customer}</p>
                <p className="text-xs text-muted-foreground truncate">{order.product}</p>
                <p className="text-sm font-semibold mt-2">
                  Gs. {(order.total ?? 0).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">
            No hay pedidos para esta fecha
          </p>
        )}
      </Card>
    </div>
  );
}
