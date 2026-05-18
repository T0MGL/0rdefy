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

import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { OrderCard } from './OrderCard';
import { InlineDeliveryConfirm } from './InlineDeliveryConfirm';
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

  const isExpanded = expanded === 'delivered';

  const handleDeliveredSuccess = (_: MarkDeliveredResult) => {
    setExpanded('idle');
    onMutation();
  };

  const handleSheetSuccess = () => {
    setOpenSheet(null);
    onMutation();
  };

  return (
    <div className="space-y-2">
      <OrderCard
        order={order}
        variant="active"
        onClick={() => {
          // Tapping the card while the inline panel is open should just
          // close the panel — the user is signaling "I changed my mind".
          if (isExpanded) {
            setExpanded('idle');
            return;
          }
          onTapCard();
        }}
        className={cn(isExpanded && 'ring-2 ring-primary/40')}
      />

      {/* Primary CTA */}
      <button
        type="button"
        onClick={() =>
          setExpanded((prev) => (prev === 'delivered' ? 'idle' : 'delivered'))
        }
        aria-expanded={isExpanded}
        className={cn(
          'flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold shadow-sm transition-colors',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          isExpanded
            ? 'bg-primary/15 text-primary ring-1 ring-inset ring-primary/30'
            : 'bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.99]',
        )}
      >
        <CheckCircle2 className="h-4 w-4" strokeWidth={2.25} />
        {isExpanded ? 'Cancelar' : 'Entregar'}
      </button>

      {/* Inline confirm */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <InlineDeliveryConfirm
            order={order}
            onClose={() => setExpanded('idle')}
            onEscalate={() => {
              setExpanded('idle');
              setOpenSheet('delivered');
            }}
            onSuccess={handleDeliveredSuccess}
          />
        )}
      </AnimatePresence>

      {/* Secondary actions row */}
      <div className="flex items-center justify-between gap-2 px-1 text-[11px]">
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
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      {label}
    </button>
  );
}

function Separator() {
  return <span className="h-3 w-px shrink-0 bg-border" />;
}
