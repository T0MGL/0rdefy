// ================================================================
// DELIVERY ATTEMPTS PANEL COMPONENT
// ================================================================
// Shows delivery attempt history with timeline visualization
// ================================================================

import { useEffect, useState } from 'react';
import { DeliveryAttempt } from '@/types';
import { deliveryAttemptsService } from '@/services/delivery-attempts.service';
import { useAuth } from '@/contexts/AuthContext';
import { formatLocalDate } from '@/utils/timeUtils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Loader2, MapPin, Clock, CheckCircle2, XCircle, Package } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface DeliveryAttemptsPanelProps {
  orderId: string;
  orderNumber?: string;
}

export function DeliveryAttemptsPanel({ orderId, orderNumber }: DeliveryAttemptsPanelProps) {
  const { currentStore } = useAuth();
  const storeTimezone = currentStore?.timezone || 'America/Asuncion';
  const [attempts, setAttempts] = useState<DeliveryAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewAttemptDialog, setShowNewAttemptDialog] = useState(false);
  const [showMarkDialog, setShowMarkDialog] = useState(false);
  const [selectedAttempt, setSelectedAttempt] = useState<DeliveryAttempt | null>(null);
  const [markAction, setMarkAction] = useState<'delivered' | 'failed'>('delivered');
  const [formData, setFormData] = useState({
    scheduled_date: formatLocalDate(new Date(), storeTimezone),
    notes: '',
    photo_url: '',
    failed_reason: '',
  });
  const { toast } = useToast();

  const fetchAttempts = async () => {
    try {
      setLoading(true);
      const response = await deliveryAttemptsService.getAll({ order_id: orderId });
      setAttempts(response.data);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudieron cargar los intentos de entrega',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAttempts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const handleCreateAttempt = async () => {
    try {
      await deliveryAttemptsService.create({
        order_id: orderId,
        scheduled_date: formData.scheduled_date,
        notes: formData.notes || undefined,
      });

      toast({
        title: 'Intento programado',
        description: 'El intento de entrega ha sido programado exitosamente',
      });

      setShowNewAttemptDialog(false);
      setFormData({
        scheduled_date: formatLocalDate(new Date(), storeTimezone),
        notes: '',
        photo_url: '',
        failed_reason: '',
      });
      fetchAttempts();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo programar el intento',
      });
    }
  };

  const handleMarkAttempt = async () => {
    if (!selectedAttempt) return;

    try {
      if (markAction === 'delivered') {
        await deliveryAttemptsService.markDelivered(selectedAttempt.id, {
          photo_url: formData.photo_url || undefined,
          notes: formData.notes || undefined,
        });
        toast({
          title: 'Entrega confirmada',
          description: 'El pedido ha sido marcado como entregado',
        });
      } else {
        await deliveryAttemptsService.markFailed(selectedAttempt.id, {
          failed_reason: formData.failed_reason,
          notes: formData.notes || undefined,
        });
        toast({
          title: 'Entrega fallida',
          description: 'El intento ha sido marcado como fallido',
        });
      }

      setShowMarkDialog(false);
      setSelectedAttempt(null);
      setFormData({
        scheduled_date: formatLocalDate(new Date(), storeTimezone),
        notes: '',
        photo_url: '',
        failed_reason: '',
      });
      fetchAttempts();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo actualizar el intento',
      });
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      scheduled: { label: 'Programado', variant: 'outline' },
      in_progress: { label: 'En camino', variant: 'default' },
      delivered: { label: 'Entregado', variant: 'default' },
      failed: { label: 'Fallido', variant: 'destructive' },
      cancelled: { label: 'Cancelado', variant: 'secondary' },
    };

    const config = statusConfig[status] || { label: status, variant: 'outline' };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'scheduled':
        return <Clock className="h-5 w-5 text-blue-500" />;
      case 'in_progress':
        return <Package className="h-5 w-5 text-yellow-500" />;
      case 'delivered':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <MapPin className="h-5 w-5 text-gray-500" />;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Intentos de Entrega</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Intentos de Entrega</CardTitle>
              <CardDescription>
                {orderNumber ? `Pedido #${orderNumber}` : 'Historial de entregas'}
              </CardDescription>
            </div>
            <Button onClick={() => setShowNewAttemptDialog(true)}>
              Programar Entrega
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {attempts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No hay intentos de entrega registrados</p>
              <p className="text-sm">Programa la primera entrega para comenzar</p>
            </div>
          ) : (
            <div className="space-y-4">
              {attempts.map((attempt, index) => (
                <div
                  key={attempt.id}
                  className="flex gap-4 pb-4 border-b last:border-0 dark:border-gray-800"
                >
                  <div className="flex flex-col items-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 bg-background dark:bg-gray-900">
                      {getStatusIcon(attempt.status)}
                    </div>
                    {index < attempts.length - 1 && (
                      <div className="w-px h-full bg-border dark:bg-gray-800 my-2" />
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">Intento #{attempt.attempt_number}</span>
                        {getStatusBadge(attempt.status)}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {format(new Date(attempt.scheduled_date), 'dd MMM yyyy', { locale: es })}
                      </span>
                    </div>
                    {attempt.notes && (
                      <p className="text-sm text-muted-foreground">{attempt.notes}</p>
                    )}
                    {attempt.failed_reason && (
                      <p className="text-sm text-red-600 dark:text-red-400">
                        Razón: {attempt.failed_reason}
                      </p>
                    )}
                    {attempt.photo_url && (
                      <a
                        href={attempt.photo_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Ver foto de entrega
                      </a>
                    )}
                    {attempt.status === 'scheduled' && (
                      <div className="flex gap-2 pt-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            setSelectedAttempt(attempt);
                            setMarkAction('delivered');
                            setShowMarkDialog(true);
                          }}
                        >
                          Marcar Entregado
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            setSelectedAttempt(attempt);
                            setMarkAction('failed');
                            setShowMarkDialog(true);
                          }}
                        >
                          Marcar Fallido
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* New Attempt Dialog */}
      <Dialog open={showNewAttemptDialog} onOpenChange={setShowNewAttemptDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Programar Intento de Entrega</DialogTitle>
            <DialogDescription>
              Programa un nuevo intento de entrega para este pedido
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="scheduled_date">Fecha programada</Label>
              <Input
                id="scheduled_date"
                type="date"
                value={formData.scheduled_date}
                onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notas (opcional)</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Instrucciones especiales para la entrega..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewAttemptDialog(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreateAttempt}>Programar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark Attempt Dialog */}
      <Dialog open={showMarkDialog} onOpenChange={setShowMarkDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {markAction === 'delivered' ? 'Confirmar Entrega' : 'Marcar como Fallido'}
            </DialogTitle>
            <DialogDescription>
              {markAction === 'delivered'
                ? 'Confirma que el pedido fue entregado exitosamente'
                : 'Indica la razón por la cual falló la entrega'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {markAction === 'delivered' ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="photo_url">URL de foto de entrega (opcional)</Label>
                  <Input
                    id="photo_url"
                    value={formData.photo_url}
                    onChange={(e) => setFormData({ ...formData, photo_url: e.target.value })}
                    placeholder="https://..."
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="delivery_notes">Notas (opcional)</Label>
                  <Textarea
                    id="delivery_notes"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Observaciones adicionales..."
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="failed_reason">Razón del fallo *</Label>
                  <Textarea
                    id="failed_reason"
                    value={formData.failed_reason}
                    onChange={(e) => setFormData({ ...formData, failed_reason: e.target.value })}
                    placeholder="Cliente no estaba, dirección incorrecta, etc."
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="failed_notes">Notas adicionales (opcional)</Label>
                  <Textarea
                    id="failed_notes"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Detalles adicionales..."
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMarkDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleMarkAttempt}
              variant={markAction === 'delivered' ? 'default' : 'destructive'}
              disabled={markAction === 'failed' && !formData.failed_reason.trim()}
            >
              {markAction === 'delivered' ? 'Confirmar Entrega' : 'Marcar Fallido'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
