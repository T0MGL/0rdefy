/**
 * Bottom sheet to report an incident on an order.
 *
 * Parks the order at sleeves_status='incident' and notifies the store admin.
 * Description must be at least 10 characters so the admin has something to
 * act on; the helper text below the textarea makes the floor visible.
 */

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
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
import { useToast } from '@/hooks/use-toast';
import {
  portalService,
  PortalApiError,
  type PortalOrder,
  type ReportIncidentResult,
} from '@/services/portal.service';

interface ReportIncidentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: PortalOrder;
  onSuccess: (result: ReportIncidentResult) => void;
}

const MIN_LEN = 10;
const MAX_LEN = 1000;

export function ReportIncidentSheet({
  open,
  onOpenChange,
  order,
  onSuccess,
}: ReportIncidentSheetProps) {
  const { toast } = useToast();
  const isMountedRef = useRef(true);

  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setDescription('');
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const trimmed = description.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_LEN;
  const valid = trimmed.length >= MIN_LEN;

  const handleSubmit = async () => {
    if (submitting || !valid) return;
    setSubmitting(true);

    try {
      const result = await portalService.reportIncident(order.id, {
        description: trimmed,
      });

      if (!isMountedRef.current) return;

      toast({
        title: 'Incidencia reportada',
        description: `${order.display_order_number} quedó marcada con incidencia. Te van a contactar.`,
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
            : 'No se pudo reportar la incidencia';
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
            <AlertTriangle className="h-5 w-5 text-amber-600" strokeWidth={2} />
            Reportar incidencia
          </SheetTitle>
          <SheetDescription className="text-xs">
            {order.display_order_number} · {order.customer_name}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          <div className="rounded-xl border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
            Usá esto para algo que no puedas resolver en el momento. El admin
            del store recibe el aviso enseguida.
          </div>

          <div className="space-y-2">
            <Label htmlFor="incident-description" className="text-sm font-medium">
              ¿Qué pasó?
            </Label>
            <Textarea
              id="incident-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Contá qué pasa con este pedido..."
              rows={6}
              maxLength={MAX_LEN}
              className="resize-none"
              autoFocus
            />
            <div className="flex items-center justify-between text-[11px]">
              <span
                className={
                  tooShort ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'
                }
              >
                {tooShort
                  ? `Mínimo ${MIN_LEN} caracteres`
                  : `Mínimo ${MIN_LEN}, máximo ${MAX_LEN}`}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {trimmed.length} / {MAX_LEN}
              </span>
            </div>
          </div>
        </div>

        <div className="border-t border-border bg-card px-6 py-3">
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !valid}
            className="h-12 w-full bg-amber-600 text-base text-white hover:bg-amber-700"
            size="lg"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Enviando...
              </>
            ) : (
              'Reportar al store'
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
