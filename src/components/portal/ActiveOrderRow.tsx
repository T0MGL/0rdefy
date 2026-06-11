/**
 * One row in the courier portal "Activos" list.
 *
 * Replaces the previous swipe-based interaction with a predictable
 * tap-to-confirm pattern:
 *
 *   - The card itself is tappable -> navigates to /portal/orders/:id
 *     for full detail (delivery preferences, customer notes, etc).
 *   - A primary lime CTA "Entregar" is always visible below the card.
 *     Tap -> expands InlineDeliveryConfirm in place. Tap again or
 *     "Confirmar" inside the panel commits the delivery.
 *   - A row of 3 secondary actions exposes the rest of the courier's
 *     toolbox without forcing them into the detail screen:
 *       Devuelto · No pude · Incidencia
 *
 * No gestures, no thresholds. Two taps to deliver on the happy path,
 * one tap for the non-happy path (failed attempt, returned, incident).
 *
 * Memory-leak guards:
 *   - All async work in the children (InlineDeliveryConfirm, the
 *     three sheets) carries its own isMountedRef. This wrapper only
 *     owns presentation state.
 */

import { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Navigation,
  Phone,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { normalizeTelHref } from '@/utils/phone';
import { OrderCard } from './OrderCard';
import {
  InlineDeliveryConfirm,
  type InlineDeliveryConfirmHandle,
} from './InlineDeliveryConfirm';
import { MarkDeliveredSheet } from './MarkDeliveredSheet';
import { MarkFailedSheet } from './MarkFailedSheet';
import { MarkReturnedSheet } from './MarkReturnedSheet';
import { ReportIncidentSheet } from './ReportIncidentSheet';
import type {
  MarkDeliveredResult,
  PortalOrder,
} from '@/services/portal.service';

type ExpandedState = 'idle' | 'delivered';
type SheetKind = 'delivered' | 'failed' | 'returned' | 'incident' | null;

interface ActiveOrderRowProps {
  order: PortalOrder;
  onTapCard: () => void;
  /** Fired after ANY mutation that should invalidate the list. */
  onMutation: () => void;
}

export function ActiveOrderRow({
  order,
  onTapCard,
  onMutation,
}: ActiveOrderRowProps) {
  const [expanded, setExpanded] = useState<ExpandedState>('idle');
  const [openSheet, setOpenSheet] = useState<SheetKind>(null);
  const [inlineSubmitting, setInlineSubmitting] = useState(false);
  const [inlineCanConfirm, setInlineCanConfirm] = useState(false);
  const inlineRef = useRef<InlineDeliveryConfirmHandle>(null);

  const isExpanded = expanded === 'delivered';

  const handleDeliveredSuccess = (_: MarkDeliveredResult) => {
    setExpanded('idle');
    onMutation();
  };

  const handleSheetSuccess = () => {
    setOpenSheet(null);
    onMutation();
  };

  // The outer CTA has two modes:
  //   1. idle    -> "Entregar" lime, expands the inline panel
  //   2. expanded -> "Confirmar entrega" lime, triggers inline.submit()
  // Cancel lives only as the X chip in the inline panel header, this avoids
  // the regression where the primary lime CTA turned gray "Cancelar" and the
  // courier double-tapped expecting "confirm" but got "close".
  const handlePrimaryClick = () => {
    if (isExpanded) {
      if (!inlineCanConfirm || inlineSubmitting) return;
      inlineRef.current?.submit();
      return;
    }
    setExpanded('delivered');
  };

  const primaryDisabled = isExpanded && (!inlineCanConfirm || inlineSubmitting);

  return (
    <div className="space-y-2">
      <OrderCard
        order={order}
        variant="active"
        onClick={() => {
          // Tapping the card while the inline panel is open should just
          // close the panel, the user is signaling "I changed my mind".
          if (isExpanded) {
            setExpanded('idle');
            return;
          }
          onTapCard();
        }}
        className={cn(isExpanded && 'ring-2 ring-primary/40')}
      />

      {/* Call + navigate shortcuts, the two highest-frequency courier
          actions on the street. Visible without opening the detail. */}
      {(order.customer_phone || order.customer_address || order.customer_city) && (
        <div className="flex items-stretch gap-2">
          {order.customer_phone && normalizeTelHref(order.customer_phone) && (
            <a
              href={normalizeTelHref(order.customer_phone)}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Llamar a ${order.customer_name || 'cliente'}`}
              className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card text-xs font-medium text-foreground transition-colors hover:bg-accent/40 active:bg-accent/60"
            >
              <Phone className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
              Llamar
            </a>
          )}
          {(order.customer_address || order.customer_city) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                // window.open forces a fresh top-level context, PWA shells
                // and in-app browsers respect this where bare target=_blank
                // fell back to in-place navigation. On mobile the system
                // picks up Google Maps' universal link and opens the app.
                const destination = [order.customer_address, order.customer_city]
                  .filter(Boolean)
                  .join(', ');
                window.open(
                  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`,
                  '_blank',
                  'noopener,noreferrer',
                );
              }}
              aria-label="Cómo llegar"
              className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card text-xs font-medium text-foreground transition-colors hover:bg-accent/40 active:bg-accent/60"
            >
              <Navigation className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
              Ir
            </button>
          )}
        </div>
      )}

      {/* Primary CTA, stays lime in both states, semantics never invert. */}
      <button
        type="button"
        onClick={handlePrimaryClick}
        aria-expanded={isExpanded}
        disabled={primaryDisabled}
        className={cn(
          'flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold shadow-sm transition-colors',
          'bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.99]',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:opacity-60 disabled:active:scale-100',
        )}
      >
        {inlineSubmitting ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.25} />
        ) : (
          <CheckCircle2 className="h-4 w-4" strokeWidth={2.25} />
        )}
        {isExpanded ? (inlineSubmitting ? 'Guardando...' : 'Confirmar entrega') : 'Entregar'}
      </button>

      {/* Inline confirm */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <InlineDeliveryConfirm
            ref={inlineRef}
            order={order}
            onClose={() => setExpanded('idle')}
            onEscalate={() => {
              setExpanded('idle');
              setOpenSheet('delivered');
            }}
            onSuccess={handleDeliveredSuccess}
            onSubmittingChange={setInlineSubmitting}
            onValidityChange={setInlineCanConfirm}
          />
        )}
      </AnimatePresence>

      {/* Secondary actions row */}
      <div className="flex items-stretch justify-between gap-2 px-1 text-[11px]">
        <SecondaryAction
          icon={RotateCcw}
          label="Devuelto"
          onClick={() => setOpenSheet('returned')}
        />
        <Separator />
        <SecondaryAction
          icon={XCircle}
          label="No pude"
          onClick={() => setOpenSheet('failed')}
        />
        <Separator />
        <SecondaryAction
          icon={AlertTriangle}
          label="Incidencia"
          onClick={() => setOpenSheet('incident')}
        />
      </div>

      {/* Sheets (only the 3 secondary ones; "delivered" inline lives above) */}
      <MarkDeliveredSheet
        open={openSheet === 'delivered'}
        onOpenChange={(o) => !o && setOpenSheet(null)}
        order={order}
        onSuccess={handleSheetSuccess}
      />
      <MarkFailedSheet
        open={openSheet === 'failed'}
        onOpenChange={(o) => !o && setOpenSheet(null)}
        order={order}
        onSuccess={handleSheetSuccess}
      />
      <MarkReturnedSheet
        open={openSheet === 'returned'}
        onOpenChange={(o) => !o && setOpenSheet(null)}
        order={order}
        onSuccess={handleSheetSuccess}
      />
      <ReportIncidentSheet
        open={openSheet === 'incident'}
        onOpenChange={(o) => !o && setOpenSheet(null)}
        order={order}
        onSuccess={handleSheetSuccess}
      />
    </div>
  );
}

function SecondaryAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof CheckCircle2;
  label: string;
  onClick: () => void;
}) {
  // h-11 (44px) keeps the tap area at Apple HIG / WCAG 2.5.5 minimum so a
  // courier in a moving bus with a wet thumb doesn't fat-finger between
  // "Devuelto" and "Incidencia".
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 active:bg-muted/80"
    >
      <Icon className="h-4 w-4" strokeWidth={2} />
      {label}
    </button>
  );
}

function Separator() {
  return <span className="h-3 w-px shrink-0 bg-border" />;
}
