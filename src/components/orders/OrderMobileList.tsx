/**
 * OrderMobileList
 *
 * Mobile card representation of orders. Replaces the wide horizontal table
 * on screens <lg. Tap empty area of a card to open OrderQuickView; the
 * status pill, carrier pill, and "Siguiente Paso" CTA are inline so
 * Gaston can operate the queue from a phone without ever leaving the list.
 *
 * Design: same data model and same handlers as the desktop table. We reuse
 * Select (radix-based) and CarrierQuickChangePopover, both touch-friendly.
 * Each interactive control stops propagation so taps never accidentally
 * open the QuickView sheet.
 */
import { memo, useCallback } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle,
  ChevronDown,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Package,
  PackageOpen,
  RefreshCw,
  RotateCcw,
  Star,
  Store,
  Truck,
  XCircle,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CarrierQuickChangePopover,
  isCarrierQuickChangeEligible,
} from '@/components/orders/CarrierQuickChangePopover';
import { cn } from '@/lib/utils';
import {
  isCancelled,
  isConfirmed,
  isPending,
  isReadyToShip,
  isStrictDelivered,
} from '@/lib/status';
import { formatCurrency } from '@/utils/currency';
import type { Order } from '@/types';

interface OrderMobileListProps {
  orders: Order[];
  selectedOrderIds: Set<string>;
  onToggleSelect: (orderId: string) => void;
  onOpenOrder: (order: Order) => void;
  isHighlighted?: (orderId: string) => boolean;

  // Inline operation handlers (same as desktop table)
  onStatusUpdate: (orderId: string, newStatus: Order['status']) => void;
  onQuickCarrierChange: (updatedOrder: Order) => void;
  onRequestFullAssign: (order: Order) => void;
  onQuickPrepare: (orderId: string) => void;
  onContact: (orderId: string, whatsappLink: string) => void;
  onReject: (orderId: string) => void;
  onConfirmOrder: (order: Order) => void;
  onAssignCarrier: (order: Order) => void;
  generateWhatsAppConfirmationLink: (order: Order) => string;
  generateWhatsAppFollowUpLink: (order: Order) => string;
  getCarrierName: (carrier?: string | null) => string | undefined;

  // Permission and feature gates
  canEditOrders: boolean;
  hasWarehouseFeature: boolean;
  userRole: string;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  contacted: 'Contactado',
  awaiting_carrier: 'Esperando',
  confirmed: 'Confirmado',
  in_preparation: 'En Preparación',
  ready_to_ship: 'Preparado',
  shipped: 'Despachado',
  in_transit: 'En Tránsito',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
  returned: 'Devuelto',
  rejected: 'Rechazado',
  incident: 'Incidencia',
};

// Same palette as desktop statusColors so visual identity is consistent.
const STATUS_TONE: Record<string, string> = {
  pending: 'bg-yellow-50 dark:bg-yellow-950/30 text-yellow-700 dark:text-yellow-400 border-yellow-300/60 dark:border-yellow-800',
  contacted: 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-300/60 dark:border-amber-800',
  awaiting_carrier: 'bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 border-orange-300/60 dark:border-orange-800',
  confirmed: 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-300/60 dark:border-blue-800',
  in_preparation: 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400 border-indigo-300/60 dark:border-indigo-800',
  ready_to_ship: 'bg-cyan-50 dark:bg-cyan-950/30 text-cyan-700 dark:text-cyan-400 border-cyan-300/60 dark:border-cyan-800',
  shipped: 'bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border-purple-300/60 dark:border-purple-800',
  in_transit: 'bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border-purple-300/60 dark:border-purple-800',
  delivered: 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-300/60 dark:border-green-800',
  returned: 'bg-gray-50 dark:bg-gray-950/30 text-gray-700 dark:text-gray-400 border-gray-300/60 dark:border-gray-800',
  cancelled: 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-300/60 dark:border-red-800',
  rejected: 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-300/60 dark:border-red-800',
  incident: 'bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 border-orange-300/60 dark:border-orange-800',
};

