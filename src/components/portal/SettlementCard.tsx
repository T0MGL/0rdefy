/**
 * Card for an already-closed settlement in /portal/conciliacion → Historial.
 *
 * Distinct from PendingReconciliationCard:
 *   - No checkbox (history is read-only)
 *   - Settlement code is the primary identifier
 *   - Status badge + payment metadata
 *   - Proof thumbnail tap-to-expand (signed URL)
 */

import { useState } from 'react';
import { Calendar, FileText, Receipt } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/utils/currency';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import type { PortalSettlement } from '@/services/portal.service';

interface SettlementCardProps {
  settlement: PortalSettlement;
}

const STATUS_LABELS: Record<string, { label: string; classes: string }> = {
  paid: {
    label: 'Pagada',
    classes: 'bg-primary/15 text-primary ring-primary/30',
  },
  completed: {
    label: 'Completada',
    classes: 'bg-primary/15 text-primary ring-primary/30',
  },
  partial: {
    label: 'Parcial',
    classes:
      'bg-amber-50 text-amber-700 ring-amber-200/60 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30',
  },
  pending: {
    label: 'Pendiente',
    classes:
      'bg-amber-50 text-amber-700 ring-amber-200/60 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30',
  },
  with_issues: {
    label: 'Con ajustes',
    classes:
      'bg-rose-50 text-rose-700 ring-rose-200/60 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/30',
  },
  disputed: {
    label: 'En disputa',
    classes:
      'bg-rose-50 text-rose-700 ring-rose-200/60 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/30',
  },
  cancelled: {
    label: 'Cancelada',
    classes:
      'bg-slate-100 text-slate-700 ring-slate-200/60 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-400/30',
  },
};

const PAYMENT_LABEL: Record<string, string> = {
  transfer: 'Transferencia',
  qr: 'QR',
  cash_deposit: 'Depósito',
  other: 'Otro',
};

function formatDateRange(from: string | null, to: string | null): string {
  if (!from && !to) return '';
  const fmt = (iso: string) =>
    new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString(
      'es-PY',
      { day: '2-digit', month: 'short' },
    );
  if (from && to && from !== to) return `${fmt(from)} → ${fmt(to)}`;
  return fmt(from || to || '');
}

export function SettlementCard({ settlement }: SettlementCardProps) {
  const status = STATUS_LABELS[settlement.status] ?? {
    label: settlement.status,
    classes:
      'bg-slate-100 text-slate-700 ring-slate-200/60 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-400/30',
  };
  const firstProof = settlement.proofs[0];
  const [proofOpen, setProofOpen] = useState(false);

  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {settlement.settlement_code}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {formatDateRange(settlement.min_delivery_date, settlement.max_delivery_date)}
          </p>
        </div>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
            status.classes,
          )}
        >
          {status.label}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-muted/50 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Pedidos
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">
            {settlement.total_orders}
          </p>
        </div>
        <div className="rounded-lg bg-muted/50 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Neto
          </p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums">
            {formatCurrency(settlement.net_receivable)}
          </p>
        </div>
      </div>

      {(settlement.payment_method || settlement.payment_reference) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {settlement.payment_method && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
              <Receipt className="h-3 w-3" strokeWidth={2} />
              {PAYMENT_LABEL[settlement.payment_method] ?? settlement.payment_method}
            </span>
          )}
          {settlement.payment_reference && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 tabular-nums">
              <FileText className="h-3 w-3" strokeWidth={2} />
              {settlement.payment_reference}
            </span>
          )}
          {settlement.submitted_by_courier_at && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
              <Calendar className="h-3 w-3" strokeWidth={2} />
              {new Date(settlement.submitted_by_courier_at).toLocaleDateString(
                'es-PY',
                { day: '2-digit', month: 'short' },
              )}
            </span>
          )}
        </div>
      )}

      {firstProof && (
        <>
          <button
            type="button"
            onClick={() => setProofOpen(true)}
            className="mt-3 flex w-full items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {firstProof.mime_type === 'application/pdf' ? (
              <FileText className="h-4 w-4 shrink-0 text-primary" strokeWidth={2} />
            ) : (
              <img
                src={firstProof.signed_url}
                alt="Vista previa del comprobante"
                className="h-9 w-9 shrink-0 rounded-md object-cover"
                loading="lazy"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <span className="min-w-0 flex-1 truncate text-foreground">
              {firstProof.mime_type === 'application/pdf'
                ? 'Comprobante PDF'
                : 'Comprobante adjunto'}
            </span>
            <span className="shrink-0 text-[11px] text-primary">Ver</span>
          </button>

          <Dialog open={proofOpen} onOpenChange={setProofOpen}>
            <DialogContent className="max-h-[90vh] overflow-hidden p-0 sm:max-w-lg">
              <div className="border-b border-border px-5 py-3">
                <p className="text-sm font-semibold">
                  Comprobante · {settlement.settlement_code}
                </p>
                {firstProof.payment_reference && (
                  <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                    Ref: {firstProof.payment_reference}
                  </p>
                )}
              </div>
              {firstProof.mime_type === 'application/pdf' ? (
                <iframe
                  src={firstProof.signed_url}
                  title="Comprobante PDF"
                  className="h-[70vh] w-full"
                />
              ) : (
                <img
                  src={firstProof.signed_url}
                  alt="Comprobante de transferencia"
                  className="max-h-[80vh] w-full object-contain"
                />
              )}
            </DialogContent>
          </Dialog>
        </>
      )}
    </article>
  );
}
