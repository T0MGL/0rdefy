/**
 * Card for a single pending-reconciliation order in /portal/conciliacion.
 *
 * Visually distinct from `OrderCard`:
 *   - Checkbox first (selection is the primary affordance)
 *   - Border-left lime brand when selected, muted when not
 *   - No tap-to-detail (the courier already worked this order)
 *   - Compact layout for high-density lists (12-20 orders typical)
 */

import { Coins, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/utils/currency';
import { Checkbox } from '@/components/ui/checkbox';
import type { PortalPendingSettlementOrder } from '@/services/portal.service';

interface PendingReconciliationCardProps {
  order: PortalPendingSettlementOrder;
  selected: boolean;
  onToggle: (orderId: string) => void;
}

function daysAgo(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  const diff = Date.now() - t;
  if (diff <= 0) return 0;
  return Math.floor(diff / 86_400_000);
}

export function PendingReconciliationCard({
  order,
  selected,
  onToggle,
}: PendingReconciliationCardProps) {
  const days = daysAgo(order.delivered_at);
  // Reconciliation is about cash to remit, not order value. For prepaid orders
  // the courier collected nothing at the door, so the displayed amount must
  // be 0 (not total_price). For COD it's whatever was actually collected.
  const amount = order.is_cod ? order.cod_amount || order.total_price : 0;

  return (
    <label
      htmlFor={`reconcile-${order.id}`}
      className={cn(
        'group flex cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm transition-colors',
        'hover:bg-accent/30',
      )}
    >
      <Checkbox
        id={`reconcile-${order.id}`}
        checked={selected}
        onCheckedChange={() => onToggle(order.id)}
        className="mt-0.5"
        aria-label={`Seleccionar ${order.display_order_number}`}
      />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">
                {order.customer_name || 'Sin nombre'}
              </span>
              <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
                {order.display_order_number}
              </span>
            </div>
            {(order.customer_address || order.customer_city) && (
              <p className="mt-0.5 line-clamp-1 break-words text-[11px] text-muted-foreground">
                {[order.customer_address, order.customer_city]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset tabular-nums',
              order.is_cod
                ? 'bg-primary/15 text-primary ring-primary/30'
                : 'bg-sky-50 text-sky-700 ring-sky-200/60 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/30',
            )}
          >
            <Coins className="h-3 w-3" strokeWidth={2} />
            {order.is_cod ? 'Cobrado' : 'Prepago · sin cobro'} {formatCurrency(amount)}
          </span>

          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" strokeWidth={2} />
            {days === 0 ? 'Hoy' : days === 1 ? 'Hace 1 día' : `Hace ${days} días`}
          </span>
        </div>
      </div>
    </label>
  );
}