function buildOrderNumber(order: Order): string {
  return (
    order.shopify_order_name ||
    (order.shopify_order_number ? `#${order.shopify_order_number}` : null) ||
    (order.shopify_order_id ? `SH#${order.shopify_order_id}` : null) ||
    `OR#${order.id.substring(0, 8)}`
  );
}

function buildProductSummary(order: Order): string {
  const items = order.order_line_items;
  if (Array.isArray(items) && items.length > 0) {
    const first = items[0];
    const name = first.product_name || 'Producto';
    if (items.length > 1) return `${name} +${items.length - 1}`;
    return `${first.quantity ?? 1}x ${name}`;
  }
  return order.product || '-';
}

function isCODOrder(order: Order): boolean {
  const gateway = (order.payment_gateway || '').toLowerCase();
  const method = (order.payment_method || '').toLowerCase();
  const financial = (order.financial_status || '').toLowerCase();
  const codAmount = Number(order.cod_amount ?? 0);
  return (
    gateway === 'cash_on_delivery' ||
    ['cash_on_delivery', 'cash', 'efectivo', 'cod'].includes(method) ||
    (codAmount > 0 && financial !== 'paid')
  );
}

// Stop propagation utility: keeps the QuickView sheet from opening when the
// user taps on an inline control.
function stop(e: React.MouseEvent | React.PointerEvent | React.TouchEvent) {
  e.stopPropagation();
}

interface OrderMobileCardProps {
  order: Order;
  isSelected: boolean;
  isHighlighted: boolean;
  onToggleSelect: (id: string) => void;
  onOpenOrder: (order: Order) => void;
  onStatusUpdate: (orderId: string, newStatus: Order['status']) => void;
  onQuickCarrierChange: (updatedOrder: Order) => void;
  onRequestFullAssign: (order: Order) => void;
  onQuickPrepare: (orderId: string) => void;
  onContact: (orderId: string, whatsappLink: string) => void;
  onReject: (orderId: string) => void;
  onConfirmOrder: (order: Order) => void;
  onAssignCarrier: (order: Order) => void;
  generateWhatsAppConfirmationLink: (order: Order) => string;
  generateWhatsAppFollowUpLink: (order: Order) => string;
  getCarrierName: (carrier?: string | null) => string | undefined;
  canEditOrders: boolean;
  hasWarehouseFeature: boolean;
  userRole: string;
}

