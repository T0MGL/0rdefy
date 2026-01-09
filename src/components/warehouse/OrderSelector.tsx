/**
 * OrderSelector Component
 * Improved order cards for the selection phase with order numbers as protagonists
 */

import { useState, useMemo } from 'react';
import { Package, User, MapPin, Phone, Search, CheckSquare, Square, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { ConfirmedOrder } from '@/services/warehouse.service';

interface OrderSelectorProps {
  orders: ConfirmedOrder[];
  selectedIds: Set<string>;
  onToggleOrder: (orderId: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onStartSession: () => void;
  loading?: boolean;
  actionLoading?: boolean;
}

export function OrderSelector({
  orders,
  selectedIds,
  onToggleOrder,
  onSelectAll,
  onClearSelection,
  onStartSession,
  loading,
  actionLoading,
}: OrderSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Filter orders based on search
  const filteredOrders = useMemo(() => {
    if (!searchQuery.trim()) return orders;

    const query = searchQuery.toLowerCase();
    return orders.filter(order =>
      order.order_number.toLowerCase().includes(query) ||
      order.customer_name.toLowerCase().includes(query) ||
      order.customer_phone?.includes(query)
    );
  }, [orders, searchQuery]);

  const allSelected = filteredOrders.length > 0 && filteredOrders.every(o => selectedIds.has(o.id));
  const someSelected = filteredOrders.some(o => selectedIds.has(o.id));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Cargando pedidos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search and Actions Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por # orden, cliente o tel..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={allSelected ? onClearSelection : onSelectAll}
          className="gap-2"
        >
          {allSelected ? (
            <>
              <Square className="h-4 w-4" />
              Deseleccionar Todo
            </>
          ) : (
            <>
              <CheckSquare className="h-4 w-4" />
              Seleccionar Todo ({filteredOrders.length})
            </>
          )}
        </Button>
      </div>

      {/* Orders Grid */}
      {filteredOrders.length === 0 ? (
        <div className="text-center py-12">
          <Package className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-semibold mb-2">
            {orders.length === 0 ? 'No hay pedidos confirmados' : 'No se encontraron pedidos'}
          </h3>
          <p className="text-muted-foreground">
            {orders.length === 0
              ? 'Los pedidos confirmados aparecerán aquí para preparar'
              : 'Intenta con otros términos de búsqueda'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredOrders.map(order => {
            const isSelected = selectedIds.has(order.id);

            return (
              <Card
                key={order.id}
                className={cn(
                  'p-4 cursor-pointer transition-all hover:shadow-md',
                  isSelected
                    ? 'border-primary border-2 bg-primary/5 shadow-md'
                    : 'hover:border-primary/50'
                )}
                onClick={() => onToggleOrder(order.id)}
              >
                {/* Header with Order Number */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => onToggleOrder(order.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-5 w-5"
                    />
                    <div>
                      <h3 className="text-xl font-bold text-primary">
                        #{order.order_number}
                      </h3>
                      <Badge variant="outline" className="mt-1 text-xs">
                        {order.total_items} producto{order.total_items !== 1 ? 's' : ''}
                      </Badge>
                    </div>
                  </div>

                  {isSelected && (
                    <div className="bg-primary text-primary-foreground rounded-full p-1">
                      <CheckSquare className="h-4 w-4" />
                    </div>
                  )}
                </div>

                {/* Customer Info */}
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <User className="h-4 w-4 flex-shrink-0" />
                    <span className="truncate font-medium text-foreground">
                      {order.customer_name}
                    </span>
                  </div>

                  {order.customer_phone && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate">{order.customer_phone}</span>
                    </div>
                  )}

                  {order.carrier_name && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <MapPin className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate">{order.carrier_name}</span>
                    </div>
                  )}
                </div>

                {/* Date */}
                <div className="mt-3 pt-3 border-t">
                  <p className="text-xs text-muted-foreground">
                    {new Date(order.created_at).toLocaleDateString('es-ES', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Floating Action Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <Card className="px-6 py-4 shadow-xl border-primary/20 bg-card/95 backdrop-blur-sm">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="bg-primary text-primary-foreground rounded-full w-8 h-8 flex items-center justify-center font-bold">
                  {selectedIds.size}
                </div>
                <span className="text-sm font-medium">
                  pedido{selectedIds.size !== 1 ? 's' : ''} seleccionado{selectedIds.size !== 1 ? 's' : ''}
                </span>
              </div>

              <Button
                onClick={onStartSession}
                disabled={actionLoading}
                size="lg"
                className="gap-2"
              >
                {actionLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creando...
                  </>
                ) : (
                  <>
                    <Package className="h-4 w-4" />
                    Iniciar Preparación
                  </>
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
