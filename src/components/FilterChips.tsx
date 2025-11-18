import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { X, Plus } from 'lucide-react';
import { useState, useEffect } from 'react';

export interface SavedFilter {
  id: string;
  name: string;
  icon: string;
  filters: Record<string, any>;
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
      setSavedFilters(JSON.parse(stored));
    } else {
      // Filtros por defecto
      const defaults: SavedFilter[] = [
        {
          id: 'pending-today',
          name: 'Pendientes Hoy',
          icon: '⏰',
          filters: { status: 'pending' },
        },
        {
          id: 'low-stock',
          name: 'Stock Bajo',
          icon: '📦',
          filters: { maxStock: 10 },
        },
        {
          id: 'deliveries-tomorrow',
          name: 'Entregas Mañana',
          icon: '🚚',
          filters: { deliveryDate: 'tomorrow' },
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
          <button
            onClick={(e) => handleRemoveFilter(filter.id, e)}
            className="ml-2 hover:text-destructive"
          >
            <X size={12} />
          </button>
        </Badge>
      ))}
      <Button variant="ghost" size="sm" className="h-7 text-xs">
        <Plus size={14} className="mr-1" />
        Guardar filtro actual
      </Button>
    </div>
  );
}