const OrderMobileCard = memo(function OrderMobileCard({
  order,
  isSelected,
  isHighlighted,
  onToggleSelect,
  onOpenOrder,
  onStatusUpdate,
  onQuickCarrierChange,
  onRequestFullAssign,
  onQuickPrepare,
  onContact,
  onReject,
  onConfirmOrder,
  onAssignCarrier,
  generateWhatsAppConfirmationLink,
  generateWhatsAppFollowUpLink,
  getCarrierName,
  canEditOrders,
  hasWarehouseFeature,
  userRole,
}: OrderMobileCardProps) {
  const isDeleted = !!order.deleted_at;
  const isTest = !!order.is_test;
  const orderNumber = buildOrderNumber(order);
  const status = order.status as string;
  const statusLabel = STATUS_LABEL[status] || status;
  const statusTone = STATUS_TONE[status] || STATUS_TONE.pending;
  const cod = isCODOrder(order);
  const productSummary = buildProductSummary(order);
  const total = order.total_price ?? order.total ?? 0;
  const customer = order.customer || '-';
  const city = order.shipping_city;
  const carrier = order.is_pickup
    ? 'Retiro en local'
    : (order.carrier_id ? (getCarrierName(order.carrier) || order.carrier || 'Sin asignar') : null);
  const hasNotes = !!order.has_internal_notes;

  const firstLineItem = order.order_line_items?.[0];
  const productImage = firstLineItem?.products?.image_url || firstLineItem?.image_url;
  const lineItemCount = order.order_line_items?.length ?? 0;

  const carrierEditable = canEditOrders && isCarrierQuickChangeEligible(order);
  const showAwaitingCarrierBadge =
    !order.is_pickup && isConfirmed(order.status) && !order.carrier_id;

  const handleCardClick = useCallback(() => {
    if (isDeleted) return;
    if ('vibrate' in navigator) navigator.vibrate?.(8);
    onOpenOrder(order);
  }, [isDeleted, onOpenOrder, order]);

  const handleCheckboxClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleSelect(order.id);
    },
    [onToggleSelect, order.id],
  );

  return (
    <Card
      id={`item-${order.id}`}
      onClick={handleCardClick}
      className={cn(
        'p-3 active:scale-[0.99] transition-all cursor-pointer',
        'border border-border hover:border-primary/40',
        (isDeleted || isTest) && 'opacity-60',
        isHighlighted &&
          'ring-2 ring-yellow-400 dark:ring-yellow-500 bg-yellow-50/50 dark:bg-yellow-900/10',
      )}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick();
        }
      }}
      aria-label={`Pedido ${orderNumber} de ${customer}, estado ${statusLabel}, total ${formatCurrency(total)}`}
    >
      <div className="flex items-start gap-2.5">
        {/* Selection checkbox */}
        {!isDeleted && (
          <button
            type="button"
            onClick={handleCheckboxClick}
            className="touch-target flex items-center justify-center -ml-1.5 -my-1 shrink-0"
            aria-label={isSelected ? 'Deseleccionar pedido' : 'Seleccionar pedido'}
            aria-pressed={isSelected}
          >
            <span
              className={cn(
                'h-5 w-5 rounded border-2 flex items-center justify-center transition-colors',
                isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/40',
              )}
            >
              {isSelected && <Check size={14} className="text-primary-foreground" />}
            </span>
          </button>
        )}

        {/* Product thumbnail */}
        <div className="shrink-0" onClick={stop}>
          {productImage ? (
            <div className="relative">
              <img
                src={productImage}
                alt={firstLineItem?.product_name || 'Producto'}
                loading="lazy"
                decoding="async"
                className="w-11 h-11 rounded-md object-cover border border-border"
              />
              {lineItemCount > 1 && (
                <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[10px] font-semibold rounded-full h-4 min-w-[16px] px-1 flex items-center justify-center">
                  +{lineItemCount - 1}
                </span>
              )}
            </div>
          ) : (
            <div className="w-11 h-11 rounded-md bg-muted border border-border flex items-center justify-center">
              <Package size={18} className="text-muted-foreground" aria-hidden="true" />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Row 1: order # + total */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-sm font-semibold truncate">{orderNumber}</span>
              {hasNotes && (
                <MessageSquare
                  size={12}
                  className="text-amber-500 shrink-0"
                  aria-label="Tiene notas internas"
                />
              )}
              {isDeleted && (
                <Badge
                  variant="outline"
                  className="text-[10px] py-0 px-1.5 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 border-red-300/60 dark:border-red-800"
                >
                  Eliminado
                </Badge>
              )}
              {isTest && !isDeleted && (
                <Badge
                  variant="outline"
                  className="text-[10px] py-0 px-1.5 bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 border-orange-300/60 dark:border-orange-800"
                >
                  Test
                </Badge>
              )}
            </div>
            <span className="text-sm font-semibold tabular-nums shrink-0">
              {formatCurrency(total)}
            </span>
          </div>

          {/* Row 2: customer + city */}
          <div className="mt-0.5 flex items-center gap-1.5 text-sm text-foreground min-w-0">
            <span className="truncate font-medium">{customer}</span>
            {city && (
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground shrink-0">
                <MapPin size={11} aria-hidden="true" />
                <span className="truncate max-w-[90px]">{city}</span>
              </span>
            )}
          </div>

          {/* Row 3: product summary */}
          <p className="mt-0.5 text-xs text-muted-foreground truncate">{productSummary}</p>

          {/* Row 4: status pill (clickable) + carrier pill (clickable) + COD badge */}
          <div
            className="mt-2 flex items-center gap-1.5 flex-wrap"
            onClick={stop}
          >
            {/* Status pill: opens native-feeling selector */}
            {canEditOrders && !isDeleted ? (
              <Select
                value={status}
                onValueChange={(newStatus) => {
                  onStatusUpdate(order.id, newStatus as Order['status']);
                }}
              >
                <SelectTrigger
                  onClick={stop}
                  onPointerDown={stop}
                  className={cn(
                    'h-7 px-2 py-0 text-[11px] font-medium gap-1 w-auto min-w-0 border',
                    statusTone,
                    'focus:ring-2 focus:ring-primary/30 focus:ring-offset-0',
                  )}
                  aria-label={`Estado actual: ${statusLabel}. Toca para cambiar.`}
                >
                  <span className="truncate">{statusLabel}</span>
                  <ChevronDown size={11} className="opacity-60 shrink-0" />
                </SelectTrigger>
                <SelectContent
                  className="min-w-[180px]"
                  onClick={stop}
                  onPointerDown={stop}
                >
                  <SelectItem value="pending">Pendiente</SelectItem>
                  <SelectItem value="contacted">Contactado</SelectItem>
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
            ) : (
              <Badge
                variant="outline"
                className={cn('text-[11px] py-0 px-1.5', statusTone)}
              >
                {statusLabel}
              </Badge>
            )}

            {/* Payment indicator */}
            {cod ? (
              <Badge
                variant="outline"
                className="text-[10px] py-0 px-1.5 border bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-300/60 dark:border-amber-800"
              >
                COD
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-[10px] py-0 px-1.5 border bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-300/60 dark:border-emerald-800"
              >
                Pagado
              </Badge>
            )}

            {/* Carrier pill: same popover as desktop, with stopPropagation wrapper */}
            {order.is_pickup ? (
              <span className="inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-300/60 dark:border-emerald-800">
                <Store size={11} aria-hidden="true" />
                Retiro
              </span>
            ) : showAwaitingCarrierBadge ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAssignCarrier(order);
                }}
                className="inline-flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-medium bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-300/60 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                aria-label="Asignar repartidor"
              >
                <AlertTriangle size={11} aria-hidden="true" />
                Asignar repartidor
              </button>
            ) : carrierEditable ? (
              <div onClick={stop} className="inline-flex items-center">
                <CarrierQuickChangePopover
                  order={order}
                  onChanged={onQuickCarrierChange}
                  onRequestFullAssign={onRequestFullAssign}
                />
              </div>
            ) : carrier ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Truck size={11} aria-hidden="true" />
                <span className="truncate max-w-[110px]">{carrier}</span>
              </span>
            ) : null}

            {/* Delivery rating (only for delivered orders that got rated) */}
            {isStrictDelivered(status) && order.delivery_rating && (
              <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 h-5 rounded-md bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-300/60 dark:border-amber-800">
                <Star size={10} className="fill-amber-500 text-amber-500" aria-hidden="true" />
                {order.delivery_rating}/5
              </span>
            )}
          </div>

          {/* Row 5: Siguiente Paso CTA. Visible only when there is a next step. */}
          {canEditOrders && !isDeleted && (
            <NextStepRow
              order={order}
              hasWarehouseFeature={hasWarehouseFeature}
              userRole={userRole}
              onStatusUpdate={onStatusUpdate}
              onQuickPrepare={onQuickPrepare}
              onContact={onContact}
              onReject={onReject}
              onConfirmOrder={onConfirmOrder}
              onAssignCarrier={onAssignCarrier}
              generateWhatsAppConfirmationLink={generateWhatsAppConfirmationLink}
              generateWhatsAppFollowUpLink={generateWhatsAppFollowUpLink}
            />
          )}
        </div>
      </div>
    </Card>
  );
});

