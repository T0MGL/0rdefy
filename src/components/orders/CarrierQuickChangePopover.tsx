import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Loader2, MapPin, Truck, AlertCircle } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useCarriers } from '@/hooks/useCarriers';
import { useCarriersWithCoverage, type CarrierWithCoverage } from '@/hooks/useCarriersWithCoverage';
import { ordersService } from '@/services/orders.service';
import { formatCurrency } from '@/utils/currency';
import { cn } from '@/lib/utils';
import { logger } from '@/utils/logger';
import type { Order } from '@/types';

interface Props {
  order: Order;
  onChanged: (updatedOrder: Order) => void;
  onRequestFullAssign?: (order: Order) => void;
  disabled?: boolean;
}

const CARRIER_EDITABLE_STATUSES = new Set([
  'confirmed',
  'contacted',
  'in_preparation',
  'ready_to_ship',
]);

export function isCarrierQuickChangeEligible(order: Order): boolean {
  if (order.is_pickup) return false;
  if (!order.carrier_id) return false;
  return CARRIER_EDITABLE_STATUSES.has(order.status as string);
}

export function CarrierQuickChangePopover({
  order,
  onChanged,
  onRequestFullAssign,
  disabled,
}: Props) {
  const { toast } = useToast();
  const { getCarrierName } = useCarriers({ activeOnly: false });

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const shippingCity = order.shipping_city?.trim() || null;

  const {
    carriers: coverage,
    isLoading: loadingCoverage,
    isError: coverageError,
  } = useCarriersWithCoverage(shippingCity, { enabled: open && !!shippingCity });

  const currentLabel = useMemo(() => {
    const resolved = getCarrierName(order.carrier);
    return resolved || order.carrier || 'Sin asignar';
  }, [getCarrierName, order.carrier]);

  const handleSelect = async (carrier: CarrierWithCoverage) => {
    if (submitting) return;
    if (carrier.carrier_id === order.carrier_id) {
      setOpen(false);
      return;
    }

    setOpen(false);
    setSubmitting(true);

    const previousSnapshot: Order = { ...order };
    const wasPrinted = !!order.printed;

    const optimistic: Order = {
      ...order,
      carrier: carrier.carrier_id,
      carrier_id: carrier.carrier_id,
      shipping_cost: carrier.rate ?? order.shipping_cost,
      delivery_zone: carrier.zone_code || order.delivery_zone,
      printed: wasPrinted ? false : order.printed,
      printed_at: wasPrinted ? undefined : order.printed_at,
      printed_by: wasPrinted ? undefined : order.printed_by,
    };

    onChanged(optimistic);

    try {
      const updated = await ordersService.update(order.id, {
        carrier: carrier.carrier_id,
        shipping_cost: carrier.rate ?? undefined,
        delivery_zone: carrier.zone_code || undefined,
      }, order.store_id);

      if (!isMountedRef.current) return;

      if (!updated) {
        throw new Error('La orden no fue encontrada');
      }

      onChanged(updated);

      toast({
        title: 'Repartidor actualizado',
        description: `${carrier.carrier_name} ahora lleva esta orden.`,
      });

      if (wasPrinted) {
        toast({
          title: 'Reimprimí la etiqueta',
          description: 'Los datos del repartidor cambiaron, la etiqueta anterior quedó obsoleta.',
        });
      }
    } catch (error: unknown) {
      if (!isMountedRef.current) return;
      logger.error('Error cambiando repartidor desde popover:', error);
      onChanged(previousSnapshot);
      const message = error instanceof Error ? error.message : 'No se pudo cambiar el repartidor';
      toast({
        title: 'Error al cambiar repartidor',
        description: message,
        variant: 'destructive',
      });
    } finally {
      if (isMountedRef.current) setSubmitting(false);
    }
  };

  if (disabled) {
    return <span className="text-foreground">{currentLabel}</span>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={submitting}
          aria-label={`Cambiar repartidor (actual: ${currentLabel})`}
          className={cn(
            'h-7 -mx-1 px-2 font-normal text-sm gap-1 text-foreground',
            'hover:bg-muted/60 data-[state=open]:bg-muted',
            submitting && 'opacity-70 cursor-wait',
          )}
        >
          <span className="truncate max-w-[160px]">{currentLabel}</span>
          {submitting ? (
            <Loader2 size={12} className="animate-spin opacity-70" />
          ) : (
            <ChevronsUpDown size={12} className="opacity-50 flex-shrink-0" />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[280px] p-0" align="start">
        <div className="px-3 py-2 border-b border-border/60 flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin size={12} />
          {shippingCity ? (
            <span className="truncate">{shippingCity}</span>
          ) : (
            <span>Orden sin ciudad</span>
          )}
        </div>

        {!shippingCity ? (
          <EmptyState
            icon={<AlertCircle size={16} className="text-amber-500" />}
            title="Esta orden no tiene ciudad"
            description="Asigná una ciudad para poder seleccionar repartidores con cobertura."
            actionLabel={onRequestFullAssign ? 'Asignar ciudad y repartidor' : undefined}
            onAction={onRequestFullAssign ? () => { setOpen(false); onRequestFullAssign(order); } : undefined}
          />
        ) : loadingCoverage ? (
          <CoverageSkeleton />
        ) : coverageError ? (
          <EmptyState
            icon={<AlertCircle size={16} className="text-destructive" />}
            title="No pudimos cargar los repartidores"
            description="Reintentá en unos segundos."
          />
        ) : coverage.length === 0 ? (
          <EmptyState
            icon={<AlertCircle size={16} className="text-amber-500" />}
            title={`Sin cobertura en ${shippingCity}`}
            description="Ningún repartidor activo cubre esta ciudad."
            actionLabel={onRequestFullAssign ? 'Editar orden completa' : undefined}
            onAction={onRequestFullAssign ? () => { setOpen(false); onRequestFullAssign(order); } : undefined}
          />
        ) : (
          <Command>
            <CommandInput placeholder="Buscar repartidor..." className="h-9" />
            <CommandList>
              <CommandEmpty>Sin resultados</CommandEmpty>
              <CommandGroup>
                {coverage.map((c) => {
                  const isCurrent = c.carrier_id === order.carrier_id;
                  return (
                    <CommandItem
                      key={c.carrier_id}
                      value={c.carrier_name}
                      onSelect={() => handleSelect(c)}
                      className="flex items-center justify-between gap-2 cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Truck size={14} className="text-muted-foreground flex-shrink-0" />
                        <span className="truncate">{c.carrier_name}</span>
                        {isCurrent && (
                          <Check size={14} className="text-primary flex-shrink-0" />
                        )}
                      </div>
                      {c.rate != null && (
                        <Badge variant="secondary" className="font-mono text-[11px] flex-shrink-0">
                          {formatCurrency(c.rate)}
                        </Badge>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}

function CoverageSkeleton() {
  return (
    <div className="p-2 space-y-1">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-2 px-2 py-2 rounded-md"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse flex-shrink-0" />
            <div className="h-3 rounded bg-muted animate-pulse flex-1 max-w-[140px]" />
          </div>
          <div className="h-5 w-16 rounded bg-muted animate-pulse flex-shrink-0" />
        </div>
      ))}
    </div>
  );
}

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

function EmptyState({ icon, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="p-4 flex flex-col items-start gap-2">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-sm font-medium text-foreground">{title}</p>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      {actionLabel && onAction && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-1 h-7 text-xs"
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
