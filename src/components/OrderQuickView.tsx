import { Order } from '@/types';
import { logger } from '@/utils/logger';
import { formatCurrency } from '@/utils/currency';
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
import { Phone, MessageCircle, Eye, MapPin, Package, Calendar, Truck, ExternalLink, Star } from 'lucide-react';
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
  in_preparation: 'bg-indigo-500/20 text-indigo-700 border-indigo-500/30',
  ready_to_ship: 'bg-cyan-500/20 text-cyan-700 border-cyan-500/30',
  shipped: 'bg-purple-500/20 text-purple-700 border-purple-500/30',
  in_transit: 'bg-purple-500/20 text-purple-700 border-purple-500/30',
  delivered: 'bg-primary/20 text-primary border-primary/30',
  returned: 'bg-gray-500/20 text-gray-700 border-gray-500/30',
  cancelled: 'bg-red-500/20 text-red-700 border-red-500/30',
  incident: 'bg-orange-500/20 text-orange-700 border-orange-500/30',
  // Estados legacy
  preparing: 'bg-indigo-500/20 text-indigo-700 border-indigo-500/30',
  out_for_delivery: 'bg-purple-500/20 text-purple-700 border-purple-500/30',
  delivery_failed: 'bg-orange-500/20 text-orange-700 border-orange-500/30',
  rejected: 'bg-red-500/20 text-red-700 border-red-500/30',
};

