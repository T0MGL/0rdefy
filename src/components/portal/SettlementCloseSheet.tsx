/**
 * Bottom sheet for closing a settlement from the courier portal.
 *
 * Inputs: payment method, bank reference, screenshot file, optional
 * notes. Submits via portalService.closeSettlement (multipart). On
 * success, calls onSuccess and the parent invalidates the pending +
 * history queries.
 *
 * Trust model is auto-paid: the resulting settlement is stamped
 * status='paid' server-side. The screenshot is evidence, not a gate.
 *
 * Memory-leak guards:
 *   - isMountedRef + AbortController on the mutation
 *   - URL.revokeObjectURL on every preview replacement and on unmount
 */

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Upload, X, CheckCircle2, AlertCircle, FileText } from 'lucide-react';
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
import { formatCurrency } from '@/utils/currency';
import {
  portalService,
  PortalApiError,
  type CloseSettlementResult,
  type SettlementPaymentMethod,
} from '@/services/portal.service';

const PAYMENT_METHODS: Array<{ value: SettlementPaymentMethod; label: string }> = [
  { value: 'transfer', label: 'Transferencia bancaria' },
  { value: 'qr', label: 'QR / Wallet' },
  { value: 'cash_deposit', label: 'Depósito en efectivo' },
  { value: 'other', label: 'Otro' },
];

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);
const MAX_BYTES = 5 * 1024 * 1024;
const PAYMENT_REFERENCE_MAX = 200;
const NOTES_MAX = 2000;

interface SettlementCloseSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderIds: string[];
  totals: {
    totalOrders: number;
    totalCodToRemit: number;
    estimatedCarrierFees: number;
    estimatedNet: number;
  };
  onSuccess: (result: CloseSettlementResult) => void;
}