interface NextStepRowProps {
  order: Order;
  hasWarehouseFeature: boolean;
  userRole: string;
  onStatusUpdate: (orderId: string, newStatus: Order['status']) => void;
  onQuickPrepare: (orderId: string) => void;
  onContact: (orderId: string, whatsappLink: string) => void;
  onReject: (orderId: string) => void;
  onConfirmOrder: (order: Order) => void;
  onAssignCarrier: (order: Order) => void;
  generateWhatsAppConfirmationLink: (order: Order) => string;
  generateWhatsAppFollowUpLink: (order: Order) => string;
}

function NextStepRow({
  order,
  hasWarehouseFeature,
  userRole,
  onStatusUpdate,
  onQuickPrepare,
  onContact,
  onReject,
  onConfirmOrder,
  onAssignCarrier,
  generateWhatsAppConfirmationLink,
  generateWhatsAppFollowUpLink,
}: NextStepRowProps) {
  const status = order.status as string;

  // Status that have no inline next-step on desktop -> render nothing on mobile.
  // 'contacted', 'awaiting_carrier', 'incident' are legacy pre-148c VARCHARs.
  const hasInlineCTA =
    isPending(status) ||
    status === 'contacted' ||
    status === 'awaiting_carrier' ||
    (isConfirmed(status) && hasWarehouseFeature) ||
    (isReadyToShip(status) && hasWarehouseFeature) ||
    isCancelled(status) ||
    status === 'incident';

  if (!hasInlineCTA) return null;

  return (
    <div
      className="mt-2 pt-2 border-t border-border/60 flex items-center gap-2"
      onClick={stop}
    >
      {isPending(status) && (
        <>
          <Button
            size="sm"
            variant="outline"
            className="h-9 flex-1 text-xs font-medium bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 border-green-300 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/30"
            onClick={(e) => {
              e.stopPropagation();
              onContact(order.id, generateWhatsAppConfirmationLink(order));
            }}
          >
            <MessageSquare size={14} className="mr-1.5" aria-hidden="true" />
            Enviar WhatsApp
          </Button>
          <NextStepMoreMenu
            items={[
              {
                key: 'confirm',
                label: 'Confirmar',
                icon: <CheckCircle size={14} className="mr-2" />,
                tone: 'text-blue-700 dark:text-blue-400',
                onSelect: () => onConfirmOrder(order),
              },
              {
                key: 'reject',
                label: 'Rechazar',
                icon: <XCircle size={14} className="mr-2" />,
                tone: 'text-red-600 dark:text-red-400',
                onSelect: () => onReject(order.id),
              },
            ]}
          />
        </>
      )}

      {status === 'contacted' && (
        <>
          <Button
            size="sm"
            variant="outline"
            className="h-9 flex-1 text-xs font-medium bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/30"
            onClick={(e) => {
              e.stopPropagation();
              onConfirmOrder(order);
            }}
          >
            <CheckCircle size={14} className="mr-1.5" aria-hidden="true" />
            Confirmar
          </Button>
          <NextStepMoreMenu
            items={[
              {
                key: 'resend',
                label: 'Re-enviar WhatsApp',
                icon: <MessageSquare size={14} className="mr-2" />,
                tone: 'text-amber-700 dark:text-amber-400',
                onSelect: () =>
                  window.open(generateWhatsAppFollowUpLink(order), '_blank'),
              },
              {
                key: 'reject',
                label: 'Rechazar',
                icon: <XCircle size={14} className="mr-2" />,
                tone: 'text-red-600 dark:text-red-400',
                onSelect: () => onReject(order.id),
              },
            ]}
          />
        </>
      )}

      {status === 'awaiting_carrier' && (
        <>
          {(userRole === 'owner' || userRole === 'admin') ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-9 flex-1 text-xs font-medium bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/30"
                onClick={(e) => {
                  e.stopPropagation();
                  onAssignCarrier(order);
                }}
              >
                <Truck size={14} className="mr-1.5" aria-hidden="true" />
                Asignar
              </Button>
              <NextStepMoreMenu
                items={[
                  {
                    key: 'reject',
                    label: 'Rechazar',
                    icon: <XCircle size={14} className="mr-2" />,
                    tone: 'text-red-600 dark:text-red-400',
                    onSelect: () => onReject(order.id),
                  },
                ]}
              />
            </>
          ) : (
            <Badge
              variant="outline"
              className="h-9 flex-1 inline-flex items-center justify-center text-xs font-medium bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 border-orange-300/60 dark:border-orange-800"
            >
              <Truck size={14} className="mr-1.5" aria-hidden="true" />
              Esperando
            </Badge>
          )}
        </>
      )}

      {isConfirmed(status) && hasWarehouseFeature && (
        <Button
          size="sm"
          variant="outline"
          className="h-9 flex-1 text-xs font-medium bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400 border-indigo-300 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/30"
          onClick={(e) => {
            e.stopPropagation();
            onQuickPrepare(order.id);
          }}
        >
          <PackageOpen size={14} className="mr-1.5" aria-hidden="true" />
          Preparar
        </Button>
      )}

      {isReadyToShip(status) && hasWarehouseFeature && (
        <Button
          size="sm"
          variant="outline"
          className="h-9 flex-1 text-xs font-medium bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-900/30"
          onClick={(e) => {
            e.stopPropagation();
            onStatusUpdate(order.id, 'shipped');
          }}
        >
          <Truck size={14} className="mr-1.5" aria-hidden="true" />
          Despachar
        </Button>
      )}

      {isCancelled(status) && (
        <Button
          size="sm"
          variant="outline"
          className="h-9 flex-1 text-xs font-medium bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/30"
          onClick={(e) => {
            e.stopPropagation();
            onStatusUpdate(order.id, 'pending');
          }}
        >
          <RefreshCw size={14} className="mr-1.5" aria-hidden="true" />
          Reactivar
        </Button>
      )}

      {status === 'incident' && (
        <Button
          size="sm"
          variant="outline"
          className="h-9 flex-1 text-xs font-medium bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-800 hover:bg-orange-100 dark:hover:bg-orange-900/30"
          onClick={(e) => {
            e.stopPropagation();
            window.location.href = `/incidents?order=${order.id}`;
          }}
        >
          <AlertTriangle size={14} className="mr-1.5" aria-hidden="true" />
          Ver Incidencia
        </Button>
      )}
    </div>
  );
}

