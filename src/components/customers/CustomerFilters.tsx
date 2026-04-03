import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SlidersHorizontal, ChevronDown, X, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useCallback } from 'react';

export interface CustomerFilterValues {
  min_orders?: number;
  min_spent?: number;
  city?: string;
  accepts_marketing?: boolean;
  last_order_before?: string;
  sort_by?: string;
  sort_order?: string;
}

interface CustomerFiltersProps {
  onFiltersChange: (filters: CustomerFilterValues) => void;
  currentFilters: CustomerFilterValues;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
}

interface FilterPreset {
  id: string;
  label: string;
  filters: CustomerFilterValues;
}

const THIRTY_DAYS_AGO = (): string => {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString();
};

const FILTER_PRESETS: FilterPreset[] = [
  {
    id: 'recurrentes',
    label: 'Recurrentes',
    filters: { min_orders: 2 },
  },
  {
    id: 'vip',
    label: 'VIP',
    filters: { min_spent: 500000 },
  },
  {
    id: 'nuevos',
    label: 'Nuevos (30d)',
    filters: { sort_by: 'created_at', sort_order: 'desc' },
  },
  {
    id: 'inactivos',
    label: 'Inactivos',
    filters: { last_order_before: 'THIRTY_DAYS' },
  },
  {
    id: 'marketing',
    label: 'Marketing',
    filters: { accepts_marketing: true },
  },
];

function isPresetActive(preset: FilterPreset, currentFilters: CustomerFilterValues): boolean {
  const resolved = resolvePresetFilters(preset);
  const keys = Object.keys(resolved) as (keyof CustomerFilterValues)[];
  if (keys.length === 0) return false;

  return keys.every((key) => {
    const presetVal = resolved[key];
    const currentVal = currentFilters[key];
    if (presetVal === undefined) return true;
    if (typeof presetVal === 'number') return Number(currentVal) === presetVal;
    if (typeof presetVal === 'boolean') return currentVal === presetVal;
    if (typeof presetVal === 'string' && key === 'last_order_before') {
      return currentVal !== undefined && currentVal !== '';
    }
    return currentVal === presetVal;
  });
}

function resolvePresetFilters(preset: FilterPreset): CustomerFilterValues {
  const filters = { ...preset.filters };
  if (filters.last_order_before === 'THIRTY_DAYS') {
    filters.last_order_before = THIRTY_DAYS_AGO();
  }
  return filters;
}

export function CustomerFilters({
  onFiltersChange,
  currentFilters,
  onClearFilters,
  hasActiveFilters,
}: CustomerFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);

  const updateFilter = useCallback(
    (key: keyof CustomerFilterValues, value: string | number | boolean | undefined) => {
      const updated = { ...currentFilters };
      if (value === undefined || value === '' || value === 0) {
        delete updated[key];
      } else {
        (updated as Record<string, unknown>)[key] = value;
      }
      onFiltersChange(updated);
    },
    [currentFilters, onFiltersChange],
  );

  const handlePresetClick = useCallback(
    (preset: FilterPreset) => {
      if (isPresetActive(preset, currentFilters)) {
        onClearFilters();
        return;
      }
      const resolved = resolvePresetFilters(preset);
      onFiltersChange(resolved);
    },
    [currentFilters, onFiltersChange, onClearFilters],
  );

  const activeFilterCount = Object.keys(currentFilters).filter((k) => {
    const val = currentFilters[k as keyof CustomerFilterValues];
    return val !== undefined && val !== '' && val !== 0;
  }).length;

  return (
    <div className="space-y-3">
      {/* Preset Chips */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1 lg:flex-wrap lg:overflow-x-visible lg:pb-0">
        {FILTER_PRESETS.map((preset) => {
          const active = isPresetActive(preset, currentFilters);
          return (
            <Badge
              key={preset.id}
              variant="outline"
              className={`cursor-pointer px-3 py-1.5 text-sm transition-colors whitespace-nowrap select-none ${
                active
                  ? 'bg-primary/20 text-primary border-primary'
                  : 'hover:bg-muted'
              }`}
              onClick={() => handlePresetClick(preset)}
            >
              {preset.label}
            </Badge>
          );
        })}

        {hasActiveFilters && (
          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
            <Badge
              variant="outline"
              className="cursor-pointer px-3 py-1.5 text-sm text-destructive border-destructive/30 hover:bg-destructive/10 whitespace-nowrap"
              onClick={onClearFilters}
            >
              <X size={12} className="mr-1" />
              Limpiar
            </Badge>
          </motion.div>
        )}
      </div>

      {/* Advanced Filters Collapsible */}
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
            <SlidersHorizontal size={14} />
            Filtros avanzados
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="h-5 w-5 p-0 flex items-center justify-center text-xs">
                {activeFilterCount}
              </Badge>
            )}
            <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown size={14} />
            </motion.div>
          </Button>
        </CollapsibleTrigger>

        <AnimatePresence>
          {isOpen && (
            <CollapsibleContent forceMount asChild>
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 pt-3 pb-1">
                  {/* Min orders */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Min. pedidos</label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="0"
                      value={currentFilters.min_orders ?? ''}
                      onChange={(e) => {
                        const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                        updateFilter('min_orders', val);
                      }}
                      className="h-9"
                    />
                  </div>

                  {/* Min spent */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Min. gastado</label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="0"
                      value={currentFilters.min_spent ?? ''}
                      onChange={(e) => {
                        const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                        updateFilter('min_spent', val);
                      }}
                      className="h-9"
                    />
                  </div>

                  {/* City */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Ciudad</label>
                    <Input
                      type="text"
                      placeholder="Ej: Asuncion"
                      value={currentFilters.city ?? ''}
                      onChange={(e) => updateFilter('city', e.target.value || undefined)}
                      className="h-9"
                    />
                  </div>

                  {/* Accepts Marketing */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Acepta marketing</label>
                    <div className="flex items-center gap-2 h-9">
                      <Switch
                        checked={currentFilters.accepts_marketing === true}
                        onCheckedChange={(checked) =>
                          updateFilter('accepts_marketing', checked ? true : undefined)
                        }
                      />
                      <span className="text-sm text-muted-foreground">
                        {currentFilters.accepts_marketing ? 'Si' : 'Todos'}
                      </span>
                    </div>
                  </div>

                  {/* Inactive */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Inactivos (30+ dias)</label>
                    <div className="flex items-center gap-2 h-9">
                      <Switch
                        checked={!!currentFilters.last_order_before}
                        onCheckedChange={(checked) =>
                          updateFilter('last_order_before', checked ? THIRTY_DAYS_AGO() : undefined)
                        }
                      />
                      <span className="text-sm text-muted-foreground">
                        {currentFilters.last_order_before ? 'Solo inactivos' : 'Todos'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Clear all inside panel */}
                {hasActiveFilters && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onClearFilters}
                      className="gap-1.5 text-muted-foreground hover:text-destructive"
                    >
                      <RotateCcw size={13} />
                      Limpiar todos los filtros
                    </Button>
                  </motion.div>
                )}
              </motion.div>
            </CollapsibleContent>
          )}
        </AnimatePresence>
      </Collapsible>
    </div>
  );
}
