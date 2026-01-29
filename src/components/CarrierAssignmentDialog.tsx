import { useState, useEffect } from 'react';
import { logger } from '@/utils/logger';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';
import { useCarriers } from '@/hooks/useCarriers';
import { Loader2, Check, ChevronsUpDown, MapPin, Truck, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Order } from '@/types';
import { formatCurrency } from '@/utils/currency';
import { getOrderDisplayId } from '@/utils/orderDisplay';

// Types for city coverage system
interface CityLocation {
  city: string;
  department: string;
  zone_code: string;
  display_text: string;
}

interface CarrierWithCoverage {
  carrier_id: string;
  carrier_name: string;
  carrier_phone: string | null;
  rate: number | null;
  zone_code: string;
  has_coverage: boolean;
}

interface CarrierAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order | null;
  onAssigned: () => void;
}

export function CarrierAssignmentDialog({
  open,
  onOpenChange,
  order,
  onAssigned,
}: CarrierAssignmentDialogProps) {
  const { toast } = useToast();
  const { carriers, isLoading: loadingCarriers, isError: carriersError, refetch: refetchCarriers } = useCarriers({ activeOnly: true });

  const [loading, setLoading] = useState(false);
  const [courierId, setCourierId] = useState<string>('');
  const [shippingCost, setShippingCost] = useState<number>(0);

  // City-based coverage system state
  const [citySearch, setCitySearch] = useState('');
  const [cityResults, setCityResults] = useState<CityLocation[]>([]);
  const [selectedCity, setSelectedCity] = useState<CityLocation | null>(null);
  const [loadingCities, setLoadingCities] = useState(false);
  const [openCityCombobox, setOpenCityCombobox] = useState(false);
  const [carriersWithCoverage, setCarriersWithCoverage] = useState<CarrierWithCoverage[]>([]);
  const [loadingCoverage, setLoadingCoverage] = useState(false);

  // Search cities for autocomplete (debounced)
  useEffect(() => {
    const searchCities = async () => {
      if (!citySearch || citySearch.length < 2) {
        setCityResults([]);
        return;
      }

      try {
        setLoadingCities(true);
        const token = localStorage.getItem('auth_token');
        const storeId = localStorage.getItem('current_store_id');

        const response = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/carriers/locations/search?q=${encodeURIComponent(citySearch)}&limit=10`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'X-Store-ID': storeId || '',
            },
          }
        );

        if (response.ok) {
          const { data } = await response.json();
          setCityResults(data || []);
        } else {
          setCityResults([]);
        }
      } catch (error) {
        logger.error('Error searching cities:', error);
        setCityResults([]);
      } finally {
        setLoadingCities(false);
      }
    };

    // Debounce search
    const timeoutId = setTimeout(searchCities, 300);
    return () => clearTimeout(timeoutId);
  }, [citySearch]);

  // Fetch carriers with coverage when city is selected
  useEffect(() => {
    const fetchCarriersForCity = async () => {
      if (!selectedCity) {
        setCarriersWithCoverage([]);
        return;
      }

      try {
        setLoadingCoverage(true);
        const token = localStorage.getItem('auth_token');
        const storeId = localStorage.getItem('current_store_id');

        const response = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/carriers/coverage/city?city=${encodeURIComponent(selectedCity.city)}&department=${encodeURIComponent(selectedCity.department || '')}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'X-Store-ID': storeId || '',
            },
          }
        );

        if (response.ok) {
          const { data } = await response.json();
          // Sort: carriers with coverage first, then by rate (lowest first)
          const sorted = (data || []).sort((a: CarrierWithCoverage, b: CarrierWithCoverage) => {
            if (a.has_coverage && !b.has_coverage) return -1;
            if (!a.has_coverage && b.has_coverage) return 1;
            if (a.rate === null) return 1;
            if (b.rate === null) return -1;
            return a.rate - b.rate;
          });
          setCarriersWithCoverage(sorted);

          // Auto-select cheapest carrier with coverage
          const cheapest = sorted.find((c: CarrierWithCoverage) => c.has_coverage);
          if (cheapest) {
            setCourierId(cheapest.carrier_id);
            setShippingCost(cheapest.rate || 0);
          }
        } else {
          setCarriersWithCoverage([]);
        }
      } catch (error) {
        logger.error('Error fetching carriers for city:', error);
        setCarriersWithCoverage([]);
      } finally {
        setLoadingCoverage(false);
      }
    };

    fetchCarriersForCity();
  }, [selectedCity]);

  // Reset state when dialog opens
  useEffect(() => {
    if (open && order) {
      setCourierId('');
      setShippingCost(0);
      setOpenCityCombobox(false);
      setCitySearch('');
      setCityResults([]);
      setCarriersWithCoverage([]);

      // Pre-fill city if order already has one
      const orderShippingCity = (order as any)?.shipping_city;
      if (orderShippingCity) {
        setSelectedCity({
          city: orderShippingCity,
          department: '',
          zone_code: (order as any)?.delivery_zone || '',
          display_text: orderShippingCity,
        });
      } else {
        setSelectedCity(null);
      }

      refetchCarriers();
    }
  }, [open, order, refetchCarriers]);

  const handleAssign = async () => {
    if (!order) return;

    if (!courierId) {
      toast({
        title: 'Repartidor requerido',
        description: 'Debes seleccionar un repartidor',
        variant: 'destructive',
      });
      return;
    }

    if (!selectedCity) {
      toast({
        title: 'Ciudad requerida',
        description: 'Debes seleccionar la ciudad de entrega',
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);

      const token = localStorage.getItem('auth_token');
      const storeId = localStorage.getItem('current_store_id');

      const payload = {
        courier_id: courierId,
        shipping_cost: shippingCost,
        shipping_city: selectedCity.city,
        delivery_zone: selectedCity.zone_code,
      };

      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/orders/${order.id}/assign-carrier`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'X-Store-ID': storeId || '',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to assign carrier');
      }

      toast({
        title: 'Repartidor asignado',
        description: 'El pedido ha sido asignado al repartidor exitosamente.',
        duration: 5000,
      });

      onAssigned();
      onOpenChange(false);
    } catch (error: any) {
      logger.error('Error assigning carrier:', error);

      toast({
        title: 'Error al asignar',
        description: error.message || 'No se pudo asignar el repartidor. Intenta nuevamente.',
        variant: 'destructive',
        duration: 5000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setCourierId('');
    setShippingCost(0);
    setCitySearch('');
    setCityResults([]);
    setSelectedCity(null);
    setCarriersWithCoverage([]);
    setOpenCityCombobox(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Asignar Repartidor</DialogTitle>
          <DialogDescription>
            Asigna un repartidor y zona de entrega a este pedido confirmado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Order Info */}
          {order && (
            <div className="rounded-lg border p-3 bg-muted/50 space-y-2">
              <p className="text-sm font-medium">Pedido {getOrderDisplayId(order)}</p>
              <p className="text-sm text-muted-foreground">Cliente: {order.customer}</p>
              <p className="text-sm text-muted-foreground">Total: {formatCurrency(order.total ?? 0)}</p>
              {order.address && (
                <p className="text-sm text-muted-foreground">Dirección: {order.address}</p>
              )}
            </div>
          )}

          {/* Awaiting carrier info */}
          <div className="p-4 rounded-lg border-2 border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/30">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900 flex items-center justify-center">
                <Truck className="h-5 w-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="font-medium text-orange-900 dark:text-orange-100">
                  Venta confirmada - Esperando asignación
                </p>
                <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                  Un confirmador ya verificó esta venta con el cliente. Ahora debes asignar el repartidor y zona de entrega.
                </p>
              </div>
            </div>
          </div>

          {/* City Search (Autocomplete) */}
          <div className="space-y-2">
            <Label htmlFor="city-search">
              <MapPin className="h-4 w-4 inline mr-1" />
              Ciudad de entrega <span className="text-red-500">*</span>
            </Label>
            <Popover open={openCityCombobox} onOpenChange={setOpenCityCombobox}>
              <PopoverTrigger asChild>
                <Button
                  id="city-search"
                  variant="outline"
                  role="combobox"
                  aria-expanded={openCityCombobox}
                  className="w-full justify-between"
                >
                  {selectedCity ? (
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-primary" />
                      <span>{selectedCity.display_text}</span>
                      {selectedCity.zone_code && (
                        <Badge variant="secondary" className="text-xs">
                          {selectedCity.zone_code.replace('_', ' ')}
                        </Badge>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">Escribe la ciudad...</span>
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Buscar ciudad..."
                    value={citySearch}
                    onValueChange={setCitySearch}
                  />
                  {loadingCities ? (
                    <div className="flex items-center justify-center p-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="ml-2 text-sm">Buscando...</span>
                    </div>
                  ) : cityResults.length === 0 && citySearch.length >= 2 ? (
                    <CommandEmpty>No se encontraron ciudades.</CommandEmpty>
                  ) : (
                    <CommandGroup className="max-h-64 overflow-auto">
                      {cityResults.map((city) => (
                        <CommandItem
                          key={`${city.city}-${city.department}`}
                          value={city.display_text}
                          onSelect={() => {
                            setSelectedCity(city);
                            setCitySearch('');
                            setOpenCityCombobox(false);
                            // Reset carrier when city changes
                            setCourierId('');
                            setShippingCost(0);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              selectedCity?.city === city.city ? "opacity-100" : "opacity-0"
                            )}
                          />
                          <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-2">
                              <MapPin className="h-4 w-4 text-muted-foreground" />
                              <span>{city.city}</span>
                              <span className="text-xs text-muted-foreground">({city.department})</span>
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {city.zone_code.replace('_', ' ')}
                            </Badge>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {/* Carrier Selection with Coverage */}
          {selectedCity && (
            <div className="space-y-2">
              <Label htmlFor="courier-coverage">
                <Truck className="h-4 w-4 inline mr-1" />
                Repartidor <span className="text-red-500">*</span>
              </Label>
              {loadingCoverage ? (
                <div className="flex items-center justify-center p-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="ml-2 text-sm text-muted-foreground">Cargando cobertura...</span>
                </div>
              ) : carriersWithCoverage.length === 0 ? (
                <div className="p-4 rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/20">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                        Sin cobertura configurada
                      </p>
                      <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                        No hay repartidores con cobertura para {selectedCity.city}.
                        Ve a Logística → Transportadoras para configurar tarifas.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {carriersWithCoverage.map((carrier) => (
                    <div
                      key={carrier.carrier_id}
                      onClick={() => {
                        if (carrier.has_coverage) {
                          setCourierId(carrier.carrier_id);
                          setShippingCost(carrier.rate || 0);
                        }
                      }}
                      className={cn(
                        "p-3 rounded-lg border-2 cursor-pointer transition-all",
                        carrier.carrier_id === courierId
                          ? "border-primary bg-primary/5"
                          : carrier.has_coverage
                            ? "border-muted hover:border-primary/50 hover:bg-muted/50"
                            : "border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/20 cursor-not-allowed opacity-60"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-5 h-5 rounded-full border-2 flex items-center justify-center",
                            carrier.carrier_id === courierId
                              ? "border-primary bg-primary"
                              : "border-muted-foreground/30"
                          )}>
                            {carrier.carrier_id === courierId && (
                              <Check className="h-3 w-3 text-white" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium">{carrier.carrier_name}</p>
                            {carrier.carrier_phone && (
                              <p className="text-xs text-muted-foreground">{carrier.carrier_phone}</p>
                            )}
                          </div>
                        </div>
                        {carrier.has_coverage ? (
                          <Badge variant={carrier.carrier_id === courierId ? "default" : "secondary"} className="text-base px-3">
                            {formatCurrency(Number(carrier.rate || 0))}
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">
                            SIN COBERTURA
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Show selected shipping cost */}
          {selectedCity && courierId && shippingCost > 0 && (
            <div className="p-3 rounded-lg border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                Costo de envío: <span className="text-lg">{formatCurrency(shippingCost)}</span>
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                {selectedCity.city} → {carriersWithCoverage.find(c => c.carrier_id === courierId)?.carrier_name}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleAssign}
            disabled={loading || !courierId || !selectedCity}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Asignando...
              </>
            ) : (
              <>
                <Truck className="mr-2 h-4 w-4" />
                Asignar Repartidor
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
