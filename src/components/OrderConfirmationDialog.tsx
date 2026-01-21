import { useState, useEffect, useCallback } from 'react';

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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import { useToast } from '@/hooks/use-toast';
import { useCarriers } from '@/hooks/useCarriers';
import { productsService } from '@/services/products.service';
import { Loader2, CheckCircle2, Printer, Check, ChevronsUpDown, Package, Percent, Store, Banknote, MapPin, AlertTriangle, Truck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { printLabelPDF } from '@/components/printing/printLabelPDF';
import { getOrderDisplayId } from '@/utils/orderDisplay';
import { cn } from '@/lib/utils';
import type { Order, Product } from '@/types';
import { DeliveryPreferencesAccordion, type DeliveryPreferences } from '@/components/DeliveryPreferencesAccordion';

interface OrderConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order | null;
  onConfirmed: () => void;
}

export function OrderConfirmationDialog({
  open,
  onOpenChange,
  order,
  onConfirmed,
}: OrderConfirmationDialogProps) {
  const { toast } = useToast();
  const { currentStore } = useAuth();
  const { hasFeature } = useSubscription();

  // In Free plan (no warehouse), show print option directly after confirmation
  // In paid plans with warehouse, they'll print from warehouse/dispatch flow
  const showPrintAfterConfirm = !hasFeature('warehouse');
  const [loading, setLoading] = useState(false);

  // Determine if order is COD (eligible for "mark as prepaid" option)
  // Show option ONLY if order is COD and NOT already paid online
  const orderIsCOD = order && (
    ['cash_on_delivery', 'cod', 'manual'].includes((order as any).payment_gateway?.toLowerCase() || '') ||
    ((order as any).cod_amount && (order as any).cod_amount > 0)
  );
  const orderIsAlreadyPaid = order && ['paid', 'authorized'].includes((order as any).financial_status?.toLowerCase() || '');
  const showPrepaidOption = orderIsCOD && !orderIsAlreadyPaid;

  // Use centralized carriers hook with caching (active carriers only)
  const { carriers, isLoading: loadingCarriers, isError: carriersError, refetch: refetchCarriers, getCarrierById } = useCarriers({ activeOnly: true });

  // Confirmation state
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState<any>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  // Form state
  const [upsellAdded, setUpsellAdded] = useState(false);
  const [upsellProductId, setUpsellProductId] = useState<string>('');
  const [upsellQuantity, setUpsellQuantity] = useState<number>(1);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [openProductCombobox, setOpenProductCombobox] = useState(false);
  const [courierId, setCourierId] = useState<string>('');
  const [address, setAddress] = useState('');
  const [googleMapsLink, setGoogleMapsLink] = useState('');
  const [carrierZones, setCarrierZones] = useState<any[]>([]);
  const [selectedZone, setSelectedZone] = useState<string>('');
  const [shippingCost, setShippingCost] = useState<number>(0);
  const [loadingZones, setLoadingZones] = useState(false);
  const [openZoneCombobox, setOpenZoneCombobox] = useState(false);
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [discountAmount, setDiscountAmount] = useState<number>(0);
  const [isPickup, setIsPickup] = useState(false);
  const [markAsPrepaid, setMarkAsPrepaid] = useState(false);

  // City-based coverage system state
  const [citySearch, setCitySearch] = useState('');
  const [cityResults, setCityResults] = useState<CityLocation[]>([]);
  const [selectedCity, setSelectedCity] = useState<CityLocation | null>(null);
  const [loadingCities, setLoadingCities] = useState(false);
  const [openCityCombobox, setOpenCityCombobox] = useState(false);
  const [carriersWithCoverage, setCarriersWithCoverage] = useState<CarrierWithCoverage[]>([]);
  const [loadingCoverage, setLoadingCoverage] = useState(false);
  const [useCoverageSystem, setUseCoverageSystem] = useState(true); // Toggle between old/new system

  // Delivery preferences state (date restrictions, time slots, notes)
  const [deliveryPreferences, setDeliveryPreferences] = useState<DeliveryPreferences | null>(null);

  // Fetch products when dialog opens
  useEffect(() => {
    const fetchProducts = async () => {
      if (!open) return;

      try {
        setLoadingProducts(true);
        const allProducts = await productsService.getAll();
        setProducts(allProducts);
      } catch (error) {
        logger.error('Error fetching products:', error);
        setProducts([]);
      } finally {
        setLoadingProducts(false);
      }
    };

    fetchProducts();
  }, [open]);

  // Search cities for autocomplete (debounced)
  useEffect(() => {
    const searchCities = async () => {
      if (!citySearch || citySearch.length < 2 || !useCoverageSystem) {
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
  }, [citySearch, useCoverageSystem]);

  // Fetch carriers with coverage when city is selected
  useEffect(() => {
    const fetchCarriersForCity = async () => {
      if (!selectedCity || !useCoverageSystem) {
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

          // If carrier is already selected (pre-filled from order), keep it
          // Otherwise auto-select cheapest carrier with coverage
          if (!courierId) {
            const cheapest = sorted.find((c: CarrierWithCoverage) => c.has_coverage);
            if (cheapest) {
              setCourierId(cheapest.carrier_id);
              setShippingCost(cheapest.rate || 0);
            }
          } else {
            // Verify the pre-selected carrier has coverage, update rate if found
            const preselectedCarrier = sorted.find((c: CarrierWithCoverage) => c.carrier_id === courierId);
            if (preselectedCarrier && preselectedCarrier.has_coverage) {
              // Keep the carrier, update rate from coverage data
              setShippingCost(preselectedCarrier.rate || 0);
            } else if (preselectedCarrier && !preselectedCarrier.has_coverage) {
              // Pre-selected carrier doesn't have coverage - auto-select cheapest
              const cheapest = sorted.find((c: CarrierWithCoverage) => c.has_coverage);
              if (cheapest) {
                setCourierId(cheapest.carrier_id);
                setShippingCost(cheapest.rate || 0);
              }
            }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- courierId is intentionally excluded to prevent re-fetch when carrier is selected
  }, [selectedCity, useCoverageSystem]);

  // Fetch carrier zones when carrier is selected (legacy system)
  useEffect(() => {
    const fetchCarrierZones = async () => {
      if (!courierId) {
        setCarrierZones([]);
        setSelectedZone('');
        setShippingCost(0);
        return;
      }

      try {
        setLoadingZones(true);
        const token = localStorage.getItem('auth_token');
        const storeId = localStorage.getItem('current_store_id');

        const response = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/carriers/${courierId}/zones`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'X-Store-ID': storeId || '',
            },
          }
        );

        if (response.ok) {
          const { data } = await response.json();
          setCarrierZones(data || []);

          // Auto-select first zone if only one available
          if (data && data.length === 1) {
            setSelectedZone(data[0].id);
            setShippingCost(Number(data[0].rate) || 0);
          }
        } else {
          setCarrierZones([]);
        }
      } catch (error) {
        logger.error('Error fetching carrier zones:', error);
        setCarrierZones([]);
      } finally {
        setLoadingZones(false);
      }
    };

    fetchCarrierZones();
  }, [courierId]);

  // Update shipping cost when zone is selected
  useEffect(() => {
    if (selectedZone && carrierZones.length > 0) {
      const zone = carrierZones.find((z) => z.id === selectedZone);
      if (zone) {
        setShippingCost(Number(zone.rate) || 0);
      }
    }
  }, [selectedZone, carrierZones]);

  // Reset state when dialog opens - Pre-fill from order data if available
  useEffect(() => {
    if (open && order) {
      setIsConfirmed(false);
      setConfirmedOrder(null);
      setUpsellProductId('');
      setUpsellQuantity(1);
      setOpenProductCombobox(false);
      setDiscountEnabled(false);
      setDiscountAmount(0);
      setMarkAsPrepaid(false);
      setOpenCityCombobox(false);

      // Reset delivery preferences
      setDeliveryPreferences((order as any)?.delivery_preferences || null);

      // Pre-fill address if order has one
      if (order?.address) {
        setAddress(order.address);
      }

      // Pre-fill Google Maps link if order has one
      setGoogleMapsLink(order?.google_maps_link || '');

      // Pre-fill upsell if order has one
      if (order?.upsell_added !== undefined) {
        setUpsellAdded(order.upsell_added);
      } else {
        setUpsellAdded(false);
      }

      // Pre-fill pickup status from order
      const orderIsPickup = (order as any)?.is_pickup || false;
      setIsPickup(orderIsPickup);

      // Pre-fill shipping data from order (if set during creation)
      const orderShippingCity = (order as any)?.shipping_city;
      const orderDeliveryZone = (order as any)?.delivery_zone;
      const orderCourierId = (order as any)?.courier_id || (order as any)?.carrier_id;
      const orderShippingCost = (order as any)?.shipping_cost;

      if (orderIsPickup) {
        // Pickup order - reset shipping fields
        setCourierId('');
        setSelectedZone('');
        setShippingCost(0);
        setCarrierZones([]);
        setCitySearch('');
        setCityResults([]);
        setSelectedCity(null);
        setCarriersWithCoverage([]);
      } else if (orderShippingCity) {
        // Order has city info - pre-fill city coverage system
        setSelectedCity({
          city: orderShippingCity,
          department: '', // Will be populated when carriers load
          zone_code: orderDeliveryZone || '',
        });
        setCitySearch('');
        setCityResults([]);
        // Carrier and shipping cost will be set after carriers load for city
        if (orderCourierId) {
          setCourierId(orderCourierId);
        }
        if (orderShippingCost !== undefined && orderShippingCost !== null) {
          setShippingCost(Number(orderShippingCost) || 0);
        }
        // Reset legacy zone system
        setSelectedZone('');
        setCarrierZones([]);
      } else {
        // No shipping data - reset all
        setCourierId('');
        setSelectedZone('');
        setShippingCost(0);
        setCarrierZones([]);
        setCitySearch('');
        setCityResults([]);
        setSelectedCity(null);
        setCarriersWithCoverage([]);
      }

      // Refetch carriers when dialog opens to ensure fresh data
      refetchCarriers();
    }
  }, [open, order, refetchCarriers]);

  // Show toast when carriers finish loading with no results (only if not using pickup)
  useEffect(() => {
    if (open && !loadingCarriers && carriers.length === 0 && !carriersError && !isPickup) {
      toast({
        title: 'Sin repartidores',
        description: 'No hay repartidores activos. Puedes usar "Retiro en local" o crear un repartidor.',
        variant: 'default',
      });
    }
  }, [open, loadingCarriers, carriers.length, carriersError, isPickup, toast]);

  // Auto-save upsell when changed after confirmation
  useEffect(() => {
    if (isConfirmed && confirmedOrder && order) {
      const updateUpsell = async () => {
        try {
          const token = localStorage.getItem('auth_token');
          const storeId = localStorage.getItem('current_store_id');

          await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/orders/${order.id}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'X-Store-ID': storeId || '',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ upsell_added: upsellAdded }),
          });

          toast({
            title: 'Upsell actualizado',
            description: upsellAdded ? 'Se agregó el upsell al pedido' : 'Se removió el upsell del pedido',
          });
        } catch (error) {
          logger.error('Error updating upsell:', error);
        }
      };

      // Only update if the value actually changed from what was in the order
      if (order.upsell_added !== upsellAdded) {
        updateUpsell();
      }
    }
  }, [upsellAdded, isConfirmed, confirmedOrder, order, toast]);

  const handleConfirm = async () => {
    if (!order) return;

    // Validation: Either pickup OR carrier required
    if (!isPickup) {
      if (!courierId) {
        toast({
          title: 'Repartidor requerido',
          description: 'Debes seleccionar un repartidor o marcar "Retiro en local"',
          variant: 'destructive',
        });
        return;
      }

      // For coverage system, require city; for legacy system, require zone
      if (useCoverageSystem && !selectedCity) {
        toast({
          title: 'Ciudad requerida',
          description: 'Debes seleccionar la ciudad de entrega',
          variant: 'destructive',
        });
        return;
      } else if (!useCoverageSystem && !selectedZone) {
        toast({
          title: 'Zona requerida',
          description: 'Debes seleccionar una zona de entrega',
          variant: 'destructive',
        });
        return;
      }
    }

    // If upsell is enabled, require product selection
    if (upsellAdded && !upsellProductId) {
      toast({
        title: 'Producto requerido',
        description: 'Debes seleccionar el producto adicional del upsell',
        variant: 'destructive',
      });
      return;
    }

    try {
      setLoading(true);

      // Show loading toast immediately
      const loadingToast = toast({
        title: 'Confirmando pedido...',
        description: 'Por favor espera mientras procesamos la confirmación',
        duration: Infinity, // Keep it open until we update it
      });

      const token = localStorage.getItem('auth_token');
      const storeId = localStorage.getItem('current_store_id');

      // Get selected zone details (legacy system) or city (new system)
      const zoneData = carrierZones.find((z) => z.id === selectedZone);

      const payload: any = {
        courier_id: isPickup ? null : courierId,
        upsell_added: upsellAdded,
        // Use city-based zone if coverage system is active
        delivery_zone: isPickup ? null : (useCoverageSystem && selectedCity ? selectedCity.zone_code : (zoneData?.zone_name || '')),
        shipping_cost: isPickup ? 0 : shippingCost,
        // Add city info for tracking
        shipping_city: isPickup ? null : (useCoverageSystem && selectedCity ? selectedCity.city : null),
        shipping_city_normalized: isPickup ? null : (useCoverageSystem && selectedCity ? selectedCity.city.toLowerCase() : null),
      };

      // Add upsell product info if selected (this adds to the order, doesn't replace)
      if (upsellAdded && upsellProductId) {
        const upsellProduct = products.find(p => p.id === upsellProductId);
        payload.upsell_product_id = upsellProductId;
        payload.upsell_quantity = upsellQuantity;
        payload.upsell_product_name = upsellProduct?.name;
        payload.upsell_product_price = upsellProduct?.price;
      }

      // Add optional fields if provided
      if (address && address !== order.address) {
        payload.address = address;
      }

      if (googleMapsLink && googleMapsLink !== order.google_maps_link) {
        payload.google_maps_link = googleMapsLink;
      }

      // Add discount if enabled
      if (discountEnabled && discountAmount > 0) {
        payload.discount_amount = discountAmount;
      }

      // Add mark as prepaid if selected (COD order paid via transfer)
      if (markAsPrepaid && showPrepaidOption) {
        payload.mark_as_prepaid = true;
        payload.prepaid_method = 'transfer';
      }

      // Add delivery preferences if configured
      if (deliveryPreferences) {
        payload.delivery_preferences = deliveryPreferences;
      }

      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/orders/${order.id}/confirm`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Store-ID': storeId || '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to confirm order');
      }

      const result = await response.json();

      // Dismiss loading toast
      loadingToast.dismiss();

      // Show success toast
      toast({
        title: '¡Pedido confirmado!',
        description: markAsPrepaid
          ? 'Pedido marcado como PAGADO. La etiqueta mostrará "PAGADO".'
          : isPickup
            ? 'El pedido está listo para retiro en local (sin envío).'
            : 'El pedido ha sido asignado al repartidor exitosamente.',
        duration: 5000,
      });

      // Close dialog immediately and notify parent
      onConfirmed();
      onOpenChange(false);
    } catch (error: any) {
      logger.error('Error confirming order:', error);

      toast({
        title: 'Error al confirmar',
        description: error.message || 'No se pudo confirmar el pedido. Intenta nuevamente.',
        variant: 'destructive',
        duration: 5000,
      });
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = async () => {
    if (!confirmedOrder) return;

    try {
      setIsPrinting(true);
      const labelData = {
        storeName: currentStore?.name || 'ORDEFY',
        orderNumber: confirmedOrder.shopify_order_name || confirmedOrder.id.substring(0, 8),
        customerName: `${confirmedOrder.customer_first_name || ''} ${confirmedOrder.customer_last_name || ''}`.trim() || order?.customer || 'Cliente',
        customerPhone: confirmedOrder.customer_phone || order?.phone || '',
        customerAddress: confirmedOrder.customer_address || confirmedOrder.address || order?.address || order?.customer_address,
        neighborhood: confirmedOrder.neighborhood || order?.neighborhood,
        addressReference: confirmedOrder.address_reference || order?.address_reference,
        carrierName: getCarrierById(courierId)?.name,
        codAmount: confirmedOrder.cod_amount || order?.cod_amount,
        totalPrice: confirmedOrder.total_price || order?.total || order?.total_price, // Fallback for COD amount
        paymentMethod: confirmedOrder.payment_method,
        paymentGateway: confirmedOrder.payment_gateway, // Most reliable COD indicator
        financialStatus: confirmedOrder.financial_status,
        deliveryToken: confirmedOrder.delivery_link_token || '',
        items: confirmedOrder.line_items && confirmedOrder.line_items.length > 0
          ? confirmedOrder.line_items.map((item: any) => ({
            name: item.product_name || item.title,
            quantity: item.quantity,
          }))
          : order
            ? [{ name: order.product, quantity: order.quantity }]
            : [],
      };

      await printLabelPDF(labelData);
    } catch (error) {
      logger.error('Error printing from dialog:', error);
      toast({
        title: 'Error de impresión',
        description: 'No se pudo generar la etiqueta.',
        variant: 'destructive',
      });
    } finally {
      setIsPrinting(false);
    }
  };

  const handleClose = () => {
    // Reset form
    setUpsellAdded(false);
    setUpsellProductId('');
    setUpsellQuantity(1);
    setOpenProductCombobox(false);
    setCourierId('');
    setAddress('');
    setGoogleMapsLink('');
    setSelectedZone('');
    setShippingCost(0);
    setCarrierZones([]);
    setOpenZoneCombobox(false);
    setIsConfirmed(false);
    setConfirmedOrder(null);
    setIsPrinting(false);
    setIsPickup(false);
    setDiscountEnabled(false);
    setDiscountAmount(0);
    setMarkAsPrepaid(false);
    setDeliveryPreferences(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isConfirmed ? '✅ Pedido Confirmado' : 'Confirmar Pedido'}
          </DialogTitle>
          <DialogDescription>
            {isConfirmed
              ? showPrintAfterConfirm
                ? 'El pedido ha sido confirmado exitosamente. Imprime la etiqueta para pegar en el paquete.'
                : 'El pedido ha sido confirmado exitosamente y está listo para preparación.'
              : 'Revisa y confirma los detalles del pedido antes de asignarlo a un repartidor'
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {isConfirmed && confirmedOrder ? (
            // Success state - Show shipping label with upsell toggle
            <>
              <div className="mb-6 p-4 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800 flex items-center gap-3">
                <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-green-900 dark:text-green-100">
                    Pedido confirmado exitosamente
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    {showPrintAfterConfirm
                      ? 'El repartidor ha sido asignado. Imprime la etiqueta y pégala en el paquete.'
                      : 'El pedido pasará a preparación en el módulo de Almacén.'}
                  </p>
                </div>
              </div>

              {/* Upsell Toggle - Available after confirmation */}
              <div className="flex items-center justify-between space-x-2 p-3 rounded-lg border bg-muted/50">
                <Label htmlFor="upsell-confirmed" className="flex flex-col space-y-1">
                  <span>¿Agregar upsell?</span>
                  <span className="font-normal text-xs text-muted-foreground">
                    Marca si se añadió un producto adicional
                  </span>
                </Label>
                <Switch
                  id="upsell-confirmed"
                  checked={upsellAdded}
                  onCheckedChange={setUpsellAdded}
                />
              </div>

              {/* Print section - Only show in Free plan (no warehouse flow) */}
              {showPrintAfterConfirm && (
                <div className="flex flex-col items-center justify-center py-8 gap-6 border rounded-xl bg-muted/30">
                  <Printer className="h-16 w-16 text-blue-500 opacity-20" />
                  <Button
                    size="lg"
                    onClick={handlePrint}
                    disabled={isPrinting}
                    className="gap-2 px-8 h-14 text-lg bg-blue-600 hover:bg-blue-700 shadow-lg hover:shadow-xl transition-all"
                  >
                    {isPrinting ? (
                      <>
                        <Loader2 className="h-6 w-6 animate-spin" />
                        Preparando...
                      </>
                    ) : (
                      <>
                        <Printer size={24} />
                        Imprimir Etiqueta (4x6)
                      </>
                    )}
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    Se abrirá el diálogo de impresión directamente
                  </p>
                </div>
              )}

              <div className="flex justify-end pt-4">
                <Button variant="outline" onClick={handleClose}>
                  Cerrar
                </Button>
              </div>
            </>
          ) : (
            // Form state - Original confirmation form
            <>
              {/* Order Info */}
              {order && (
                <div className="rounded-lg border p-3 bg-muted/50 space-y-2">
                  <p className="text-sm font-medium">Pedido {getOrderDisplayId(order)}</p>
                  <p className="text-sm text-muted-foreground">Cliente: {order.customer}</p>
                  <p className="text-sm text-muted-foreground">Total: Gs. {(order.total ?? 0).toLocaleString()}</p>

                  {/* Shopify extracted data section */}
                  {(order.shipping_city || order.shopify_shipping_method || order.address_reference || order.delivery_notes) && (
                    <div className="mt-2 pt-2 border-t border-dashed border-muted-foreground/30 space-y-1">
                      {order.shipping_city && (
                        <p className="text-sm">
                          <span className="text-muted-foreground">Ciudad:</span>{' '}
                          <span className="font-medium">{order.shipping_city}</span>
                        </p>
                      )}
                      {order.address_reference && (
                        <p className="text-sm">
                          <span className="text-muted-foreground">Referencia:</span>{' '}
                          <span className="font-medium">{order.address_reference}</span>
                        </p>
                      )}
                      {order.shopify_shipping_method && (
                        <p className="text-sm">
                          <span className="text-muted-foreground">Envío:</span>{' '}
                          <Badge variant="outline" className="ml-1 text-xs bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400">
                            {order.shopify_shipping_method}
                          </Badge>
                        </p>
                      )}
                      {order.delivery_notes && (
                        <p className="text-sm">
                          <span className="text-muted-foreground">Nota del cliente:</span>{' '}
                          <span className="italic">{order.delivery_notes}</span>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Upsell Toggle with Product Selection */}
              <div className="space-y-3">
                <div className="flex items-center justify-between space-x-2">
                  <Label htmlFor="upsell" className="flex flex-col space-y-1">
                    <span>¿Agregar upsell?</span>
                    <span className="font-normal text-xs text-muted-foreground">
                      Marca si el cliente pidió un producto adicional
                    </span>
                  </Label>
                  <Switch
                    id="upsell"
                    checked={upsellAdded}
                    onCheckedChange={(checked) => {
                      setUpsellAdded(checked);
                      if (!checked) {
                        setUpsellProductId('');
                      }
                    }}
                  />
                </div>

                {/* Product Selection - Only show when upsell is enabled */}
                {upsellAdded && (
                  <div className="space-y-2 pl-4 border-l-2 border-primary/30">
                    <Label htmlFor="upsell-product">
                      Producto adicional <span className="text-red-500">*</span>
                    </Label>
                    {loadingProducts ? (
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
                      <Popover open={openProductCombobox} onOpenChange={setOpenProductCombobox}>
                        <PopoverTrigger asChild>
                          <Button
                            id="upsell-product"
                            variant="outline"
                            role="combobox"
                            aria-expanded={openProductCombobox}
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
                                    setOpenProductCombobox(false);
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
                                      Gs. {Number(product.price || 0).toLocaleString()}
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

              {/* Discount Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between space-x-2">
                  <Label htmlFor="discount" className="flex flex-col space-y-1">
                    <span className="flex items-center gap-2">
                      <Percent className="h-4 w-4" />
                      ¿Aplicar descuento?
                    </span>
                    <span className="font-normal text-xs text-muted-foreground">
                      Descuento por promoción o negociación con el cliente
                    </span>
                  </Label>
                  <Switch
                    id="discount"
                    checked={discountEnabled}
                    onCheckedChange={(checked) => {
                      setDiscountEnabled(checked);
                      if (!checked) {
                        setDiscountAmount(0);
                      }
                    }}
                  />
                </div>

                {discountEnabled && (
                  <div className="space-y-2 pl-4 border-l-2 border-orange-500/30">
                    <Label htmlFor="discount-amount">
                      Monto del descuento (Gs.)
                    </Label>
                    <Input
                      id="discount-amount"
                      type="number"
                      min={0}
                      value={discountAmount || ''}
                      onChange={(e) => setDiscountAmount(Math.max(0, parseInt(e.target.value) || 0))}
                      placeholder="Ej: 10000"
                      className="max-w-[200px]"
                    />
                    {discountAmount > 0 && order && (
                      <div className="p-3 rounded-lg border bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-800">
                        <p className="text-sm text-orange-900 dark:text-orange-100">
                          <span className="font-medium">Total original:</span> Gs. {(order.total ?? 0).toLocaleString()}
                        </p>
                        <p className="text-sm text-orange-900 dark:text-orange-100">
                          <span className="font-medium">Descuento:</span> -Gs. {discountAmount.toLocaleString()}
                        </p>
                        <p className="text-sm font-bold text-orange-900 dark:text-orange-100 mt-1 pt-1 border-t border-orange-300 dark:border-orange-700">
                          Nuevo total: Gs. {Math.max(0, (order.total ?? 0) - discountAmount).toLocaleString()}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Mark as Prepaid Option - Only show for COD orders that aren't already paid */}
              {showPrepaidOption && (
                <div className="space-y-3">
                  <div className={cn(
                    "flex items-center justify-between space-x-2 p-4 rounded-lg border-2 transition-all",
                    markAsPrepaid
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
                      : "border-muted bg-muted/30 hover:border-muted-foreground/20"
                  )}>
                    <Label htmlFor="prepaid" className="flex items-start gap-3 cursor-pointer flex-1">
                      <Banknote className={cn(
                        "h-5 w-5 mt-0.5 flex-shrink-0",
                        markAsPrepaid ? "text-blue-600" : "text-muted-foreground"
                      )} />
                      <div className="space-y-1">
                        <span className={cn(
                          "font-medium",
                          markAsPrepaid && "text-blue-700 dark:text-blue-300"
                        )}>
                          Pagado por transferencia
                        </span>
                        <p className="font-normal text-xs text-muted-foreground">
                          El cliente ya pagó antes del envío (transferencia, QR, etc.)
                        </p>
                      </div>
                    </Label>
                    <Switch
                      id="prepaid"
                      checked={markAsPrepaid}
                      onCheckedChange={setMarkAsPrepaid}
                    />
                  </div>

                  {markAsPrepaid && (
                    <div className="p-3 rounded-lg bg-blue-100 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800">
                      <p className="text-sm text-blue-800 dark:text-blue-200 font-medium flex items-center gap-2">
                        <Check className="h-4 w-4" />
                        La etiqueta mostrará "PAGADO" en lugar de "COBRAR"
                      </p>
                      <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                        El pedido se marcará como pagado y no aparecerá en cobros COD.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Pickup Option (Retiro en Local) */}
              <div className="space-y-3">
                <div className={cn(
                  "flex items-center justify-between space-x-2 p-4 rounded-lg border-2 transition-all",
                  isPickup
                    ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30"
                    : "border-muted bg-muted/30 hover:border-muted-foreground/20"
                )}>
                  <Label htmlFor="pickup" className="flex items-start gap-3 cursor-pointer flex-1">
                    <Store className={cn(
                      "h-5 w-5 mt-0.5 flex-shrink-0",
                      isPickup ? "text-emerald-600" : "text-muted-foreground"
                    )} />
                    <div className="space-y-1">
                      <span className={cn(
                        "font-medium",
                        isPickup && "text-emerald-700 dark:text-emerald-300"
                      )}>
                        Retiro en local
                      </span>
                      <p className="font-normal text-xs text-muted-foreground">
                        El cliente retira en la tienda. Sin costo de envío.
                      </p>
                    </div>
                  </Label>
                  <Switch
                    id="pickup"
                    checked={isPickup}
                    onCheckedChange={(checked) => {
                      setIsPickup(checked);
                      if (checked) {
                        setCourierId('');
                        setSelectedZone('');
                        setShippingCost(0);
                        setCarrierZones([]);
                      }
                    }}
                  />
                </div>

                {isPickup && (
                  <div className="p-3 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800">
                    <p className="text-sm text-emerald-800 dark:text-emerald-200 font-medium flex items-center gap-2">
                      <Check className="h-4 w-4" />
                      Sin costo de envío - Gs. 0
                    </p>
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                      El pedido no aparecerá en despachos ni liquidaciones de repartidores.
                    </p>
                  </div>
                )}
              </div>

              {/* City & Carrier Selection - Only show if NOT pickup */}
              {!isPickup && useCoverageSystem && (
                <>
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
                              <Badge variant="secondary" className="text-xs">
                                {selectedCity.zone_code.replace('_', ' ')}
                              </Badge>
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
                                    Gs. {Number(carrier.rate || 0).toLocaleString()}
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
                        Costo de envío: <span className="text-lg">Gs. {shippingCost.toLocaleString()}</span>
                      </p>
                      <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                        {selectedCity.city} → {carriersWithCoverage.find(c => c.carrier_id === courierId)?.carrier_name}
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* Legacy Courier Selection (when coverage system is disabled) */}
              {!isPickup && !useCoverageSystem && (
                <div className="space-y-2">
                  <Label htmlFor="courier">
                    Repartidor <span className="text-red-500">*</span>
                  </Label>
                  {loadingCarriers ? (
                    <div className="flex items-center justify-center p-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="ml-2 text-sm text-muted-foreground">Cargando repartidores...</span>
                    </div>
                  ) : carriersError ? (
                    <div className="flex items-center justify-between p-4 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20">
                      <span className="text-sm text-red-800 dark:text-red-200">
                        Error al cargar repartidores
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => refetchCarriers()}
                      >
                        Reintentar
                      </Button>
                    </div>
                  ) : (
                    <Select value={courierId} onValueChange={setCourierId}>
                      <SelectTrigger id="courier">
                        <SelectValue placeholder="Selecciona un repartidor" />
                      </SelectTrigger>
                      <SelectContent>
                        {carriers.map((carrier) => (
                          <SelectItem key={carrier.id} value={carrier.id}>
                            {carrier.name} {carrier.phone && `- ${carrier.phone}`}
                          </SelectItem>
                        ))}
                        {carriers.length === 0 && (
                          <div className="p-2 text-sm text-muted-foreground text-center">
                            No hay repartidores activos
                          </div>
                        )}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {/* Zone Selection - Only show in LEGACY mode when carrier is selected and NOT pickup */}
              {!isPickup && !useCoverageSystem && courierId && (
                <div className="space-y-2">
                  <Label htmlFor="zone">
                    Zona de Entrega <span className="text-red-500">*</span>
                  </Label>
                  {loadingZones ? (
                    <div className="flex items-center justify-center p-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="ml-2 text-sm text-muted-foreground">Cargando zonas...</span>
                    </div>
                  ) : carrierZones.length === 0 ? (
                    <div className="p-4 rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/20">
                      <p className="text-sm text-yellow-800 dark:text-yellow-200">
                        Este transportista no tiene zonas configuradas. Ve a Logística → Transportadoras para configurar tarifas por zona.
                      </p>
                    </div>
                  ) : (
                    <>
                      <Popover open={openZoneCombobox} onOpenChange={setOpenZoneCombobox}>
                        <PopoverTrigger asChild>
                          <Button
                            id="zone"
                            variant="outline"
                            role="combobox"
                            aria-expanded={openZoneCombobox}
                            className="w-full justify-between"
                          >
                            {selectedZone
                              ? carrierZones.find((zone) => zone.id === selectedZone)?.zone_name || "Selecciona una zona"
                              : "Selecciona una zona"}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-full p-0" align="start">
                          <Command>
                            <CommandInput placeholder="Buscar zona..." />
                            <CommandEmpty>No se encontraron zonas.</CommandEmpty>
                            <CommandGroup className="max-h-64 overflow-auto">
                              {carrierZones.map((zone) => (
                                <CommandItem
                                  key={zone.id}
                                  value={`${zone.zone_name} ${zone.zone_code || ''}`}
                                  onSelect={() => {
                                    setSelectedZone(zone.id);
                                    setOpenZoneCombobox(false);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4",
                                      selectedZone === zone.id ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  <div className="flex items-center justify-between w-full">
                                    <span>
                                      {zone.zone_name} {zone.zone_code && `(${zone.zone_code})`}
                                    </span>
                                    <span className="text-sm font-semibold text-primary ml-2">
                                      Gs. {Number(zone.rate || 0).toLocaleString()}
                                    </span>
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      {selectedZone && shippingCost > 0 && (
                        <div className="mt-2 p-3 rounded-lg border bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                          <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                            Costo de envío: <span className="text-lg">Gs. {shippingCost.toLocaleString()}</span>
                          </p>
                          <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                            Este costo será descontado del beneficio neto
                          </p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Address (Optional) */}
              <div className="space-y-2">
                <Label htmlFor="address">
                  Actualizar dirección (opcional)
                </Label>
                <Input
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Calle Principal 123"
                />
              </div>

              {/* Google Maps Link (Optional) */}
              <div className="space-y-2">
                <Label htmlFor="google-maps-link">
                  Link de Google Maps (opcional)
                </Label>
                <Input
                  id="google-maps-link"
                  type="url"
                  value={googleMapsLink}
                  onChange={(e) => setGoogleMapsLink(e.target.value)}
                  placeholder="https://maps.google.com/?q=..."
                />
                <p className="text-xs text-muted-foreground">
                  Este link estará disponible para el transportador para navegar directamente
                </p>
              </div>

              {/* Delivery Preferences (Optional) - Date restrictions, time slots, notes */}
              <DeliveryPreferencesAccordion
                value={deliveryPreferences}
                onChange={setDeliveryPreferences}
                disabled={loading}
              />

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={handleClose}
                  disabled={loading}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleConfirm}
                  disabled={loading || (!isPickup && (
                    !courierId ||
                    (useCoverageSystem && !selectedCity) ||
                    (!useCoverageSystem && !selectedZone)
                  ))}
                  className={isPickup ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Confirmando...
                    </>
                  ) : isPickup ? (
                    <>
                      <Store className="mr-2 h-4 w-4" />
                      Confirmar Retiro
                    </>
                  ) : (
                    'Confirmar Pedido'
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
