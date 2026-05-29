import { memo } from 'react';
import { Package, AlertTriangle, ShoppingBag, DollarSign } from 'lucide-react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { formatCurrency } from '@/utils/currency';
import { cn } from '@/lib/utils';
import type { DispatchProductSummary } from '@/services/shipping.service';

interface DispatchProductCardProps {
  summary: DispatchProductSummary;
  selected: boolean;
  onToggleSelect: () => void;
  onView: () => void;
}

/**
 * Single tile in the /shipping cards grid. Shows the wave-level stats for
 * one product (or the global "Mixtos" bucket): order count, units, COD
 * total, optional product image. Selection state is owned by the parent
 * page; this component is purely presentational.
 *
 * Mixtos cards never participate in mono-product batches and are clearly
 * marked: red border, AlertTriangle, "Ver lista" CTA that takes the user
 * to the flat view filtered to multi-product orders. They are excluded
 * from the multi-select toggle (clicking the card just opens the list).
 */
function DispatchProductCardImpl({
  summary,
  selected,
  onToggleSelect,
  onView,
}: DispatchProductCardProps) {
  const isMixed = !summary.is_mono;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.18 }}
      whileHover={{ y: -2 }}
    >
      <Card
        className={cn(
          'relative p-4 transition-all cursor-pointer overflow-hidden',
          isMixed
            ? 'border-red-300 dark:border-red-800 bg-red-50/30 dark:bg-red-950/10 hover:border-red-400'
            : selected
              ? 'border-primary ring-2 ring-primary/20 bg-primary/5'
              : 'hover:border-primary/50'
        )}
        onClick={() => {
          if (isMixed) {
            onView();
          } else {
            onToggleSelect();
          }
        }}
      >
        {/* Header */}
        <div className="flex items-start gap-3">
          {!isMixed && (
            <Checkbox
              checked={selected}
              onCheckedChange={onToggleSelect}
              onClick={e => e.stopPropagation()}
              className="mt-1"
              aria-label={`Seleccionar ${summary.product_name}`}
            />
          )}

          {summary.product_image ? (
            <img
              src={summary.product_image}
              alt=""
              className="h-12 w-12 rounded-md object-cover bg-muted shrink-0"
              loading="lazy"
            />
          ) : (
            <div
              className={cn(
                'h-12 w-12 rounded-md flex items-center justify-center shrink-0',
                isMixed ? 'bg-red-100 dark:bg-red-950/30' : 'bg-muted'
              )}
            >
              {isMixed ? (
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              ) : (
                <Package className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-base leading-tight truncate">
                {summary.product_name}
              </h3>
              {isMixed && (
                <Badge
                  variant="outline"
                  className="bg-red-100 dark:bg-red-950/40 border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 text-[10px] uppercase tracking-wide"
                >
                  Mixtos
                </Badge>
              )}
            </div>
            {isMixed && (
              <p className="text-[11px] text-red-700 dark:text-red-300 mt-0.5">
                Multi producto, requieren atencion
              </p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat
            icon={<ShoppingBag className="h-3.5 w-3.5" />}
            label="Pedidos"
            value={summary.order_count.toString()}
            tone={isMixed ? 'danger' : 'default'}
          />
          {!isMixed && (
            <Stat
              icon={<Package className="h-3.5 w-3.5" />}
              label="Unidades"
              value={summary.unit_count.toString()}
            />
          )}
          {isMixed && <div />}
          <Stat
            icon={<DollarSign className="h-3.5 w-3.5" />}
            label="COD"
            value={formatCurrency(summary.cod_total)}
            tone={summary.cod_total > 0 ? 'success' : 'muted'}
          />
        </div>

        {/* CTA */}
        <div className="mt-4 pt-3 border-t flex items-center justify-end gap-2">
          {isMixed ? (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs border-red-300 dark:border-red-800 text-red-700 dark:text-red-300"
              onClick={e => {
                e.stopPropagation();
                onView();
              }}
            >
              Ver lista
            </Button>
          ) : (
            <Button
              size="sm"
              variant={selected ? 'default' : 'outline'}
              className="h-8 text-xs"
              onClick={e => {
                e.stopPropagation();
                onToggleSelect();
              }}
            >
              {selected ? 'Seleccionado' : 'Seleccionar'}
            </Button>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

interface StatProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'danger' | 'muted';
}

function Stat({ icon, label, value, tone = 'default' }: StatProps) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span
        className={cn(
          'flex items-center gap-1 text-[10px] uppercase tracking-wide',
          tone === 'danger' ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground'
        )}
      >
        {icon}
        {label}
      </span>
      <span
        className={cn(
          'text-sm font-semibold tabular-nums truncate',
          tone === 'success' && 'text-primary dark:text-primary',
          tone === 'danger' && 'text-red-700 dark:text-red-300',
          tone === 'muted' && 'text-muted-foreground'
        )}
      >
        {value}
      </span>
    </div>
  );
}

export const DispatchProductCard = memo(DispatchProductCardImpl);
