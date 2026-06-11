/**
 * Inline drawer-card rendered below a SwipeableOrderCard when the
 * courier swipes-to-deliver.
 *
 * Compared to MarkDeliveredSheet:
 *   - Inline (slides down below the card), not a full bottom sheet.
 *   - Two pre-filled inputs (amount collected, courier fee shown
 *     read-only as context).
 *   - One CTA "Confirmar". A bit of fricción + the link "Editar detalle"
 *     escalates to the full MarkDeliveredSheet for edge cases.
 *
 * Prepaid orders skip the amount input, the courier just confirms.
 * Discrepancies > 5% block submit and prompt to use the detail sheet
 * so the courier can record notes.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { motion } from 'framer-motion';
import { X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency, parseAmountInput } from '@/utils/currency';
import {
  portalService,
  PortalApiError,
  type PortalOrder,
  type MarkDeliveredResult,
} from '@/services/portal.service';

interface InlineDeliveryConfirmProps {
  order: PortalOrder;
  onClose: () => void;
  onSuccess: (result: MarkDeliveredResult) => void;
  /** Open the full sheet for edge cases (prepago notes, discrepancy, etc.) */
  onEscalate: () => void;
  /** Owner sets this to true while the outer CTA is in-flight. */
  onSubmittingChange?: (submitting: boolean) => void;
  /** Owner reads this to gate the outer CTA. */
  onValidityChange?: (canConfirm: boolean) => void;
}

export interface InlineDeliveryConfirmHandle {
  /** Programmatically trigger the same confirm path as the inline button. */
  submit: () => void;
}

const DISCREPANCY_THRESHOLD = 0.05;

export const InlineDeliveryConfirm = forwardRef<
  InlineDeliveryConfirmHandle,
  InlineDeliveryConfirmProps
>(function InlineDeliveryConfirm({
  order,
  onClose,
  onSuccess,
  onEscalate,
  onSubmittingChange,
  onValidityChange,
}, ref) {
  const { toast } = useToast();
  const isMountedRef = useRef(true);
  const isCod = order.is_cod;

  const [amount, setAmount] = useState<string>(
    isCod ? String(order.total_price) : '',
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Locale-aware parser: "150.000" / "150,000" / "150000" all map to 150000 for
  // 0-decimal currencies (PYG). Number(amount) without this returns 150 for the
  // first case and silently destroys cash reconciliation.
  const parsedAmount = isCod ? parseAmountInput(amount, 0) : 0;
  const numericAmount = Number.isFinite(parsedAmount) ? parsedAmount : NaN;
  const hasParsedValue = isCod ? Number.isFinite(numericAmount) : true;
  const discrepancyRatio = isCod && hasParsedValue
    ? Math.abs(numericAmount - order.total_price) /
      Math.max(order.total_price, 1)
    : 0;
  const hasDiscrepancy = hasParsedValue && discrepancyRatio > DISCREPANCY_THRESHOLD;
  const invalid = isCod && (!hasParsedValue || numericAmount < 0);

  const handleConfirm = async () => {
    if (submitting) return;
    if (invalid) return;
    if (hasDiscrepancy) {
      // Soft-block: push the courier to the full sheet so the discrepancy
      // is recorded with notes. This is exactly the case where the simple
      // inline form is the wrong tool.
      onEscalate();
      return;
    }

    setSubmitting(true);
    onSubmittingChange?.(true);
    try {
      const result = await portalService.markDelivered(order.id, {
        amount_collected: isCod ? numericAmount : 0,
        payment_method: isCod ? 'cash' : order.payment_method || 'qr',
      });

      if (!isMountedRef.current) return;

      toast({
        title: result.already_delivered
          ? 'Ya estaba entregada'
          : 'Entrega registrada',
        description: result.already_delivered
          ? 'No se hicieron cambios.'
          : `${order.display_order_number} pasó a entregada.`,
      });

      onSuccess(result);
    } catch (err) {
      if (!isMountedRef.current) return;
      const message =
        err instanceof PortalApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'No se pudo marcar como entregada';
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      if (isMountedRef.current) setSubmitting(false);
      onSubmittingChange?.(false);
    }
  };

  useImperativeHandle(ref, () => ({ submit: handleConfirm }), [handleConfirm]);

  // Tell the parent whether the outer CTA should be enabled. We mirror the
  // same disabled rules used by the (now removed) inline button so the outer
  // CTA stays the single source of truth for the action.
  useEffect(() => {
    onValidityChange?.(!invalid && !submitting);
  }, [invalid, submitting, onValidityChange]);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.2 }}
      className="overflow-hidden"
    >
      <div className="mt-2 rounded-2xl border border-primary/40 bg-primary/[0.04] p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <CheckCircle2 className="h-4 w-4 text-primary" strokeWidth={2} />
            Confirmar entrega
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 space-y-3">
          {isCod ? (
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor={`inline-amount-${order.id}`} className="text-xs font-medium">
                  Monto cobrado
                </Label>
                <span className="text-[11px] text-muted-foreground">
                  Esperado: {formatCurrency(order.total_price)}
                </span>
              </div>
              <Input
                id={`inline-amount-${order.id}`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                enterKeyHint="done"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                placeholder="0"
                className="h-11 text-base font-medium tabular-nums"
                aria-invalid={invalid}
              />
              {hasParsedValue ? (
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  Interpretado como <span className="font-medium text-foreground">{formatCurrency(numericAmount)}</span>
                </p>
              ) : amount.length > 0 ? (
                <p className="flex items-start gap-1.5 text-[11px] text-rose-700 dark:text-rose-400">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  Monto inválido. Usá solo números.
                </p>
              ) : null}
              {hasDiscrepancy && (
                <p className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  Diferencia del {Math.round(discrepancyRatio * 100)}%. Editá el detalle
                  para registrar la nota.
                </p>
              )}
            </div>
          ) : (
            <p className="rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              Prepago: no se cobra al cliente. Confirmá la entrega cuando el cliente
              haya recibido el pedido.
            </p>
          )}

          {order.shipping_cost > 0 && (
            <div className="rounded-xl bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Tu cobro:</span>{' '}
              <span className="tabular-nums">{formatCurrency(order.shipping_cost)}</span>
            </div>
          )}
        </div>

        {/*
          Confirm action lives in the outer CTA (ActiveOrderRow). This footer
          is just the escape hatch to the full sheet for edge cases the inline
          panel can't handle (notes, photo, complex discrepancy).
        */}
        <div className="mt-3 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onEscalate}
            className="text-[11px] font-medium text-primary hover:underline focus:outline-none focus-visible:underline"
          >
            {hasDiscrepancy ? 'Ajustar y confirmar →' : 'Editar detalle →'}
          </button>
        </div>
      </div>
    </motion.div>
  );
});
