import { Order } from '@/types';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Phone, MessageCircle, Eye, MapPin, Package, Calendar, Truck } from 'lucide-react';
import { useState, useEffect } from 'react';

// Helper function to calculate relative time
function getRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Hace un momento';
  if (diffMins < 60) return `Hace ${diffMins} min`;
  if (diffHours < 24) return `Hace ${diffHours} hora${diffHours > 1 ? 's' : ''}`;
  if (diffDays === 1) return 'Hace 1 día';
  if (diffDays < 7) return `Hace ${diffDays} días`;

  // More than a week, show formatted date
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

interface OrderQuickViewProps {
  order: Order | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusUpdate?: (orderId: string, newStatus: Order['status']) => Promise<void>;
}

const statusColors = {
  pending: 'bg-yellow-500/20 text-yellow-700 border-yellow-500/30',
  confirmed: 'bg-blue-500/20 text-blue-700 border-blue-500/30',
  preparing: 'bg-indigo-500/20 text-indigo-700 border-indigo-500/30',
  out_for_delivery: 'bg-purple-500/20 text-purple-700 border-purple-500/30',
  delivered: 'bg-primary/20 text-primary border-primary/30',
  delivery_failed: 'bg-orange-500/20 text-orange-700 border-orange-500/30',
  rejected: 'bg-red-500/20 text-red-700 border-red-500/30',
  cancelled: 'bg-red-500/20 text-red-700 border-red-500/30',
};

const statusLabels = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  preparing: 'Preparando',
  out_for_delivery: 'En Tránsito',
  delivered: 'Entregado',
  delivery_failed: 'Entrega Fallida',
  rejected: 'Rechazado',
  cancelled: 'Cancelado',
};

