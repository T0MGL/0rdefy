/**
 * Bottom sheet to mark an order as returned.
 *
 * Triggers stock restoration on the backend (handled by trigger
 * `trigger_update_stock_on_order_status`). We surface that side effect to
 * the courier so they don't second-guess what's happening.
 *
 * Two-step confirm: first the courier picks the reason, then taps the
 * destructive button to commit.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
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
  type MarkReturnedResult,
} from '@/services/portal.service';

interface MarkReturnedSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: PortalOrder;
  onSuccess: (result: MarkReturnedResult) => void;
}

const REASONS: Array<{ value: string; label: string }> = [
  { value: 'customer_rejected', label: 'Cliente rechazó el pedido' },
  { value: 'damaged', label: 'Producto dañado' },
  { value: 'wrong_item', label: 'Producto equivocado' },
  { value: 'incomplete', label: 'Pedido incompleto' },
  { value: 'address_unreachable', label: 'No se pudo llegar al cliente' },
  { value: 'other', label: 'Otra razón' },
];

export function MarkReturnedSheet({
  open,
  onOpenChange,
  order,
  onSuccess,
}: MarkReturnedSheetProps) {
  const { toast } = useToast();
  const isMountedRef = useRef(true);

  const [reason, setReason] = useState('customer_rejected');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('customer_rejected');
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
    setSubmitting(true);

    try {
      const result = await portalService.markReturned(order.id, {
        reason,
        notes: notes.trim() || undefined,
      });

      if (!isMountedRef.current) return;

      toast({
        title: result.already_returned
          ? 'Ya estaba devuelta'
          : 'Devolución registrada',
        description: result.already_returned
          ? 'No se hicieron cambios.'
          : `${order.display_order_number} pasó a devuelta. El stock se restaura automáticamente.`,
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
            : 'No se pudo marcar como devuelta';
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
            <RotateCcw className="h-5 w-5 text-slate-700 dark:text-slate-300" strokeWidth={2} />
            Marcar como devuelta
          </SheetTitle>
          <SheetDescription className="text-xs">
            {order.display_order_number} · {order.customer_name}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          <div className="rounded-xl border border-amber-200/60 bg-amber-50/60 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
            El stock vuelve al almacén automáticamente cuando confirmás.
          </div>

          <div className="space-y-2">
            <Label htmlFor="returned-reason" className="text-sm font-medium">
              Motivo de la devolución
            </Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger id="returned-reason" className="h-12">
                <SelectValue />
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
            <Label htmlFor="returned-notes" className="text-sm font-medium">
              Detalle (opcional)
            </Label>
            <Textarea
              id="returned-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Algo que aclare la devolución..."
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
            disabled={submitting}
            className="h-12 w-full text-base"
            size="lg"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Confirmando...
              </>
            ) : (
              'Confirmar devolución'
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