export function SettlementCloseSheet({
  open,
  onOpenChange,
  orderIds,
  totals,
  onSuccess,
}: SettlementCloseSheetProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isMountedRef = useRef(true);
  const previewUrlRef = useRef<string | null>(null);
  // AbortController for the in-flight close request. We abort on unmount and
  // when the sheet closes mid-upload so the network request stops uploading
  // the file. Without this, the courier could trigger a duplicate close by
  // closing the sheet and re-opening it: the first request keeps running and
  // can either succeed (charging the courier twice mentally) or race against
  // the second one on the advisory lock.
  const submitAbortRef = useRef<AbortController | null>(null);

  const [paymentMethod, setPaymentMethod] = useState<SettlementPaymentMethod>('transfer');
  const [paymentReference, setPaymentReference] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Mount / unmount lifecycle. Revoke any lingering preview URL on unmount.
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      submitAbortRef.current?.abort();
      submitAbortRef.current = null;
    };
  }, []);

  // Sync the ref so the unmount cleanup sees the latest URL.
  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  // Reset every time the sheet opens with a fresh selection. When the sheet
  // CLOSES we also abort any in-flight close, the courier dismissing the
  // sheet is a clear signal that they don't want this submission anymore.
  useEffect(() => {
    if (!open) {
      submitAbortRef.current?.abort();
      submitAbortRef.current = null;
      return;
    }
    setPaymentMethod('transfer');
    setPaymentReference('');
    setNotes('');
    setFileError(null);
    setSubmitting(false);
    setFile(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [open]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;

    if (!ALLOWED_MIME.has(picked.type)) {
      setFileError('Solo JPEG, PNG, WEBP o PDF.');
      return;
    }
    if (picked.size === 0) {
      setFileError('El archivo está vacío.');
      return;
    }
    if (picked.size > MAX_BYTES) {
      setFileError('El archivo excede 5 MB.');
      return;
    }

    setFileError(null);
    setFile(picked);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return picked.type.startsWith('image/') ? URL.createObjectURL(picked) : null;
    });
  };

  const handleRemoveFile = () => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setFile(null);
    setFileError(null);
  };

  const trimmedReference = paymentReference.trim();
  const submitDisabled =
    submitting ||
    orderIds.length === 0 ||
    !file ||
    !trimmedReference ||
    !!fileError;

  const handleSubmit = async () => {
    if (submitDisabled || !file) return;
    // Cancel any leftover request from a previous attempt before starting a
    // fresh one. The controller is unmount/close-aware via the effects above.
    submitAbortRef.current?.abort();
    const controller = new AbortController();
    submitAbortRef.current = controller;
    setSubmitting(true);

    try {
      const result = await portalService.closeSettlement(
        {
          order_ids: orderIds,
          total_amount_collected: totals.totalCodToRemit,
          payment_method: paymentMethod,
          payment_reference: trimmedReference,
          notes: notes.trim() || null,
        },
        file,
        { signal: controller.signal },
      );

      if (!isMountedRef.current || controller.signal.aborted) return;

      toast({
        title: 'Conciliación cerrada',
        description: `${result.settlement_code} · neto ${formatCurrency(result.net_receivable)}`,
      });

      onSuccess(result);
      onOpenChange(false);
    } catch (err) {
      // Abort is an explicit user action (closed the sheet or remounted) -
      // no toast, no error, just exit. AbortError is what fetch raises;
      // we also short-circuit on aborted signal in case the polyfill differs.
      if (
        controller.signal.aborted ||
        (err instanceof DOMException && err.name === 'AbortError')
      ) {
        return;
      }
      if (!isMountedRef.current) return;

      // Post-RPC error codes: the orders are ALREADY reconciled in the DB
      // but something downstream failed (payment update, proof upload, or
      // proof insert). The courier's work is locked in; retrying the close
      // here will get them ALREADY_RECONCILED. Best UX: close the sheet,
      // surface a clear message about admin follow-up, and refresh history
      // so they can see the (disputed) settlement immediately.
      const code =
        err instanceof PortalApiError ? (err.code ?? '') : '';
      const POST_RPC_FAILURE_CODES = new Set([
        'PAYMENT_UPDATE_FAILED',
        'PROOF_UPLOAD_FAILED',
        'PROOF_INSERT_FAILED',
      ]);
      if (POST_RPC_FAILURE_CODES.has(code)) {
        toast({
          title: 'Conciliación con incidencia',
          description:
            'Tu rendición quedó registrada pero el comprobante no se guardó. El admin la va a revisar, no la vuelvas a cerrar.',
          variant: 'destructive',
          duration: 10000,
        });
        // Invalidate locally so the courier sees the disputed settlement
        // appear in Historial as soon as the sheet closes. We don't call
        // onSuccess (the result type is success:true; this path failed).
        queryClient.invalidateQueries({ queryKey: ['portal', 'settlements'] });
        queryClient.invalidateQueries({ queryKey: ['portal', 'orders'] });
        queryClient.invalidateQueries({ queryKey: ['portal', 'financial-summary'] });
        onOpenChange(false);
        return;
      }

      const message =
        err instanceof PortalApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'No se pudo cerrar la conciliación';
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      if (isMountedRef.current) setSubmitting(false);
      if (submitAbortRef.current === controller) {
        submitAbortRef.current = null;
      }
    }
  };

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
            Cerrar conciliación
          </SheetTitle>
          <SheetDescription className="text-xs">
            {orderIds.length} {orderIds.length === 1 ? 'pedido' : 'pedidos'} a rendir
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Summary */}
          <section
            aria-label="Resumen"
            className="rounded-2xl border border-border bg-muted/30 p-3 text-sm"
          >
            <SummaryRow label="Pedidos" value={String(totals.totalOrders)} />
            <SummaryRow
              label="Cobranza total"
              value={formatCurrency(totals.totalCodToRemit)}
            />
            <SummaryRow
              label="Tu cobro acumulado"
              value={formatCurrency(totals.estimatedCarrierFees)}
            />
            <div className="mt-2 border-t border-border pt-2">
              <SummaryRow
                label="Neto a transferir"
                value={formatCurrency(totals.estimatedNet)}
                bold
              />
            </div>
          </section>

          {/* Payment method */}
          <div className="space-y-2">
            <Label htmlFor="payment-method" className="text-sm font-medium">
              Método de pago
            </Label>
            <Select
              value={paymentMethod}
              onValueChange={(v) => setPaymentMethod(v as SettlementPaymentMethod)}
            >
              <SelectTrigger id="payment-method" className="h-12">
                <SelectValue />
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

          {/* Payment reference */}
          <div className="space-y-2">
            <Label htmlFor="payment-reference" className="text-sm font-medium">
              N° de referencia / transferencia
            </Label>
            <Input
              id="payment-reference"
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              maxLength={PAYMENT_REFERENCE_MAX}
              placeholder="TX-2026051712345"
              className="h-12 tabular-nums"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              inputMode="text"
            />
          </div>

          {/* File upload */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Comprobante (captura o PDF)</Label>
            {file ? (
              <div className="relative overflow-hidden rounded-2xl border border-border">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Vista previa del comprobante"
                    className="h-48 w-full object-cover"
                  />
                ) : (
                  <div className="flex h-32 flex-col items-center justify-center gap-1 bg-muted/40 text-muted-foreground">
                    <FileText className="h-6 w-6" strokeWidth={1.75} />
                    <span className="max-w-[80%] truncate text-xs">{file.name}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleRemoveFile}
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-opacity hover:bg-black/75"
                  aria-label="Quitar comprobante"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label
                htmlFor="settlement-proof"
                className="flex h-28 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-border bg-muted/30 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/50"
              >
                <Upload className="h-5 w-5" strokeWidth={1.75} />
                <span className="text-xs">Subir captura de transferencia</span>
                <span className="text-[10px] text-muted-foreground/70">
                  JPEG / PNG / WEBP / PDF · máx 5 MB
                </span>
                <input
                  id="settlement-proof"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={handleFileChange}
                  className="sr-only"
                />
              </label>
            )}
            {fileError && (
              <p className="flex items-start gap-1.5 text-xs text-rose-600 dark:text-rose-400">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {fileError}
              </p>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="settlement-notes" className="text-sm font-medium">
              Notas (opcional)
            </Label>
            <Textarea
              id="settlement-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={NOTES_MAX}
              rows={3}
              placeholder="Algo que el admin deba saber..."
              className="resize-none"
            />
          </div>
        </div>

        <div className="border-t border-border bg-card px-6 py-3">
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitDisabled}
            className="h-12 w-full text-base"
            size="lg"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Cerrando conciliación...
              </>
            ) : (
              'Confirmar y cerrar'
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SummaryRow({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span
        className={
          bold
            ? 'text-sm font-semibold text-foreground'
            : 'text-xs text-muted-foreground'
        }
      >
        {label}
      </span>
      <span
        className={
          bold
            ? 'text-base font-semibold tabular-nums'
            : 'text-sm tabular-nums'
        }
      >
        {value}
      </span>
    </div>
  );
}
