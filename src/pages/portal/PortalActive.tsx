/**
 * Active orders view — the home of the courier portal.
 *
 * Composition:
 *   - Financial summary cards (React Query, 30s staleTime).
 *   - Sticky search input with debounce.
 *   - List of active orders (React Query, 30s staleTime, keepPreviousData
 *     so the search debounce doesn't flicker).
 *
 * Each row renders ActiveOrderRow, which exposes the full courier
 * toolbox in-place: tap the primary "Entregar" CTA to expand an
 * inline confirm, or tap one of the three secondary actions
 * (Devuelto · No pude · Incidencia). The card itself stays tappable
 * to navigate into /portal/orders/:id for full detail when needed.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Truck, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  portalService,
  type PortalOrdersResponse,
  type PortalFinancialSummary,
} from '@/services/portal.service';
import { ActiveOrderRow } from '@/components/portal/ActiveOrderRow';
import { FinancialSummaryCards } from '@/components/portal/FinancialSummaryCards';
import { EmptyState } from '@/components/portal/EmptyState';

const SEARCH_DEBOUNCE_MS = 300;

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function PortalActive() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMountedRef = useRef(true);
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Portal queries opt-in to refetchOnWindowFocus (global default off)
  // so the courier sees fresh state when they return to the tab.
  const summaryQuery = useQuery<PortalFinancialSummary>({
    queryKey: ['portal', 'financial-summary'],
    queryFn: ({ signal }) => portalService.getFinancialSummary({ signal }),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  const ordersQuery = useQuery<PortalOrdersResponse>({
    queryKey: ['portal', 'orders', 'active', debouncedSearch],
    queryFn: ({ signal }) =>
      portalService.getOrders(
        {
          view: 'active',
          search: debouncedSearch || undefined,
          page: 1,
          page_size: 50,
        },
        { signal },
      ),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
  });

  const orders = ordersQuery.data?.orders ?? [];
  const total = ordersQuery.data?.pagination?.total ?? orders.length;

  const headline = useMemo(() => {
    if (ordersQuery.isLoading && !ordersQuery.data) return 'Cargando pedidos...';
    if (debouncedSearch) return `${total} resultados`;
    if (total === 0) return 'Sin pedidos activos';
    if (total === 1) return '1 pedido para entregar';
    return `${total} pedidos para entregar`;
  }, [debouncedSearch, total, ordersQuery.isLoading, ordersQuery.data]);

  const invalidateAfterMutation = () => {
    if (!isMountedRef.current) return;
    queryClient.invalidateQueries({ queryKey: ['portal', 'orders'] });
    queryClient.invalidateQueries({ queryKey: ['portal', 'financial-summary'] });
    queryClient.invalidateQueries({ queryKey: ['portal', 'settlements', 'pending'] });
  };

  return (
    <div className="space-y-5">
      {/* Summary */}
      <FinancialSummaryCards
        summary={summaryQuery.data}
        isLoading={summaryQuery.isLoading}
        isError={summaryQuery.isError}
      />

      {/* Search */}
      <div className="sticky top-[calc(env(safe-area-inset-top)+3.5rem)] z-30 -mx-4 px-4 pt-1">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.75}
          />
          <Input
            ref={inputRef}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar por número, cliente, dirección..."
            className="h-11 rounded-2xl border-border/70 bg-card/80 pl-10 pr-10 text-sm shadow-sm backdrop-blur"
            aria-label="Buscar pedidos"
          />
          {searchInput && (
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                inputRef.current?.focus();
              }}
              aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <section aria-labelledby="active-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2
            id="active-heading"
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            {headline}
          </h2>
          <button
            type="button"
            onClick={() => ordersQuery.refetch()}
            disabled={ordersQuery.isFetching}
            className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {ordersQuery.isFetching ? 'Actualizando...' : 'Actualizar'}
          </button>
        </div>

        {ordersQuery.isLoading && !ordersQuery.data ? (
          <ListSkeleton />
        ) : ordersQuery.isError ? (
          <EmptyState
            icon={Truck}
            title="No pudimos cargar tus pedidos"
            description="Revisá tu conexión y volvé a intentar."
          />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={Truck}
            title={debouncedSearch ? 'Sin resultados' : 'Sin pedidos activos'}
            description={
              debouncedSearch
                ? 'Probá con otro número o nombre.'
                : 'Cuando te asignen pedidos, aparecen acá.'
            }
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
            className="space-y-3.5"
          >
            <AnimatePresence initial={false}>
              {orders.map((order) => (
                <motion.li
                  key={order.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2 }}
                >
                  <ActiveOrderRow
                    order={order}
                    onTapCard={() => navigate(`/portal/orders/${order.id}`)}
                    onMutation={invalidateAfterMutation}
                  />
                </motion.li>
              ))}
            </AnimatePresence>
          </motion.ul>
        )}
      </section>
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="space-y-3.5" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <li
          key={i}
          className="rounded-2xl border border-border bg-card p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-4 w-4 animate-pulse rounded bg-muted" />
          </div>
          <div className="mt-3 flex gap-2">
            <div className="h-5 w-24 animate-pulse rounded-full bg-muted" />
            <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
          </div>
          <div className="mt-3 h-11 w-full animate-pulse rounded-2xl bg-muted" />
        </li>
      ))}
    </ul>
  );
}
