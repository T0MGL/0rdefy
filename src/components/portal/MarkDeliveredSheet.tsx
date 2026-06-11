/**
 * Bottom sheet to mark an order as delivered.
 *
 * COD orders ask the courier for the amount actually collected (defaults to
 * total_price) plus the payment method used. Prepaid orders skip those fields
 * since the cash didn't change hands at the door.
 *
 * Discrepancies > 5% prompt a confirm before submitting so the courier can't
 * fat-finger the amount and break the conciliation.
 *
 * Note: photo upload is intentionally NOT exposed in this UI. The
 * /api/portal/orders/:id/upload-proof endpoint still exists for external
 * integrations, but the portal courier flow runs without it.
 */

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { formatCurrency, parseAmountInput } from '@/utils/currency';
import {
  portalService,
  PortalApiError,
  type PortalOrder,
  type MarkDeliveredResult,
} from '@/services/portal.service';

const PAYMENT_METHODS: Array<{ value: string; label: string }> = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'qr', label: 'QR / Transferencia' },
  { value: 'pos', label: 'POS' },
  { value: 'mixed', label: 'Mixto' },
  { value: 'other', label: 'Otro' },
];

interface MarkDeliveredSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: PortalOrder;
  onSuccess: (result: MarkDeliveredResult) => void;
}

const DISCREPANCY_THRESHOLD = 0.05; // 5 %

export function MarkDeliveredSheet({
  open,
  onOpenChange,
  order,
  onSuccess,
}: MarkDeliveredSheetProps) {
  const { toast } = useToast();
  const isCod = order.is_cod;
  const isMountedRef = useRef(true);

  const [amount, setAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmDiscrepancy, setConfirmDiscrepancy] = useState(false);

  // Reset on every open
  useEffect(() => {
    if (open) {
      setAmount(isCod ? String(order.total_price) : '');
      setPaymentMethod(isCod ? 'cash' : (order.payment_method || 'qr'));
      setNotes('');
      setSubmitting(false);
      setConfirmDiscrepancy(false);
    }
  }, [open, isCod, order.total_price, order.payment_method]);

  // Mount/unmount lifecycle for memory-leak-safe async submit.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Locale-aware parser: PY couriers type "150.000" expecting 150000; Number()
  // would parse it as 150 and silently destroy the conciliation. Returns NaN on
  // bad input, caller must gate submit on hasParsedValue.
  const parsedAmount = isCod ? parseAmountInput(amount, 0) : 0;
  const numericAmount = Number.isFinite(parsedAmount) ? parsedAmount : NaN;
  const hasParsedValue = isCod ? Number.isFinite(numericAmount) : true;
  const discrepancyRatio = isCod && hasParsedValue
    ? Math.abs(numericAmount - order.total_price) / Math.max(order.total_price, 1)
    : 0;
  const hasDiscrepancy = hasParsedValue && discrepancyRatio > DISCREPANCY_THRESHOLD;

  const handleSubmit = async () => {
    if (submitting) return;

    // Discrepancy gate
    if (isCod && hasDiscrepancy && !confirmDiscrepancy) {
      setConfirmDiscrepancy(true);
      return;
    }

    setSubmitting(true);

    try {
      const result = await portalService.markDelivered(order.id, {
        amount_collected: isCod ? numericAmount : 0,
        payment_method: paymentMethod,
        notes: notes.trim() || undefined,
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
      onOpenChange(false);
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

  const submitDisabled =
    submitting ||
    (isCod && (!hasParsedValue || numericAmount < 0));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showDragHandle
        withSafeArea
        className="rounded-t-3xl p-0 max-h-[92vh] flex flex-col"
        aria-describedby={undefined}
      >
        <SheetHeader className="px-6 pt-1 pb-4 border-b border-border">
          <SheetTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="h-5 w-5 text-primary" strokeWidth={2} />
            Marcar como entregada
          </SheetTitle>
          <SheetDescription className="text-xs">
            {order.display_order_number} · {order.customer_name}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {isCod && (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="amount" className="text-sm font-medium">
                  ¿Cuánto cobraste?
                </Label>
                <span className="text-xs text-muted-foreground">
                  Total: {formatCurrency(order.total_price)}
                </span>
              </div>
              <Input
                id="amount"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                enterKeyHint="done"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setConfirmDiscrepancy(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
                placeholder="0"
                className="h-12 text-lg font-medium tabular-nums"
                aria-invalid={!hasParsedValue}
              />

              {hasParsedValue ? (
                <p className="text-xs text-muted-foreground tabular-nums">
                  Interpretado como{' '}
                  <span className="font-medium text-foreground">
                    {formatCurrency(numericAmount)}
                  </span>
                </p>
              ) : amount.length > 0 ? (
                <p className="flex items-start gap-1.5 text-xs text-rose-700 dark:text-rose-400">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  Monto inválido. Usá solo números.
                </p>
              ) : null}

              <AnimatePresence>
                {hasDiscrepancy && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="flex items-start gap-2 rounded-xl border border-amber-200/60 bg-amber-50/60 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200"
                  >
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      El monto difiere {Math.round(discrepancyRatio * 100)}% del
                      total. Va a quedar marcado como discrepancia.
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="payment-method" className="text-sm font-medium">
              Método de pago
            </Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger id="payment-method" className="h-12">
                <SelectValue placeholder="Elegí uno" />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="delivered-notes" className="text-sm font-medium">
              Notas (opcional)
            </Label>
            <Textarea
              id="delivered-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Algo que debamos saber..."
              rows={3}
              maxLength={500}
              className="resize-none"
            />
          </div>
        </div>

        <div className="border-t border-border bg-card px-6 py-3">
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitDisabled}
            variant={confirmDiscrepancy && hasDiscrepancy ? 'destructive' : 'default'}
            className={cn(
              'h-12 w-full text-base transition-colors',
              confirmDiscrepancy && hasDiscrepancy &&
                'bg-amber-500 text-amber-950 hover:bg-amber-600 dark:bg-amber-500 dark:text-amber-950',
            )}
            size="lg"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : confirmDiscrepancy && hasDiscrepancy ? (
              <>
                <AlertCircle className="mr-2 h-4 w-4" strokeWidth={2.25} />
                Confirmar con discrepancia
              </>
            ) : (
              'Confirmar entrega'
            )}
          </Button>
          {confirmDiscrepancy && hasDiscrepancy && (
            <p className="mt-2 text-center text-[11px] text-amber-700 dark:text-amber-300">
              Va a quedar marcado para revisión administrativa.
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
