import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2,
  XCircle,
  DollarSign,
  Truck,
  AlertTriangle,
  Loader2,
  Calendar,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/utils/currency';

interface ReconciliationSummaryProps {
  carrierName: string;
  /**
   * Display label for the settlement header. For legacy single-day
   * settlements this is the dispatch/delivery date. For carrier-grouped
   * settlements (Migration 182) pass `coveredRangeLabel` instead and
   * leave this empty.
   */
  dispatchDate: string;
  /**
   * Optional pre-formatted range string ("4/5 al 9/5"). When provided,
   * overrides `dispatchDate` for display purposes and renders a small
   * "Cubre" sub-line for clarity.
   */
  coveredRangeLabel?: string;
  totalDispatched: number;
  totalDelivered: number;
  totalNotDelivered: number;
  totalCodExpected: number;
  totalCodCollected: number;
  totalCarrierFees: number;
  totalFailedAttemptFees: number;
  discrepancyNotes?: string;
  feesAreEstimated?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  isProcessing: boolean;
}


export function ReconciliationSummary({
  carrierName,
  dispatchDate,
  coveredRangeLabel,
  totalDispatched,
  totalDelivered,
  totalNotDelivered,
  totalCodExpected,
  totalCodCollected,
  totalCarrierFees,
  totalFailedAttemptFees,
  discrepancyNotes,
  feesAreEstimated = false,
  onConfirm,
  onCancel,
  isProcessing,
}: ReconciliationSummaryProps) {
  // NETO = COD cobrado por el courier - tarifas de entrega - tarifas por intentos fallidos
  const netReceivable = totalCodCollected - totalCarrierFees - totalFailedAttemptFees;
  const hasDiscrepancy = totalCodCollected !== totalCodExpected;

  return (
    <Card className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Truck className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-bold text-lg">{carrierName}</h2>
            <p className="text-sm text-muted-foreground">{coveredRangeLabel || dispatchDate}</p>
            {coveredRangeLabel && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                <Calendar className="h-3 w-3" />
                Cubre: {coveredRangeLabel}
              </p>
            )}
          </div>
        </div>
        <Badge variant="outline" className="text-sm">
          Resumen de Conciliacion
        </Badge>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="p-3 bg-muted rounded-lg text-center">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-2xl font-bold">{totalDispatched}</p>
        </div>
        <div className="p-3 bg-primary/5 dark:bg-primary/30 rounded-lg text-center">
          <div className="flex items-center justify-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
            <p className="text-xs text-muted-foreground">Entregados</p>
          </div>
          <p className="text-2xl font-bold text-primary">{totalDelivered}</p>
        </div>
        <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-lg text-center">
          <div className="flex items-center justify-center gap-1">
            <XCircle className="h-3.5 w-3.5 text-red-600" />
            <p className="text-xs text-muted-foreground">No Entregados</p>
          </div>
          <p className="text-2xl font-bold text-red-600">{totalNotDelivered}</p>
        </div>
        <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg text-center">
          <p className="text-xs text-muted-foreground">Tasa Exito</p>
          <p className="text-2xl font-bold text-blue-600">
            {totalDispatched > 0 ? Math.round((totalDelivered / totalDispatched) * 100) : 0}%
          </p>
        </div>
      </div>

      {/* Financial Summary - Clear breakdown */}
      <div className="space-y-2 mb-6 font-mono text-sm">
        {/* Section: COD */}
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
          Cobros COD
        </div>
        <div className="flex items-center justify-between py-1">
          <span className="text-muted-foreground">COD Esperado</span>
          <span>{formatCurrency(totalCodExpected)}</span>
        </div>
        <div className="flex items-center justify-between py-1">
          <span className="text-muted-foreground">COD Cobrado</span>
          <span className="font-semibold">{formatCurrency(totalCodCollected)}</span>
        </div>
        {hasDiscrepancy && (
          <div className={cn(
            "flex items-center justify-between py-1",
            totalCodCollected - totalCodExpected < 0 ? 'text-red-600' : 'text-primary'
          )}>
            <span>Diferencia</span>
            <span>{totalCodCollected - totalCodExpected > 0 ? '+' : ''}{formatCurrency(totalCodCollected - totalCodExpected)}</span>
          </div>
        )}

        <div className="border-t my-3" />

        {/* Section: EGRESOS */}
        <div className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
          Tarifas
        </div>
        {feesAreEstimated ? (
          <div className="flex items-center justify-between py-1 text-muted-foreground">
            <span>Tarifas de entrega</span>
            <span className="text-xs italic">calculadas al confirmar</span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between py-1 text-muted-foreground">
              <span>Entregas ({totalDelivered} pedidos)</span>
              <span>-{formatCurrency(totalCarrierFees)}</span>
            </div>
            {totalNotDelivered > 0 && totalFailedAttemptFees > 0 && (
              <div className="flex items-center justify-between py-1 text-muted-foreground">
                <span>Fallidos ({totalNotDelivered} pedidos)</span>
                <span>-{formatCurrency(totalFailedAttemptFees)}</span>
              </div>
            )}
          </>
        )}

        <div className="border-t border-primary/20 my-3" />

        {/* NETO */}
        {feesAreEstimated ? (
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-muted-foreground" />
              <span className="font-bold text-lg text-muted-foreground">NETO A RECIBIR</span>
            </div>
            <span className="text-sm text-muted-foreground italic">calculado al confirmar</span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-primary" />
                <span className="font-bold text-lg">NETO A RECIBIR</span>
              </div>
              <span className={cn(
                'text-2xl font-bold',
                netReceivable >= 0 ? 'text-primary' : 'text-red-600'
              )}>
                {formatCurrency(netReceivable)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground text-right">
              {netReceivable >= 0 ? 'El courier te debe' : 'Le debes al courier'}
            </p>
          </>
        )}
      </div>

      {/* Discrepancy Warning */}
      {hasDiscrepancy && (
        <div className="mb-6 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Discrepancia de {formatCurrency(Math.abs(totalCodCollected - totalCodExpected))}
              </p>
              {discrepancyNotes && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Nota: {discrepancyNotes}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-4 border-t">
        <Button variant="outline" onClick={onCancel} disabled={isProcessing} className="flex-1">
          Cancelar
        </Button>
        <Button onClick={onConfirm} disabled={isProcessing} className="flex-1 gap-2">
          {isProcessing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Procesando...
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4" />
              Confirmar Conciliacion
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}
