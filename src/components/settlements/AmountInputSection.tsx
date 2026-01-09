import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle, DollarSign, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AmountInputSectionProps {
  totalCodExpected: number;
  totalAmountCollected: number | null;
  onAmountChange: (amount: number) => void;
  discrepancyNotes: string;
  onDiscrepancyNotesChange: (notes: string) => void;
  confirmDiscrepancy: boolean;
  onConfirmDiscrepancyChange: (confirm: boolean) => void;
}

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('es-PY', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount) + ' Gs';
};

export function AmountInputSection({
  totalCodExpected,
  totalAmountCollected,
  onAmountChange,
  discrepancyNotes,
  onDiscrepancyNotesChange,
  confirmDiscrepancy,
  onConfirmDiscrepancyChange,
}: AmountInputSectionProps) {
  const discrepancy = (totalAmountCollected ?? 0) - totalCodExpected;
  const hasDiscrepancy = totalAmountCollected !== null && discrepancy !== 0;
  const hasEnteredAmount = totalAmountCollected !== null && totalAmountCollected > 0;

  return (
    <Card className="p-5">
      <h3 className="font-semibold mb-4 flex items-center gap-2">
        <DollarSign className="h-5 w-5 text-primary" />
        Monto Total Cobrado por el Courier
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Expected */}
        <div className="p-4 bg-muted rounded-lg text-center">
          <p className="text-sm text-muted-foreground mb-1">COD Esperado</p>
          <p className="text-2xl font-bold text-green-600">
            {formatCurrency(totalCodExpected)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Suma de pedidos COD entregados
          </p>
        </div>

        {/* Input */}
        <div className="p-4 bg-primary/5 border-2 border-primary rounded-lg">
          <Label className="text-sm font-medium">Monto que entrega el courier</Label>
          <Input
            type="number"
            value={totalAmountCollected ?? ''}
            onChange={(e) => onAmountChange(Number(e.target.value))}
            className="text-xl font-bold text-center mt-2 h-12"
            placeholder="0"
          />
          <p className="text-xs text-muted-foreground mt-1 text-center">
            Ingrese el monto total en efectivo
          </p>
        </div>

        {/* Difference */}
        <div className={cn(
          'p-4 rounded-lg text-center',
          !hasEnteredAmount && 'bg-muted',
          hasEnteredAmount && !hasDiscrepancy && 'bg-green-100 dark:bg-green-950/30',
          hasEnteredAmount && hasDiscrepancy && discrepancy > 0 && 'bg-green-100 dark:bg-green-950/30',
          hasEnteredAmount && hasDiscrepancy && discrepancy < 0 && 'bg-red-100 dark:bg-red-950/30'
        )}>
          <p className="text-sm text-muted-foreground mb-1">Diferencia</p>
          <div className="flex items-center justify-center gap-2">
            {hasEnteredAmount && hasDiscrepancy && (
              discrepancy > 0
                ? <TrendingUp className="h-5 w-5 text-green-600" />
                : <TrendingDown className="h-5 w-5 text-red-600" />
            )}
            {hasEnteredAmount && !hasDiscrepancy && (
              <Minus className="h-5 w-5 text-muted-foreground" />
            )}
            <p className={cn(
              'text-2xl font-bold',
              !hasEnteredAmount && 'text-muted-foreground',
              hasEnteredAmount && !hasDiscrepancy && 'text-green-600',
              hasEnteredAmount && hasDiscrepancy && discrepancy > 0 && 'text-green-600',
              hasEnteredAmount && hasDiscrepancy && discrepancy < 0 && 'text-red-600'
            )}>
              {!hasEnteredAmount ? '-' : (discrepancy > 0 ? '+' : '') + formatCurrency(discrepancy)}
            </p>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {!hasEnteredAmount && 'Ingrese el monto cobrado'}
            {hasEnteredAmount && !hasDiscrepancy && 'Montos coinciden'}
            {hasEnteredAmount && hasDiscrepancy && discrepancy > 0 && 'Cobro de mas'}
            {hasEnteredAmount && hasDiscrepancy && discrepancy < 0 && 'Cobro de menos'}
          </p>
        </div>
      </div>

      {/* Discrepancy Warning */}
      {hasDiscrepancy && (
        <div className="mt-4 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium text-amber-800 dark:text-amber-200">
                Discrepancia de {formatCurrency(Math.abs(discrepancy))} detectada
              </p>
              <p className="text-sm text-amber-600 dark:text-amber-400 mt-1">
                {discrepancy < 0
                  ? 'El courier entrega menos dinero del esperado. Por favor agregue una nota explicando el motivo.'
                  : 'El courier entrega mas dinero del esperado. Por favor verifique el monto.'}
              </p>

              <Textarea
                placeholder="Explique el motivo de la discrepancia..."
                value={discrepancyNotes}
                onChange={(e) => onDiscrepancyNotesChange(e.target.value)}
                className="mt-3 bg-white dark:bg-gray-900"
                rows={2}
              />

              <div className="flex items-center gap-2 mt-3">
                <Checkbox
                  id="confirm-discrepancy"
                  checked={confirmDiscrepancy}
                  onCheckedChange={(v) => onConfirmDiscrepancyChange(Boolean(v))}
                />
                <Label htmlFor="confirm-discrepancy" className="text-sm cursor-pointer">
                  Confirmo que la discrepancia es correcta y deseo continuar
                </Label>
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
