import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { X, Plus } from 'lucide-react';
import { useState, useEffect } from 'react';

export interface SavedFilter {
  id: string;
  name: string;
  icon: string;
  filters: Record<string, any>;
  isPermanent?: boolean; // Filtros permanentes no se pueden eliminar
}

interface FilterChipsProps {
  storageKey: string;
  onFilterApply: (filters: Record<string, any>) => void;
}

export function FilterChips({ storageKey, onFilterApply }: FilterChipsProps) {
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        setSavedFilters(JSON.parse(stored));
      } catch {
        console.error('[FilterChips] Failed to parse saved filters');
        // Continue with defaults on parse error
      }
    }
    if (!stored) {
      // Filtros por defecto para pedidos (permanentes - no se pueden eliminar)
      const defaults: SavedFilter[] = [
        {
          id: 'pending',
          name: 'Pendientes',
          icon: '⏰',
          filters: { status: 'pending' },
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
          name: 'En Preparación',
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
          name: 'En Tránsito',
          icon: '🚚',
          filters: { status: 'shipped' },
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
      setActiveFilter(null);
      onFilterApply({});
    } else {
      setActiveFilter(filter.id);
      onFilterApply(filter.filters);
    }
  };

  const handleRemoveFilter = (filterId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = savedFilters.filter((f) => f.id !== filterId);
    setSavedFilters(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
    if (activeFilter === filterId) {
      setActiveFilter(null);
      onFilterApply({});
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {savedFilters.map((filter) => (
        <Badge
          key={filter.id}
          variant="outline"
          className={`cursor-pointer px-3 py-1.5 text-sm transition-colors ${
            activeFilter === filter.id
              ? 'bg-primary/20 text-primary border-primary'
              : 'hover:bg-muted'
          }`}
          onClick={() => handleFilterClick(filter)}
        >
          <span className="mr-2">{filter.icon}</span>
          {filter.name}
          {/* Solo mostrar botón X si NO es permanente */}
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
      {/* Ocultar botón de guardar filtro por ahora */}
    </div>
  );
}
