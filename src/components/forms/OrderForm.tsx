import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { logger } from '@/utils/logger';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { Loader2, Check, ChevronsUpDown, MapPin, Truck, Store } from 'lucide-react';
import { productsService } from '@/services/products.service';
import { useState, useEffect } from 'react';
import { Product } from '@/types';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { DeliveryPreferencesAccordion, type DeliveryPreferences } from '@/components/DeliveryPreferencesAccordion';

// Types for city coverage system
interface CityLocation {
  city: string;
  department: string;
  zone_code: string;
  display_text?: string;
}

interface CarrierWithCoverage {
  carrier_id: string;
  carrier_name: string;
  carrier_phone: string | null;
  rate: number | null;
  zone_code: string;
  has_coverage: boolean;
}

const orderSchema = z.object({
  customer: z.string().trim().min(1, 'El nombre del cliente es requerido').max(100),
  countryCode: z.string().min(1, 'Selecciona un código de país'),
  phone: z.string().trim().regex(/^[0-9]{6,15}$/, 'Formato de teléfono inválido (solo números)'),
  address: z.string().trim().min(1, 'La dirección es requerida').max(300),
  googleMapsLink: z.string().optional(),
  product: z.string().min(1, 'Selecciona un producto'),
  quantity: z.number().int().positive('La cantidad debe ser mayor a 0'),
  carrier: z.string().optional(),
  paymentMethod: z.enum(['paid', 'cod'], {
    errorMap: () => ({ message: 'Selecciona un método de pago' })
  }),
});

type OrderFormValues = z.infer<typeof orderSchema>;

// Extended form data that includes shipping info
export interface OrderFormData extends OrderFormValues {
  shippingCity?: string;
  shippingCityNormalized?: string;
  deliveryZone?: string;
  shippingCost?: number;
  isPickup?: boolean;
  deliveryPreferences?: DeliveryPreferences | null;
}

interface OrderFormProps {
  onSubmit: (data: OrderFormData) => void;
  onCancel: () => void;
  initialData?: Partial<OrderFormData>;
}

