import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  CheckCircle,
  XCircle,
  Loader2,
  MapPin,
  Phone,
  Package,
  AlertCircle,
} from 'lucide-react';

type DeliveryState =
  | { type: 'loading' }
  | { type: 'delivered'; message: string; deliveredAt: string; alreadyRated: boolean; rating?: number; ratingComment?: string; data: any }
  | { type: 'rated_thanks'; message: string }
  | { type: 'failed'; message: string; reason: string; data?: any }
  | { type: 'not_found'; message: string }
  | { type: 'pending'; data: any };

export default function Delivery() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const [state, setState] = useState<DeliveryState>({ type: 'loading' });
  const [submitting, setSubmitting] = useState(false);
  const [failureReason, setFailureReason] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [failureNotes, setFailureNotes] = useState('');
  const [rating, setRating] = useState(0);
  const [ratingComment, setRatingComment] = useState('');

  useEffect(() => {
    if (token) {
      fetchOrderByToken(token);
    }
  }, [token]);

  const fetchOrderByToken = async (token: string) => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/orders/token/${token}`);
      const result = await response.json();

      if (result.already_delivered) {
        setState({
          type: 'delivered',
          message: result.message,
          deliveredAt: result.delivered_at,
          alreadyRated: result.already_rated,
          rating: result.rating,
          ratingComment: result.rating_comment,
          data: result.data,
        });
      } else if (result.delivery_failed) {
        setState({
          type: 'failed',
          message: result.message,
          reason: result.failure_reason,
          data: result.data,
        });
      } else if (result.error) {
        setState({
          type: 'not_found',
          message: result.message,
        });
      } else {
        setState({
          type: 'pending',
          data: result.data,
        });
      }
    } catch (error) {
      console.error('Error fetching order:', error);
      setState({
        type: 'not_found',
        message: 'Error al cargar el pedido',
      });
    }
  };

  const handleConfirmDelivery = async () => {
    if (state.type !== 'pending') return;

    // Validar que se haya seleccionado método de pago
    if (!paymentMethod) {
      toast({
        title: 'Método de pago requerido',
        description: 'Debes seleccionar el método de pago usado por el cliente',
        variant: 'destructive',
      });
      return;
    }

    try {
      setSubmitting(true);
      const authToken = localStorage.getItem('auth_token');
      const storeId = state.data.store_id;

      let uploadedPhotoUrl = photoUrl;

      // Si hay un archivo de foto, subirlo primero
      if (photoFile) {
        const formData = new FormData();
        formData.append('file', photoFile);
        formData.append('store_id', storeId);
        formData.append('order_id', state.data.id);

        const uploadResponse = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/delivery-attempts/upload-photo`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${authToken}`,
              'X-Store-ID': storeId,
            },
            body: formData,
          }
        );

        if (uploadResponse.ok) {
          const uploadResult = await uploadResponse.json();
          uploadedPhotoUrl = uploadResult.url;
        } else {
          console.warn('Failed to upload photo, continuing without it');
        }
      }

      const payload: any = {
        payment_method: paymentMethod,
      };
      if (uploadedPhotoUrl) {
        payload.proof_photo_url = uploadedPhotoUrl;
      }

      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/orders/${state.data.id}/delivery-confirm`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Store-ID': storeId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to confirm delivery');
      }

      toast({
        title: '¡Entrega confirmada!',
        description: 'El pedido ha sido marcado como entregado',
      });

      // Refresh to show delivered state
      fetchOrderByToken(token!);
    } catch (error) {
      console.error('Error confirming delivery:', error);
      toast({
        title: 'Error',
        description: 'No se pudo confirmar la entrega',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReportFailure = async () => {
    if (state.type !== 'pending') return;

    if (!failureReason) {
      toast({
        title: 'Motivo requerido',
        description: 'Debes seleccionar un motivo de falla',
        variant: 'destructive',
      });
      return;
    }

    try {
      setSubmitting(true);
      const authToken = localStorage.getItem('auth_token');
      const storeId = state.data.store_id;

      const payload: any = {
        delivery_failure_reason: failureReason,
      };

      // Agregar notas adicionales si existen
      if (failureNotes.trim()) {
        payload.failure_notes = failureNotes;
      }

      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/orders/${state.data.id}/delivery-fail`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authToken}`,
            'X-Store-ID': storeId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to report failure');
      }

      toast({
        title: 'Falla reportada',
        description: 'El problema ha sido registrado',
      });

      // Refresh to show failed state
      fetchOrderByToken(token!);
    } catch (error) {
      console.error('Error reporting failure:', error);
      toast({
        title: 'Error',
        description: 'No se pudo reportar la falla',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitRating = async () => {
    if (state.type !== 'delivered') return;

    if (!rating || rating < 1 || rating > 5) {
      toast({
        title: 'Calificación requerida',
        description: 'Por favor selecciona una calificación de 1 a 5 estrellas',
        variant: 'destructive',
      });
      return;
    }

    try {
      setSubmitting(true);

      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/orders/${state.data.id}/rate-delivery`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            rating,
            comment: ratingComment || null,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to submit rating');
      }

      const result = await response.json();

      toast({
        title: '¡Gracias por tu calificación!',
        description: result.message,
      });

      // Show thank you message
      setState({
        type: 'rated_thanks',
        message: '¡Gracias por tu calificación! Tu opinión nos ayuda a mejorar',
      });
    } catch (error: any) {
      console.error('Error submitting rating:', error);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo enviar la calificación',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openInMaps = () => {
    if (state.type !== 'pending') return;
    const { google_maps_link, latitude, longitude, customer_address, neighborhood } = state.data;

    // Prioridad: usar google_maps_link si está disponible, si no usar lat/long, si no usar dirección
    if (google_maps_link) {
      window.open(google_maps_link, '_blank');
    } else if (latitude && longitude) {
      window.open(`https://www.google.com/maps?q=${latitude},${longitude}`, '_blank');
    } else if (customer_address) {
      // Construir búsqueda de Google Maps con la dirección
      const parts = [];
      if (customer_address) parts.push(customer_address);
      if (neighborhood) parts.push(neighborhood);
      const address = parts.join(', ');
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, '_blank');
    }
  };

  // Loading state
  if (state.type === 'loading') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background dark:bg-background p-4">
        {/* Logo Ordefy */}
        <div className="flex items-center justify-center mb-8">
          <img
            src="/NO BACKGROUND.png"
            alt="Ordefy Logo"
            className="h-20 w-auto object-contain"
          />
        </div>

        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Cargando información del pedido...</p>
        </div>
      </div>
    );
  }

  // Delivered state - Show rating form if not rated yet
  if (state.type === 'delivered') {
    if (state.alreadyRated) {
      // Already rated - show thank you message
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-background dark:bg-background p-4">
          {/* Logo Ordefy */}
          <div className="flex items-center justify-center mb-8">
            <img
              src="/NO BACKGROUND.png"
              alt="Ordefy Logo"
              className="h-20 w-auto object-contain"
            />
          </div>

          <Card className="max-w-md w-full text-center bg-card border-border">
            <CardHeader>
              <CheckCircle className="h-20 w-20 text-green-500 mx-auto mb-4" />
              <CardTitle className="text-2xl">{state.message}</CardTitle>
              <CardDescription>
                Entregado el {new Date(state.deliveredAt).toLocaleString('es-ES', {
                  dateStyle: 'long',
                  timeStyle: 'short',
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 bg-green-50 dark:bg-green-950/20 rounded-lg">
                <p className="text-sm font-medium mb-2">Ya calificaste esta entrega</p>
                <div className="flex items-center justify-center gap-1 mb-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <span key={star} className="text-2xl">
                      {star <= (state.rating || 0) ? '⭐' : '☆'}
                    </span>
                  ))}
                </div>
                {state.ratingComment && (
                  <p className="text-sm text-muted-foreground italic">"{state.ratingComment}"</p>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                ¡Gracias por tu opinión!
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }

    // Not rated yet - show rating form
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background dark:bg-background p-4">
        {/* Logo Ordefy */}
        <div className="flex items-center justify-center mb-8">
          <img
            src="/NO BACKGROUND.png"
            alt="Ordefy Logo"
            className="h-20 w-auto object-contain"
          />
        </div>

        <Card className="max-w-md w-full bg-card border-border">
          <CardHeader className="text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <CardTitle className="text-2xl">{state.message}</CardTitle>
            <CardDescription>
              Entregado el {new Date(state.deliveredAt).toLocaleString('es-ES', {
                dateStyle: 'long',
                timeStyle: 'short',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3 text-center">
              <Label className="text-base font-semibold">
                ¿Cómo calificas la entrega de {state.data.carrier_name}?
              </Label>
              <div className="flex items-center justify-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    className="text-4xl hover:scale-110 transition-transform focus:outline-none focus:ring-2 focus:ring-primary rounded"
                  >
                    {star <= rating ? '⭐' : '☆'}
                  </button>
                ))}
              </div>
              {rating > 0 && (
                <p className="text-sm text-muted-foreground">
                  {rating === 5 && '¡Excelente!'}
                  {rating === 4 && '¡Muy bueno!'}
                  {rating === 3 && 'Bueno'}
                  {rating === 2 && 'Regular'}
                  {rating === 1 && 'Necesita mejorar'}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="comment" className="text-sm font-medium">
                Comentario (opcional)
              </Label>
              <Textarea
                id="comment"
                value={ratingComment}
                onChange={(e) => setRatingComment(e.target.value)}
                placeholder="Cuéntanos sobre tu experiencia con la entrega..."
                rows={3}
                className="resize-none"
              />
            </div>

            <Button
              onClick={handleSubmitRating}
              disabled={submitting || rating === 0}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
              size="lg"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                'Enviar Calificación'
              )}
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              Tu opinión nos ayuda a mejorar nuestro servicio
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Rated thanks state
  if (state.type === 'rated_thanks') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background dark:bg-background p-4">
        {/* Logo Ordefy */}
        <div className="flex items-center justify-center mb-8">
          <img
            src="/NO BACKGROUND.png"
            alt="Ordefy Logo"
            className="h-20 w-auto object-contain"
          />
        </div>

        <Card className="max-w-md w-full text-center bg-card border-border">
          <CardHeader>
            <CheckCircle className="h-20 w-20 text-green-500 mx-auto mb-4" />
            <CardTitle className="text-2xl">¡Gracias por tu calificación!</CardTitle>
            <CardDescription className="text-base mt-4">
              {state.message}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Failed state - Show retry options
  if (state.type === 'failed') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background dark:bg-background p-4">
        {/* Logo Ordefy */}
        <div className="flex items-center justify-center mb-8">
          <img
            src="/NO BACKGROUND.png"
            alt="Ordefy Logo"
            className="h-20 w-auto object-contain"
          />
        </div>

        <Card className="max-w-md w-full bg-card border-border">
          <CardHeader className="text-center">
            <XCircle className="h-20 w-20 text-red-500 mx-auto mb-4" />
            <CardTitle className="text-2xl">{state.message}</CardTitle>
            {state.reason && (
              <CardDescription className="mt-2">
                <span className="font-medium">Motivo:</span> {state.reason}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-orange-50 dark:bg-orange-950/20 rounded-lg border border-orange-200 dark:border-orange-800">
              <p className="text-sm font-medium text-orange-900 dark:text-orange-100 mb-2">
                ¿Qué deseas hacer con este pedido?
              </p>
              <p className="text-xs text-orange-700 dark:text-orange-300">
                Puedes programar un reintento de entrega o cancelar el pedido definitivamente.
              </p>
            </div>

            <div className="space-y-2">
              <Button
                className="w-full bg-primary hover:bg-primary/90 text-black font-semibold"
                size="lg"
                onClick={async () => {
                  try {
                    const authToken = localStorage.getItem('auth_token');
                    const storeId = state.data?.store_id;

                    // Reactivate order by setting status to 'confirmed'
                    // This will trigger token regeneration on the backend
                    const response = await fetch(
                      `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/orders/${state.data?.id}/status`,
                      {
                        method: 'PATCH',
                        headers: {
                          'Authorization': `Bearer ${authToken}`,
                          'X-Store-ID': storeId,
                          'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                          sleeves_status: 'confirmed',
                        }),
                      }
                    );

                    if (response.ok) {
                      toast({
                        title: 'Pedido reactivado',
                        description: 'El pedido ha sido programado para un nuevo intento de entrega',
                      });
                      // Refresh to show pending state
                      fetchOrderByToken(token!);
                    } else {
                      throw new Error('Failed to reactivate order');
                    }
                  } catch (error) {
                    console.error('Error reactivating order:', error);
                    toast({
                      title: 'Error',
                      description: 'No se pudo reagendar el pedido',
                      variant: 'destructive',
                    });
                  }
                }}
              >
                🔄 Programar Reintento de Entrega
              </Button>

              <Button
                variant="outline"
                className="w-full border-red-500 text-red-500 hover:bg-red-500/10 font-semibold"
                size="lg"
                onClick={async () => {
                  if (confirm('¿Estás seguro de que deseas cancelar este pedido? Esta acción no se puede deshacer.')) {
                    // Call API to cancel order permanently
                    try {
                      const authToken = localStorage.getItem('auth_token');
                      const response = await fetch(
                        `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/orders/${state.data?.id}/cancel`,
                        {
                          method: 'POST',
                          headers: {
                            'Authorization': `Bearer ${authToken}`,
                            'Content-Type': 'application/json',
                          },
                        }
                      );

                      if (response.ok) {
                        toast({
                          title: 'Pedido cancelado',
                          description: 'El pedido ha sido cancelado permanentemente',
                        });
                        // Show cancelled message
                        setState({
                          type: 'not_found',
                          message: 'Este pedido ha sido cancelado',
                        });
                      } else {
                        throw new Error('Failed to cancel order');
                      }
                    } catch (error) {
                      console.error('Error cancelling order:', error);
                      toast({
                        title: 'Error',
                        description: 'No se pudo cancelar el pedido',
                        variant: 'destructive',
                      });
                    }
                  }
                }}
              >
                ❌ Cancelar Pedido Definitivamente
              </Button>
            </div>

            <p className="text-xs text-center text-muted-foreground pt-2">
              Si tienes dudas, contacta al vendedor antes de tomar una decisión
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Not found state
  if (state.type === 'not_found') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background dark:bg-background p-4">
        {/* Logo Ordefy */}
        <div className="flex items-center justify-center mb-8">
          <img
            src="/NO BACKGROUND.png"
            alt="Ordefy Logo"
            className="h-20 w-auto object-contain"
          />
        </div>

        <Card className="max-w-md w-full text-center bg-card border-border">
          <CardHeader>
            <AlertCircle className="h-20 w-20 text-orange-500 mx-auto mb-4" />
            <CardTitle className="text-2xl">Pedido no encontrado</CardTitle>
            <CardDescription>{state.message}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Pending delivery state
  const orderData = state.data;

  return (
    <div className="min-h-screen bg-background dark:bg-background p-4 pb-20">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Logo Ordefy */}
        <div className="flex items-center justify-center py-4">
          <img
            src="/NO BACKGROUND.png"
            alt="Ordefy Logo"
            className="h-16 w-auto object-contain"
          />
        </div>

        {/* Header */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Datos de Entrega
            </CardTitle>
            <CardDescription>
              Repartidor: {orderData.carrier_name || 'No asignado'}
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Customer Info */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle>Información del Cliente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{orderData.customer_name}</p>
              </div>
            </div>

            {orderData.customer_phone && (
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <a
                  href={`tel:${orderData.customer_phone}`}
                  className="text-blue-600 hover:underline"
                >
                  {orderData.customer_phone}
                </a>
              </div>
            )}

            {orderData.customer_address && (
              <div className="flex items-start gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{orderData.customer_address}</p>
                  {orderData.address_reference && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Ref: {orderData.address_reference}
                    </p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Order Items */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle>Productos</CardTitle>
          </CardHeader>
          <CardContent>
            {orderData.line_items && orderData.line_items.length > 0 ? (
              <div className="space-y-2">
                {orderData.line_items.map((item: any, index: number) => (
                  <div
                    key={index}
                    className="flex justify-between items-center py-2 border-b last:border-0"
                  >
                    <div>
                      <p className="font-medium">{item.title || item.product_name}</p>
                      <p className="text-sm text-muted-foreground">
                        Cantidad: {item.quantity}
                      </p>
                    </div>
                    <p className="font-medium">
                      ${((item.price || 0) * (item.quantity || 1)).toLocaleString()}
                    </p>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-3 font-bold text-lg">
                  <span>Total</span>
                  <span>${orderData.total_price?.toLocaleString()}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No hay productos para mostrar</p>
            )}
          </CardContent>
        </Card>

        {/* COD (Cash on Delivery) Alert */}
        {orderData.cod_amount > 0 && (
          <Card className="bg-yellow-500/10 border-yellow-500">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-yellow-500/20 rounded-full">
                  <svg className="h-6 w-6 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="font-bold text-lg text-yellow-500">Cobro en Efectivo</p>
                  <p className="text-sm text-muted-foreground">Debes cobrar al cliente:</p>
                  <p className="text-2xl font-bold text-yellow-400 mt-1">
                    ${orderData.cod_amount?.toLocaleString()} {orderData.payment_method === 'efectivo' ? 'en efectivo' : ''}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )

        }

        {/* Google Maps Location Card - Prominent for Couriers */}
        {orderData.customer_address && (
          <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
            <CardContent className="p-4">
              <div className="flex items-start gap-3 mb-3">
                <div className="p-2 bg-blue-600 rounded-full">
                  <MapPin className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-1">
                    Ubicación de Entrega
                  </h3>
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    {orderData.customer_address}
                  </p>
                  {orderData.neighborhood && (
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                      {orderData.neighborhood}
                    </p>
                  )}
                  {orderData.address_reference && (
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                      Ref: {orderData.address_reference}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2">
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold h-12"
                  onClick={() => {
                    const { google_maps_link, latitude, longitude, customer_address, neighborhood } = orderData;

                    // Prioridad: usar google_maps_link si está disponible, si no usar lat/long para navegación
                    if (latitude && longitude) {
                      // Abrir directamente en la app de Google Maps con navegación
                      window.location.href = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
                    } else if (google_maps_link) {
                      window.open(google_maps_link, '_blank');
                    } else if (customer_address) {
                      // Construir búsqueda de Google Maps con la dirección
                      const parts = [];
                      if (customer_address) parts.push(customer_address);
                      if (neighborhood) parts.push(neighborhood);
                      const address = parts.join(', ');
                      window.location.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
                    }
                  }}
                >
                  <svg className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  Iniciar Navegación
                </Button>

                <Button
                  variant="outline"
                  className="w-full border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30"
                  onClick={openInMaps}
                >
                  <MapPin className="h-4 w-4 mr-2" />
                  Ver en Google Maps
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle>Acciones de Entrega</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Confirm Delivery Section */}
            <div className="space-y-3 p-4 border rounded-lg bg-green-50 dark:bg-green-950/20">
              <div className="space-y-2">
                <Label htmlFor="payment-method" className="text-sm font-medium">
                  Método de pago *
                </Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger id="payment-method">
                    <SelectValue placeholder="Selecciona el método de pago" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="efectivo">Efectivo</SelectItem>
                    <SelectItem value="tarjeta">Tarjeta</SelectItem>
                    <SelectItem value="transferencia">Transferencia</SelectItem>
                    <SelectItem value="yape">Yape</SelectItem>
                    <SelectItem value="plin">Plin</SelectItem>
                    <SelectItem value="otro">Otro</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="photo-file" className="text-sm font-medium">
                  Foto de evidencia (opcional)
                </Label>
                <input
                  type="file"
                  id="photo-file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
                {photoFile && (
                  <p className="text-xs text-muted-foreground">
                    Archivo seleccionado: {photoFile.name} ({(photoFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>

              <Button
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold"
                size="lg"
                onClick={handleConfirmDelivery}
                disabled={submitting || !paymentMethod}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Confirmando...
                  </>
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Confirmar Entrega
                  </>
                )}
              </Button>
            </div>

            {/* Report Failure Section */}
            <div className="space-y-3 p-4 border rounded-lg bg-red-50 dark:bg-red-950/20">
              <div className="space-y-2">
                <Label htmlFor="reason" className="text-sm font-medium">
                  Motivo de falla *
                </Label>
                <Select value={failureReason} onValueChange={setFailureReason}>
                  <SelectTrigger id="reason">
                    <SelectValue placeholder="Selecciona un motivo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Cliente ausente">Cliente ausente</SelectItem>
                    <SelectItem value="Dirección incorrecta">Dirección incorrecta</SelectItem>
                    <SelectItem value="Cliente rechazó el pedido">
                      Cliente rechazó el pedido
                    </SelectItem>
                    <SelectItem value="No había efectivo">No había efectivo</SelectItem>
                    <SelectItem value="Cliente no contestó llamadas">
                      Cliente no contestó llamadas
                    </SelectItem>
                    <SelectItem value="Zona insegura">Zona insegura</SelectItem>
                    <SelectItem value="Otro motivo">Otro motivo</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="failure-notes" className="text-sm font-medium">
                  Información adicional del problema (opcional)
                </Label>
                <Textarea
                  id="failure-notes"
                  value={failureNotes}
                  onChange={(e) => setFailureNotes(e.target.value)}
                  placeholder="Describe con más detalle qué sucedió..."
                  rows={3}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  Puedes agregar más detalles sobre el problema para ayudar a resolver la situación
                </p>
              </div>

              <Button
                variant="destructive"
                className="w-full"
                size="lg"
                onClick={handleReportFailure}
                disabled={submitting || !failureReason}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Reportando...
                  </>
                ) : (
                  <>
                    <XCircle className="mr-2 h-4 w-4" />
                    Reportar Falla
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
