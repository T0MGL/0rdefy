/**
 * Bottom sheet for logging a failed delivery attempt.
 *
 * Does NOT change the order's `sleeves_status` (the order stays in transit
 * so the courier can retry). The backend dedupes against the same
 * (user, reason) inside a 5-minute window.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import {
  portalService,
  PortalApiError,
  type PortalOrder,
  type FailedReason,
  type MarkFailedResult,
} from '@/services/portal.service';

interface MarkFailedSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: PortalOrder;
  onSuccess: (result: MarkFailedResult) => void;
}

const REASONS: Array<{ value: FailedReason; label: string }> = [
  { value: 'customer_absent', label: 'Cliente ausente' },
  { value: 'wrong_address', label: 'Dirección equivocada' },
  { value: 'customer_rejected', label: 'Cliente rechazó el paquete' },
  { value: 'other', label: 'Otra razón' },
];

export function MarkFailedSheet({
  open,
  onOpenChange,
  order,
  onSuccess,
}: MarkFailedSheetProps) {
  const { toast } = useToast();
  const isMountedRef = useRef(true);

  // No default reason: pre-selecting "Cliente ausente" biased analytics —
  // couriers confirmed the default without thinking. Force a conscious choice.
  const [reason, setReason] = useState<FailedReason | ''>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setNotes('');
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleSubmit = async () => {
    if (submitting) return;
    if (!reason) return; // Defensive: button is disabled, but guard the path.
    setSubmitting(true);

    try {
      const result = await portalService.markFailed(order.id, {
        reason,
        notes: notes.trim() || undefined,
      });

      if (!isMountedRef.current) return;

      toast({
        title: result.already_logged
          ? 'Ya estaba registrado'
          : 'Intento registrado',
        description: result.already_logged
          ? 'Recientemente cargaste el mismo motivo.'
          : `Quedó cargado el intento fallido en ${order.display_order_number}.`,
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
            : 'No se pudo registrar el intento';
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showDragHandle
        withSafeArea
        className="rounded-t-3xl p-0 max-h-[85vh] flex flex-col"
        aria-describedby={undefined}
      >
        <SheetHeader className="px-6 pt-1 pb-4 border-b border-border">
          <SheetTitle className="flex items-center gap-2 text-base">
            <XCircle className="h-5 w-5 text-rose-600" strokeWidth={2} />
            No se pudo entregar
          </SheetTitle>
          <SheetDescription className="text-xs">
            {order.display_order_number} · {order.customer_name}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          <div className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            La orden sigue en tránsito. Después podés volver a intentar.
          </div>

          <div className="space-y-2">
            <Label htmlFor="failed-reason" className="text-sm font-medium">
              Motivo
            </Label>
            <Select
              value={reason}
              onValueChange={(v) => setReason(v as FailedReason)}
            >
              <SelectTrigger
                id="failed-reason"
                className="h-12"
                aria-required="true"
                aria-invalid={reason === ''}
              >
                <SelectValue placeholder="Elegí un motivo" />
              </SelectTrigger>
              <SelectContent>
                {REASONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="failed-notes" className="text-sm font-medium">
              Detalle (opcional)
            </Label>
            <Textarea
              id="failed-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Por ejemplo: vuelve a las 6, o no responde el portero..."
              rows={4}
              maxLength={500}
              className="resize-none"
            />
          </div>
        </div>

        <div className="border-t border-border bg-card px-6 py-3">
          <Button
            type="button"
            variant="destructive"
            onClick={handleSubmit}
            disabled={submitting || !reason}
            className="h-12 w-full text-base"
            size="lg"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : !reason ? (
              'Elegí un motivo'
            ) : (
              'Registrar intento fallido'
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
