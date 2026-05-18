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
 * Prepaid orders skip the amount input — the courier just confirms.
 * Discrepancies > 5% block submit and prompt to use the detail sheet
 * so the courier can record notes.
 */

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { formatCurrency } from '@/utils/currency';
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
}

const DISCREPANCY_THRESHOLD = 0.05;

export function InlineDeliveryConfirm({
  order,
  onClose,
  onSuccess,
  onEscalate,
}: InlineDeliveryConfirmProps) {
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

  const numericAmount = isCod ? Number(amount) || 0 : 0;
  const discrepancyRatio = isCod
    ? Math.abs(numericAmount - order.total_price) /
      Math.max(order.total_price, 1)
    : 0;
  const hasDiscrepancy = discrepancyRatio > DISCREPANCY_THRESHOLD;
  const invalid = isCod && (Number.isNaN(numericAmount) || numericAmount < 0);

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
    }
  };

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
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="h-11 text-base font-medium tabular-nums"
              />
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

        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onEscalate}
            className="text-[11px] font-medium text-primary hover:underline focus:outline-none focus-visible:underline"
          >
            Editar detalle →
          </button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={submitting || invalid}
            size="sm"
            className="h-10 min-w-[120px]"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : hasDiscrepancy ? (
              'Ajustar y confirmar →'
            ) : (
              'Confirmar'
            )}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