export function OrderForm({ onSubmit, onCancel, initialData }: OrderFormProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);

  // City coverage system state
  const [citySearch, setCitySearch] = useState('');
  const [cityResults, setCityResults] = useState<CityLocation[]>([]);
  const [selectedCity, setSelectedCity] = useState<CityLocation | null>(null);
  const [loadingCities, setLoadingCities] = useState(false);
  const [openCityCombobox, setOpenCityCombobox] = useState(false);

  // Carriers with coverage for selected city
  const [carriersWithCoverage, setCarriersWithCoverage] = useState<CarrierWithCoverage[]>([]);
  const [loadingCoverage, setLoadingCoverage] = useState(false);
  const [selectedCarrierId, setSelectedCarrierId] = useState<string>('');
  const [shippingCost, setShippingCost] = useState<number>(0);

  // Pickup option
  const [isPickup, setIsPickup] = useState(false);

  // Delivery preferences (scheduling)
  const [deliveryPreferences, setDeliveryPreferences] = useState<DeliveryPreferences | null>(
    initialData?.deliveryPreferences || null
  );

  // Form must be defined before useEffects that use it
  const form = useForm<OrderFormValues>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      customer: initialData?.customer || '',
      countryCode: '+595',
      phone: initialData?.phone?.replace(/^\+\d+\s*/, '') || '',
      address: initialData?.address || '',
      googleMapsLink: initialData?.googleMapsLink || '',
      product: initialData?.product || '',
      quantity: initialData?.quantity || 1,
      carrier: initialData?.carrier || '',
      paymentMethod: initialData?.paymentMethod || 'cod',
    },
  });

  useEffect(() => {
    let isMounted = true;
    const loadProducts = async () => {
      try {
        const data = await productsService.getAll();
        if (isMounted) {
          setProducts(data);
        }
      } catch (error) {
        logger.error('Error loading products:', error);
        if (isMounted) {
          setProducts([]);
        }
      } finally {
        if (isMounted) {
          setIsLoadingProducts(false);
        }
      }
    };
    loadProducts();
    return () => { isMounted = false; };
  }, []);

  // Search cities for autocomplete (debounced)
  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const searchCities = async () => {
      if (!citySearch || citySearch.length < 2 || isPickup) {
        if (isMounted) setCityResults([]);
        return;
      }

      try {
        if (isMounted) setLoadingCities(true);
        const token = localStorage.getItem('auth_token');
        const storeId = localStorage.getItem('current_store_id');

        const response = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/carriers/locations/search?q=${encodeURIComponent(citySearch)}&limit=10`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'X-Store-ID': storeId || '',
            },
            signal: controller.signal,
          }
        );

        if (response.ok && isMounted) {
          const { data } = await response.json();
          setCityResults(data || []);
        } else if (isMounted) {
          setCityResults([]);
        }
      } catch (error: any) {
        if (error?.name !== 'AbortError') {
          logger.error('Error searching cities:', error);
        }
        if (isMounted) setCityResults([]);
      } finally {
        if (isMounted) setLoadingCities(false);
      }
    };

    const timeoutId = setTimeout(searchCities, 300);
    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [citySearch, isPickup]);

  // Fetch carriers with coverage when city is selected
  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const fetchCarriersForCity = async () => {
      if (!selectedCity || isPickup) {
        if (isMounted) {
          setCarriersWithCoverage([]);
          setSelectedCarrierId('');
          setShippingCost(0);
        }
        return;
      }

      try {
        if (isMounted) setLoadingCoverage(true);
        const token = localStorage.getItem('auth_token');
        const storeId = localStorage.getItem('current_store_id');

        const response = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/carriers/coverage/city?city=${encodeURIComponent(selectedCity.city)}&department=${encodeURIComponent(selectedCity.department || '')}`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'X-Store-ID': storeId || '',
            },
            signal: controller.signal,
          }
        );

        if (response.ok && isMounted) {
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
            setSelectedCarrierId(cheapest.carrier_id);
            setShippingCost(cheapest.rate || 0);
            form.setValue('carrier', cheapest.carrier_id);
          } else {
            setSelectedCarrierId('');
            setShippingCost(0);
            form.setValue('carrier', '');
          }
        } else if (isMounted) {
          setCarriersWithCoverage([]);
        }
      } catch (error: any) {
        if (error?.name !== 'AbortError') {
          logger.error('Error fetching carriers for city:', error);
        }
        if (isMounted) setCarriersWithCoverage([]);
      } finally {
        if (isMounted) setLoadingCoverage(false);
      }
    };

    fetchCarriersForCity();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [selectedCity, isPickup, form]);

  // Reset shipping when pickup toggled
  useEffect(() => {
    if (isPickup) {
      setSelectedCity(null);
      setCitySearch('');
      setSelectedCarrierId('');
      setShippingCost(0);
      setCarriersWithCoverage([]);
      form.setValue('carrier', '');
    }
  }, [isPickup, form]);

  const handleSubmit = async (data: OrderFormValues) => {
    // Validate: either pickup or city+carrier required
    if (!isPickup && !selectedCity) {
      form.setError('carrier', { message: 'Selecciona la ciudad de entrega o marca "Retiro en local"' });
      return;
    }

    if (!isPickup && !selectedCarrierId) {
      form.setError('carrier', { message: 'Selecciona un repartidor con cobertura' });
      return;
    }

    try {
      const fullPhone = `${data.countryCode}${data.phone}`;

      // Build extended form data with shipping info
      const extendedData: OrderFormData = {
        ...data,
        phone: fullPhone,
        carrier: isPickup ? undefined : selectedCarrierId,
        shippingCity: isPickup ? undefined : selectedCity?.city,
        shippingCityNormalized: isPickup ? undefined : selectedCity?.city.toLowerCase(),
        deliveryZone: isPickup ? undefined : selectedCity?.zone_code,
        shippingCost: isPickup ? 0 : shippingCost,
        isPickup,
        deliveryPreferences,
      };

      await onSubmit(extendedData);

      // Reset form after successful submission
      form.reset({
        customer: '',
        countryCode: '+595',
        phone: '',
        address: '',
        googleMapsLink: '',
        product: '',
        quantity: 1,
        carrier: '',
        paymentMethod: 'cod',
      });
      setSelectedCity(null);
      setCitySearch('');
      setSelectedCarrierId('');
      setShippingCost(0);
      setCarriersWithCoverage([]);
      setIsPickup(false);
      setDeliveryPreferences(null);
    } catch (error) {
      logger.error('Error submitting order form:', error);
    }
  };

  const handleCarrierSelect = (carrier: CarrierWithCoverage) => {
    if (!carrier.has_coverage) return;
    setSelectedCarrierId(carrier.carrier_id);
    setShippingCost(carrier.rate || 0);
    form.setValue('carrier', carrier.carrier_id);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        {/* Customer Name */}
        <FormField
          control={form.control}
          name="customer"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre del Cliente</FormLabel>
              <FormControl>
                <Input placeholder="Juan Pérez" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Phone */}
        <div className="grid grid-cols-3 gap-2">
          <FormField
            control={form.control}
            name="countryCode"
            render={({ field }) => (
              <FormItem>
                <FormLabel>País</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Código" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="+595">🇵🇾 +595</SelectItem>
                    <SelectItem value="+54">🇦🇷 +54</SelectItem>
                    <SelectItem value="+55">🇧🇷 +55</SelectItem>
                    <SelectItem value="+598">🇺🇾 +598</SelectItem>
                    <SelectItem value="+56">🇨🇱 +56</SelectItem>
                    <SelectItem value="+51">🇵🇪 +51</SelectItem>
                    <SelectItem value="+57">🇨🇴 +57</SelectItem>
                    <SelectItem value="+52">🇲🇽 +52</SelectItem>
                    <SelectItem value="+34">🇪🇸 +34</SelectItem>
                    <SelectItem value="+1">🇺🇸 +1</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem className="col-span-2">
                <FormLabel>Teléfono</FormLabel>
                <FormControl>
                  <Input placeholder="981234567" type="tel" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Address */}
        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Dirección</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Calle, número, barrio..."
                  className="resize-none"
                  rows={2}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Google Maps Link */}
        <FormField
          control={form.control}
          name="googleMapsLink"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Link de Google Maps
                <span className="text-muted-foreground text-xs font-normal">(opcional)</span>
              </FormLabel>
              <FormControl>
                <Input
                  placeholder="https://maps.google.com/..."
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Pickup Toggle */}
        <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
          <div className="flex items-center gap-2">
            <Store className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Retiro en local</p>
              <p className="text-xs text-muted-foreground">El cliente retira en tienda</p>
            </div>
          </div>
          <Switch
            checked={isPickup}
            onCheckedChange={setIsPickup}
          />
        </div>

        {/* City Selection - Only show if not pickup */}
        {!isPickup && (
          <div className="space-y-3">
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Ciudad de Entrega
              </FormLabel>
              <Popover open={openCityCombobox} onOpenChange={setOpenCityCombobox}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={openCityCombobox}
                    className="w-full justify-between"
                  >
                    {selectedCity ? (
                      <span>{selectedCity.city}, {selectedCity.department}</span>
                    ) : (
                      <span className="text-muted-foreground">Buscar ciudad...</span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Escribir nombre de ciudad..."
                      value={citySearch}
                      onValueChange={setCitySearch}
                    />
                    {loadingCities ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    ) : cityResults.length === 0 ? (
                      <CommandEmpty>
                        {citySearch.length < 2 ? 'Escribe al menos 2 letras' : 'No se encontraron ciudades'}
                      </CommandEmpty>
                    ) : (
                      <CommandGroup>
                        {cityResults.map((city) => (
                          <CommandItem
                            key={`${city.city}-${city.department}`}
                            value={city.city}
                            onSelect={() => {
                              setSelectedCity(city);
                              setOpenCityCombobox(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedCity?.city === city.city ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <div className="flex flex-col">
                              <span>{city.city}</span>
                              <span className="text-xs text-muted-foreground">{city.department}</span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </Command>
                </PopoverContent>
              </Popover>
            </FormItem>

            {/* Carrier Selection - Show after city is selected */}
            {selectedCity && (
              <FormItem>
                <FormLabel className="flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  Repartidor
                  {loadingCoverage && <Loader2 className="h-3 w-3 animate-spin" />}
                </FormLabel>
                {loadingCoverage ? (
                  <div className="flex items-center justify-center py-4 border rounded-md">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    <span className="text-sm text-muted-foreground">Cargando repartidores...</span>
                  </div>
                ) : carriersWithCoverage.length === 0 ? (
                  <div className="text-sm text-muted-foreground border rounded-md p-3 bg-muted/30">
                    No hay repartidores configurados para esta ciudad
                  </div>
                ) : (
                  <div className="space-y-2">
                    {carriersWithCoverage.map((carrier) => (
                      <div
                        key={carrier.carrier_id}
                        onClick={() => handleCarrierSelect(carrier)}
                        className={cn(
                          "flex items-center justify-between p-3 border rounded-md cursor-pointer transition-colors",
                          carrier.has_coverage
                            ? selectedCarrierId === carrier.carrier_id
                              ? "border-primary bg-primary/5"
                              : "hover:border-primary/50 hover:bg-muted/50"
                            : "opacity-50 cursor-not-allowed bg-muted/20"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {selectedCarrierId === carrier.carrier_id && (
                            <Check className="h-4 w-4 text-primary" />
                          )}
                          <span className="font-medium">{carrier.carrier_name}</span>
                        </div>
                        {carrier.has_coverage ? (
                          <Badge variant="secondary">
                            Gs. {(carrier.rate || 0).toLocaleString()}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            SIN COBERTURA
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <FormField
                  control={form.control}
                  name="carrier"
                  render={() => <FormMessage />}
                />
              </FormItem>
            )}

            {/* Shipping Cost Display */}
            {selectedCity && selectedCarrierId && shippingCost > 0 && (
              <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-md">
                <span className="text-sm font-medium text-green-700 dark:text-green-400">
                  Costo de envío:
                </span>
                <span className="text-sm font-bold text-green-700 dark:text-green-400">
                  Gs. {shippingCost.toLocaleString()}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Product Selection */}
        <FormField
          control={form.control}
          name="product"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Producto</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un producto" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {isLoadingProducts ? (
                    <SelectItem value="loading" disabled>
                      Cargando productos...
                    </SelectItem>
                  ) : products.length === 0 ? (
                    <SelectItem value="empty" disabled>
                      No hay productos disponibles
                    </SelectItem>
                  ) : (
                    products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name} - Gs. {product.price.toLocaleString()}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Quantity */}
        <FormField
          control={form.control}
          name="quantity"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Cantidad</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min="1"
                  {...field}
                  onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Payment Method */}
        <FormField
          control={form.control}
          name="paymentMethod"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Método de Pago</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona el método de pago" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="cod">Contra Entrega (COD)</SelectItem>
                  <SelectItem value="paid">Pagado</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Delivery Preferences (Optional) - Date restrictions, time slots, notes */}
        <DeliveryPreferencesAccordion
          value={deliveryPreferences}
          onChange={setDeliveryPreferences}
          disabled={form.formState.isSubmitting}
        />

        {/* Submit Buttons */}
        <div className="flex gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
            Cancelar
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting} className="flex-1">
            {form.formState.isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {initialData ? 'Actualizando...' : 'Creando...'}
              </>
            ) : (
              initialData ? 'Actualizar Pedido' : 'Crear Pedido'
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