const statusLabels = {
  pending: 'Pendiente',
  confirmed: 'Confirmado',
  in_preparation: 'En Preparación',
  ready_to_ship: 'Preparado',
  shipped: 'En Tránsito',
  in_transit: 'En Tránsito',
  delivered: 'Entregado',
  returned: 'Devuelto',
  cancelled: 'Cancelado',
  incident: 'Incidencia',
  // Estados legacy
  preparing: 'Preparando',
  out_for_delivery: 'En Tránsito',
  delivery_failed: 'Entrega Fallida',
  rejected: 'Rechazado',
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
      logger.error('Error updating status:', error);
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
            <div className="flex items-center gap-2">
              <span>
                Pedido {order.shopify_order_name ||
                        (order.shopify_order_number ? `#${order.shopify_order_number}` : null) ||
                        (order.shopify_order_id ? `SH#${order.shopify_order_id}` : null) ||
                        `OR#${order.id.substring(0, 8)}`}
              </span>
              {order.shopify_order_id && (
                <Badge
                  variant="outline"
                  className="bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-800 text-xs"
                >
                  Shopify
                </Badge>
              )}
            </div>
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
              {(order.address || order.google_maps_link) && (
                <div className="flex items-start gap-2 text-sm text-muted-foreground mt-2">
                  <MapPin size={14} className="mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    {order.address && <span>{order.address}</span>}
                    {order.google_maps_link && (
                      <a
                        href={order.google_maps_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-primary hover:underline mt-1"
                      >
                        <ExternalLink size={12} />
                        Ver ubicación en Google Maps
                      </a>
                    )}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2 mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 min-w-[100px]"
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
                  className="flex-1 min-w-[100px]"
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
                {order.google_maps_link && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 min-w-[100px]"
                    onClick={() => window.open(order.google_maps_link, '_blank')}
                  >
                    <MapPin size={14} className="mr-2" />
                    Ver Mapa
                  </Button>
                )}
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
                <p className="text-sm font-semibold mt-1">{formatCurrency(order.total ?? 0)}</p>
              </div>
            </div>
          </div>

          {/* Pago */}
          <div className="space-y-3">
            <h4 className="font-semibold text-sm text-muted-foreground">PAGO</h4>
            <div className="p-3 bg-muted rounded-lg space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Total del Pedido:</span>
                <span className="text-lg font-bold">{formatCurrency(order.total ?? 0)}</span>
              </div>
              {order.payment_gateway && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Gateway:</span>
                  <Badge variant="outline" className="text-xs">
                    {order.payment_gateway === 'shopify_payments' ? 'Shopify Payments' :
                     order.payment_gateway === 'manual' ? 'Manual' :
                     order.payment_gateway === 'cash_on_delivery' ? 'Contra Entrega' :
                     order.payment_gateway === 'paypal' ? 'PayPal' :
                     order.payment_gateway === 'mercadopago' ? 'MercadoPago' :
                     order.payment_gateway}
                  </Badge>
                </div>
              )}
              {order.payment_method && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Método de Pago:</span>
                  <span className="text-sm font-medium capitalize">{order.payment_method}</span>
                </div>
              )}
              {order.cod_amount && order.cod_amount > 0 && (
                <div className="flex justify-between items-center pt-2 border-t border-border">
                  <span className="text-sm text-muted-foreground">Monto a Cobrar (COD):</span>
                  <span className="text-lg font-bold text-green-600 dark:text-green-400">
                    {formatCurrency(order.cod_amount)}
                  </span>
                </div>
              )}
              {order.has_amount_discrepancy && order.amount_collected !== undefined && (
                <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="h-4 w-4 text-orange-600 dark:text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span className="text-sm font-semibold text-orange-700 dark:text-orange-400">Monto Diferente Cobrado</span>
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Esperado:</span>
                      <span>{formatCurrency(order.cod_amount ?? order.total ?? 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Cobrado:</span>
                      <span className="font-semibold text-orange-700 dark:text-orange-400">{formatCurrency(order.amount_collected)}</span>
                    </div>
                    <div className="flex justify-between pt-1 border-t border-orange-200 dark:border-orange-700">
                      <span className="text-muted-foreground">Diferencia:</span>
                      <span className={`font-bold ${order.amount_collected - (order.cod_amount ?? order.total ?? 0) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {order.amount_collected - (order.cod_amount ?? order.total ?? 0) > 0 ? '+' : ''}{formatCurrency(order.amount_collected - (order.cod_amount ?? order.total ?? 0))}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              {order.payment_status && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Estado de Pago:</span>
                  <Badge variant="outline" className={
                    order.payment_status === 'collected' ? 'bg-green-50 text-green-700 border-green-300' :
                    order.payment_status === 'failed' ? 'bg-red-50 text-red-700 border-red-300' :
                    'bg-yellow-50 text-yellow-700 border-yellow-300'
                  }>
                    {order.payment_status === 'collected' ? 'Cobrado' :
                     order.payment_status === 'failed' ? 'Fallido' :
                     'Pendiente'}
                  </Badge>
                </div>
              )}
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
              {/* Método de envío de Shopify */}
              {order.shopify_shipping_method && (
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="outline" className="bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800 text-xs">
                    {order.shopify_shipping_method}
                  </Badge>
                </div>
              )}
              {/* Ciudad de destino */}
              {order.shipping_city && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPin size={14} />
                  <span>{order.shipping_city}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar size={14} />
                <span>{new Date(order.date).toLocaleDateString('es-ES')}</span>
              </div>
              {order.courier_notes && (
                <div className="mt-3 p-3 bg-muted rounded-lg">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">NOTAS DEL TRANSPORTISTA:</p>
                  <p className="text-sm">{order.courier_notes}</p>
                </div>
              )}
              {order.delivery_failure_reason && (
                <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-800">
                  <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1">MOTIVO DE FALLA:</p>
                  <p className="text-sm text-red-900 dark:text-red-300">{order.delivery_failure_reason}</p>
                </div>
              )}
            </div>
          </div>

          {/* Notas Internas (Admin) */}
          {order.internal_notes && (
            <div className="space-y-3">
              <h4 className="font-semibold text-sm text-muted-foreground">NOTAS INTERNAS</h4>
              <div className="p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800/30 border-dashed">
                <p className="text-sm whitespace-pre-wrap text-amber-900 dark:text-amber-200">{order.internal_notes}</p>
              </div>
            </div>
          )}

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
              {currentStatus !== 'pending' && (
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
              {(currentStatus === 'shipped' || currentStatus === 'in_transit' || currentStatus === 'delivered') && (
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

          {/* Calificación del Cliente */}
          {order.delivery_rating && (
            <div className="space-y-3">
              <h4 className="font-semibold text-sm text-muted-foreground">CALIFICACIÓN DEL CLIENTE</h4>
              <div className="p-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800/30">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        size={18}
                        className={star <= order.delivery_rating! ? 'fill-amber-500 text-amber-500' : 'text-gray-300'}
                      />
                    ))}
                  </div>
                  <span className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                    {order.delivery_rating}/5
                  </span>
                </div>
                {order.delivery_rating_comment && (
                  <div className="mt-3 pt-3 border-t border-amber-200 dark:border-amber-700/50">
                    <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 mb-1">Comentario:</p>
                    <p className="text-sm text-amber-900 dark:text-amber-200 italic">
                      "{order.delivery_rating_comment}"
                    </p>
                  </div>
                )}
                {order.rated_at && (
                  <p className="text-xs text-amber-600 dark:text-amber-400/70 mt-2">
                    Calificado {getRelativeTime(order.rated_at)}
                  </p>
                )}
              </div>
            </div>
          )}

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
                <SelectItem value="in_preparation">En Preparación</SelectItem>
                <SelectItem value="ready_to_ship">Preparado</SelectItem>
                <SelectItem value="shipped">En Tránsito</SelectItem>
                <SelectItem value="delivered">Entregado</SelectItem>
                <SelectItem value="returned">Devuelto</SelectItem>
                <SelectItem value="cancelled">Cancelado</SelectItem>
                <SelectItem value="incident">Incidencia</SelectItem>
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
