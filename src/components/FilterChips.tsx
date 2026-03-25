import { Badge } from './ui/badge';
import { X } from 'lucide-react';
import { useState, useEffect } from 'react';
import { logger } from '@/utils/logger';

export interface SavedFilter {
  id: string;
  name: string;
  icon: string;
  filters: Record<string, any>;
  isPermanent?: boolean;
}

interface FilterChipsProps {
  storageKey: string;
  onFilterApply: (filters: Record<string, any>) => void;
  activeFilterId?: string | null;
}

export function FilterChips({ storageKey, onFilterApply, activeFilterId }: FilterChipsProps) {
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [internalActive, setInternalActive] = useState<string | null>(null);

  // Derive the effective active filter: external prop takes precedence when provided
  const activeFilter = activeFilterId !== undefined ? activeFilterId : internalActive;

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    let useDefaults = !stored;

    if (stored) {
      try {
        let parsed = JSON.parse(stored) as SavedFilter[];
        let needsMigration = false;
        parsed = parsed.map(filter => {
          const currentStatus = filter.filters?.status;
          if (currentStatus === 'shipped') {
            needsMigration = true;
            return { ...filter, filters: { ...filter.filters, status: 'in_transit' } };
          }
          if (currentStatus === 'rejected') {
            needsMigration = true;
            return { ...filter, filters: { ...filter.filters, status: 'cancelled' } };
          }
          return filter;
        });
        if (needsMigration) {
          localStorage.setItem(storageKey, JSON.stringify(parsed));
        }
        setSavedFilters(parsed);
      } catch {
        logger.error('[FilterChips] Failed to parse saved filters, using defaults');
        useDefaults = true;
      }
    }

    if (useDefaults) {
      const defaults: SavedFilter[] = [
        {
          id: 'pending',
          name: 'Pendientes',
          icon: '⏰',
          filters: { status: 'pending' },
          isPermanent: true,
        },
        {
          id: 'awaiting-carrier',
          name: 'Esperando Asignacion',
          icon: '🚛',
          filters: { status: 'awaiting_carrier' },
          isPermanent: true,
        },
        {
          id: 'confirmed',
          name: 'Confirmados',
          icon: '✅',
          filters: { status: 'confirmed' },
          isPermanent: true,
        },
        {
          id: 'in-preparation',
          name: 'En Preparacion',
          icon: '🔧',
          filters: { status: 'in_preparation' },
          isPermanent: true,
        },
        {
          id: 'ready-to-ship',
          name: 'Preparados',
          icon: '📦',
          filters: { status: 'ready_to_ship' },
          isPermanent: true,
        },
        {
          id: 'shipped',
          name: 'En Transito',
          icon: '🚚',
          filters: { status: 'in_transit' },
          isPermanent: true,
        },
        {
          id: 'delivered',
          name: 'Entregados',
          icon: '✅',
          filters: { status: 'delivered' },
          isPermanent: true,
        },
        {
          id: 'returned',
          name: 'Devueltos',
          icon: '↩️',
          filters: { status: 'returned' },
          isPermanent: true,
        },
        {
          id: 'cancelled',
          name: 'Cancelados',
          icon: '❌',
          filters: { status: 'cancelled' },
          isPermanent: true,
        },
        {
          id: 'incident',
          name: 'Incidencias',
          icon: '⚠️',
          filters: { status: 'incident' },
          isPermanent: true,
        },
      ];
      setSavedFilters(defaults);
      localStorage.setItem(storageKey, JSON.stringify(defaults));
    }
  }, [storageKey]);

  const handleFilterClick = (filter: SavedFilter) => {
    if (activeFilter === filter.id) {
      setInternalActive(null);
      onFilterApply({});
    } else {
      setInternalActive(filter.id);
      onFilterApply(filter.filters);
    }
  };

  const handleRemoveFilter = (filterId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedFilters.filter((f) => f.id !== filterId);
    setSavedFilters(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
    if (activeFilter === filterId) {
      setInternalActive(null);
      onFilterApply({});
    }
  };

  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1 lg:flex-wrap lg:overflow-x-visible lg:pb-0">
      {savedFilters.map((filter) => (
        <Badge
          key={filter.id}
          variant="outline"
          className={`cursor-pointer px-3 py-1.5 text-sm transition-colors whitespace-nowrap ${
            activeFilter === filter.id
              ? 'bg-primary/20 text-primary border-primary'
              : 'hover:bg-muted'
          }`}
          onClick={() => handleFilterClick(filter)}
        >
          <span className="mr-1.5">{filter.icon}</span>
          {filter.name}
          {!filter.isPermanent && (
            <button
              onClick={(e) => handleRemoveFilter(filter.id, e)}
              className="ml-2 hover:text-destructive"
            >
              <X size={12} />
            </button>
          )}
        </Badge>
      ))}
    </div>
  );
}
