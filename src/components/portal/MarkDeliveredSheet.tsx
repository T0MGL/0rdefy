/**
 * Bottom sheet to mark an order as delivered.
 *
 * COD orders ask the courier for the amount actually collected (defaults to
 * total_price) plus the payment method used. Prepaid orders skip those fields
 * since the cash didn't change hands at the door.
 *
 * Photo upload is optional, runs through client-side compression to keep
 * blobs under ~500KB, and uploads via portalService.uploadProof. The
 * returned URL is then attached to mark-delivered.
 *
 * Discrepancies > 5% prompt a confirm before submitting so the courier can't
 * fat-finger the amount and break the conciliation.
 */

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Loader2, X, AlertCircle, CheckCircle2 } from 'lucide-react';
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
import { compressForPreview } from '@/utils/imageCompression';
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
  const abortRef = useRef<AbortController | null>(null);

  const [amount, setAmount] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [notes, setNotes] = useState<string>('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const photoPreviewRef = useRef<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDiscrepancy, setConfirmDiscrepancy] = useState(false);

  // Reset on every open
  useEffect(() => {
    if (open) {
      setAmount(isCod ? String(order.total_price) : '');
      setPaymentMethod(isCod ? 'cash' : (order.payment_method || 'qr'));
      setNotes('');
      setPhotoFile(null);
      setPhotoPreview(null);
      setPhotoUrl(null);
      setPhotoError(null);
      setSubmitting(false);
      setConfirmDiscrepancy(false);
    }
  }, [open, isCod, order.total_price, order.payment_method]);

  // Mount/unmount lifecycle. We keep the latest object URL in a ref so the
  // unmount-time revoke always uses the current preview without depending on
  // state — that avoids the well-known "ref captured at mount" pitfall and
  // the matching exhaustive-deps warning.
  useEffect(() => {
    isMountedRef.current = true;
    // abortRef holds a non-DOM ref (an AbortController instance). The lint
    // rule that flags ref reads in cleanup is intended for DOM nodes, but we
    // still snapshot the controller to satisfy it and avoid relying on
    // ref-mutation timing during teardown.
    const localAbortRef = abortRef;
    const localPreviewRef = photoPreviewRef;
    return () => {
      isMountedRef.current = false;
      localAbortRef.current?.abort();
      if (localPreviewRef.current) {
        URL.revokeObjectURL(localPreviewRef.current);
        localPreviewRef.current = null;
      }
    };
  }, []);

  // Keep the ref in sync with state so the unmount cleanup sees the latest
  // URL. We only revoke on unmount; in-session swaps revoke explicitly.
  useEffect(() => {
    photoPreviewRef.current = photoPreview;
  }, [photoPreview]);

  const numericAmount = isCod ? Number(amount) || 0 : 0;
  const discrepancyRatio = isCod
    ? Math.abs(numericAmount - order.total_price) / Math.max(order.total_price, 1)
    : 0;
  const hasDiscrepancy = discrepancyRatio > DISCREPANCY_THRESHOLD;

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // Allow picking the same file again
    if (!file) return;
    setPhotoError(null);
    setPhotoUploading(true);

    try {
      const { file: compressed, previewUrl } = await compressForPreview(file);

      if (!isMountedRef.current) {
        URL.revokeObjectURL(previewUrl);
        return;
      }

      // Replace existing preview, revoke the old one
      setPhotoPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return previewUrl;
      });
      setPhotoFile(compressed);

      const result = await portalService.uploadProof(order.id, compressed);
      if (!isMountedRef.current) return;
      setPhotoUrl(result.photo_url);
    } catch (err) {
      if (!isMountedRef.current) return;
      const message =
        err instanceof PortalApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'No se pudo subir la foto';
      setPhotoError(message);
      setPhotoFile(null);
      setPhotoUrl(null);
    } finally {
      if (isMountedRef.current) setPhotoUploading(false);
    }
  };

  const removePhoto = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    setPhotoFile(null);
    setPhotoUrl(null);
    setPhotoError(null);
  };

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
        photo_url: photoUrl || undefined,
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
    photoUploading ||
    (isCod && (Number.isNaN(numericAmount) || numericAmount < 0));

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
            <CheckCircle2 className="h-5 w-5 text-emerald-600" strokeWidth={2} />
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
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setConfirmDiscrepancy(false);
                }}
                placeholder="0"
                className="h-12 text-lg font-medium tabular-nums"
              />

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
            <Label className="text-sm font-medium">Foto de prueba (opcional)</Label>
            {photoPreview ? (
              <div className="relative overflow-hidden rounded-2xl border border-border">
                <img
                  src={photoPreview}
                  alt="Vista previa de la prueba de entrega"
                  className="h-48 w-full object-cover"
                />
                <button
                  type="button"
                  onClick={removePhoto}
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-opacity hover:bg-black/75"
                  aria-label="Quitar foto"
                >
                  <X className="h-4 w-4" />
                </button>
                {photoUploading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <Loader2 className="h-6 w-6 animate-spin text-white" />
                  </div>
                )}
                {photoUrl && !photoUploading && (
                  <div className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-medium text-white">
                    <CheckCircle2 className="h-3 w-3" />
                    Subida
                  </div>
                )}
              </div>
            ) : (
              <label
                htmlFor="proof-photo"
                className="flex h-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-border bg-muted/30 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/50"
              >
                {photoUploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <Camera className="h-5 w-5" strokeWidth={1.75} />
                )}
                <span className="text-xs">
                  {photoUploading ? 'Procesando...' : 'Tomar o subir foto'}
                </span>
                <input
                  id="proof-photo"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handlePhotoChange}
                  disabled={photoUploading}
                  className="sr-only"
                />
              </label>
            )}
            {photoError && (
              <p className="text-xs text-rose-600 dark:text-rose-400">
                {photoError}
              </p>
            )}
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
            className="h-12 w-full text-base"
            size="lg"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : confirmDiscrepancy && hasDiscrepancy ? (
              'Confirmar entrega con discrepancia'
            ) : (
              'Confirmar entrega'
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
