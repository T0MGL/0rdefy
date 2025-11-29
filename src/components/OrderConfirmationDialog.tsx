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
import { Loader2, MapPin, CheckCircle2, Printer } from 'lucide-react';
import type { Order } from '@/types';
import type { Carrier } from '@/types/carrier';
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
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [loadingCarriers, setLoadingCarriers] = useState(true);

  // Confirmation state
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState<any>(null);

  // Form state
  const [upsellAdded, setUpsellAdded] = useState(false);
  const [courierId, setCourierId] = useState<string>('');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState<string>('');
  const [longitude, setLongitude] = useState<string>('');

  // Load carriers on mount and reset state
  useEffect(() => {
    if (open) {
      setIsConfirmed(false);
      setConfirmedOrder(null);
      fetchCarriers();
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
    }
  }, [open, order]);

  const fetchCarriers = async () => {
    try {
      setLoadingCarriers(true);
      const token = localStorage.getItem('auth_token');
      const storeId = localStorage.getItem('current_store_id');

      // Query the couriers endpoint (repartidores)
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/couriers?status=active`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Store-ID': storeId || '',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Carriers API error:', errorData);
        throw new Error(errorData.message || 'Failed to fetch carriers');
      }

      const result = await response.json();
      console.log('Carriers loaded:', result);
      console.log('Carriers data:', result.data);
      console.log('Number of carriers:', result.data?.length || 0);

      // The API should return active carriers
      const carriersList = result.data || [];

      // Map the API response to match our Carrier type
      const mappedCarriers = carriersList.map((c: any) => ({
        ...c,
        status: c.is_active ? 'active' : 'inactive',
        deliveryRate: c.delivery_rate || 0,
      }));

      console.log('Mapped carriers:', mappedCarriers);
      setCarriers(mappedCarriers);

      if (carriersList.length === 0) {
        toast({
          title: 'Sin repartidores',
          description: 'No hay repartidores activos disponibles. Crea uno primero.',
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      console.error('Error fetching carriers:', error);
      toast({
        title: 'Error',
        description: error.message || 'No se pudieron cargar los repartidores',
        variant: 'destructive',
      });
    } finally {
      setLoadingCarriers(false);
    }
  };

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

      // Show success state with print label option
      setIsConfirmed(true);
      setConfirmedOrder(result.data);

      toast({
        title: '¡Pedido confirmado!',
        description: 'El pedido ha sido asignado al repartidor. Ahora puedes imprimir la etiqueta.',
      });

      onConfirmed();
    } catch (error: any) {
      console.error('Error confirming order:', error);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo confirmar el pedido',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
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

        {isConfirmed && confirmedOrder ? (
          // Success state - Show shipping label
          <div className="py-4">
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

            <OrderShippingLabel
              orderId={confirmedOrder.id}
              deliveryToken={confirmedOrder.delivery_link_token}
              customerName={`${confirmedOrder.customer_first_name || ''} ${confirmedOrder.customer_last_name || ''}`.trim() || order?.customer || 'Cliente'}
              customerPhone={confirmedOrder.customer_phone || order?.phone || ''}
              customerAddress={confirmedOrder.customer_address || confirmedOrder.address || order?.address || order?.customer_address}
              addressReference={confirmedOrder.address_reference || order?.address_reference}
              neighborhood={confirmedOrder.neighborhood || order?.neighborhood}
              deliveryNotes={confirmedOrder.delivery_notes || order?.delivery_notes}
              courierName={carriers.find(c => c.id === courierId)?.name}
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
          </div>
        ) : (
          // Form state - Original confirmation form
          <div className="space-y-4 py-4">
            {/* Order Info */}
            {order && (
              <div className="rounded-lg border p-3 bg-muted/50">
                <p className="text-sm font-medium">Pedido #{order.id.slice(0, 8)}</p>
                <p className="text-sm text-muted-foreground">Cliente: {order.customer}</p>
                <p className="text-sm text-muted-foreground">Total: Gs. {order.total.toLocaleString()}</p>
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
              Usa el botón de ubicación o ingresa las coordenadas manualmente
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
        </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
