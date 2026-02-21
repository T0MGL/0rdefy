import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { logger } from '@/utils/logger';
import { usePhoneAutoPaste } from '@/hooks/usePhoneAutoPaste';
import { formatCurrency } from '@/utils/currency';
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
import { Loader2, Check, ChevronsUpDown, MapPin, Truck, Store, Package, Layers, StickyNote } from 'lucide-react';
import { productsService } from '@/services/products.service';
import { useState, useEffect } from 'react';
import { Product, ProductVariant } from '@/types';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { DeliveryPreferencesAccordion, type DeliveryPreferences } from '@/components/DeliveryPreferencesAccordion';
import { Label } from '@/components/ui/label';

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
  internalNotes: z.string().max(5000, 'Máximo 5000 caracteres').optional(),
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
  upsellProductId?: string;
  upsellQuantity?: number;
  // Variant support (Migration 097)
  variantId?: string;
  variantPrice?: number;
  variantTitle?: string;
  unitsPerPack?: number;
  // Internal notes (admin-only, not visible to customers)
  internalNotes?: string;
}

interface OrderFormProps {
  onSubmit: (data: OrderFormData) => void;
  onCancel: () => void;
  initialData?: Partial<OrderFormData>;
}

export function OrderForm({ onSubmit, onCancel, initialData }: OrderFormProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);

  // Variant selection state (Migration 097)
  const [selectedProductVariants, setSelectedProductVariants] = useState<ProductVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [parentStock, setParentStock] = useState<number>(0);

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

  // Upsell state
  const [upsellEnabled, setUpsellEnabled] = useState(false);
  const [upsellProductId, setUpsellProductId] = useState<string>('');
  const [upsellQuantity, setUpsellQuantity] = useState(1);
  const [openUpsellCombobox, setOpenUpsellCombobox] = useState(false);

  // Extract country code from phone for editing
  const extractCountryCode = (phone: string): { countryCode: string; phoneNumber: string } => {
    if (!phone) return { countryCode: '+595', phoneNumber: '' };

    const countryCodes = ['+595', '+54', '+55', '+598', '+56', '+51', '+57', '+52', '+34', '+33', '+1'];
    for (const code of countryCodes) {
      if (phone.startsWith(code)) {
        return {
          countryCode: code,
          phoneNumber: phone.slice(code.length).trim()
        };
      }
    }

    // If no known code found, default to +595 and use full phone
    return { countryCode: '+595', phoneNumber: phone.replace(/^\+\d+\s*/, '') };
  };

  const { countryCode: extractedCountryCode, phoneNumber: extractedPhone } = extractCountryCode(initialData?.phone || '');

  // Form must be defined before useEffects that use it
  const form = useForm<OrderFormValues>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      customer: initialData?.customer || '',
      countryCode: extractedCountryCode,
      phone: extractedPhone,
      address: initialData?.address || '',
      googleMapsLink: initialData?.googleMapsLink || '',
      product: initialData?.product || '',
      quantity: initialData?.quantity || 1,
      carrier: initialData?.carrier || '',
      paymentMethod: initialData?.paymentMethod || 'cod',
      internalNotes: initialData?.internalNotes || '',
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

  // Load variants when product is selected (Migration 097)
  const selectedProductId = form.watch('product');
  useEffect(() => {
    let isMounted = true;

    const loadVariants = async () => {
      if (!selectedProductId) {
        setSelectedProductVariants([]);
        setSelectedVariantId(null);
        setParentStock(0);
        return;
      }

      setLoadingVariants(true);
      try {
        const result = await productsService.getVariants(selectedProductId);
        if (isMounted) {
          if (result.has_variants && result.variants.length > 0) {
            setSelectedProductVariants(result.variants);
            setParentStock(result.parent_stock);
            // Auto-select first active variant if only one exists
            const activeVariants = result.variants.filter(v => v.is_active);
            if (activeVariants.length === 1) {
              setSelectedVariantId(activeVariants[0].id);
            } else {
              setSelectedVariantId(null);
            }
          } else {
            setSelectedProductVariants([]);
            setSelectedVariantId(null);
            setParentStock(0);
          }
        }
      } catch (error) {
        logger.error('Error loading product variants:', error);
        if (isMounted) {
          setSelectedProductVariants([]);
          setSelectedVariantId(null);
        }
      } finally {
        if (isMounted) {
          setLoadingVariants(false);
        }
      }
    };

    loadVariants();
    return () => { isMounted = false; };
  }, [selectedProductId]);

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
          `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/carriers/coverage/city?city=${encodeURIComponent(selectedCity.city)}&department=${encodeURIComponent(selectedCity.department || '')}&zone_code=${encodeURIComponent(selectedCity.zone_code || '')}`,
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

  // Initialize fields from initialData when editing an order
  useEffect(() => {
    if (initialData) {
      // Set pickup state
      if (initialData.isPickup !== undefined) {
        setIsPickup(initialData.isPickup);
      }

      // Set city if provided
      if (initialData.shippingCity && !initialData.isPickup) {
        setSelectedCity({
          city: initialData.shippingCity,
          department: '', // Will be loaded from API
          zone_code: initialData.deliveryZone || '',
        });
        setCitySearch(initialData.shippingCity);
      }

      // Set carrier if provided
      if (initialData.carrier && !initialData.isPickup) {
        setSelectedCarrierId(initialData.carrier);
      }

      // Set shipping cost if provided
      if (initialData.shippingCost !== undefined) {
        setShippingCost(initialData.shippingCost);
      }

      // Set upsell if provided
      if (initialData.upsellProductId) {
        setUpsellEnabled(true);
        setUpsellProductId(initialData.upsellProductId);
        setUpsellQuantity(initialData.upsellQuantity || 1);
      }
    }
    // Only run on mount or when initialData changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData?.customer]); // Use customer as dependency to detect when order changes

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

    // Validate: if upsell enabled, product must be selected
    if (upsellEnabled && !upsellProductId) {
      form.setError('product', { message: 'Selecciona el producto de upsell o desactiva el upsell' });
      return;
    }

    // Note: Products with variants can be ordered as base product (no variant selected)
    // The validation was removed to allow ordering the base product without selecting a variant

    try {
      const fullPhone = `${data.countryCode}${data.phone}`;

      // Get variant info if selected (Migration 097)
      const selectedVariant = selectedVariantId
        ? selectedProductVariants.find(v => v.id === selectedVariantId)
        : null;

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
        upsellProductId: upsellEnabled ? upsellProductId : undefined,
        upsellQuantity: upsellEnabled ? upsellQuantity : undefined,
        // Variant data (Migration 097)
        variantId: selectedVariant?.id,
        variantPrice: selectedVariant?.price,
        variantTitle: selectedVariant?.variant_title,
        unitsPerPack: selectedVariant?.units_per_pack,
        // Internal notes (trim to null if empty)
        internalNotes: data.internalNotes?.trim() || undefined,
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
        internalNotes: '',
      });
      setSelectedCity(null);
      setCitySearch('');
      setSelectedCarrierId('');
      setShippingCost(0);
      setCarriersWithCoverage([]);
      setIsPickup(false);
      setDeliveryPreferences(null);
      setUpsellEnabled(false);
      setUpsellProductId('');
      setUpsellQuantity(1);
      // Reset variant state
      setSelectedProductVariants([]);
      setSelectedVariantId(null);
      setParentStock(0);
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

  // Auto-detect country code and clean phone number on paste using custom hook
  const handlePhonePaste = usePhoneAutoPaste((countryCode, phoneNumber) => {
    form.setValue('countryCode', countryCode);
    form.setValue('phone', phoneNumber);
  });

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
                    <SelectItem value="+33">🇫🇷 +33</SelectItem>
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
                  <Input
                    placeholder="981234567"
                    type="tel"
                    {...field}
                    onPaste={handlePhonePaste}
                  />
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
                            {formatCurrency(carrier.rate || 0)}
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
                  {formatCurrency(shippingCost)}
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
                        {product.name} - {formatCurrency(product.price)}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Variant Selection - Show when product has variants (Migration 097) */}
        {selectedProductId && (loadingVariants || selectedProductVariants.length > 0) && (
          <FormItem>
            <FormLabel className="flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Variante <span className="text-muted-foreground font-normal">(opcional)</span>
              {loadingVariants && <Loader2 className="h-3 w-3 animate-spin" />}
            </FormLabel>
            {loadingVariants ? (
              <div className="flex items-center justify-center py-3 border rounded-md">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm text-muted-foreground">Cargando variantes...</span>
              </div>
            ) : selectedProductVariants.length === 0 ? null : (
              <div className="space-y-2">
                {/* Base product option (no variant) */}
                {(() => {
                  const selectedProduct = products.find(p => p.id === selectedProductId);
                  const baseStock = selectedProduct?.stock ?? 0;
                  const basePrice = selectedProduct?.price ?? 0;
                  const isBaseOutOfStock = baseStock <= 0;

                  return (
                    <div
                      onClick={() => !isBaseOutOfStock && setSelectedVariantId(null)}
                      className={cn(
                        "flex items-center justify-between p-3 border rounded-md transition-colors",
                        isBaseOutOfStock
                          ? "opacity-50 cursor-not-allowed bg-muted/20"
                          : selectedVariantId === null
                            ? "border-primary bg-primary/5 cursor-pointer"
                            : "hover:border-primary/50 hover:bg-muted/50 cursor-pointer"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        {selectedVariantId === null && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                        <div>
                          <span className="font-medium">Sin variante</span>
                          <p className="text-xs text-muted-foreground">Precio base del producto</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="font-semibold">
                          {formatCurrency(basePrice)}
                        </Badge>
                        {isBaseOutOfStock ? (
                          <Badge variant="destructive" className="text-xs">
                            Sin stock
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            {baseStock} disp.
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Variant options - with PACK/VAR badges */}
                {selectedProductVariants.filter(v => v.is_active).map((variant) => {
                  const isBundle = variant.uses_shared_stock || (variant as any).variant_type === 'bundle';
                  const availableStock = isBundle
                    ? Math.floor(parentStock / (variant.units_per_pack || 1))
                    : variant.stock;
                  const isOutOfStock = availableStock <= 0;

                  return (
                    <div
                      key={variant.id}
                      onClick={() => !isOutOfStock && setSelectedVariantId(variant.id)}
                      className={cn(
                        "flex items-center justify-between p-3 border rounded-md transition-colors",
                        isOutOfStock
                          ? "opacity-50 cursor-not-allowed bg-muted/20"
                          : selectedVariantId === variant.id
                            ? "border-primary bg-primary/5 cursor-pointer"
                            : "hover:border-primary/50 hover:bg-muted/50 cursor-pointer"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        {selectedVariantId === variant.id && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                        <div className="flex items-center gap-2">
                          {/* Type badge: PACK (purple) or VAR (emerald) */}
                          {isBundle ? (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700">
                              PACK
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700">
                              VAR
                            </Badge>
                          )}
                          <div>
                            <span className="font-medium">{variant.variant_title}</span>
                            {isBundle && variant.units_per_pack > 1 && (
                              <span className="text-xs text-muted-foreground ml-1">
                                ({variant.units_per_pack}x)
                              </span>
                            )}
                            {variant.sku && (
                              <p className="text-xs text-muted-foreground">SKU: {variant.sku}</p>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="font-semibold">
                          {formatCurrency(variant.price)}
                        </Badge>
                        {isOutOfStock ? (
                          <Badge variant="destructive" className="text-xs">
                            Sin stock
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            {availableStock} {isBundle ? 'packs' : 'uds'}
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })}
                {/* Show info about shared stock */}
                {selectedProductVariants.some(v => v.uses_shared_stock) && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Stock compartido: {parentStock} unidades físicas disponibles
                  </p>
                )}
              </div>
            )}
          </FormItem>
        )}

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

        {/* Upsell Section */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between space-x-2">
            <Label htmlFor="upsell" className="flex flex-col space-y-1">
              <span>¿Agregar upsell?</span>
              <span className="font-normal text-xs text-muted-foreground">
                Marca si el cliente pidió un producto adicional
              </span>
            </Label>
            <Switch
              id="upsell"
              checked={upsellEnabled}
              onCheckedChange={(checked) => {
                setUpsellEnabled(checked);
                if (!checked) {
                  setUpsellProductId('');
                  setUpsellQuantity(1);
                }
              }}
            />
          </div>

          {/* Product Selection - Only show when upsell is enabled */}
          {upsellEnabled && (
            <div className="space-y-2 pl-4 border-l-2 border-primary/30">
              <Label htmlFor="upsell-product">
                Producto adicional <span className="text-red-500">*</span>
              </Label>
              {isLoadingProducts ? (
                <div className="flex items-center justify-center p-4">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="ml-2 text-sm text-muted-foreground">Cargando productos...</span>
                </div>
              ) : products.length === 0 ? (
                <div className="p-4 rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/20">
                  <p className="text-sm text-yellow-800 dark:text-yellow-200">
                    No hay productos disponibles. Crea productos primero en el módulo de Productos.
                  </p>
                </div>
              ) : (
                <Popover open={openUpsellCombobox} onOpenChange={setOpenUpsellCombobox}>
                  <PopoverTrigger asChild>
                    <Button
                      id="upsell-product"
                      variant="outline"
                      role="combobox"
                      aria-expanded={openUpsellCombobox}
                      className="w-full justify-between"
                    >
                      {upsellProductId ? (
                        <div className="flex items-center gap-2">
                          {products.find((p) => p.id === upsellProductId)?.image ? (
                            <img
                              src={products.find((p) => p.id === upsellProductId)?.image}
                              alt=""
                              className="w-6 h-6 rounded object-cover"
                            />
                          ) : (
                            <Package className="h-4 w-4 text-muted-foreground" />
                          )}
                          <span className="truncate">
                            {products.find((p) => p.id === upsellProductId)?.name || 'Selecciona un producto'}
                          </span>
                        </div>
                      ) : (
                        'Selecciona un producto'
                      )}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Buscar producto..." />
                      <CommandEmpty>No se encontraron productos.</CommandEmpty>
                      <CommandGroup className="max-h-64 overflow-auto">
                        {products.map((product) => (
                          <CommandItem
                            key={product.id}
                            value={`${product.name} ${product.sku || ''}`}
                            onSelect={() => {
                              setUpsellProductId(product.id);
                              setOpenUpsellCombobox(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                upsellProductId === product.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <div className="flex items-center gap-2 w-full">
                              {product.image ? (
                                <img
                                  src={product.image}
                                  alt=""
                                  className="w-8 h-8 rounded object-cover"
                                />
                              ) : (
                                <div className="w-8 h-8 rounded bg-muted flex items-center justify-center">
                                  <Package className="h-4 w-4 text-muted-foreground" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{product.name}</p>
                                {product.sku && (
                                  <p className="text-xs text-muted-foreground">SKU: {product.sku}</p>
                                )}
                              </div>
                              <span className="text-sm font-semibold text-primary ml-2">
                                {formatCurrency(Number(product.price || 0))}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
              {/* Quantity selector - only show when product is selected */}
              {upsellProductId && (
                <div className="space-y-2">
                  <Label htmlFor="upsell-quantity">Cantidad</Label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setUpsellQuantity(Math.max(1, upsellQuantity - 1))}
                      disabled={upsellQuantity <= 1}
                    >
                      -
                    </Button>
                    <Input
                      id="upsell-quantity"
                      type="number"
                      min={1}
                      value={upsellQuantity}
                      onChange={(e) => setUpsellQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-16 text-center"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setUpsellQuantity(upsellQuantity + 1)}
                    >
                      +
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Este producto se agregará al pedido (no reemplaza los productos existentes)
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

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

        {/* Internal Notes (Admin only) */}
        <FormField
          control={form.control}
          name="internalNotes"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="flex items-center gap-2">
                <StickyNote className="h-4 w-4" />
                Notas internas
                <span className="text-muted-foreground text-xs font-normal">(opcional)</span>
              </FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Notas para el equipo... (ej: cliente pidió entregar después del 25, quiere pagar con transferencia)"
                  className="resize-none min-h-[80px]"
                  {...field}
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                Solo visible para el equipo, no para el cliente ni repartidor
              </p>
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
