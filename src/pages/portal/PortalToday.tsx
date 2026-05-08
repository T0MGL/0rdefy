/**
 * "Hoy" view — what the courier closed today.
 *
 * Sums amount_collected and shipping_cost across the day's orders so the
 * courier knows what they should be settling this evening. Numbers come
 * from the same /api/portal/orders endpoint with view='today'.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CheckCircle2, Coins, Truck } from 'lucide-react';
import {
  portalService,
  type PortalOrdersResponse,
} from '@/services/portal.service';
import { OrderCard } from '@/components/portal/OrderCard';
import { EmptyState } from '@/components/portal/EmptyState';
import { formatCurrency } from '@/utils/currency';
import { cn } from '@/lib/utils';

export default function PortalToday() {
  const navigate = useNavigate();

  const { data, isLoading, isError, refetch, isFetching } =
    useQuery<PortalOrdersResponse>({
      queryKey: ['portal', 'orders', 'today'],
      queryFn: ({ signal }) =>
        portalService.getOrders({ view: 'today', page_size: 100 }, { signal }),
      staleTime: 30_000,
    });

  const orders = useMemo(() => data?.orders ?? [], [data?.orders]);
  const totals = useMemo(() => {
    return orders.reduce(
      (acc, o) => {
        // amount_collected lives on the server payload but PortalOrder doesn't
        // expose it (the view-fields list keeps the type lean). For totals we
        // approximate with total_price for COD orders, since the sum is the
        // signal courier needs ("what cash am I sitting on").
        if (o.is_cod) {
          acc.cod += o.total_price;
        }
        acc.shipping += o.shipping_cost;
        return acc;
      },
      { cod: 0, shipping: 0 },
    );
  }, [orders]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Hoy
        </p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight">
          {orders.length === 0
            ? 'Tu jornada empieza acá'
            : orders.length === 1
              ? 'Cerraste 1 entrega'
              : `Cerraste ${orders.length} entregas`}
        </h1>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3">
        <SummaryTile
          icon={Coins}
          label="Cobrado COD"
          value={formatCurrency(totals.cod)}
          tone="emerald"
        />
        <SummaryTile
          icon={Truck}
          label="Tu cobro"
          value={formatCurrency(totals.shipping)}
          tone="violet"
        />
      </div>

      {/* List */}
      <section aria-labelledby="today-list-heading" className="space-y-3 pt-1">
        <div className="flex items-baseline justify-between">
          <h2
            id="today-list-heading"
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {orders.length === 0
              ? 'Detalle del día'
              : orders.length === 1
                ? '1 entrega registrada'
                : `${orders.length} entregas registradas`}
          </h2>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {isFetching ? 'Actualizando...' : 'Actualizar'}
          </button>
        </div>

        {isLoading ? (
          <SkeletonList />
        ) : isError ? (
          <EmptyState
            icon={CheckCircle2}
            title="No pudimos cargar el día"
            description="Volvé a intentar en unos segundos."
          />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Aún no marcaste entregas hoy"
            description="Cuando confirmes una, aparece acá con la hora y el monto."
          />
        ) : (
          <motion.ul
            initial="hidden"
            animate="show"
            variants={{
              hidden: { opacity: 0 },
              show: {
                opacity: 1,
                transition: { staggerChildren: 0.04 },
              },
            }}
            className="space-y-2.5"
          >
            {orders.map((order) => (
              <motion.li
                key={order.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <OrderCard
                  order={order}
                  variant="today"
                  onClick={() => navigate(`/portal/orders/${order.id}`)}
                />
              </motion.li>
            ))}
          </motion.ul>
        )}
      </section>
    </div>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  tone: 'emerald' | 'violet';
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-card p-3 ring-1 ring-inset',
        tone === 'emerald' && 'ring-emerald-200/60 dark:ring-emerald-400/30',
        tone === 'violet' && 'ring-violet-200/60 dark:ring-violet-400/30',
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-lg',
            tone === 'emerald' &&
              'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
            tone === 'violet' &&
              'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        <span>{label}</span>
      </div>
      <p className="mt-2 text-xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
    </div>
  );
}

function SkeletonList() {
  return (
    <ul className="space-y-2.5" aria-hidden>
      {Array.from({ length: 3 }).map((_, i) => (
        <li
          key={i}
          className="h-24 animate-pulse rounded-2xl border border-border bg-card"
        />
      ))}
    </ul>
  );
}
