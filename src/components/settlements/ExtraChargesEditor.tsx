/**
 * ExtraChargesEditor - Manual flete lines for a reconciliation (Migration 184)
 *
 * Real-world use case: the courier (e.g. Mike Vargas) charges flete for
 * services that are NOT system orders. Typical examples:
 *   - Relay: hands a parcel off to another courier (Lucero, TSI) that
 *     finishes the route in interior departamentos.
 *   - Operational fees: courier returns and customer wasn't there, an
 *     extra trip is charged, etc.
 *
 * Without this editor the system can't account for those amounts and the
 * net receivable comes out wrong (typically too high in favor of the
 * store, since flete costs are under-reported).
 *
 * Component is fully controlled. Parent owns the list; this only renders
 * + emits onChange. Client-side ids are generated locally so React keys
 * stay stable across edits. They are NOT sent to the backend.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Truck } from 'lucide-react';
import { formatCurrency } from '@/utils/currency';

export interface ExtraCharge {
  /** Client-only id. Never sent to backend. */
  id: string;
  description: string;
  amount: number;
}

export interface ExtraChargesEditorProps {
  charges: ExtraCharge[];
  onChange: (next: ExtraCharge[]) => void;
  /** When true, disables every interactive element (e.g. while submitting). */
  disabled?: boolean;
  /** Hard ceiling; defaults to 20. Server enforces 20 as well. */
  maxEntries?: number;
}

const DEFAULT_MAX = 20;
const DESCRIPTION_MAX = 200;