export function OrderQuickView({ order, open, onOpenChange, onStatusUpdate }: OrderQuickViewProps) {
  const [currentStatus, setCurrentStatus] = useState<Order['status']>(order?.status || 'pending');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (order) {
      setCurrentStatus(order.status);
    }
  }, [order]);

  const handleSaveStatus = async () => {
    if (!order || !onStatusUpdate || currentStatus === order.status) return;

    setIsSaving(true);
    try {
      await onStatusUpdate(order.id, currentStatus);
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating status:', error);
      setCurrentStatus(order.status); // Revert on error
    } finally {
      setIsSaving(false);
    }
  };

  if (!order) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between">
            <span>Pedido {order.id}</span>
            <Badge variant="outline" className={statusColors[currentStatus]}>
              {statusLabels[currentStatus]}
            </Badge>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Cliente */}
          <div className="space-y-3">
            <h4 className="font-semibold text-sm text-muted-foreground">CLIENTE</h4>
            <div className="space-y-2">
              <p className="font-medium">{order.customer}</p>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Phone size={14} />
                <span>{order.phone}</span>
              </div>
              {order.address && (
                <div className="flex items-start gap-2 text-sm text-muted-foreground mt-2">
                  <MapPin size={14} className="mt-0.5 flex-shrink-0" />
                  <span>{order.address}</span>
                </div>
              )}
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    const cleanPhone = order.phone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
                    window.location.href = `tel:${cleanPhone}`;
                  }}
                >
                  <Phone size={14} className="mr-2" />
                  Llamar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    const cleanPhone = order.phone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
                    // Ensure phone has + prefix for international format
                    const whatsappNumber = cleanPhone.startsWith('+') ? cleanPhone : `+${cleanPhone}`;
                    window.open(`https://wa.me/${whatsappNumber}`, '_blank');
                  }}
                >
                  <MessageCircle size={14} className="mr-2" />
                  WhatsApp
                </Button>
              </div>
            </div>
          </div>

          {/* Producto */}
          <div className="space-y-3">
            <h4 className="font-semibold text-sm text-muted-foreground">PRODUCTO</h4>
            <div className="flex items-center gap-4 p-3 bg-muted rounded-lg">
              <div className="w-16 h-16 bg-background rounded flex items-center justify-center">
                <Package className="text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="font-medium">{order.product}</p>
                <p className="text-sm text-muted-foreground">Cantidad: {order.quantity}</p>
                <p className="text-sm font-semibold mt-1">Gs. {order.total.toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* Envío */}
          <div className="space-y-3">
            <h4 className="font-semibold text-sm text-muted-foreground">ENVÍO</h4>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Truck size={14} className="text-muted-foreground" />
                <span className="font-medium">{order.carrier}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar size={14} />
                <span>{new Date(order.date).toLocaleDateString('es-ES')}</span>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="space-y-3">
            <h4 className="font-semibold text-sm text-muted-foreground">TIMELINE</h4>
            <div className="space-y-4 pl-4 border-l-2 border-primary/30">
              <div className="relative">
                <div className="absolute -left-[21px] w-3 h-3 rounded-full bg-primary" />
                <div className="text-sm">
                  <p className="font-medium">Pedido creado</p>
                  <p className="text-xs text-muted-foreground">{getRelativeTime(order.date)}</p>
                </div>
              </div>
              {currentStatus !== 'pending' && currentStatus !== 'pending_confirmation' && (
                <div className="relative">
                  <div className="absolute -left-[21px] w-3 h-3 rounded-full bg-primary" />
                  <div className="text-sm">
                    <p className="font-medium">Confirmado</p>
                    <p className="text-xs text-muted-foreground">
                      {(order as any).confirmationTimestamp
                        ? getRelativeTime((order as any).confirmationTimestamp)
                        : 'Sin fecha'}
                    </p>
                  </div>
                </div>
              )}
              {(currentStatus === 'out_for_delivery' || currentStatus === 'in_transit' || currentStatus === 'delivered' || currentStatus === 'delivery_failed' || currentStatus === 'not_delivered') && (
                <div className="relative">
                  <div className="absolute -left-[21px] w-3 h-3 rounded-full bg-primary" />
                  <div className="text-sm">
                    <p className="font-medium">En tránsito</p>
                    <p className="text-xs text-muted-foreground">
                      {(order as any).inTransitTimestamp
                        ? getRelativeTime((order as any).inTransitTimestamp)
                        : (order as any).confirmationTimestamp
                        ? getRelativeTime((order as any).confirmationTimestamp)
                        : 'En proceso'}
                    </p>
                  </div>
                </div>
              )}
              {currentStatus === 'delivered' && (
                <div className="relative">
                  <div className="absolute -left-[21px] w-3 h-3 rounded-full bg-primary" />
                  <div className="text-sm">
                    <p className="font-medium">Entregado</p>
                    <p className="text-xs text-muted-foreground">
                      {(order as any).deliveredTimestamp
                        ? getRelativeTime((order as any).deliveredTimestamp)
                        : 'Recientemente'}
                    </p>
                  </div>
                </div>
              )}
              {(currentStatus === 'cancelled' || currentStatus === 'rejected') && (
                <div className="relative">
                  <div className="absolute -left-[21px] w-3 h-3 rounded-full bg-red-500" />
                  <div className="text-sm">
                    <p className="font-medium">{currentStatus === 'cancelled' ? 'Cancelado' : 'Rechazado'}</p>
                    <p className="text-xs text-muted-foreground">
                      {(order as any).cancelledTimestamp
                        ? getRelativeTime((order as any).cancelledTimestamp)
                        : 'Sin fecha'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Acciones */}
          <div className="space-y-3 pt-4 border-t">
            <h4 className="font-semibold text-sm text-muted-foreground">CAMBIAR ESTADO</h4>
            <Select value={currentStatus} onValueChange={(value) => setCurrentStatus(value as Order['status'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pendiente</SelectItem>
                <SelectItem value="confirmed">Confirmado</SelectItem>
                <SelectItem value="preparing">Preparando</SelectItem>
                <SelectItem value="out_for_delivery">En Tránsito</SelectItem>
                <SelectItem value="delivered">Entregado</SelectItem>
                <SelectItem value="delivery_failed">Entrega Fallida</SelectItem>
                <SelectItem value="rejected">Rechazado</SelectItem>
                <SelectItem value="cancelled">Cancelado</SelectItem>
              </SelectContent>
            </Select>
            <Button
              className="w-full"
              onClick={handleSaveStatus}
              disabled={isSaving || currentStatus === order.status}
            >
              {isSaving ? 'Guardando...' : 'Guardar Cambios'}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
