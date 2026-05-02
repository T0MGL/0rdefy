/**
 * OrderMobileList
 *
 * Mobile card representation of orders. Replaces the wide horizontal table
 * on screens <lg. Tap a card to open OrderQuickView (existing pattern).
 *
 * Design: dense card with the 4 facts that matter most on mobile, mapped to
 * the same data model used by the desktop table:
 *   - Order number + status pill
 *   - Customer name + city
 *   - Product line summary
 *   - Total + payment indicator (COD vs paid)
 *
 * No row-level dropdowns: the QuickView sheet exposes status updates,
 * notes, and contact actions, which is the right pattern for one-handed use.
 */
import { memo } from 'react';
import { Check, MessageSquare, MapPin, Truck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/utils/currency';
import type { Order } from '@/types';

interface OrderMobileListProps {
  orders: Order[];
  selectedOrderIds: Set<string>;
  onToggleSelect: (orderId: string) => void;
  onOpenOrder: (order: Order) => void;
  isHighlighted?: (orderId: string) => boolean;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  contacted: 'Contactado',
  confirmed: 'Confirmado',
  in_preparation: 'En preparacion',
  ready_to_ship: 'Listo p/ envio',
  shipped: 'Enviado',
  in_transit: 'En camino',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
  returned: 'Devuelto',
  rejected: 'Rechazado',
};

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  contacted: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  confirmed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  in_preparation: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  ready_to_ship: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  shipped: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  in_transit: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  delivered: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  returned: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
};

function buildOrderNumber(order: Order): string {
  return (
    (order as any).shopify_order_name ||
    ((order as any).shopify_order_number ? `#${(order as any).shopify_order_number}` : null) ||
    ((order as any).shopify_order_id ? `SH#${(order as any).shopify_order_id}` : null) ||
    `OR#${order.id.substring(0, 8)}`
  );
}

function buildProductSummary(order: Order): string {
  const items = (order as any).line_items as
    | Array<{ product_name?: string; quantity?: number }>
    | undefined;
  if (Array.isArray(items) && items.length > 0) {
    const first = items[0];
    const name = first.product_name || 'Producto';
    if (items.length > 1) return `${name} +${items.length - 1}`;
    return `${first.quantity ?? 1}x ${name}`;
  }
  return (order as any).product || '-';
}

function isCODOrder(order: Order): boolean {
  const gateway = ((order as any).payment_gateway || '').toLowerCase();
  const method = ((order as any).payment_method || '').toLowerCase();
  const financial = ((order as any).financial_status || '').toLowerCase();
  const codAmount = Number((order as any).cod_amount ?? 0);
  return (
    gateway === 'cash_on_delivery' ||
    ['cash_on_delivery', 'cash', 'efectivo', 'cod'].includes(method) ||
    (codAmount > 0 && financial !== 'paid')
  );
}

const OrderMobileCard = memo(function OrderMobileCard({
  order,
  isSelected,
  isHighlighted,
  onToggleSelect,
  onOpenOrder,
}: {
  order: Order;
  isSelected: boolean;
  isHighlighted: boolean;
  onToggleSelect: (id: string) => void;
  onOpenOrder: (order: Order) => void;
}) {
  const isDeleted = !!(order as any).deleted_at;
  const isTest = !!(order as any).is_test;
  const orderNumber = buildOrderNumber(order);
  const status = (order as any).status as string;
  const statusLabel = STATUS_LABEL[status] || status;
  const statusTone = STATUS_TONE[status] || STATUS_TONE.pending;
  const cod = isCODOrder(order);
  const product = buildProductSummary(order);
  const total = (order as any).total_price ?? 0;
  const customer = (order as any).customer || '-';
  const city = (order as any).shipping_city || (order as any).city;
  const carrier = (order as any).carrier_name;
  const hasNotes = !!(order as any).has_internal_notes;

  const handleCardClick = () => {
    if (isDeleted) return;
    if ('vibrate' in navigator) navigator.vibrate?.(8);
    onOpenOrder(order);
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSelect(order.id);
  };

  return (
    <Card
      id={`item-${order.id}`}
      onClick={handleCardClick}
      className={cn(
        'p-3 active:scale-[0.99] transition-all cursor-pointer',
        'border border-border hover:border-primary/40',
        (isDeleted || isTest) && 'opacity-50',
        isHighlighted && 'ring-2 ring-yellow-400 dark:ring-yellow-500 bg-yellow-50/50 dark:bg-yellow-900/10',
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
      <div className="flex items-start gap-3">
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
                isSelected
                  ? 'bg-primary border-primary'
                  : 'border-muted-foreground/40',
              )}
            >
              {isSelected && <Check size={14} className="text-primary-foreground" />}
            </span>
          </button>
        )}

        <div className="flex-1 min-w-0">
          {/* Row 1: order # + status + total */}
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
            </div>
            <span className="text-sm font-semibold tabular-nums shrink-0">
              {formatCurrency(total)}
            </span>
          </div>

          {/* Row 2: customer + city */}
          <div className="mt-1 flex items-center gap-1.5 text-sm text-foreground min-w-0">
            <span className="truncate font-medium">{customer}</span>
            {city && (
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground shrink-0">
                <MapPin size={11} aria-hidden="true" />
                <span className="truncate max-w-[80px]">{city}</span>
              </span>
            )}
          </div>

          {/* Row 3: product + carrier */}
          <p className="mt-0.5 text-xs text-muted-foreground truncate">{product}</p>

          {/* Row 4: status + payment + carrier badges */}
          <div className="mt-2 flex items-center gap-1.5 flex-wrap">
            <Badge
              variant="outline"
              className={cn('text-[11px] py-0 px-1.5 border-0', statusTone)}
            >
              {statusLabel}
            </Badge>
            {cod ? (
              <Badge
                variant="outline"
                className="text-[11px] py-0 px-1.5 border-0 bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
              >
                COD
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="text-[11px] py-0 px-1.5 border-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              >
                Pagado
              </Badge>
            )}
            {carrier && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground">
                <Truck size={10} aria-hidden="true" />
                <span className="truncate max-w-[100px]">{carrier}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
});

export function OrderMobileList({
  orders,
  selectedOrderIds,
  onToggleSelect,
  onOpenOrder,
  isHighlighted,
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
          />
        </div>
      ))}
    </div>
  );
}
