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
import { useToast } from '@/hooks/use-toast';
import { useCarriers } from '@/hooks/useCarriers';
import { Loader2, MapPin, CheckCircle2, Printer } from 'lucide-react';
import type { Order } from '@/types';
import { OrderShippingLabel } from '@/components/OrderShippingLabel';

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
  const [loading, setLoading] = useState(false);

  // Use centralized carriers hook with caching (active carriers only)
  const { carriers, isLoading: loadingCarriers, getCarrierById } = useCarriers({ activeOnly: true });

  // Confirmation state
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState<any>(null);

  // Form state
  const [upsellAdded, setUpsellAdded] = useState(false);
  const [courierId, setCourierId] = useState<string>('');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState<string>('');
  const [longitude, setLongitude] = useState<string>('');
  const [mapsLink, setMapsLink] = useState('');

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setIsConfirmed(false);
      setConfirmedOrder(null);
      // Pre-fill address if order has one
      if (order?.address) {
        setAddress(order.address);
      }
      if (order?.latitude) {
        setLatitude(order.latitude.toString());
      }
      if (order?.longitude) {
        setLongitude(order.longitude.toString());
      }
      // Pre-fill upsell if order has one
      if (order?.upsell_added !== undefined) {
        setUpsellAdded(order.upsell_added);
      }

      // Check if no carriers available
      if (carriers.length === 0 && !loadingCarriers) {
        toast({
          title: 'Sin repartidores',
          description: 'No hay repartidores activos disponibles. Crea uno primero.',
          variant: 'destructive',
        });
      }
    }
  }, [open, order, carriers.length, loadingCarriers, toast]);

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

    try {
      setLoading(true);

      // Close dialog immediately to give feedback
      handleClose();

      // Show loading toast immediately
      const loadingToast = toast({
        title: 'Confirmando pedido...',
        description: 'Por favor espera mientras procesamos la confirmación',
        duration: Infinity, // Keep it open until we update it
      });

      const token = localStorage.getItem('auth_token');
      const storeId = localStorage.getItem('current_store_id');

      const payload: any = {
        courier_id: courierId,
        upsell_added: upsellAdded,
      };

      // Add optional fields if provided
      if (address && address !== order.address) {
        payload.address = address;
      }
      if (latitude) {
        payload.latitude = parseFloat(latitude);
      }
      if (longitude) {
        payload.longitude = parseFloat(longitude);
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

  const extractCoordinatesFromMapsLink = (link: string) => {
    if (!link) return;

    try {
      // Pattern 1: ?q=lat,lng or @lat,lng
      const pattern1 = /[@?]q?=?(-?\d+\.?\d*),(-?\d+\.?\d*)/;
      const match1 = link.match(pattern1);

      if (match1) {
        setLatitude(match1[1]);
        setLongitude(match1[2]);
        toast({
          title: 'Coordenadas extraídas',
          description: `Lat: ${match1[1]}, Lng: ${match1[2]}`,
        });
        return;
      }

      // Pattern 2: /place/@lat,lng,zoom
      const pattern2 = /@(-?\d+\.?\d*),(-?\d+\.?\d*),\d+/;
      const match2 = link.match(pattern2);

      if (match2) {
        setLatitude(match2[1]);
        setLongitude(match2[2]);
        toast({
          title: 'Coordenadas extraídas',
          description: `Lat: ${match2[1]}, Lng: ${match2[2]}`,
        });
        return;
      }

      toast({
        title: 'No se encontraron coordenadas',
        description: 'El formato del link no es reconocido. Intenta copiar el link desde Google Maps.',
        variant: 'destructive',
      });
    } catch (error) {
      console.error('Error extracting coordinates:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron extraer las coordenadas del link',
        variant: 'destructive',
      });
    }
  };

  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast({
        title: 'Geolocalización no disponible',
        description: 'Tu navegador no soporta geolocalización',
        variant: 'destructive',
      });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toString());
        setLongitude(position.coords.longitude.toString());
        toast({
          title: 'Ubicación obtenida',
          description: 'Se ha capturado tu ubicación actual',
        });
      },
      (error) => {
        console.error('Error getting location:', error);
        toast({
          title: 'Error',
          description: 'No se pudo obtener la ubicación',
          variant: 'destructive',
        });
      }
    );
  };

  const handleClose = () => {
    // Reset form
    setUpsellAdded(false);
    setCourierId('');
    setAddress('');
    setLatitude('');
    setLongitude('');
    setMapsLink('');
    setIsConfirmed(false);
    setConfirmedOrder(null);
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

              <OrderShippingLabel
                orderId={confirmedOrder.id}
                deliveryToken={confirmedOrder.delivery_link_token}
                customerName={`${confirmedOrder.customer_first_name || ''} ${confirmedOrder.customer_last_name || ''}`.trim() || order?.customer || 'Cliente'}
                customerPhone={confirmedOrder.customer_phone || order?.phone || ''}
                customerAddress={confirmedOrder.customer_address || confirmedOrder.address || order?.address || order?.customer_address}
                addressReference={confirmedOrder.address_reference || order?.address_reference}
                neighborhood={confirmedOrder.neighborhood || order?.neighborhood}
                deliveryNotes={confirmedOrder.delivery_notes || order?.delivery_notes}
                courierName={getCarrierById(courierId)?.name}
                codAmount={confirmedOrder.cod_amount || order?.cod_amount}
                products={
                  confirmedOrder.line_items && confirmedOrder.line_items.length > 0
                    ? confirmedOrder.line_items.map((item: any) => ({
                        name: item.product_name || item.title,
                        quantity: item.quantity,
                      }))
                    : order
                    ? [{ name: order.product, quantity: order.quantity }]
                    : []
                }
              />
            </>
          ) : (
            // Form state - Original confirmation form
            <>
            {/* Order Info */}
            {order && (
              <div className="rounded-lg border p-3 bg-muted/50">
                <p className="text-sm font-medium">Pedido #{order.id.slice(0, 8)}</p>
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

          {/* Google Maps Link */}
          <div className="space-y-2">
            <Label htmlFor="mapsLink">
              Link de Google Maps (opcional)
            </Label>
            <div className="flex gap-2">
              <Input
                id="mapsLink"
                value={mapsLink}
                onChange={(e) => setMapsLink(e.target.value)}
                placeholder="https://maps.google.com/?q=-25.263740,-57.575926"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => extractCoordinatesFromMapsLink(mapsLink)}
                disabled={!mapsLink}
              >
                Extraer
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Pega el link de Google Maps y haz clic en "Extraer" para obtener las coordenadas
            </p>
          </div>

          {/* Coordinates (Optional) */}
          <div className="space-y-2">
            <Label>Coordenadas (opcional)</Label>
            <div className="flex gap-2">
              <Input
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                placeholder="Latitud"
                type="number"
                step="any"
              />
              <Input
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                placeholder="Longitud"
                type="number"
                step="any"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={getCurrentLocation}
                title="Usar mi ubicación actual"
              >
                <MapPin className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              O ingresa las coordenadas manualmente / usa el botón de ubicación
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
              <Button onClick={handleConfirm} disabled={loading || !courierId}>
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
