/**
 * Compact order card for the courier portal lists.
 *
 * Tap surface is the entire card. Layout is mobile-first: name + chevron on
 * row 1, address on row 2, money chips on row 3, urgency cue on row 4.
 *
 * The card adapts to context via the `variant` prop:
 *   - 'active' shows days-in-transit + time-slot.
 *   - 'today'  shows the time + amount collected.
 *   - 'history' shows the final status badge.
 */

import { motion } from 'framer-motion';
import { ChevronRight, Clock, Coins, Truck, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/utils/currency';
import type { PortalOrder } from '@/services/portal.service';
import { OrderStatusBadge } from './OrderStatusBadge';

interface OrderCardProps {
  order: PortalOrder;
  variant?: 'active' | 'today' | 'history';
  onClick?: () => void;
  className?: string;
}

const TIME_SLOT_LABEL: Record<string, string> = {
  morning: 'Mañana',
  afternoon: 'Tarde',
  evening: 'Noche',
  any: 'Cualquier momento',
};

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-PY', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function daysCueClasses(days: number): string {
  if (days >= 7) return 'text-rose-600 dark:text-rose-400';
  if (days >= 3) return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}

export function OrderCard({
  order,
  variant = 'active',
  onClick,
  className,
}: OrderCardProps) {
  const isCod = order.is_cod;
  const slot = order.delivery_preferences?.preferred_time_slot;
  const slotLabel = slot ? TIME_SLOT_LABEL[slot] : null;

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 600, damping: 30 }}
      className={cn(
        'group relative w-full text-left',
        'rounded-2xl border border-border bg-card',
        'p-4 shadow-sm transition-colors',
        'hover:border-primary/40 hover:bg-accent/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className,
      )}
    >
      {/* Row 1: name + order number + chevron */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {order.customer_name || 'Sin nombre'}
            </span>
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              {order.display_order_number}
            </span>
          </div>

          {/* Row 2: address */}
          <div className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            <span className="line-clamp-1">
              {[order.customer_address, order.customer_city]
                .filter(Boolean)
                .join(' · ') || 'Sin dirección'}
            </span>
          </div>
        </div>

        <ChevronRight
          className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5"
          strokeWidth={2}
        />
      </div>

      {/* Row 3: money chips */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
            isCod
              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200/60 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30'
              : 'bg-sky-50 text-sky-700 ring-sky-200/60 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/30',
          )}
        >
          <Coins className="h-3 w-3" strokeWidth={2} />
          {isCod ? 'A cobrar' : 'Prepago'} {formatCurrency(order.total_price)}
        </span>

        {order.shipping_cost > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700 ring-1 ring-inset ring-violet-200/60 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-400/30">
            <Truck className="h-3 w-3" strokeWidth={2} />
            Flete {formatCurrency(order.shipping_cost)}
          </span>
        )}
      </div>

      {/* Row 4: variant-specific footer */}
      <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px]">
        {variant === 'active' && (
          <>
            <span className={cn('inline-flex items-center gap-1', daysCueClasses(order.days_in_transit))}>
              <Clock className="h-3 w-3" strokeWidth={2} />
              {order.days_in_transit === 0
                ? 'Recién despachada'
                : order.days_in_transit === 1
                  ? '1 día en tránsito'
                  : `${order.days_in_transit} días en tránsito`}
            </span>
            {slotLabel && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                {slotLabel}
              </span>
            )}
          </>
        )}

        {variant === 'today' && (
          <>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" strokeWidth={2} />
              Entregada {formatTime(order.delivered_at)}
            </span>
            <OrderStatusBadge status={order.sleeves_status} />
          </>
        )}

        {variant === 'history' && (
          <>
            <span className="text-muted-foreground">
              {order.delivered_at ? formatTime(order.delivered_at) : '—'}
            </span>
            <OrderStatusBadge status={order.sleeves_status} />
          </>
        )}
      </div>
    </motion.button>
  );
}
