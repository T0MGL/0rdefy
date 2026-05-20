/**
 * /portal/conciliacion — courier-side reconciliation.
 *
 * Two tabs:
 *   - Pendientes: orders delivered + not-yet-reconciled. Courier picks
 *     a subset (or all), the running totals update, taps "Cerrar
 *     conciliación" to attach a transfer screenshot.
 *   - Historial: settlements already closed. Each card shows the
 *     status badge, payment metadata, and a tap-to-expand proof.
 *
 * Trust model is auto-paid: the close mutation stamps the settlement
 * as `status='paid'` immediately. The screenshot is evidence in
 * settlement_payment_proofs (audit only).
 *
 * The pending tab is the "new conciliaciones" surface; the historial
 * tab is the "ya conciliadas" surface — visually distinct (different
 * card components, different colors, different actions) so the
 * courier never confuses them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CheckCircle2, History, Receipt, Loader2 } from 'lucide-react';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/utils/currency';
import {
  portalService,
  type PortalPendingSettlementsResult,
  type PortalSettlementsHistoryResult,
} from '@/services/portal.service';
import { EmptyState } from '@/components/portal/EmptyState';
import { PendingReconciliationCard } from '@/components/portal/PendingReconciliationCard';
import { SettlementCard } from '@/components/portal/SettlementCard';
import { SettlementCloseSheet } from '@/components/portal/SettlementCloseSheet';

type ConciliacionTab = 'pending' | 'history';

export default function PortalConciliacion() {
  const queryClient = useQueryClient();
  const isMountedRef = useRef(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [closeOpen, setCloseOpen] = useState(false);

  // Tab state persisted in the URL so a courier who refreshes (or opens the
  // proof on a share link) lands on the same tab they were viewing.
  const rawTab = searchParams.get('tab');
  const activeTab: ConciliacionTab = rawTab === 'history' ? 'history' : 'pending';

  const handleTabChange = useCallback(
    (next: string) => {
      const value: ConciliacionTab = next === 'history' ? 'history' : 'pending';
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (value === 'pending') {
            params.delete('tab');
          } else {
            params.set('tab', value);
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Both queries opt-in to refetchOnWindowFocus (global default is off)
  // so the courier always sees fresh state when they come back to the
  // tab — critical when an admin reconciles from the dashboard while
  // the courier has the portal open.
  const pendingQuery = useQuery<PortalPendingSettlementsResult>({
    queryKey: ['portal', 'settlements', 'pending'],
    queryFn: ({ signal }) => portalService.getPendingSettlements({ signal }),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  const historyQuery = useQuery<PortalSettlementsHistoryResult>({
    queryKey: ['portal', 'settlements', 'history', 1],
    queryFn: ({ signal }) =>
      portalService.getSettlementsHistory({ page: 1, page_size: 30 }, { signal }),
    // Signed URLs in the history payload live ~5 min, so we re-fetch a
    // bit more aggressively than other views to avoid stale links.
    staleTime: 4 * 60_000,
    refetchOnWindowFocus: true,
  });

  const pendingOrders = useMemo(
    () => pendingQuery.data?.orders ?? [],
    [pendingQuery.data],
  );
  const pendingSummary = pendingQuery.data?.summary;

  // Sync selection: drop any selected id that is no longer in the list
  // (e.g. another courier closed an overlapping settlement and the list
  // refreshed). Depend only on pendingOrders (memoized above) so the effect
  // doesn't fire on every render with a fresh array identity.
  useEffect(() => {
    if (pendingOrders.length === 0) return;
    const ids = new Set(pendingOrders.map((o) => o.id));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (ids.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [pendingOrders]);

  const toggleOne = (orderId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds((prev) => {
      if (prev.size === pendingOrders.length && pendingOrders.length > 0) {
        return new Set();
      }
      return new Set(pendingOrders.map((o) => o.id));
    });
  };

  const allSelected =
    pendingOrders.length > 0 && selectedIds.size === pendingOrders.length;

  // Totals over the SELECTED subset, not the whole pending backlog.
  const totals = useMemo(() => {
    let totalCodToRemit = 0;
    let totalOrders = 0;
    for (const o of pendingOrders) {
      if (!selectedIds.has(o.id)) continue;
      totalOrders += 1;
      if (o.is_cod) {
        totalCodToRemit += o.cod_amount || o.total_price;
      }
    }
    // Carrier-fee estimate: we don't expose per-order zone rates client-side,
    // so we approximate by leaving the field at 0 and trust the backend to
    // compute the exact figure on close. The summary still shows it as a
    // hint when the user has not selected anything specific.
    const estimatedCarrierFees = 0;
    const estimatedNet = totalCodToRemit - estimatedCarrierFees;
    return {
      totalOrders,
      totalCodToRemit,
      estimatedCarrierFees,
      estimatedNet,
    };
  }, [pendingOrders, selectedIds]);

  const handleCloseSuccess = () => {
    setSelectedIds(new Set());
    queryClient.invalidateQueries({ queryKey: ['portal', 'settlements', 'pending'] });
    queryClient.invalidateQueries({ queryKey: ['portal', 'settlements', 'history'] });
    queryClient.invalidateQueries({ queryKey: ['portal', 'financial-summary'] });
    queryClient.invalidateQueries({ queryKey: ['portal', 'orders'] });
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Conciliación
        </p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight">
          Rendir cobranzas
        </h1>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="grid grid-cols-2">
          <TabsTrigger value="pending">Pendientes</TabsTrigger>
          <TabsTrigger value="history">Historial</TabsTrigger>
        </TabsList>

        {/* ------------------ PENDIENTES ----------------------------- */}
        <TabsContent value="pending" className="space-y-4 pb-56 outline-none">
          {/* Summary card */}
          <PendingSummary
            isLoading={pendingQuery.isLoading}
            isError={pendingQuery.isError}
            summary={pendingSummary}
          />

          {/* Select all + counter + clear (only when selection exists) */}
          {pendingOrders.length > 0 && (
            <div className="flex items-center justify-between gap-3 px-1">
              <Label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Seleccionar todos"
                />
                Seleccionar todos
              </Label>
              <div className="flex items-center gap-3">
                {selectedIds.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelectedIds(new Set())}
                    className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus:outline-none focus-visible:underline"
                  >
                    Limpiar
                  </button>
                )}
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {selectedIds.size} de {pendingOrders.length}
                </span>
              </div>
            </div>
          )}

          {pendingQuery.isLoading ? (
            <SkeletonList />
          ) : pendingQuery.isError ? (
            <EmptyState
              icon={Receipt}
              title="No pudimos cargar los pedidos pendientes"
              description="Probá en unos segundos."
            />
          ) : pendingOrders.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Sin pedidos por rendir"
              description="Cuando entregues pedidos, vas a poder cerrarlos acá."
            />
          ) : (
            <motion.ul
              initial="hidden"
              animate="show"
              variants={{
                hidden: { opacity: 0 },
                show: { opacity: 1, transition: { staggerChildren: 0.03 } },
              }}
              className="space-y-2"
            >
              {pendingOrders.map((order) => (
                <motion.li
                  key={order.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <PendingReconciliationCard
                    order={order}
                    selected={selectedIds.has(order.id)}
                    onToggle={toggleOne}
                  />
                </motion.li>
              ))}
            </motion.ul>
          )}

          {/* Sticky CTA over the bottom nav */}
          {pendingOrders.length > 0 && (
            <div
              className="fixed inset-x-0 bottom-16 z-40 border-t border-border bg-card/95 backdrop-blur-md"
              style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
            >
              <div className="mx-auto max-w-2xl space-y-2 px-4 py-3">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-xs text-muted-foreground">
                    Total a transferir
                  </span>
                  <span className="text-lg font-semibold tabular-nums">
                    {formatCurrency(totals.totalCodToRemit)}
                  </span>
                </div>
                <Button
                  type="button"
                  disabled={selectedIds.size === 0}
                  onClick={() => setCloseOpen(true)}
                  className="h-12 w-full text-base"
                  size="lg"
                >
                  Cerrar conciliación{' '}
                  {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ------------------ HISTORIAL ------------------------------ */}
        <TabsContent value="history" className="space-y-3 outline-none">
          {historyQuery.isLoading ? (
            <SkeletonList />
          ) : historyQuery.isError ? (
            <EmptyState
              icon={History}
              title="No pudimos cargar el historial"
              description="Probá en unos segundos."
            />
          ) : (historyQuery.data?.settlements.length ?? 0) === 0 ? (
            <EmptyState
              icon={History}
              title="Sin conciliaciones aún"
              description="Cuando cierres una conciliación, queda registrada acá."
            />
          ) : (
            <motion.ul
              initial="hidden"
              animate="show"
              variants={{
                hidden: { opacity: 0 },
                show: { opacity: 1, transition: { staggerChildren: 0.03 } },
              }}
              className="space-y-2.5"
            >
              {historyQuery.data!.settlements.map((settlement) => (
                <motion.li
                  key={settlement.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <SettlementCard settlement={settlement} />
                </motion.li>
              ))}
            </motion.ul>
          )}
        </TabsContent>
      </Tabs>

      <SettlementCloseSheet
        open={closeOpen}
        onOpenChange={setCloseOpen}
        orderIds={Array.from(selectedIds)}
        totals={totals}
        onSuccess={handleCloseSuccess}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PendingSummary({
  isLoading,
  isError,
  summary,
}: {
  isLoading: boolean;
  isError: boolean;
  summary: PortalPendingSettlementsResult['summary'] | undefined;
}) {
  if (isLoading) {
    return (
      <div className="h-24 animate-pulse rounded-2xl border border-border bg-card" />
    );
  }
  if (isError || !summary) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
        No pudimos cargar el resumen.
      </div>
    );
  }

  const totalLabel =
    summary.total_orders === 0
      ? 'Nada pendiente de rendir'
      : summary.total_orders === 1
        ? '1 entrega por rendir'
        : `${summary.total_orders} entregas por rendir`;

  const oldestLabel =
    summary.days_oldest === 0
      ? 'Sin demora'
      : summary.days_oldest === 1
        ? 'Más antigua: 1 día'
        : `Más antigua: ${summary.days_oldest} días`;

  return (
    <section
      aria-label="Resumen pendiente"
      className={cn(
        'rounded-2xl border border-border bg-card p-4 ring-1 ring-inset',
        summary.days_oldest >= 5
          ? 'ring-rose-200/60 dark:ring-rose-400/30'
          : summary.days_oldest >= 3
            ? 'ring-amber-200/60 dark:ring-amber-400/30'
            : 'ring-primary/30',
      )}
    >
      <p className="text-xs font-medium text-muted-foreground">{totalLabel}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
        {formatCurrency(summary.total_cod_to_remit)}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {oldestLabel}
        {summary.total_prepaid_count > 0
          ? ` · ${summary.total_prepaid_count} prepago${summary.total_prepaid_count === 1 ? '' : 's'}`
          : ''}
      </p>
    </section>
  );
}

function SkeletonList() {
  return (
    <ul className="space-y-2" aria-hidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <li
          key={i}
          className="h-20 animate-pulse rounded-2xl border border-border bg-card"
        />
      ))}
    </ul>
  );
}
