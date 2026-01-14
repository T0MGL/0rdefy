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
import { IncidentRetryChecklist } from '@/components/IncidentRetryChecklist';
import {
  CheckCircle,
  XCircle,
  Loader2,
  MapPin,
  Phone,
  Package,
  AlertCircle,
  DollarSign,
  Navigation,
  CreditCard,
  Banknote,
  Smartphone,
  ArrowRight,
  Clock,
  User,
  ShoppingBag,
  Sparkles,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';

type DeliveryState =
  | { type: 'loading' }
  | { type: 'delivered'; message: string; deliveredAt: string; alreadyRated: boolean; rating?: number; ratingComment?: string; data: any }
  | { type: 'rated_thanks'; message: string }
  | { type: 'failed'; message: string; reason: string; data?: any }
  | { type: 'not_found'; message: string }
  | { type: 'pending'; data: any; hasIncident?: boolean; incident?: any };

export default function Delivery() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const [state, setState] = useState<DeliveryState>({ type: 'loading' });
  const [submitting, setSubmitting] = useState(false);
  const [failureReason, setFailureReason] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [failureNotes, setFailureNotes] = useState('');
  const [rating, setRating] = useState(0);
  const [ratingComment, setRatingComment] = useState('');
  const [differentAmountCollected, setDifferentAmountCollected] = useState(false);
  const [amountCollected, setAmountCollected] = useState('');
  const [showFailureSection, setShowFailureSection] = useState(false);

  useEffect(() => {
    if (token) {
      fetchOrderByToken(token);
    }
  }, [token]);

  const fetchOrderByToken = async (token: string) => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const response = await fetch(`${apiUrl}/api/orders/token/${token}`);
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
        // Check if order has active incident
        try {
          const incidentResponse = await fetch(`${apiUrl}/api/incidents/order/${result.data.id}/active`);
          const incidentResult = await incidentResponse.json();

          setState({
            type: 'pending',
            data: result.data,
            hasIncident: incidentResult.has_incident,
            incident: incidentResult.has_incident ? incidentResult.data : null,
          });
        } catch (incidentError) {
          console.error('Error fetching incident:', incidentError);
          setState({
            type: 'pending',
            data: result.data,
          });
        }
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

    if (!paymentMethod) {
      toast({
        title: 'Método de pago requerido',
        description: 'Debes seleccionar el método de pago usado por el cliente',
        variant: 'destructive',
      });
      return;
    }

    if (differentAmountCollected && !amountCollected) {
      toast({
        title: 'Monto requerido',
        description: 'Debes ingresar el monto que cobraste',
        variant: 'destructive',
      });
      return;
    }

    try {
      setSubmitting(true);

      const payload: any = {
        payment_method: paymentMethod,
      };

      if (differentAmountCollected && amountCollected) {
        payload.amount_collected = parseFloat(amountCollected.replace(/\./g, '').replace(',', '.'));
        payload.has_amount_discrepancy = true;
      }

      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/orders/token/${token}/delivery-confirm`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Error al confirmar entrega');
      }

      toast({
        title: '¡Entrega confirmada!',
        description: 'El pedido ha sido marcado como entregado',
      });

      fetchOrderByToken(token!);
    } catch (error: any) {
      console.error('Error confirming delivery:', error);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo confirmar la entrega',
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

      const payload: any = {
        delivery_failure_reason: failureReason,
      };

      if (failureNotes.trim()) {
        payload.failure_notes = failureNotes;
      }

      const response = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/orders/token/${token}/delivery-fail`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Error al reportar falla');
      }

      toast({
        title: 'Falla reportada',
        description: 'El problema ha sido registrado',
      });

      fetchOrderByToken(token!);
    } catch (error: any) {
      console.error('Error reporting failure:', error);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo reportar la falla',
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
        throw new Error(error.message || 'Error al enviar calificación');
      }

      const result = await response.json();

      toast({
        title: '¡Gracias por tu calificación!',
        description: result.message,
      });

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

    if (google_maps_link) {
      window.open(google_maps_link, '_blank');
    } else if (latitude && longitude) {
      window.open(`https://www.google.com/maps?q=${latitude},${longitude}`, '_blank');
    } else if (customer_address) {
      const parts = [];
      if (customer_address) parts.push(customer_address);
      if (neighborhood) parts.push(neighborhood);
      const address = parts.join(', ');
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, '_blank');
    }
  };

  // Loading state - Premium spinner
  if (state.type === 'loading') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10">
        <div className="relative">
          <div className="w-20 h-20 border-4 border-primary/20 rounded-full"></div>
          <div className="absolute top-0 left-0 w-20 h-20 border-4 border-primary rounded-full border-t-transparent animate-spin"></div>
        </div>
        <p className="mt-6 text-muted-foreground text-sm font-medium tracking-wide">Cargando pedido...</p>
      </div>
    );
  }

  // Delivered state - Already rated
  if (state.type === 'delivered') {
    if (state.alreadyRated) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
          <div className="max-w-md w-full">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-br from-primary to-primary/80 mb-6 shadow-lg shadow-primary/30">
                <CheckCircle className="h-12 w-12 text-primary-foreground" />
              </div>
              <h1 className="text-2xl font-bold text-foreground mb-2">{state.message}</h1>
              <p className="text-muted-foreground">
                Entregado el {new Date(state.deliveredAt).toLocaleString('es-ES', {
                  dateStyle: 'long',
                  timeStyle: 'short',
                })}
              </p>
            </div>

            <Card className="border-border/50">
              <CardContent className="p-6">
                <p className="text-sm font-medium text-muted-foreground mb-4 text-center">Ya calificaste esta entrega</p>
                <div className="flex items-center justify-center gap-1 mb-3">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <span key={star} className="text-3xl">
                      {star <= (state.rating || 0) ? '⭐' : '☆'}
                    </span>
                  ))}
                </div>
                {state.ratingComment && (
                  <p className="text-sm text-muted-foreground italic text-center">"{state.ratingComment}"</p>
                )}
              </CardContent>
            </Card>

            <p className="text-center text-muted-foreground text-sm mt-6">
              ¡Gracias por tu opinión!
            </p>
          </div>
        </div>
      );
    }

    // Not rated yet - Rating form
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-primary to-primary/80 mb-6 shadow-lg shadow-primary/30">
              <CheckCircle className="h-10 w-10 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">{state.message}</h1>
            <p className="text-muted-foreground text-sm">
              Entregado el {new Date(state.deliveredAt).toLocaleString('es-ES', {
                dateStyle: 'long',
                timeStyle: 'short',
              })}
            </p>
          </div>

          <Card className="border-border/50">
            <CardContent className="p-6 space-y-6">
              <div className="text-center">
                <Label className="text-base font-semibold text-foreground">
                  ¿Cómo calificas la entrega?
                </Label>
                <p className="text-sm text-muted-foreground mt-1">Tu opinión nos ayuda a mejorar</p>
              </div>

              <div className="flex items-center justify-center gap-3">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    className={`text-4xl transition-all duration-200 hover:scale-125 focus:outline-none ${
                      star <= rating ? 'scale-110' : 'opacity-40 hover:opacity-70'
                    }`}
                  >
                    {star <= rating ? '⭐' : '☆'}
                  </button>
                ))}
              </div>

              {rating > 0 && (
                <p className="text-sm text-center font-medium text-primary">
                  {rating === 5 && '¡Excelente!'}
                  {rating === 4 && '¡Muy bueno!'}
                  {rating === 3 && 'Bueno'}
                  {rating === 2 && 'Regular'}
                  {rating === 1 && 'Necesita mejorar'}
                </p>
              )}

              <div className="space-y-2">
                <Label htmlFor="comment" className="text-sm font-medium text-muted-foreground">
                  Comentario (opcional)
                </Label>
                <Textarea
                  id="comment"
                  value={ratingComment}
                  onChange={(e) => setRatingComment(e.target.value)}
                  placeholder="Cuéntanos sobre tu experiencia..."
                  rows={3}
                  className="resize-none"
                />
              </div>

              <Button
                onClick={handleSubmitRating}
                disabled={submitting || rating === 0}
                className="w-full h-12"
                size="lg"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  'Enviar Calificación'
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Rated thanks state
  if (state.type === 'rated_thanks') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
        <div className="max-w-md w-full text-center">
          <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-br from-primary to-primary/80 mb-6 shadow-lg shadow-primary/30">
            <Sparkles className="h-12 w-12 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-3">¡Gracias!</h1>
          <p className="text-muted-foreground">{state.message}</p>
        </div>
      </div>
    );
  }

  // Failed state
  if (state.type === 'failed') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-destructive to-destructive/80 mb-6 shadow-lg shadow-destructive/30">
              <XCircle className="h-10 w-10 text-destructive-foreground" />
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">{state.message}</h1>
            {state.reason && (
              <p className="text-muted-foreground">
                <span className="font-medium">Motivo:</span> {state.reason}
              </p>
            )}
          </div>

          <Card className="border-border/50">
            <CardContent className="p-6 space-y-4">
              <p className="text-sm font-medium text-muted-foreground text-center">
                ¿Qué deseas hacer con este pedido?
              </p>

              <Button
                className="w-full h-12"
                size="lg"
                onClick={async () => {
                  try {
                    const authToken = localStorage.getItem('auth_token');
                    const storeId = state.data?.store_id;

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
                      fetchOrderByToken(token!);
                    } else {
                      throw new Error('Error al reactivar pedido');
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
                <Clock className="mr-2 h-5 w-5" />
                Programar Reintento
              </Button>

              <Button
                variant="outline"
                className="w-full h-12 border-destructive/50 text-destructive hover:bg-destructive/10"
                size="lg"
                onClick={async () => {
                  if (confirm('¿Estás seguro de que deseas cancelar este pedido?')) {
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
                        setState({
                          type: 'not_found',
                          message: 'Este pedido ha sido cancelado',
                        });
                      } else {
                        throw new Error('Error al cancelar pedido');
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
                <XCircle className="mr-2 h-5 w-5" />
                Cancelar Pedido
              </Button>
            </CardContent>
          </Card>

          <p className="text-xs text-center text-muted-foreground mt-6">
            Si tienes dudas, contacta al vendedor antes de tomar una decisión
          </p>
        </div>
      </div>
    );
  }

  // Not found state
  if (state.type === 'not_found') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-primary/10 p-4">
        <div className="max-w-md w-full text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-amber-500 to-amber-600 mb-6 shadow-lg shadow-amber-500/30">
            <AlertCircle className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Pedido no encontrado</h1>
          <p className="text-muted-foreground">{state.message}</p>
        </div>
      </div>
    );
  }

  // Pending delivery state - Main delivery UI
  const orderData = state.data;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10">
      {/* Premium Header */}
      <div className="bg-gradient-to-r from-primary via-primary/90 to-primary/80 px-4 pt-6 pb-8">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-foreground/20 backdrop-blur-sm flex items-center justify-center">
                <Package className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-primary-foreground font-bold text-lg">Ordefy</h1>
                <p className="text-primary-foreground/80 text-xs">Sistema de Entregas</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-primary-foreground/80 text-xs">Transportista</p>
              <p className="text-primary-foreground font-semibold text-sm">{orderData.carrier_name || 'No asignado'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content - Floating Cards */}
      <div className="max-w-lg mx-auto px-4 -mt-4 pb-8 space-y-4">

        {/* Customer Card */}
        <Card className="border-border/50 shadow-xl">
          <CardContent className="p-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/25">
                <User className="h-6 w-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-foreground font-bold text-lg truncate">{orderData.customer_name}</h2>
                {orderData.customer_phone && (
                  <a
                    href={`tel:${orderData.customer_phone}`}
                    className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 bg-primary/10 hover:bg-primary/20 rounded-lg transition-colors"
                  >
                    <Phone className="h-4 w-4 text-primary" />
                    <span className="text-primary font-medium text-sm">{orderData.customer_phone}</span>
                  </a>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Address & Navigation Card */}
        {orderData.customer_address && (
          <Card className="border-border/50 shadow-xl">
            <CardContent className="p-5">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-rose-500/25">
                  <MapPin className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-foreground font-semibold mb-1">Dirección de Entrega</h3>
                  <p className="text-muted-foreground text-sm">{orderData.customer_address}</p>
                  {orderData.neighborhood && (
                    <p className="text-muted-foreground/70 text-xs mt-1">{orderData.neighborhood}</p>
                  )}
                  {orderData.address_reference && (
                    <p className="text-amber-500 dark:text-amber-400 text-xs mt-2 font-medium">
                      📍 Ref: {orderData.address_reference}
                    </p>
                  )}
                </div>
              </div>

              {(orderData.google_maps_link || orderData.latitude || orderData.longitude) && (
                <Button
                  onClick={() => {
                    const { google_maps_link, latitude, longitude } = orderData;
                    if (latitude && longitude) {
                      window.location.href = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
                    } else if (google_maps_link) {
                      window.open(google_maps_link, '_blank');
                    }
                  }}
                  className="w-full h-14"
                  size="lg"
                >
                  <Navigation className="mr-3 h-5 w-5" />
                  Iniciar Navegación
                  <ArrowRight className="ml-auto h-5 w-5" />
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* Products Card */}
        <Card className="border-border/50 shadow-xl">
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center shadow-lg shadow-purple-500/25">
                <ShoppingBag className="h-5 w-5 text-white" />
              </div>
              <h3 className="text-foreground font-semibold">Productos</h3>
            </div>

            {orderData.line_items && orderData.line_items.length > 0 ? (
              <div className="space-y-3">
                {orderData.line_items.map((item: any, index: number) => (
                  <div
                    key={index}
                    className="flex justify-between items-center py-3 border-b border-border/50 last:border-0"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground font-medium truncate">{item.title || item.product_name}</p>
                      <p className="text-muted-foreground text-sm">Cantidad: {item.quantity}</p>
                    </div>
                    <p className="text-foreground font-semibold ml-4">
                      ₲{((item.price || 0) * (item.quantity || 1)).toLocaleString()}
                    </p>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-3 mt-3 border-t border-border">
                  <span className="text-muted-foreground font-semibold">Total</span>
                  <span className="text-2xl font-bold text-foreground">₲{orderData.total_price?.toLocaleString()}</span>
                </div>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No hay productos para mostrar</p>
            )}
          </CardContent>
        </Card>

        {/* COD Alert Card */}
        {orderData.cod_amount > 0 && (
          <Card className="border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-orange-500/10">
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
                  <Banknote className="h-7 w-7 text-white" />
                </div>
                <div className="flex-1">
                  <p className="text-amber-600 dark:text-amber-400 font-semibold text-sm uppercase tracking-wide">Cobro en Efectivo</p>
                  <p className="text-3xl font-bold text-foreground mt-1">₲{orderData.cod_amount?.toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Incident Retry Checklist */}
        {state.hasIncident && state.incident && (
          <Card className="border-amber-500/50 shadow-xl">
            <CardContent className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                  <AlertCircle className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-foreground font-semibold">Incidencia de Entrega</h3>
                  <p className="text-muted-foreground text-xs">Completa uno de los intentos programados</p>
                </div>
              </div>
              <IncidentRetryChecklist
                incidentId={state.incident.incident_id}
                orderId={state.data.id}
                currentRetryCount={state.incident.current_retry_count}
                maxRetries={state.incident.max_retry_attempts}
                retryAttempts={state.incident.retry_attempts || []}
                onSuccess={() => {
                  toast({
                    title: 'Intento completado',
                    description: 'El intento ha sido registrado correctamente',
                  });
                  fetchOrderByToken(token!);
                }}
              />
            </CardContent>
          </Card>
        )}

        {/* Actions Card - Only if no incident */}
        {!state.hasIncident && (
          <Card className="border-border/50 shadow-xl">
            <CardContent className="p-5 space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg shadow-primary/25">
                  <CheckCircle className="h-5 w-5 text-primary-foreground" />
                </div>
                <h3 className="text-foreground font-semibold">Confirmar Entrega</h3>
              </div>

              {/* Payment Method Selection - Premium Buttons */}
              <div className="space-y-3">
                <Label className="text-muted-foreground text-sm font-medium">Método de pago del cliente</Label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: 'efectivo', label: 'Efectivo', icon: Banknote },
                    { value: 'tarjeta', label: 'Tarjeta', icon: CreditCard },
                    { value: 'qr', label: 'QR', icon: Smartphone },
                    { value: 'transferencia', label: 'Transfer.', icon: ArrowRight },
                  ].map((method) => {
                    const Icon = method.icon;
                    const isSelected = paymentMethod === method.value;

                    return (
                      <button
                        key={method.value}
                        onClick={() => {
                          setPaymentMethod(method.value);
                          if (method.value !== 'efectivo') {
                            setDifferentAmountCollected(false);
                            setAmountCollected('');
                          }
                        }}
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200 ${
                          isSelected
                            ? 'bg-primary/10 border-primary text-primary'
                            : 'border-border text-muted-foreground hover:border-muted-foreground/50'
                        }`}
                      >
                        <Icon className="h-6 w-6" />
                        <span className="text-sm font-medium">{method.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Different Amount Checkbox - Only for Cash */}
              {paymentMethod === 'efectivo' && (
                <div className="bg-muted/50 rounded-xl p-4 space-y-3">
                  <div className="flex items-center space-x-3">
                    <Checkbox
                      id="different-amount"
                      checked={differentAmountCollected}
                      onCheckedChange={(checked) => {
                        setDifferentAmountCollected(checked === true);
                        if (!checked) setAmountCollected('');
                      }}
                    />
                    <Label
                      htmlFor="different-amount"
                      className="text-sm font-medium cursor-pointer flex items-center gap-2 text-muted-foreground"
                    >
                      <DollarSign className="h-4 w-4 text-amber-500" />
                      Cobré un monto diferente
                    </Label>
                  </div>

                  {differentAmountCollected && (
                    <div className="space-y-2 pl-7 animate-in slide-in-from-top-2 duration-200">
                      <Label htmlFor="amount-collected" className="text-sm font-medium text-muted-foreground">
                        Monto cobrado (₲)
                      </Label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-muted-foreground font-semibold">₲</span>
                        <Input
                          id="amount-collected"
                          type="text"
                          inputMode="numeric"
                          value={amountCollected}
                          onChange={(e) => {
                            const value = e.target.value.replace(/[^0-9]/g, '');
                            const formatted = value ? parseInt(value).toLocaleString('es-PY') : '';
                            setAmountCollected(formatted);
                          }}
                          placeholder="150.000"
                          className="pl-10 h-12 text-lg font-semibold"
                        />
                      </div>
                      <p className="text-xs text-amber-500 dark:text-amber-400">
                        Monto esperado: ₲{(orderData.cod_amount || orderData.total_price || 0)?.toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Prepaid Info Message */}
              {paymentMethod && paymentMethod !== 'efectivo' && (
                <div className="bg-primary/10 rounded-xl p-4 border border-primary/30">
                  <p className="text-sm text-primary flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    <span className="font-medium">Pago prepago - No debes cobrar nada al cliente</span>
                  </p>
                </div>
              )}

              {/* Confirm Button */}
              <Button
                onClick={handleConfirmDelivery}
                disabled={submitting || !paymentMethod}
                className="w-full h-14"
                size="lg"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Confirmando...
                  </>
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-5 w-5" />
                    Confirmar Entrega
                  </>
                )}
              </Button>

              {/* Toggle Failure Section */}
              <div className="pt-2">
                <button
                  onClick={() => setShowFailureSection(!showFailureSection)}
                  className="w-full text-center text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
                >
                  {showFailureSection ? '▲ Ocultar opciones de falla' : '▼ ¿No pudiste entregar?'}
                </button>
              </div>

              {/* Failure Section - Collapsible */}
              {showFailureSection && (
                <div className="bg-destructive/10 rounded-xl p-4 border border-destructive/30 space-y-4 animate-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center gap-2 text-destructive">
                    <XCircle className="h-5 w-5" />
                    <span className="font-semibold">Reportar problema</span>
                  </div>

                  <Select value={failureReason} onValueChange={setFailureReason}>
                    <SelectTrigger className="h-12">
                      <SelectValue placeholder="Selecciona un motivo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Cliente ausente">Cliente ausente</SelectItem>
                      <SelectItem value="Dirección incorrecta">Dirección incorrecta</SelectItem>
                      <SelectItem value="Cliente rechazó el pedido">Cliente rechazó el pedido</SelectItem>
                      <SelectItem value="No había efectivo">No había efectivo</SelectItem>
                      <SelectItem value="Cliente no contestó llamadas">Cliente no contestó llamadas</SelectItem>
                      <SelectItem value="Zona insegura">Zona insegura</SelectItem>
                      <SelectItem value="Otro motivo">Otro motivo</SelectItem>
                    </SelectContent>
                  </Select>

                  <Textarea
                    value={failureNotes}
                    onChange={(e) => setFailureNotes(e.target.value)}
                    placeholder="Describe con más detalle (opcional)..."
                    rows={2}
                    className="resize-none"
                  />

                  <Button
                    variant="destructive"
                    onClick={handleReportFailure}
                    disabled={submitting || !failureReason}
                    className="w-full h-12"
                    size="lg"
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
              )}
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <div className="text-center py-4">
          <p className="text-muted-foreground text-xs">
            Powered by <span className="text-primary font-semibold">Ordefy</span>
          </p>
        </div>
      </div>
    </div>
  );
}
