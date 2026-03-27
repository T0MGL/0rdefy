// ================================================================
// CARRIER COVERAGE MANAGER
// ================================================================
// Full-screen dialog for configuring city-based carrier coverage.
// Two tabs: Gran Asuncion (20 cities) and Interior (~246 cities
// grouped by department). Base rate propagation, per-city overrides,
// exclusion controls. Saves via bulk upsert.
// ================================================================

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';
import {
  MapPin,
  Loader2,
  X,
  ChevronDown,
  ChevronRight,
  Search,
  Save,
  Globe,
  Building2,
  Undo2,
} from 'lucide-react';
import {
  carrierCoverageService,
  type LocationCity,
  type BulkCoverageItem,
} from '@/services/carrier-coverage.service';

// ================================================================
// TYPES
// ================================================================

/** Per-city state tracked in the UI */
interface CityState {
  city: string;
  department: string;
  zone_code: string;
  rate: number | null;       // null = excluded (sin cobertura)
  isCustom: boolean;         // true = user manually edited this city's rate
  isExcluded: boolean;       // true = explicitly removed from coverage
}

interface CarrierCoverageManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  carrierId: string;
  carrierName: string;
  onSaved?: () => void;
}

// ================================================================
// HELPERS
// ================================================================

function normalizeKey(city: string): string {
  return city.toLowerCase().trim();
}

