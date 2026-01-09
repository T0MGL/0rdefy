import { useState, useEffect } from 'react';
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
import { Loader2, CheckCircle2, Printer, Check, ChevronsUpDown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { printLabelPDF } from '@/components/printing/printLabelPDF';
import { getOrderDisplayId } from '@/utils/orderDisplay';
import { cn } from '@/lib/utils';
import type { Order } from '@/types';

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
  const [loading, setLoading] = useState(false);

  // Use centralized carriers hook with caching (active carriers only)
  const { carriers, isLoading: loadingCarriers, isError: carriersError, refetch: refetchCarriers, getCarrierById } = useCarriers({ activeOnly: true });

  // Confirmation state
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState<any>(null);
  const [isPrinting, setIsPrinting] = useState(false);

  // Form state
  const [upsellAdded, setUpsellAdded] = useState(false);
  const [courierId, setCourierId] = useState<string>('');
  const [address, setAddress] = useState('');
  const [googleMapsLink, setGoogleMapsLink] = useState('');
  const [carrierZones, setCarrierZones] = useState<any[]>([]);
  const [selectedZone, setSelectedZone] = useState<string>('');
  const [shippingCost, setShippingCost] = useState<number>(0);
  const [loadingZones, setLoadingZones] = useState(false);
  const [openZoneCombobox, setOpenZoneCombobox] = useState(false);

  // Fetch carrier zones when carrier is selected
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
        console.error('Error fetching carrier zones:', error);
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

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setIsConfirmed(false);
      setConfirmedOrder(null);
      setCourierId('');
      setSelectedZone('');
      setShippingCost(0);
      setCarrierZones([]);

      // Pre-fill address if order has one
      if (order?.address) {
        setAddress(order.address);
      }
      // Pre-fill upsell if order has one
      if (order?.upsell_added !== undefined) {
        setUpsellAdded(order.upsell_added);
      }
      // Pre-fill Google Maps link if order has one
      if (order?.google_maps_link) {
        setGoogleMapsLink(order.google_maps_link);
      }

      // Refetch carriers when dialog opens to ensure fresh data
      refetchCarriers();
    }
  }, [open, order, refetchCarriers]);

  // Show toast when carriers finish loading with no results
  useEffect(() => {
    if (open && !loadingCarriers && carriers.length === 0 && !carriersError) {
      toast({
        title: 'Sin repartidores',
        description: 'No hay repartidores activos disponibles. Crea uno primero.',
        variant: 'destructive',
      });
    }
  }, [open, loadingCarriers, carriers.length, carriersError, toast]);

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
          console.error('Error updating upsell:', error);
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

    // Validation
    if (!courierId) {
      toast({
        title: 'Repartidor requerido',
        description: 'Debes seleccionar un repartidor',
        variant: 'destructive',
      });
      return;
    }

    if (!selectedZone) {
      toast({
        title: 'Zona requerida',
        description: 'Debes seleccionar una zona de entrega',
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

      // Get selected zone details
      const zoneData = carrierZones.find((z) => z.id === selectedZone);

      const payload: any = {
        courier_id: courierId,
        upsell_added: upsellAdded,
        delivery_zone: zoneData?.zone_name || '',
        shipping_cost: shippingCost,
      };

      // Add optional fields if provided
      if (address && address !== order.address) {
        payload.address = address;
      }

      if (googleMapsLink && googleMapsLink !== order.google_maps_link) {
        payload.google_maps_link = googleMapsLink;
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
      setConfirmedOrder(result.data || result);
      setIsConfirmed(true);

      // Dismiss loading toast
      loadingToast.dismiss();

      // Show success toast
      toast({
        title: '¡Pedido confirmado!',
        description: 'El pedido ha sido asignado al repartidor exitosamente.',
        duration: 5000,
      });

      onConfirmed();
    } catch (error: any) {
      console.error('Error confirming order:', error);

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
        paymentMethod: confirmedOrder.payment_gateway || 'cash',
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
      console.error('Error printing from dialog:', error);
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
              ? 'El pedido ha sido confirmado exitosamente. Imprime la etiqueta para pegar en el paquete.'
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
                    El repartidor ha sido asignado. Imprime la etiqueta y pégala en el paquete.
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
                <div className="rounded-lg border p-3 bg-muted/50">
                  <p className="text-sm font-medium">Pedido {getOrderDisplayId(order)}</p>
                  <p className="text-sm text-muted-foreground">Cliente: {order.customer}</p>
                  <p className="text-sm text-muted-foreground">Total: Gs. {(order.total ?? 0).toLocaleString()}</p>
                </div>
              )}

              {/* Upsell Toggle */}
              <div className="flex items-center justify-between space-x-2">
                <Label htmlFor="upsell" className="flex flex-col space-y-1">
                  <span>¿Agregar upsell?</span>
                  <span className="font-normal text-xs text-muted-foreground">
                    Marca si se añadió un producto adicional
                  </span>
                </Label>
                <Switch
                  id="upsell"
                  checked={upsellAdded}
                  onCheckedChange={setUpsellAdded}
                />
              </div>

              {/* Courier Selection */}
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

              {/* Zone Selection - Only show if carrier is selected */}
              {courierId && (
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


              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={handleClose}
                  disabled={loading}
                >
                  Cancelar
                </Button>
                <Button onClick={handleConfirm} disabled={loading || !courierId || !selectedZone}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Confirmando...
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
