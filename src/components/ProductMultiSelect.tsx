import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown, Package, X } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useIsMobile } from '@/hooks/use-mobile';
import { useProductsForFilter, type ProductFilterOption } from '@/hooks/useProductsForFilter';
import { cn } from '@/lib/utils';

interface ProductMultiSelectProps {
  value: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  emptyLabel?: string;
}

/**
 * Multi-select for products. Renders a Combobox + Command on desktop and a
 * bottom Sheet on mobile (matches the filter-sheet pattern used elsewhere).
 *
 * The component is purely controlled: callers own the selected ids array
 * (typically held in URL state via setSearchParams). When ids in `value`
 * are not present in the loaded options (e.g. archived products), they are
 * still preserved in the array but rendered as a generic chip so the user
 * can clear them.
 */
export function ProductMultiSelect({
  value,
  onChange,
  placeholder = 'Filtrar por producto',
  className,
  triggerClassName,
  emptyLabel = 'Sin productos',
}: ProductMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const { data: products, isLoading } = useProductsForFilter();

  const optionsById = useMemo(() => {
    const map = new Map<string, ProductFilterOption>();
    (products || []).forEach(p => map.set(p.id, p));
    return map;
  }, [products]);

  const selectedOptions = useMemo(
    () => value.map(id => optionsById.get(id)).filter(Boolean) as ProductFilterOption[],
    [value, optionsById]
  );

  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter(v => v !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const clearAll = () => onChange([]);

  const triggerLabel = (() => {
    if (selectedOptions.length === 0) return placeholder;
    if (selectedOptions.length === 1) return selectedOptions[0].name;
    return `${selectedOptions.length} productos`;
  })();

  const list = (
    <Command className="bg-transparent">
      <CommandInput placeholder="Buscar producto..." />
      <CommandList className="max-h-[320px]">
        <CommandEmpty>
          {isLoading ? 'Cargando productos...' : emptyLabel}
        </CommandEmpty>
        <CommandGroup>
          {(products || []).map(product => {
            const isSelected = value.includes(product.id);
            return (
              <CommandItem
                key={product.id}
                value={`${product.name} ${product.sku}`}
                onSelect={() => toggle(product.id)}
                className="cursor-pointer gap-2"
              >
                <div
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/40'
                  )}
                  aria-hidden="true"
                >
                  {isSelected && <Check size={14} />}
                </div>
                {product.image ? (
                  <img
                    src={product.image}
                    alt=""
                    className="h-7 w-7 shrink-0 rounded object-cover bg-muted"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted">
                    <Package size={14} className="text-muted-foreground" />
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{product.name}</span>
                  {product.sku && (
                    <span className="truncate text-[11px] text-muted-foreground">
                      {product.sku}
                    </span>
                  )}
                </div>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              'w-full justify-between gap-2 font-normal',
              selectedOptions.length === 0 && 'text-muted-foreground',
              triggerClassName
            )}
          >
            <span className="truncate">{triggerLabel}</span>
            <div className="flex items-center gap-1.5">
              {selectedOptions.length > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
                  {selectedOptions.length}
                </Badge>
              )}
              <ChevronsUpDown size={16} className="opacity-50 shrink-0" />
            </div>
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className={cn('h-[85vh] p-0 flex flex-col', className)}>
          <SheetHeader className="px-4 py-3 border-b">
            <SheetTitle className="flex items-center justify-between">
              <span>Productos</span>
              {selectedOptions.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAll}
                  className="h-7 text-xs gap-1"
                >
                  <X size={12} />
                  Limpiar
                </Button>
              )}
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">{list}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'w-full justify-between gap-2 font-normal md:w-56',
            selectedOptions.length === 0 && 'text-muted-foreground',
            triggerClassName
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          <div className="flex items-center gap-1.5">
            {selectedOptions.length > 0 && (
              <Badge variant="secondary" className="h-5 px-1.5 text-[11px]">
                {selectedOptions.length}
              </Badge>
            )}
            <ChevronsUpDown size={16} className="opacity-50 shrink-0" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('w-[320px] p-0', className)} align="start">
        {list}
        {selectedOptions.length > 0 && (
          <div className="border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="w-full h-8 text-xs gap-1.5 justify-center"
            >
              <X size={12} />
              Limpiar seleccion
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
