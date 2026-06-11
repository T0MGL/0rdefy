/**
 * Order detail, the action surface for the courier.
 *
 * Reads the order from the React Query cache (active/today/history pages
 * already populated it) instead of issuing a separate GET, because the
 * backend doesn't expose a /portal/orders/:id endpoint. If we miss the
 * cache we refetch active orders and search by id.
 *
 * The 4 action buttons are sticky at the bottom on mobile and disabled when
 * the order is no longer mutable (already delivered/returned/cancelled). All
 * mutations live in dedicated bottom sheets that own their own state and
 * toast feedback.
 *
 * After a successful action, we optimistically invalidate the relevant
 * lists so the user sees the change reflected when they go back.
 */

import { useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ChevronLeft,
  Phone,
  MapPin,
  Navigation,
  CalendarClock,
  ClipboardList,
  Coins,
  Truck,
  CheckCircle2,
  XCircle,
  RotateCcw,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { isCancelled, isReturned, isStrictDelivered } from '@/lib/status';
import { formatCurrency } from '@/utils/currency';
import { normalizeTelHref } from '@/utils/phone';
import {
  portalService,
  type PortalOrder,
  type PortalOrdersResponse,
} from '@/services/portal.service';
import { OrderStatusBadge } from '@/components/portal/OrderStatusBadge';
import { MarkDeliveredSheet } from '@/components/portal/MarkDeliveredSheet';
import { MarkFailedSheet } from '@/components/portal/MarkFailedSheet';
import { MarkReturnedSheet } from '@/components/portal/MarkReturnedSheet';
import { ReportIncidentSheet } from '@/components/portal/ReportIncidentSheet';

const TERMINAL_STATUSES = new Set([
  'delivered',
  'returned',
  'cancelled',
  'incident',
]);

const TIME_SLOT_LABEL: Record<string, string> = {
  morning: 'Por la mañana',
  afternoon: 'Por la tarde',
  evening: 'Por la noche',
  any: 'Cualquier momento',
};

type SheetKind = 'delivered' | 'failed' | 'returned' | 'incident' | null;

function formatDate(iso?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('es-PY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function PortalOrderDetail() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [openSheet, setOpenSheet] = useState<SheetKind>(null);

  // We try to find the order in any cached list first.
  const cachedOrder = useMemo<PortalOrder | undefined>(() => {
    if (!orderId) return undefined;
    const queries = queryClient.getQueriesData<
      PortalOrdersResponse | { pages: PortalOrdersResponse[] }
    >({
      queryKey: ['portal', 'orders'],
    });
    for (const [, data] of queries) {
      if (!data) continue;
      // Could be a single page (active/today) or a paginated infinite shape (history)
      if ('orders' in data && Array.isArray(data.orders)) {
        const hit = data.orders.find((o) => o.id === orderId);
        if (hit) return hit;
      }
      if ('pages' in data && Array.isArray(data.pages)) {
        for (const page of data.pages) {
          const hit = page.orders.find((o) => o.id === orderId);
          if (hit) return hit;
        }
      }
    }
    return undefined;
  }, [orderId, queryClient]);

  // If we have no cached order, fetch the active list as a best-effort
  // fallback. The portal API today does not expose a single-order GET, so
  // we try `active` first then fall back to `today` and `history` so
  // deep-linking an already-delivered or historical order still works.
  //
  // Critical: use an ISOLATED queryKey (not the same as PortalActive). The
  // home page's own ['portal','orders','active', debouncedSearch] cache
  // uses page_size=50 by default; if we share keys we either pollute the
  // home with 100-item pages or get the home's 50 here and miss the order.
  const fallbackActive = useQuery<PortalOrdersResponse>({
    queryKey: ['portal', 'orders', 'detail-fallback', orderId, 'active'],
    queryFn: ({ signal }) =>
      portalService.getOrders(
        { view: 'active', page_size: 100 },
        { signal },
      ),
    enabled: !cachedOrder && !!orderId,
    staleTime: 30_000,
  });

  const activeHit = fallbackActive.data?.orders.find((o) => o.id === orderId);

  const fallbackToday = useQuery<PortalOrdersResponse>({
    queryKey: ['portal', 'orders', 'detail-fallback', orderId, 'today'],
    queryFn: ({ signal }) =>
      portalService.getOrders(
        { view: 'today', page_size: 100 },
        { signal },
      ),
    enabled: !cachedOrder && !!orderId && fallbackActive.isFetched && !activeHit,
    staleTime: 30_000,
  });

  const todayHit = fallbackToday.data?.orders.find((o) => o.id === orderId);

  const fallbackHistory = useQuery<PortalOrdersResponse>({
    queryKey: ['portal', 'orders', 'detail-fallback', orderId, 'history'],
    queryFn: ({ signal }) =>
      portalService.getOrders(
        { view: 'history', page_size: 100 },
        { signal },
      ),
    enabled:
      !cachedOrder &&
      !!orderId &&
      fallbackActive.isFetched &&
      fallbackToday.isFetched &&
      !activeHit &&
      !todayHit,
    staleTime: 30_000,
  });

  const fallbackQuery = activeHit
    ? fallbackActive
    : todayHit
      ? fallbackToday
      : fallbackHistory;

  const order =
    cachedOrder ??
    activeHit ??
    todayHit ??
    fallbackHistory.data?.orders.find((o) => o.id === orderId);

  const invalidatePortalLists = () => {
    queryClient.invalidateQueries({ queryKey: ['portal', 'orders'] });
    queryClient.invalidateQueries({
      queryKey: ['portal', 'financial-summary'],
    });
  };

  const handleDeliveredSuccess = () => {
    invalidatePortalLists();
    // Back to Activos, that's where the courier keeps working. "Hoy" is a
    // wrap-up view they consult at end-of-shift, not the next-step surface.
    navigate('/portal', { replace: true });
  };

  const handleFailedSuccess = () => {
    invalidatePortalLists();
    // Stay on detail, order is still active.
  };

  const handleReturnedSuccess = () => {
    invalidatePortalLists();
    navigate('/portal', { replace: true });
  };

  const handleIncidentSuccess = () => {
    invalidatePortalLists();
    navigate('/portal', { replace: true });
  };

  if (!order) {
    return (
      <div className="space-y-4">
        <BackButton />
        {fallbackQuery.isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Cargando pedido...</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card px-6 py-10 text-center">
            <p className="text-base font-medium text-foreground">
              No encontramos este pedido
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Volvé a la lista y refrescá. Puede que ya no esté asignado a vos.
            </p>
            <Link
              to="/portal"
              className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-primary"
            >
              <ChevronLeft className="h-4 w-4" />
              Volver a activos
            </Link>
          </div>
        )}
      </div>
    );
  }

  const isMutable = !TERMINAL_STATUSES.has(order.sleeves_status);
  const slot = order.delivery_preferences?.preferred_time_slot;
  const slotLabel = slot ? TIME_SLOT_LABEL[slot] : null;
  const notBeforeDate = formatDate(order.delivery_preferences?.not_before_date);
  const deliveryNotes = order.delivery_preferences?.delivery_notes;

  return (
    <div className="space-y-4 pb-32">
      <BackButton />

      {/* Customer */}
      <motion.section
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border bg-card p-4 shadow-sm"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Cliente
            </p>
            <h1 className="mt-0.5 truncate text-lg font-semibold tracking-tight">
              {order.customer_name || 'Sin nombre'}
            </h1>
          </div>
          <OrderStatusBadge status={order.sleeves_status} size="md" />
        </div>

        <div className="mt-3 space-y-2">
          {order.customer_phone && normalizeTelHref(order.customer_phone) && (
            <a
              href={normalizeTelHref(order.customer_phone)}
              className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted active:bg-muted/80"
            >
              <Phone
                className="h-4 w-4 text-muted-foreground"
                strokeWidth={1.75}
              />
              <span className="min-w-0 flex-1 truncate tabular-nums">{order.customer_phone}</span>
              <span className="text-[11px] font-normal text-primary">
                Llamar
              </span>
            </a>
          )}

          {(() => {
            const addressText =
              [order.customer_address, order.customer_city]
                .filter(Boolean)
                .join(' · ') || null;
            const navigationTarget = [order.customer_address, order.customer_city]
              .filter(Boolean)
              .join(', ');
            const mapsUrl = navigationTarget
              ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(navigationTarget)}`
              : null;

            if (mapsUrl) {
              return (
                <button
                  type="button"
                  onClick={() => {
                    // window.open with explicit _blank so the universal link
                    // hands off to the Google Maps app (iOS/Android) or a
                    // fresh browser tab. target=_blank on an <a> was navigating
                    // in-place inside PWA shells and the in-app webview.
                    window.open(mapsUrl, '_blank', 'noopener,noreferrer');
                  }}
                  className="flex min-w-0 w-full items-start gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-muted active:bg-muted/80"
                  aria-label={`Cómo llegar a ${navigationTarget}`}
                >
                  <MapPin
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.75}
                  />
                  <span className="min-w-0 flex-1 break-words leading-5 line-clamp-3">
                    {addressText}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-normal text-primary">
                    <Navigation className="h-3 w-3" strokeWidth={2} />
                    Ir
                  </span>
                </button>
              );
            }

            return (
              <div className="flex min-w-0 items-start gap-2 px-1 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
                <span className="min-w-0 break-words leading-5 line-clamp-3">
                  Sin dirección
                </span>
              </div>
            );
          })()}
        </div>
      </motion.section>

      {/* Order */}
      <motion.section
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.04 }}
        className="rounded-2xl border border-border bg-card p-4 shadow-sm"
      >
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Pedido
        </p>
        <p className="mt-0.5 text-sm font-semibold text-foreground">
          {order.display_order_number}
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Tile
            icon={Coins}
            label={order.is_cod ? 'A cobrar' : 'Prepago'}
            value={formatCurrency(order.total_price)}
            tone={order.is_cod ? 'primary' : 'sky'}
          />
          <Tile
            icon={Truck}
            label="Tu cobro"
            value={formatCurrency(order.shipping_cost)}
            tone="violet"
          />
        </div>

        {order.payment_method && (
          <p className="mt-3 text-xs text-muted-foreground">
            Método de pago original:{' '}
            <span className="font-medium text-foreground">
              {order.payment_method}
            </span>
          </p>
        )}
      </motion.section>

      {/* Delivery preferences */}
      {(slotLabel || notBeforeDate || deliveryNotes) && (
        <motion.section
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="rounded-2xl border border-border bg-card p-4 shadow-sm"
        >
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Preferencias del cliente
          </p>
          <div className="mt-3 space-y-2 text-sm">
            {slotLabel && (
              <div className="flex items-start gap-2">
                <CalendarClock
                  className="mt-0.5 h-4 w-4 text-muted-foreground"
                  strokeWidth={1.75}
                />
                <span>{slotLabel}</span>
              </div>
            )}
            {notBeforeDate && (
              <div className="flex items-start gap-2">
                <CalendarClock
                  className="mt-0.5 h-4 w-4 text-muted-foreground"
                  strokeWidth={1.75}
                />
                <span>No entregar antes del {notBeforeDate}</span>
              </div>
            )}
            {deliveryNotes && (
              <div className="flex items-start gap-2">
                <ClipboardList
                  className="mt-0.5 h-4 w-4 text-muted-foreground"
                  strokeWidth={1.75}
                />
                <span className="leading-5">{deliveryNotes}</span>
              </div>
            )}
          </div>
        </motion.section>
      )}

      {/* Status */}
      <motion.section
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="rounded-2xl border border-border bg-card p-4 shadow-sm"
      >
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Estado actual
        </p>
        <div className="mt-2 flex items-center gap-2">
          <OrderStatusBadge status={order.sleeves_status} size="md" />
          <span className="text-sm text-muted-foreground">
            {order.days_in_transit === 0
              ? 'Recién despachada'
              : order.days_in_transit === 1
                ? '1 día en tránsito'
                : `${order.days_in_transit} días en tránsito`}
          </span>
        </div>
        {order.delivered_at && (
          <p className="mt-1 text-xs text-muted-foreground">
            Entregada el {formatDate(order.delivered_at)}
          </p>
        )}
      </motion.section>

      {/* Sticky action bar */}
      <div
        className="fixed inset-x-0 bottom-16 z-40 overflow-hidden border-t border-border bg-card/95 backdrop-blur-md sm:bottom-16"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto max-w-2xl px-4 py-3">
          {isMutable ? (
            <div className="grid grid-cols-2 gap-2">
              <ActionButton
                kind="delivered"
                onClick={() => setOpenSheet('delivered')}
              />
              <ActionButton
                kind="failed"
                onClick={() => setOpenSheet('failed')}
              />
              <ActionButton
                kind="returned"
                onClick={() => setOpenSheet('returned')}
              />
              <ActionButton
                kind="incident"
                onClick={() => setOpenSheet('incident')}
              />
            </div>
          ) : (
            <div className="rounded-xl bg-muted/60 px-3 py-2.5 text-center text-sm text-muted-foreground">
              Esta orden ya está {labelForTerminal(order.sleeves_status)}.
            </div>
          )}
        </div>
      </div>

      {/* Sheets */}
      <MarkDeliveredSheet
        open={openSheet === 'delivered'}
        onOpenChange={(o) => !o && setOpenSheet(null)}
        order={order}
        onSuccess={handleDeliveredSuccess}
      />
      <MarkFailedSheet
        open={openSheet === 'failed'}
        onOpenChange={(o) => !o && setOpenSheet(null)}
        order={order}
        onSuccess={handleFailedSuccess}
      />
      <MarkReturnedSheet
        open={openSheet === 'returned'}
        onOpenChange={(o) => !o && setOpenSheet(null)}
        order={order}
        onSuccess={handleReturnedSuccess}
      />
      <ReportIncidentSheet
        open={openSheet === 'incident'}
        onOpenChange={(o) => !o && setOpenSheet(null)}
        order={order}
        onSuccess={handleIncidentSuccess}
      />
    </div>
  );
}

function BackButton() {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(-1)}
      className="-ml-2 inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <ChevronLeft className="h-4 w-4" />
      Volver
    </button>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  tone: 'primary' | 'sky' | 'violet';
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card p-3 ring-1 ring-inset',
        tone === 'primary' && 'ring-primary/30',
        tone === 'sky' && 'ring-sky-200/60 dark:ring-sky-400/30',
        tone === 'violet' && 'ring-violet-200/60 dark:ring-violet-400/30',
      )}
    >
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
        {label}
      </div>
      <p className="mt-1 text-base font-semibold tracking-tight tabular-nums">
        {value}
      </p>
    </div>
  );
}

const ACTION_VARIANTS: Record<
  Exclude<SheetKind, null>,
  { label: string; icon: typeof CheckCircle2; classes: string }
> = {
  delivered: {
    label: 'Entregada',
    icon: CheckCircle2,
    classes:
      'bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-primary',
  },
  failed: {
    label: 'No entregada',
    icon: XCircle,
    classes:
      'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500',
  },
  returned: {
    label: 'Devuelta',
    icon: RotateCcw,
    classes:
      'bg-slate-700 text-white hover:bg-slate-800 focus-visible:ring-slate-500 dark:bg-slate-600 dark:hover:bg-slate-500',
  },
  incident: {
    label: 'Incidencia',
    icon: AlertTriangle,
    classes:
      'bg-amber-500 text-white hover:bg-amber-600 focus-visible:ring-amber-500',
  },
};

function ActionButton({
  kind,
  onClick,
}: {
  kind: Exclude<SheetKind, null>;
  onClick: () => void;
}) {
  const v = ACTION_VARIANTS[kind];
  const Icon = v.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-medium shadow-sm transition-transform active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        v.classes,
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={2} />
      {v.label}
    </button>
  );
}

function labelForTerminal(status: string): string {
  if (isStrictDelivered(status)) return 'entregada';
  if (isReturned(status)) return 'devuelta';
  if (isCancelled(status)) return 'cancelada';
  // 'incident' is a legacy pre-148c VARCHAR; explicit literal kept.
  if (status === 'incident') return 'con incidencia';
  return status;
}
