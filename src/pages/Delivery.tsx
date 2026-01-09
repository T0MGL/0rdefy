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
        throw new Error(errorData.message || 'Failed to confirm delivery');
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
        throw new Error(errorData.message || 'Failed to report failure');
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
        throw new Error(error.message || 'Failed to submit rating');
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
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        <div className="relative">
          <div className="w-20 h-20 border-4 border-emerald-500/20 rounded-full"></div>
          <div className="absolute top-0 left-0 w-20 h-20 border-4 border-emerald-500 rounded-full border-t-transparent animate-spin"></div>
        </div>
        <p className="mt-6 text-slate-400 text-sm font-medium tracking-wide">Cargando pedido...</p>
      </div>
    );
  }

  // Delivered state - Already rated
  if (state.type === 'delivered') {
    if (state.alreadyRated) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-4">
          <div className="max-w-md w-full">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 mb-6 shadow-lg shadow-emerald-500/30">
                <CheckCircle className="h-12 w-12 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-white mb-2">{state.message}</h1>
              <p className="text-slate-400">
                Entregado el {new Date(state.deliveredAt).toLocaleString('es-ES', {
                  dateStyle: 'long',
                  timeStyle: 'short',
                })}
              </p>
            </div>

            <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700/50">
              <p className="text-sm font-medium text-slate-300 mb-4 text-center">Ya calificaste esta entrega</p>
              <div className="flex items-center justify-center gap-1 mb-3">
                {[1, 2, 3, 4, 5].map((star) => (
                  <span key={star} className="text-3xl">
                    {star <= (state.rating || 0) ? '⭐' : '☆'}
                  </span>
                ))}
              </div>
              {state.ratingComment && (
                <p className="text-sm text-slate-400 italic text-center">"{state.ratingComment}"</p>
              )}
            </div>

            <p className="text-center text-slate-500 text-sm mt-6">
              ¡Gracias por tu opinión!
            </p>
          </div>
        </div>
      );
    }

    // Not rated yet - Rating form
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 mb-6 shadow-lg shadow-emerald-500/30">
              <CheckCircle className="h-10 w-10 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">{state.message}</h1>
            <p className="text-slate-400 text-sm">
              Entregado el {new Date(state.deliveredAt).toLocaleString('es-ES', {
                dateStyle: 'long',
                timeStyle: 'short',
              })}
            </p>
          </div>

          <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700/50 space-y-6">
            <div className="text-center">
              <Label className="text-base font-semibold text-white">
                ¿Cómo calificas la entrega?
              </Label>
              <p className="text-sm text-slate-400 mt-1">Tu opinión nos ayuda a mejorar</p>
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
              <p className="text-sm text-center font-medium text-emerald-400">
                {rating === 5 && '¡Excelente!'}
                {rating === 4 && '¡Muy bueno!'}
                {rating === 3 && 'Bueno'}
                {rating === 2 && 'Regular'}
                {rating === 1 && 'Necesita mejorar'}
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="comment" className="text-sm font-medium text-slate-300">
                Comentario (opcional)
              </Label>
              <Textarea
                id="comment"
                value={ratingComment}
                onChange={(e) => setRatingComment(e.target.value)}
                placeholder="Cuéntanos sobre tu experiencia..."
                rows={3}
                className="resize-none bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-emerald-500 focus:ring-emerald-500/20"
              />
            </div>

            <Button
              onClick={handleSubmitRating}
              disabled={submitting || rating === 0}
              className="w-full h-12 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-semibold rounded-xl shadow-lg shadow-emerald-500/25 transition-all duration-200 disabled:opacity-50 disabled:shadow-none"
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
          </div>
        </div>
      </div>
    );
  }

  // Rated thanks state
  if (state.type === 'rated_thanks') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-4">
        <div className="max-w-md w-full text-center">
          <div className="inline-flex items-center justify-center w-24 h-24 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 mb-6 shadow-lg shadow-emerald-500/30">
            <Sparkles className="h-12 w-12 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-3">¡Gracias!</h1>
          <p className="text-slate-400">{state.message}</p>
        </div>
      </div>
    );
  }

  // Failed state
  if (state.type === 'failed') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-red-400 to-red-600 mb-6 shadow-lg shadow-red-500/30">
              <XCircle className="h-10 w-10 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">{state.message}</h1>
            {state.reason && (
              <p className="text-slate-400">
                <span className="font-medium">Motivo:</span> {state.reason}
              </p>
            )}
          </div>

          <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl p-6 border border-slate-700/50 space-y-4">
            <p className="text-sm font-medium text-slate-300 text-center">
              ¿Qué deseas hacer con este pedido?
            </p>

            <Button
              className="w-full h-12 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-semibold rounded-xl"
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
              <Clock className="mr-2 h-5 w-5" />
              Programar Reintento
            </Button>

            <Button
              variant="outline"
              className="w-full h-12 border-red-500/50 text-red-400 hover:bg-red-500/10 font-semibold rounded-xl"
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
              <XCircle className="mr-2 h-5 w-5" />
              Cancelar Pedido
            </Button>
          </div>

          <p className="text-xs text-center text-slate-500 mt-6">
            Si tienes dudas, contacta al vendedor antes de tomar una decisión
          </p>
        </div>
      </div>
    );
  }

  // Not found state
  if (state.type === 'not_found') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-4">
        <div className="max-w-md w-full text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 mb-6 shadow-lg shadow-amber-500/30">
            <AlertCircle className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Pedido no encontrado</h1>
          <p className="text-slate-400">{state.message}</p>
        </div>
      </div>
    );
  }

  // Pending delivery state - Main delivery UI
  const orderData = state.data;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      {/* Premium Header */}
      <div className="bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 px-4 pt-6 pb-8">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <Package className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-white font-bold text-lg">Ordefy</h1>
                <p className="text-emerald-100 text-xs">Sistema de Entregas</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-emerald-100 text-xs">Transportista</p>
              <p className="text-white font-semibold text-sm">{orderData.carrier_name || 'No asignado'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content - Floating Cards */}
      <div className="max-w-lg mx-auto px-4 -mt-4 pb-8 space-y-4">

        {/* Customer Card */}
        <div className="bg-slate-800/90 backdrop-blur-sm rounded-2xl border border-slate-700/50 overflow-hidden shadow-xl">
          <div className="p-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/25">
                <User className="h-6 w-6 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-white font-bold text-lg truncate">{orderData.customer_name}</h2>
                {orderData.customer_phone && (
                  <a
                    href={`tel:${orderData.customer_phone}`}
                    className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 bg-blue-500/20 hover:bg-blue-500/30 rounded-lg transition-colors"
                  >
                    <Phone className="h-4 w-4 text-blue-400" />
                    <span className="text-blue-400 font-medium text-sm">{orderData.customer_phone}</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Address & Navigation Card */}
        {orderData.customer_address && (
          <div className="bg-slate-800/90 backdrop-blur-sm rounded-2xl border border-slate-700/50 overflow-hidden shadow-xl">
            <div className="p-5">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-rose-500/25">
                  <MapPin className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-white font-semibold mb-1">Dirección de Entrega</h3>
                  <p className="text-slate-300 text-sm">{orderData.customer_address}</p>
                  {orderData.neighborhood && (
                    <p className="text-slate-400 text-xs mt-1">{orderData.neighborhood}</p>
                  )}
                  {orderData.address_reference && (
                    <p className="text-amber-400 text-xs mt-2 font-medium">
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
                  className="w-full h-14 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-blue-500/25 text-base"
                >
                  <Navigation className="mr-3 h-5 w-5" />
                  Iniciar Navegación
                  <ArrowRight className="ml-auto h-5 w-5" />
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Products Card */}
        <div className="bg-slate-800/90 backdrop-blur-sm rounded-2xl border border-slate-700/50 overflow-hidden shadow-xl">
          <div className="p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center shadow-lg shadow-purple-500/25">
                <ShoppingBag className="h-5 w-5 text-white" />
              </div>
              <h3 className="text-white font-semibold">Productos</h3>
            </div>

            {orderData.line_items && orderData.line_items.length > 0 ? (
              <div className="space-y-3">
                {orderData.line_items.map((item: any, index: number) => (
                  <div
                    key={index}
                    className="flex justify-between items-center py-3 border-b border-slate-700/50 last:border-0"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-medium truncate">{item.title || item.product_name}</p>
                      <p className="text-slate-400 text-sm">Cantidad: {item.quantity}</p>
                    </div>
                    <p className="text-white font-semibold ml-4">
                      ₲{((item.price || 0) * (item.quantity || 1)).toLocaleString()}
                    </p>
                  </div>
                ))}
                <div className="flex justify-between items-center pt-3 mt-3 border-t border-slate-600">
                  <span className="text-slate-300 font-semibold">Total</span>
                  <span className="text-2xl font-bold text-white">₲{orderData.total_price?.toLocaleString()}</span>
                </div>
              </div>
            ) : (
              <p className="text-slate-400 text-sm">No hay productos para mostrar</p>
            )}
          </div>
        </div>

        {/* COD Alert Card */}
        {orderData.cod_amount > 0 && (
          <div className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 rounded-2xl border border-amber-500/30 overflow-hidden">
            <div className="p-5">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/30">
                  <Banknote className="h-7 w-7 text-white" />
                </div>
                <div className="flex-1">
                  <p className="text-amber-300 font-semibold text-sm uppercase tracking-wide">Cobro en Efectivo</p>
                  <p className="text-3xl font-bold text-white mt-1">₲{orderData.cod_amount?.toLocaleString()}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Incident Retry Checklist */}
        {state.hasIncident && state.incident && (
          <div className="bg-slate-800/90 backdrop-blur-sm rounded-2xl border border-amber-500/50 overflow-hidden shadow-xl">
            <div className="p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                  <AlertCircle className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-semibold">Incidencia de Entrega</h3>
                  <p className="text-slate-400 text-xs">Completa uno de los intentos programados</p>
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
            </div>
          </div>
        )}

        {/* Actions Card - Only if no incident */}
        {!state.hasIncident && (
          <div className="bg-slate-800/90 backdrop-blur-sm rounded-2xl border border-slate-700/50 overflow-hidden shadow-xl">
            <div className="p-5 space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/25">
                  <CheckCircle className="h-5 w-5 text-white" />
                </div>
                <h3 className="text-white font-semibold">Confirmar Entrega</h3>
              </div>

              {/* Payment Method Selection - Premium Buttons */}
              <div className="space-y-3">
                <Label className="text-slate-300 text-sm font-medium">Método de pago del cliente</Label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: 'efectivo', label: 'Efectivo', icon: Banknote, color: 'emerald' },
                    { value: 'tarjeta', label: 'Tarjeta', icon: CreditCard, color: 'blue' },
                    { value: 'qr', label: 'QR', icon: Smartphone, color: 'purple' },
                    { value: 'transferencia', label: 'Transfer.', icon: ArrowRight, color: 'indigo' },
                  ].map((method) => {
                    const Icon = method.icon;
                    const isSelected = paymentMethod === method.value;
                    const colorClasses = {
                      emerald: isSelected ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'border-slate-600 text-slate-400 hover:border-slate-500',
                      blue: isSelected ? 'bg-blue-500/20 border-blue-500 text-blue-400' : 'border-slate-600 text-slate-400 hover:border-slate-500',
                      purple: isSelected ? 'bg-purple-500/20 border-purple-500 text-purple-400' : 'border-slate-600 text-slate-400 hover:border-slate-500',
                      indigo: isSelected ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400' : 'border-slate-600 text-slate-400 hover:border-slate-500',
                    };

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
                        className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200 ${colorClasses[method.color as keyof typeof colorClasses]}`}
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
                <div className="bg-slate-900/50 rounded-xl p-4 space-y-3">
                  <div className="flex items-center space-x-3">
                    <Checkbox
                      id="different-amount"
                      checked={differentAmountCollected}
                      onCheckedChange={(checked) => {
                        setDifferentAmountCollected(checked === true);
                        if (!checked) setAmountCollected('');
                      }}
                      className="border-amber-500 data-[state=checked]:bg-amber-500 data-[state=checked]:border-amber-500"
                    />
                    <Label
                      htmlFor="different-amount"
                      className="text-sm font-medium cursor-pointer flex items-center gap-2 text-slate-300"
                    >
                      <DollarSign className="h-4 w-4 text-amber-500" />
                      Cobré un monto diferente
                    </Label>
                  </div>

                  {differentAmountCollected && (
                    <div className="space-y-2 pl-7 animate-in slide-in-from-top-2 duration-200">
                      <Label htmlFor="amount-collected" className="text-sm font-medium text-slate-400">
                        Monto cobrado (₲)
                      </Label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-500 font-semibold">₲</span>
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
                          className="pl-10 h-12 bg-slate-800 border-slate-600 text-white text-lg font-semibold rounded-xl focus:border-amber-500 focus:ring-amber-500/20"
                        />
                      </div>
                      <p className="text-xs text-amber-500">
                        Monto esperado: ₲{(orderData.cod_amount || orderData.total_price || 0)?.toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Prepaid Info Message */}
              {paymentMethod && paymentMethod !== 'efectivo' && (
                <div className="bg-blue-500/10 rounded-xl p-4 border border-blue-500/30">
                  <p className="text-sm text-blue-400 flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    <span className="font-medium">Pago prepago - No debes cobrar nada al cliente</span>
                  </p>
                </div>
              )}

              {/* Confirm Button */}
              <Button
                onClick={handleConfirmDelivery}
                disabled={submitting || !paymentMethod}
                className="w-full h-14 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-bold rounded-xl shadow-lg shadow-emerald-500/25 text-base disabled:opacity-50 disabled:shadow-none transition-all duration-200"
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
                  className="w-full text-center text-slate-500 hover:text-slate-400 text-sm font-medium transition-colors"
                >
                  {showFailureSection ? '▲ Ocultar opciones de falla' : '▼ ¿No pudiste entregar?'}
                </button>
              </div>

              {/* Failure Section - Collapsible */}
              {showFailureSection && (
                <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/30 space-y-4 animate-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center gap-2 text-red-400">
                    <XCircle className="h-5 w-5" />
                    <span className="font-semibold">Reportar problema</span>
                  </div>

                  <Select value={failureReason} onValueChange={setFailureReason}>
                    <SelectTrigger className="bg-slate-900/50 border-slate-600 text-white h-12 rounded-xl">
                      <SelectValue placeholder="Selecciona un motivo" />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
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
                    className="resize-none bg-slate-900/50 border-slate-600 text-white placeholder:text-slate-500 rounded-xl"
                  />

                  <Button
                    variant="destructive"
                    onClick={handleReportFailure}
                    disabled={submitting || !failureReason}
                    className="w-full h-12 bg-red-500 hover:bg-red-600 font-semibold rounded-xl"
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
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center py-4">
          <p className="text-slate-600 text-xs">
            Powered by <span className="text-emerald-500 font-semibold">Ordefy</span>
          </p>
        </div>
      </div>
    </div>
  );
}
