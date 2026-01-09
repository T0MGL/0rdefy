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
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReconciliationSummaryProps {
  carrierName: string;
  dispatchDate: string;
  totalDispatched: number;
  totalDelivered: number;
  totalNotDelivered: number;
  totalCodExpected: number;
  totalCodCollected: number;
  carrierFeePerDelivery: number;
  failedAttemptFeeRate: number;
  discrepancyNotes?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isProcessing: boolean;
}

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('es-PY', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount) + ' Gs';
};

export function ReconciliationSummary({
  carrierName,
  dispatchDate,
  totalDispatched,
  totalDelivered,
  totalNotDelivered,
  totalCodExpected,
  totalCodCollected,
  carrierFeePerDelivery,
  failedAttemptFeeRate,
  discrepancyNotes,
  onConfirm,
  onCancel,
  isProcessing,
}: ReconciliationSummaryProps) {
  const totalCarrierFees = totalDelivered * carrierFeePerDelivery;
  const failedAttemptFees = totalNotDelivered * (carrierFeePerDelivery * failedAttemptFeeRate);
  const netReceivable = totalCodCollected - totalCarrierFees - failedAttemptFees;
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
            <p className="text-sm text-muted-foreground">{dispatchDate}</p>
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
        <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg text-center">
          <div className="flex items-center justify-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            <p className="text-xs text-muted-foreground">Entregados</p>
          </div>
          <p className="text-2xl font-bold text-green-600">{totalDelivered}</p>
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

      {/* Financial Summary */}
      <div className="space-y-3 mb-6">
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">COD Cobrado</span>
          <span className="font-semibold text-green-600">{formatCurrency(totalCodCollected)}</span>
        </div>

        <div className="flex items-center justify-between py-2 text-sm">
          <span className="text-muted-foreground">
            - Tarifas Courier ({totalDelivered} x {formatCurrency(carrierFeePerDelivery)})
          </span>
          <span className="text-red-600">-{formatCurrency(totalCarrierFees)}</span>
        </div>

        {totalNotDelivered > 0 && (
          <div className="flex items-center justify-between py-2 text-sm">
            <span className="text-muted-foreground">
              - Intentos Fallidos ({totalNotDelivered} x {formatCurrency(carrierFeePerDelivery * failedAttemptFeeRate)})
            </span>
            <span className="text-red-600">-{formatCurrency(failedAttemptFees)}</span>
          </div>
        )}

        <div className="border-t pt-3 mt-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" />
              <span className="font-bold text-lg">NETO A RECIBIR</span>
            </div>
            <span className={cn(
              'text-2xl font-bold',
              netReceivable >= 0 ? 'text-green-600' : 'text-red-600'
            )}>
              {formatCurrency(netReceivable)}
            </span>
          </div>
          {netReceivable < 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Monto negativo significa que debes pagar al courier
            </p>
          )}
        </div>
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