function parseRate(value: string): number | null {
  const cleaned = value.replace(/[^\d]/g, '');
  if (!cleaned) return null;
  const num = parseInt(cleaned, 10);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function formatRateInput(rate: number | null): string {
  if (rate === null || rate === undefined) return '';
  return rate.toString();
}

// ================================================================
// COMPONENT
// ================================================================

export function CarrierCoverageManager({
  open,
  onOpenChange,
  carrierId,
  carrierName,
  onSaved,
}: CarrierCoverageManagerProps) {
  const { toast } = useToast();

  // Memory leak prevention
  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Data
  const [granAsuncionCities, setGranAsuncionCities] = useState<LocationCity[]>([]);
  const [interiorDepartments, setInteriorDepartments] = useState<Record<string, LocationCity[]>>({});
  const [totalLocations, setTotalLocations] = useState(0);

  // City states (keyed by normalized city name)
  const [cityStates, setCityStates] = useState<Map<string, CityState>>(new Map());

  // Base rates
  const [granAsuncionBaseRate, setGranAsuncionBaseRate] = useState<string>('');
  const [interiorBaseRate, setInteriorBaseRate] = useState<string>('');
  const [departmentBaseRates, setDepartmentBaseRates] = useState<Record<string, string>>({});

  // UI
  const [activeTab, setActiveTab] = useState<'gran_asuncion' | 'interior'>('gran_asuncion');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [openDepartments, setOpenDepartments] = useState<Set<string>>(new Set());
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // ================================================================
  // LIFECYCLE
  // ================================================================

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!open) {
      abortControllerRef.current?.abort();
      return;
    }
    if (carrierId) {
      loadData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, carrierId]);

  // ================================================================
  // DATA LOADING
  // ================================================================

  const loadData = async () => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setLoading(true);

      const [locationsResp, coverageResp] = await Promise.all([
        carrierCoverageService.getGroupedLocations(controller.signal),
        carrierCoverageService.getCoverageAll(carrierId, controller.signal),
      ]);

      if (!isMountedRef.current || controller.signal.aborted) return;

      setGranAsuncionCities(locationsResp.gran_asuncion.cities);
      setInteriorDepartments(locationsResp.interior.departments);
      setTotalLocations(locationsResp.total);

      // Build initial city state from locations + existing coverage
      const newStates = new Map<string, CityState>();
      const coverageMap = coverageResp.coverage_map;

      const initCity = (loc: LocationCity) => {
        const key = normalizeKey(loc.city);
        const existing = coverageMap[key];

        newStates.set(key, {
          city: loc.city,
          department: loc.department,
          zone_code: loc.zone_code,
          rate: existing ? existing.rate : null,
          isCustom: existing != null,
          isExcluded: existing ? existing.rate === null : false,
        });
      };

      for (const loc of locationsResp.gran_asuncion.cities) {
        initCity(loc);
      }
      for (const cities of Object.values(locationsResp.interior.departments)) {
        for (const loc of cities) {
          initCity(loc);
        }
      }

      setCityStates(newStates);

      // Detect base rates from existing data:
      // If all non-excluded gran_asuncion cities share one rate, use it as base
      const gaRates = locationsResp.gran_asuncion.cities
        .map(c => coverageMap[normalizeKey(c.city)])
        .filter(c => c && c.rate !== null)
        .map(c => c!.rate);

      if (gaRates.length > 0) {
        const uniqueGaRates = new Set(gaRates);
        if (uniqueGaRates.size === 1) {
          setGranAsuncionBaseRate(gaRates[0]!.toString());
        }
      }

      // Same for interior
      const intRates: number[] = [];
      for (const cities of Object.values(locationsResp.interior.departments)) {
        for (const loc of cities) {
          const cov = coverageMap[normalizeKey(loc.city)];
          if (cov && cov.rate !== null) {
            intRates.push(cov.rate);
          }
        }
      }
      if (intRates.length > 0) {
        const uniqueIntRates = new Set(intRates);
        if (uniqueIntRates.size === 1) {
          setInteriorBaseRate(intRates[0].toString());
        }
      }

      setHasUnsavedChanges(false);
      setSearchQuery('');
      setActiveTab('gran_asuncion');

    } catch (error: any) {
      if (!isMountedRef.current || controller.signal.aborted) return;
      logger.error('Error loading coverage data:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudieron cargar los datos de cobertura',
      });
    } finally {
      if (isMountedRef.current && !controller.signal.aborted) setLoading(false);
    }
  };

  // ================================================================
  // BASE RATE PROPAGATION
  // ================================================================

  const applyGranAsuncionBaseRate = useCallback((rateStr: string) => {
    setGranAsuncionBaseRate(rateStr);
    const rate = parseRate(rateStr);

    setCityStates(prev => {
      const next = new Map(prev);
      for (const loc of granAsuncionCities) {
        const key = normalizeKey(loc.city);
        const current = next.get(key);
        if (!current) continue;
        // Only overwrite if not custom-edited
        if (!current.isCustom) {
          next.set(key, {
            ...current,
            rate: rate,
            isExcluded: rate === null,
          });
        }
      }
      return next;
    });
    setHasUnsavedChanges(true);
  }, [granAsuncionCities]);

  const applyInteriorBaseRate = useCallback((rateStr: string) => {
    setInteriorBaseRate(rateStr);
    const rate = parseRate(rateStr);

    setCityStates(prev => {
      const next = new Map(prev);
      for (const cities of Object.values(interiorDepartments)) {
        for (const loc of cities) {
          const key = normalizeKey(loc.city);
          const current = next.get(key);
          if (!current) continue;
          if (!current.isCustom) {
            next.set(key, {
              ...current,
              rate: rate,
              isExcluded: rate === null,
            });
          }
        }
      }
      return next;
    });
    setHasUnsavedChanges(true);
  }, [interiorDepartments]);

  const applyDepartmentBaseRate = useCallback((department: string, rateStr: string) => {
    setDepartmentBaseRates(prev => ({ ...prev, [department]: rateStr }));
    const rate = parseRate(rateStr);
    const cities = interiorDepartments[department] || [];

    setCityStates(prev => {
      const next = new Map(prev);
      for (const loc of cities) {
        const key = normalizeKey(loc.city);
        const current = next.get(key);
        if (!current) continue;
        if (!current.isCustom) {
          next.set(key, {
            ...current,
            rate: rate,
            isExcluded: rate === null,
          });
        }
      }
      return next;
    });
    setHasUnsavedChanges(true);
  }, [interiorDepartments]);

  // ================================================================
  // INDIVIDUAL CITY ACTIONS
  // ================================================================

  const setCityRate = useCallback((cityName: string, rateStr: string) => {
    const key = normalizeKey(cityName);
    const rate = parseRate(rateStr);

    setCityStates(prev => {
      const next = new Map(prev);
      const current = next.get(key);
      if (!current) return next;
      next.set(key, {
        ...current,
        rate: rate,
        isCustom: true,
        isExcluded: false,
      });
      return next;
    });
    setHasUnsavedChanges(true);
  }, []);

  const excludeCity = useCallback((cityName: string) => {
    const key = normalizeKey(cityName);

    setCityStates(prev => {
      const next = new Map(prev);
      const current = next.get(key);
      if (!current) return next;
      next.set(key, {
        ...current,
        rate: null,
        isCustom: true,
        isExcluded: true,
      });
      return next;
    });
    setHasUnsavedChanges(true);
  }, []);

  const resetCity = useCallback((cityName: string, zoneCode: string) => {
    const key = normalizeKey(cityName);

    // Determine which base rate to apply
    let baseRateStr = '';
    if (zoneCode === 'ASUNCION' || zoneCode === 'CENTRAL') {
      baseRateStr = granAsuncionBaseRate;
    } else {
      // Find the city's department for department-level rate
      const cityState = cityStates.get(key);
      const deptRate = cityState ? departmentBaseRates[cityState.department] : undefined;
      baseRateStr = deptRate || interiorBaseRate;
    }

    const rate = parseRate(baseRateStr);

    setCityStates(prev => {
      const next = new Map(prev);
      const current = next.get(key);
      if (!current) return next;
      next.set(key, {
        ...current,
        rate: rate,
        isCustom: false,
        isExcluded: rate === null,
      });
      return next;
    });
    setHasUnsavedChanges(true);
  }, [granAsuncionBaseRate, interiorBaseRate, departmentBaseRates, cityStates]);

  const excludeDepartment = useCallback((department: string) => {
    const cities = interiorDepartments[department] || [];
    setCityStates(prev => {
      const next = new Map(prev);
      for (const loc of cities) {
        const key = normalizeKey(loc.city);
        const current = next.get(key);
        if (!current) continue;
        next.set(key, {
          ...current,
          rate: null,
          isCustom: false,
          isExcluded: true,
        });
      }
      return next;
    });
    setDepartmentBaseRates(prev => ({ ...prev, [department]: '' }));
    setHasUnsavedChanges(true);
  }, [interiorDepartments]);

  // ================================================================
  // STATS
  // ================================================================

  const stats = useMemo(() => {
    let gaConfigured = 0;
    let gaExcluded = 0;
    let gaTotal = granAsuncionCities.length;

    for (const loc of granAsuncionCities) {
      const state = cityStates.get(normalizeKey(loc.city));
      if (!state) continue;
      if (state.isExcluded || state.rate === null) {
        gaExcluded++;
      } else if (state.rate !== null) {
        gaConfigured++;
      }
    }

    let intConfigured = 0;
    let intExcluded = 0;
    let intTotal = 0;
    const deptStats: Record<string, { configured: number; excluded: number; total: number }> = {};

    for (const [dept, cities] of Object.entries(interiorDepartments)) {
      deptStats[dept] = { configured: 0, excluded: 0, total: cities.length };
      intTotal += cities.length;

      for (const loc of cities) {
        const state = cityStates.get(normalizeKey(loc.city));
        if (!state) continue;
        if (state.isExcluded || state.rate === null) {
          intExcluded++;
          deptStats[dept].excluded++;
        } else if (state.rate !== null) {
          intConfigured++;
          deptStats[dept].configured++;
        }
      }
    }

    return {
      ga: { configured: gaConfigured, excluded: gaExcluded, total: gaTotal },
      int: { configured: intConfigured, excluded: intExcluded, total: intTotal },
      departments: deptStats,
    };
  }, [granAsuncionCities, interiorDepartments, cityStates]);

  // ================================================================
  // SEARCH FILTER (Interior only)
  // ================================================================

  const filteredInterior = useMemo(() => {
    if (!searchQuery.trim()) return interiorDepartments;

    const q = searchQuery.toLowerCase().trim();
    const filtered: Record<string, LocationCity[]> = {};

    for (const [dept, cities] of Object.entries(interiorDepartments)) {
      const matching = cities.filter(c =>
        c.city.toLowerCase().includes(q) ||
        dept.toLowerCase().includes(q)
      );
      if (matching.length > 0) {
        filtered[dept] = matching;
      }
    }
    return filtered;
  }, [interiorDepartments, searchQuery]);

  // ================================================================
  // SAVE
  // ================================================================

  const handleSave = async () => {
    const coverage: BulkCoverageItem[] = [];

    cityStates.forEach((state) => {
      // Only include cities that have a rate set or are explicitly excluded
      if (state.rate !== null || state.isExcluded || state.isCustom) {
        coverage.push({
          city: state.city,
          department: state.department,
          rate: state.rate,
        });
      }
    });

    if (coverage.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Sin cambios',
        description: 'Configura al menos una ciudad con tarifa antes de guardar.',
      });
      return;
    }

    try {
      setSaving(true);
      const result = await carrierCoverageService.saveBulkCoverage(carrierId, coverage);

      if (!isMountedRef.current) return;

      toast({
        title: 'Cobertura guardada',
        description: `Se actualizaron ${result.count} ciudades para ${carrierName}.`,
      });
      setHasUnsavedChanges(false);
      onSaved?.();
    } catch (error: any) {
      if (!isMountedRef.current) return;
      logger.error('Error saving coverage:', error);
      toast({
        variant: 'destructive',
        title: 'Error al guardar',
        description: error.message || 'No se pudo guardar la cobertura. Intenta nuevamente.',
      });
    } finally {
      if (isMountedRef.current) setSaving(false);
    }
  };

  // ================================================================
  // DEPARTMENT TOGGLE
  // ================================================================

  const toggleDepartment = (dept: string) => {
    setOpenDepartments(prev => {
      const next = new Set(prev);
      if (next.has(dept)) {
        next.delete(dept);
      } else {
        next.add(dept);
      }
      return next;
    });
  };

  // ================================================================
  // RENDER: CITY ROW
  // ================================================================

  const renderCityRow = (loc: LocationCity) => {
    const key = normalizeKey(loc.city);
    const state = cityStates.get(key);
    if (!state) return null;

    const isExcluded = state.isExcluded || (state.rate === null && !state.isCustom && state.rate !== 0);
    const isConfigured = state.rate !== null && !isExcluded;
    const isCustom = state.isCustom;

    return (
      <div
        key={`${loc.city}-${loc.department}`}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors group',
          isExcluded
            ? 'border-red-200/50 bg-red-50/30 dark:border-red-900/30 dark:bg-red-950/10'
            : isConfigured
              ? 'border-green-200/50 bg-green-50/30 dark:border-green-900/30 dark:bg-green-950/10'
              : 'border-border bg-background'
        )}
      >
        {/* City name */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn(
              'text-sm font-medium truncate',
              isExcluded && 'text-muted-foreground line-through'
            )}>
              {loc.city}
            </span>
            {loc.department !== 'ASUNCION' && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                ({loc.department})
              </span>
            )}
            {isCustom && !isExcluded && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400">
                Personalizado
              </Badge>
            )}
          </div>
        </div>

        {/* Rate input or excluded badge */}
        {isExcluded ? (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30">
              Sin cobertura
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => resetCity(loc.city, loc.zone_code)}
              title="Restaurar"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="relative w-28">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                Gs.
              </span>
              <Input
                type="text"
                inputMode="numeric"
                className="h-8 pl-9 pr-2 text-sm text-right tabular-nums"
                value={formatRateInput(state.rate)}
                onChange={(e) => setCityRate(loc.city, e.target.value)}
                placeholder="0"
              />
            </div>
            {isCustom && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => resetCity(loc.city, loc.zone_code)}
                title="Restaurar a tarifa base"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
              onClick={() => excludeCity(loc.city)}
              title="Excluir ciudad"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    );
  };

  // ================================================================
  // RENDER: DEPARTMENT GROUP
  // ================================================================

  const renderDepartmentGroup = (department: string, cities: LocationCity[]) => {
    const isOpen = openDepartments.has(department);
    const deptStat = stats.departments[department] || { configured: 0, excluded: 0, total: cities.length };
    const deptBaseRate = departmentBaseRates[department] || '';

    // Check if all cities are excluded
    const allExcluded = cities.every(c => {
      const state = cityStates.get(normalizeKey(c.city));
      return state && (state.isExcluded || state.rate === null);
    });

    return (
      <Collapsible
        key={department}
        open={isOpen}
        onOpenChange={() => toggleDepartment(department)}
      >
        <div className={cn(
          'rounded-lg border transition-colors',
          allExcluded
            ? 'border-red-200/30 dark:border-red-900/20'
            : 'border-border'
        )}>
          {/* Department header */}
          <CollapsibleTrigger asChild>
            <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/50 rounded-t-lg transition-colors">
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{department}</span>
                  <Badge
                    variant={deptStat.configured > 0 ? 'default' : 'secondary'}
                    className={cn(
                      'text-[10px] px-1.5 py-0 h-4',
                      deptStat.configured > 0
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-100'
                        : ''
                    )}
                  >
                    {deptStat.configured}/{deptStat.total}
                  </Badge>
                  {allExcluded && deptStat.total > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 text-red-600 dark:text-red-400">
                      Excluido
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="px-4 pb-3 space-y-3">
              {/* Department base rate + actions */}
              <div className="flex items-center gap-3 pt-1 pb-2 border-b border-dashed">
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">Tarifa depto:</span>
                  <div className="relative w-28">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      Gs.
                    </span>
                    <Input
                      type="text"
                      inputMode="numeric"
                      className="h-7 pl-9 pr-2 text-xs text-right tabular-nums"
                      value={deptBaseRate}
                      onChange={(e) => applyDepartmentBaseRate(department, e.target.value)}
                      placeholder="Tarifa base"
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 px-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    excludeDepartment(department);
                  }}
                >
                  <X className="h-3 w-3 mr-1" />
                  Excluir todo
                </Button>
              </div>

              {/* Cities */}
              <div className="space-y-1.5">
                {cities.map(loc => renderCityRow(loc))}
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    );
  };

  // ================================================================
  // RENDER
  // ================================================================

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen && hasUnsavedChanges) {
          const confirmed = window.confirm('Tienes cambios sin guardar. Descartar?');
          if (!confirmed) return;
        }
        if (!isOpen) {
          setGranAsuncionBaseRate('');
          setInteriorBaseRate('');
          setDepartmentBaseRates({});
          setSearchQuery('');
          setOpenDepartments(new Set());
        }
        onOpenChange(isOpen);
      }}
    >
      <DialogContent className="max-w-3xl h-[90vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Configurar Cobertura
          </DialogTitle>
          <DialogDescription>
            Define las tarifas de envio por ciudad para {carrierName}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Cargando ciudades...</p>
            </div>
          </div>
        ) : (
          <>
            {/* Tab bar + stats */}
            <div className="px-6 pt-4 pb-3 border-b shrink-0 space-y-3">
              {/* Tabs */}
              <div className="flex gap-2">
                <Button
                  variant={activeTab === 'gran_asuncion' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setActiveTab('gran_asuncion')}
                  className="gap-2"
                >
                  <Building2 className="h-4 w-4" />
                  Gran Asuncion
                  <Badge
                    variant="secondary"
                    className={cn(
                      'text-[10px] px-1.5 py-0 h-4 ml-1',
                      activeTab === 'gran_asuncion'
                        ? 'bg-white/20 text-inherit'
                        : ''
                    )}
                  >
                    {stats.ga.configured}/{stats.ga.total}
                  </Badge>
                </Button>
                <Button
                  variant={activeTab === 'interior' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setActiveTab('interior')}
                  className="gap-2"
                >
                  <Globe className="h-4 w-4" />
                  Interior
                  <Badge
                    variant="secondary"
                    className={cn(
                      'text-[10px] px-1.5 py-0 h-4 ml-1',
                      activeTab === 'interior'
                        ? 'bg-white/20 text-inherit'
                        : ''
                    )}
                  >
                    {stats.int.configured}/{stats.int.total}
                  </Badge>
                </Button>
              </div>

              {/* Base rate input */}
              {activeTab === 'gran_asuncion' && (
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium whitespace-nowrap">Tarifa base:</span>
                  <div className="relative w-36">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      Gs.
                    </span>
                    <Input
                      type="text"
                      inputMode="numeric"
                      className="h-9 pl-10 pr-3 text-sm text-right tabular-nums"
                      value={granAsuncionBaseRate}
                      onChange={(e) => applyGranAsuncionBaseRate(e.target.value)}
                      placeholder="Ej: 25000"
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Se aplica a las {granAsuncionCities.length} ciudades no editadas
                  </span>
                </div>
              )}

              {activeTab === 'interior' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium whitespace-nowrap">Tarifa base:</span>
                    <div className="relative w-36">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                        Gs.
                      </span>
                      <Input
                        type="text"
                        inputMode="numeric"
                        className="h-9 pl-10 pr-3 text-sm text-right tabular-nums"
                        value={interiorBaseRate}
                        onChange={(e) => applyInteriorBaseRate(e.target.value)}
                        placeholder="Ej: 40000"
                      />
                    </div>
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                      Para todas las ciudades del Interior no editadas
                    </span>
                  </div>

                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      type="text"
                      className="h-9 pl-9 pr-3 text-sm"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Buscar ciudad o departamento..."
                    />
                    {searchQuery && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                        onClick={() => setSearchQuery('')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Content area */}
            <ScrollArea className="flex-1">
              <div className="px-6 py-4 space-y-2">
                {activeTab === 'gran_asuncion' && (
                  <div className="space-y-1.5">
                    {granAsuncionCities.map(loc => renderCityRow(loc))}
                  </div>
                )}

                {activeTab === 'interior' && (
                  <div className="space-y-3">
                    {Object.keys(filteredInterior).length === 0 ? (
                      <div className="text-center py-12 text-muted-foreground">
                        <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">No se encontraron ciudades para "{searchQuery}"</p>
                      </div>
                    ) : (
                      Object.entries(filteredInterior).map(([dept, cities]) =>
                        renderDepartmentGroup(dept, cities)
                      )
                    )}
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Footer */}
            <div className="px-6 py-4 border-t shrink-0 flex items-center justify-between gap-4">
              <div className="text-xs text-muted-foreground">
                {stats.ga.configured + stats.int.configured} de {totalLocations} ciudades con tarifa
                {(stats.ga.excluded + stats.int.excluded) > 0 && (
                  <span className="text-red-500 ml-2">
                    ({stats.ga.excluded + stats.int.excluded} excluidas)
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={saving}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={saving || !hasUnsavedChanges}
                  className="gap-2 min-w-[120px]"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Guardando...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Guardar
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
