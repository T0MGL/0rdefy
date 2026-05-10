/**
 * History view — paginated infinite scroll of every order the courier has
 * touched. Filter by final status to find a specific delivery. Page size is
 * 30; the server bounds it to 100 max.
 *
 * Filtering is client-side over the same /portal/orders?view=history payload
 * because the backend's history view doesn't currently take a status filter.
 * If we ever push the filter server-side, we just swap this map.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { History, Loader2 } from 'lucide-react';
import {
  portalService,
  type PortalOrdersResponse,
  type PortalOrder,
} from '@/services/portal.service';
import { OrderCard } from '@/components/portal/OrderCard';
import { EmptyState } from '@/components/portal/EmptyState';
import { isCancelled, isReturned, isStrictDelivered } from '@/lib/status';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type StatusFilter =
  | 'all'
  | 'delivered'
  | 'failed'
  | 'returned'
  | 'incident';

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'delivered', label: 'Entregadas' },
  { value: 'failed', label: 'No entregadas' },
  { value: 'returned', label: 'Devueltas' },
  { value: 'incident', label: 'Con incidencia' },
];

const PAGE_SIZE = 30;

function matchesFilter(order: PortalOrder, f: StatusFilter): boolean {
  if (f === 'all') return true;
  if (f === 'delivered') return isStrictDelivered(order.sleeves_status);
  if (f === 'returned') return isReturned(order.sleeves_status);
  // 'incident' is a legacy pre-148c VARCHAR; explicit literal kept.
  if (f === 'incident') return order.sleeves_status === 'incident';
  if (f === 'failed') {
    return (
      isCancelled(order.sleeves_status) ||
      order.delivery_status === 'failed'
    );
  }
  return true;
}

export default function PortalHistory() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<PortalOrdersResponse>({
    queryKey: ['portal', 'orders', 'history'],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      portalService.getOrders(
        {
          view: 'history',
          page: pageParam as number,
          page_size: PAGE_SIZE,
        },
        { signal },
      ),
    getNextPageParam: (lastPage) =>
      lastPage.pagination.has_more
        ? lastPage.pagination.page + 1
        : undefined,
    staleTime: 60_000,
  });

  // Intersection observer for infinite scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    if (!hasNextPage || isFetchingNextPage) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            fetchNextPage();
          }
        }
      },
      { rootMargin: '120px' },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const allOrders = useMemo(
    () => data?.pages.flatMap((p) => p.orders) ?? [],
    [data],
  );
  const filteredOrders = useMemo(
    () => allOrders.filter((o) => matchesFilter(o, filter)),
    [allOrders, filter],
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Historial
        </p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight">
          Tus entregas
        </h1>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Select
          value={filter}
          onValueChange={(v) => setFilter(v as StatusFilter)}
        >
          <SelectTrigger className="h-10 max-w-[60%] rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {filteredOrders.length} de {allOrders.length}
        </span>
      </div>

      {isLoading ? (
        <SkeletonList />
      ) : isError ? (
        <EmptyState
          icon={History}
          title="No pudimos cargar el historial"
          description="Volvé a intentar en unos segundos."
        />
      ) : filteredOrders.length === 0 ? (
        <EmptyState
          icon={History}
          title={
            allOrders.length === 0
              ? 'Sin historial todavía'
              : 'No hay pedidos con ese filtro'
          }
          description={
            allOrders.length === 0
              ? 'Acá vas a ver todas las entregas que toques.'
              : 'Probá con otro estado para ver más resultados.'
          }
        />
      ) : (
        <>
          <motion.ul
            initial="hidden"
            animate="show"
            variants={{
              hidden: { opacity: 0 },
              show: {
                opacity: 1,
                transition: { staggerChildren: 0.03 },
              },
            }}
            className="space-y-2.5"
          >
            {filteredOrders.map((order) => (
              <motion.li
                key={order.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <OrderCard
                  order={order}
                  variant="history"
                  onClick={() => navigate(`/portal/orders/${order.id}`)}
                />
              </motion.li>
            ))}
          </motion.ul>

          <div
            ref={sentinelRef}
            className="flex h-12 items-center justify-center text-xs text-muted-foreground"
          >
            {isFetchingNextPage ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Cargando más...
              </span>
            ) : hasNextPage ? (
              <span>Desplazá para ver más</span>
            ) : (
              <span>Llegaste al final</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SkeletonList() {
  return (
    <ul className="space-y-2.5" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <li
          key={i}
          className="h-24 animate-pulse rounded-2xl border border-border bg-card"
        />
      ))}
    </ul>
  );
}