/** RFC4122-ish client id without pulling a uuid dependency. */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `extra_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function makeExtraCharge(description = '', amount = 0): ExtraCharge {
  return { id: newId(), description, amount };
}

export function ExtraChargesEditor({
  charges,
  onChange,
  disabled = false,
  maxEntries = DEFAULT_MAX,
}: ExtraChargesEditorProps) {
  // Inline add-form state (no modal). When `adding` is true, the input row
  // appears at the top of the list with autofocus on description.
  const [adding, setAdding] = useState(false);
  const [draftDescription, setDraftDescription] = useState('');
  const [draftAmount, setDraftAmount] = useState<string>('');
  const descriptionInputRef = useRef<HTMLInputElement | null>(null);

  // Autofocus the description field when entering the add state.
  useEffect(() => {
    if (adding && descriptionInputRef.current) {
      descriptionInputRef.current.focus();
    }
  }, [adding]);

  const total = charges.reduce((s, c) => s + (Number.isFinite(c.amount) ? c.amount : 0), 0);
  const atCap = charges.length >= maxEntries;

  const handleStartAdd = useCallback(() => {
    if (disabled || atCap) return;
    setDraftDescription('');
    setDraftAmount('');
    setAdding(true);
  }, [disabled, atCap]);

  const handleCancelAdd = useCallback(() => {
    setAdding(false);
    setDraftDescription('');
    setDraftAmount('');
  }, []);

  const draftValid = (() => {
    const d = draftDescription.trim();
    const a = Number(draftAmount);
    // Amount can be negative (for adjustments like "shared TSI delivery -25k").
    // The only disqualifier is exactly zero, which contributes nothing.
    return d.length >= 2 && d.length <= DESCRIPTION_MAX && Number.isFinite(a) && a !== 0;
  })();

  const handleConfirmAdd = useCallback(() => {
    if (!draftValid) return;
    const next: ExtraCharge = {
      id: newId(),
      description: draftDescription.trim(),
      amount: Number(draftAmount),
    };
    onChange([...charges, next]);
    setAdding(false);
    setDraftDescription('');
    setDraftAmount('');
  }, [draftValid, draftDescription, draftAmount, charges, onChange]);

  const handleRemove = useCallback(
    (id: string) => {
      onChange(charges.filter(c => c.id !== id));
    },
    [charges, onChange]
  );

  const handleEditDescription = useCallback(
    (id: string, description: string) => {
      onChange(charges.map(c => (c.id === id ? { ...c, description } : c)));
    },
    [charges, onChange]
  );

  const handleEditAmount = useCallback(
    (id: string, amountRaw: string) => {
      const amt = amountRaw === '' ? 0 : Number(amountRaw);
      // Allow negative amounts for shared-delivery adjustments (e.g. TSI(2)
      // where two prepaid orders ship as one physical delivery and only one
      // flete should be charged). Server-side CHECK was relaxed accordingly.
      onChange(
        charges.map(c => (c.id === id ? { ...c, amount: Number.isFinite(amt) ? amt : 0 } : c))
      );
    },
    [charges, onChange]
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Truck className="h-4 w-4 text-muted-foreground" />
            Envíos extra (opcional)
          </CardTitle>
          {charges.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {charges.length} {charges.length === 1 ? 'línea' : 'líneas'}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1 leading-snug">
          Relays a otros couriers o ajustes al flete. Por ejemplo: entrega a Lucero del
          Interior (+25k), entrega compartida TSI con 2 pedidos pero 1 solo flete (−25k),
          una reentrega no facturada (+30k). Usá montos negativos para descontar.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Existing rows */}
        {charges.length > 0 && (
          <ul className="space-y-2" role="list">
            {charges.map(c => (
              <li
                key={c.id}
                className="flex items-center gap-2 p-2 rounded-md border bg-muted/20"
              >
                <Input
                  value={c.description}
                  onChange={e => handleEditDescription(c.id, e.target.value)}
                  className="flex-1 h-8 text-sm"
                  placeholder="Descripción"
                  maxLength={DESCRIPTION_MAX}
                  disabled={disabled}
                  aria-label="Descripción del envío extra"
                />
                <div className="relative w-36">
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={c.amount || ''}
                    onChange={e => handleEditAmount(c.id, e.target.value)}
                    onWheel={e => (e.target as HTMLInputElement).blur()}
                    className={`h-8 text-sm text-right font-mono pr-8 ${
                      c.amount < 0 ? 'text-emerald-600 dark:text-emerald-400' : ''
                    }`}
                    placeholder="0"
                    step="1"
                    disabled={disabled}
                    aria-label="Monto en guaraníes (negativo para descuento)"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                    Gs
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemove(c.id)}
                  disabled={disabled}
                  aria-label={`Eliminar envío extra: ${c.description || 'sin descripción'}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {/* Inline add form */}
        {adding && (
          <div className="p-3 rounded-md border border-dashed bg-muted/10 space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Label htmlFor="extra-description" className="text-xs">
                  Descripción
                </Label>
                <Input
                  id="extra-description"
                  ref={descriptionInputRef}
                  value={draftDescription}
                  onChange={e => setDraftDescription(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && draftValid) {
                      e.preventDefault();
                      handleConfirmAdd();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      handleCancelAdd();
                    }
                  }}
                  placeholder="Ej: Entrega a Lucero del Interior"
                  maxLength={DESCRIPTION_MAX}
                  className="h-9 mt-1"
                  disabled={disabled}
                />
              </div>
              <div className="w-32">
                <Label htmlFor="extra-amount" className="text-xs">
                  Monto (Gs)
                </Label>
                <Input
                  id="extra-amount"
                  type="number"
                  inputMode="numeric"
                  value={draftAmount}
                  onChange={e => setDraftAmount(e.target.value)}
                  onWheel={e => (e.target as HTMLInputElement).blur()}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && draftValid) {
                      e.preventDefault();
                      handleConfirmAdd();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      handleCancelAdd();
                    }
                  }}
                  placeholder="25000 ó -25000"
                  step="1"
                  className={`h-9 mt-1 text-right font-mono ${
                    Number(draftAmount) < 0 ? 'text-emerald-600 dark:text-emerald-400' : ''
                  }`}
                  disabled={disabled}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCancelAdd}
                disabled={disabled}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleConfirmAdd}
                disabled={!draftValid || disabled}
              >
                Agregar
              </Button>
            </div>
          </div>
        )}

        {/* Add button + cap indicator */}
        {!adding && (
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleStartAdd}
              disabled={disabled || atCap}
              className="gap-1.5"
              aria-label="Agregar envío extra"
            >
              <Plus className="h-3.5 w-3.5" />
              Agregar envío extra
            </Button>
            {atCap && (
              <span className="text-xs text-muted-foreground">
                Máximo {maxEntries} líneas
              </span>
            )}
          </div>
        )}

        {/* Total */}
        {charges.length > 0 && (
          <div className="flex items-center justify-between pt-3 border-t text-sm">
            <span className="text-muted-foreground">Total extras</span>
            <span
              className={`font-mono font-semibold ${
                total < 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {total < 0 ? '−' : ''}
              {formatCurrency(Math.abs(total))}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
