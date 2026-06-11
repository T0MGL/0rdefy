/**
 * SupplierMobileList
 *
 * Mobile card representation of suppliers (replaces the wide table on <lg).
 * Mirrors the OrderMobileList pattern: dense card, 3-row layout, tap to edit.
 *
 * No row-level dropdowns: the edit/delete actions live in the dedicated
 * sheet that opens on tap, matching the spec ("table -> cards" and "row
 * actions hidden behind detail").
 */
import { formatDecimal } from '@/utils/currency';
import { memo } from 'react';
import { Edit, Star, Trash2, Mail, Phone } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { tap as hapticTap } from '@/lib/haptics';

export interface SupplierMobileItem {
  id: string;
  name: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  rating?: number;
  products_supplied?: number;
  products_count?: number;
}

interface SupplierMobileListProps {
  suppliers: SupplierMobileItem[];
  onEdit: (supplier: SupplierMobileItem) => void;
  onDelete: (id: string) => void;
}

const SupplierCard = memo(function SupplierCard({
  supplier,
  onEdit,
  onDelete,
}: {
  supplier: SupplierMobileItem;
  onEdit: (s: SupplierMobileItem) => void;
  onDelete: (id: string) => void;
}) {
  const productCount = supplier.products_supplied ?? supplier.products_count ?? 0;
  return (
    <Card
      onClick={() => {
        hapticTap();
        onEdit(supplier);
      }}
      className={cn(
        'p-4 transition-all cursor-pointer rounded-2xl',
        'border border-border/40 hover:border-primary/40 active:scale-[0.99]',
      )}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEdit(supplier);
        }
      }}
      aria-label={`Editar proveedor ${supplier.name}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold leading-snug truncate">
            {supplier.name}
          </h3>
          {supplier.contact_person && (
            <p className="text-[13px] text-muted-foreground truncate mt-0.5">
              {supplier.contact_person}
            </p>
          )}
        </div>
        {supplier.rating ? (
          <div className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1">
            <Star size={14} className="fill-primary text-primary" />
            <span className="text-[13px] font-semibold tabular-nums">
              {formatDecimal(supplier.rating, 1)}
            </span>
          </div>
        ) : null}
      </div>

      {(supplier.email || supplier.phone) && (
        <div className="mt-3 space-y-1.5">
          {supplier.email && (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Mail size={13} className="shrink-0" aria-hidden="true" />
              <span className="truncate">{supplier.email}</span>
            </div>
          )}
          {supplier.phone && (
            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Phone size={13} className="shrink-0" aria-hidden="true" />
              <span className="truncate tabular-nums">{supplier.phone}</span>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2">
        <Badge variant="outline" className="tabular-nums">
          {productCount} producto{productCount === 1 ? '' : 's'}
        </Badge>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 -mr-1"
            onClick={(e) => {
              e.stopPropagation();
              hapticTap();
              onEdit(supplier);
            }}
            aria-label={`Editar ${supplier.name}`}
          >
            <Edit size={16} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 -mr-1 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(supplier.id);
            }}
            aria-label={`Eliminar ${supplier.name}`}
          >
            <Trash2 size={16} />
          </Button>
        </div>
      </div>
    </Card>
  );
});

export function SupplierMobileList({
  suppliers,
  onEdit,
  onDelete,
}: SupplierMobileListProps) {
  return (
    <div className="space-y-2" role="list" aria-label="Proveedores">
      {suppliers.map((s) => (
        <div role="listitem" key={s.id}>
          <SupplierCard supplier={s} onEdit={onEdit} onDelete={onDelete} />
        </div>
      ))}
    </div>
  );
}