interface NextStepMenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  tone?: string;
  onSelect: () => void;
}

function NextStepMoreMenu({ items }: { items: NextStepMenuItem[] }) {
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-9 w-9 p-0 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={stop}
          aria-label="Más acciones"
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48" onClick={stop}>
        {items.map((item) => (
          <DropdownMenuItem
            key={item.key}
            className={item.tone}
            onSelect={() => item.onSelect()}
          >
            {item.icon}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function OrderMobileList({
  orders,
  selectedOrderIds,
  onToggleSelect,
  onOpenOrder,
  isHighlighted,
  onStatusUpdate,
  onQuickCarrierChange,
  onRequestFullAssign,
  onQuickPrepare,
  onContact,
  onReject,
  onConfirmOrder,
  onAssignCarrier,
  generateWhatsAppConfirmationLink,
  generateWhatsAppFollowUpLink,
  getCarrierName,
  canEditOrders,
  hasWarehouseFeature,
  userRole,
}: OrderMobileListProps) {
  return (
    <div className="space-y-2" role="list" aria-label="Pedidos">
      {orders.map((order) => (
        <div role="listitem" key={order.id}>
          <OrderMobileCard
            order={order}
            isSelected={selectedOrderIds.has(order.id)}
            isHighlighted={isHighlighted ? isHighlighted(order.id) : false}
            onToggleSelect={onToggleSelect}
            onOpenOrder={onOpenOrder}
            onStatusUpdate={onStatusUpdate}
            onQuickCarrierChange={onQuickCarrierChange}
            onRequestFullAssign={onRequestFullAssign}
            onQuickPrepare={onQuickPrepare}
            onContact={onContact}
            onReject={onReject}
            onConfirmOrder={onConfirmOrder}
            onAssignCarrier={onAssignCarrier}
            generateWhatsAppConfirmationLink={generateWhatsAppConfirmationLink}
            generateWhatsAppFollowUpLink={generateWhatsAppFollowUpLink}
            getCarrierName={getCarrierName}
            canEditOrders={canEditOrders}
            hasWarehouseFeature={hasWarehouseFeature}
            userRole={userRole}
          />
        </div>
      ))}
    </div>
  );
}
