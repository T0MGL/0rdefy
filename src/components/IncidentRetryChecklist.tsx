import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  RotateCcw,
  FileText,
  Upload,
} from 'lucide-react';

interface RetryAttempt {
  id?: string;
  retry_number: number;
  scheduled_date?: string;
  status: string;
  courier_notes?: string;
  failure_reason?: string;
  attempted_at?: string;
}

interface IncidentRetryChecklistProps {
  incidentId: string;
  orderId: string;
  currentRetryCount: number;
  maxRetries: number;
  retryAttempts: RetryAttempt[];
  onSuccess: () => void;
}

const retryStatusColors = {
  scheduled: 'bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400',
  in_progress: 'bg-yellow-50 dark:bg-yellow-950/20 text-yellow-700 dark:text-yellow-400',
  delivered: 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400',
  failed: 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400',
};

const retryStatusLabels = {
  scheduled: 'Programado',
  in_progress: 'En Proceso',
  delivered: 'Entregado',
  failed: 'Fallido',
};

export function IncidentRetryChecklist({
  incidentId,
  orderId,
  currentRetryCount,
  maxRetries,
  retryAttempts,
  onSuccess,
}: IncidentRetryChecklistProps) {
  const { toast } = useToast();
  const [expandedRetry, setExpandedRetry] = useState<number | null>(null);
  const [selectedRetryId, setSelectedRetryId] = useState<string | null>(null);
  const [deliveryStatus, setDeliveryStatus] = useState<'delivered' | 'failed'>('delivered');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [courierNotes, setCourierNotes] = useState('');
  const [failureReason, setFailureReason] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleCompleteRetry = async (retryId: string) => {
    if (!deliveryStatus) {
      toast({
        variant: 'destructive',
        title: 'Estado requerido',
        description: 'Debes seleccionar si la entrega fue exitosa o falló',
      });
      return;
    }

    if (deliveryStatus === 'delivered' && !paymentMethod) {
      toast({
        variant: 'destructive',
        title: 'Método de pago requerido',
        description: 'Debes seleccionar el método de pago',
      });
      return;
    }

    if (deliveryStatus === 'failed' && !failureReason) {
      toast({
        variant: 'destructive',
        title: 'Motivo requerido',
        description: 'Debes indicar el motivo de la falla',
      });
      return;
    }

    try {
      setSubmitting(true);
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';

      let uploadedPhotoUrl = '';

      // Subir foto si existe
      if (photoFile) {
        const formData = new FormData();
        formData.append('file', photoFile);
        formData.append('order_id', orderId);

        const uploadResponse = await fetch(`${apiUrl}/api/delivery-attempts/upload-photo`, {
          method: 'POST',
          body: formData,
        });

        if (uploadResponse.ok) {
          const uploadResult = await uploadResponse.json();
          uploadedPhotoUrl = uploadResult.url;
        }
      }

      // Completar el reintento
      const payload: any = {
        status: deliveryStatus,
        courier_notes: courierNotes || null,
      };

      if (deliveryStatus === 'delivered') {
        payload.payment_method = paymentMethod;
      } else {
        payload.failure_reason = failureReason;
      }

      if (uploadedPhotoUrl) {
        payload.proof_photo_url = uploadedPhotoUrl;
      }

      const response = await fetch(`${apiUrl}/api/incidents/retry/${retryId}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Error al completar el intento');
      }

      toast({
        title: deliveryStatus === 'delivered' ? '¡Entrega confirmada!' : 'Falla reportada',
        description: deliveryStatus === 'delivered'
          ? 'El pedido ha sido entregado exitosamente'
          : 'La falla ha sido registrada',
      });

      // Reset form
      setExpandedRetry(null);
      setSelectedRetryId(null);
      setDeliveryStatus('delivered');
      setPaymentMethod('');
      setCourierNotes('');
      setFailureReason('');
      setPhotoFile(null);

      // Notify parent
      onSuccess();
    } catch (error: any) {
      logger.error('Error completing retry:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo completar el intento',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Generate checklist slots (always show 3 slots)
  const checklistSlots = [];
  for (let i = 1; i <= maxRetries; i++) {
    const existingAttempt = retryAttempts.find((a) => a.retry_number === i);
    checklistSlots.push({
      number: i,
      attempt: existingAttempt,
      canComplete: !existingAttempt || existingAttempt.status === 'scheduled',
    });
  }

  return (
    <div className="space-y-4">
      <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-300 dark:border-orange-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-orange-900 dark:text-orange-100">
              Pedido con Incidencia
            </h3>
            <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
              Este pedido tiene problemas de entrega. Selecciona uno de los intentos programados
              para marcar el resultado.
            </p>
            <div className="flex items-center gap-2 mt-2">
              <RotateCcw className="h-4 w-4" />
              <span className="text-sm font-medium">
                Intentos: {currentRetryCount}/{maxRetries}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Retry Checklist */}
      <div className="space-y-3">
        {checklistSlots.map((slot) => (
          <Card
            key={slot.number}
            className={
              slot.attempt?.status
                ? retryStatusColors[slot.attempt.status]
                : 'border-dashed'
            }
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  Intento #{slot.number}
                </CardTitle>
                {slot.attempt && (
                  <Badge variant="outline">
                    {retryStatusLabels[slot.attempt.status] || slot.attempt.status}
                  </Badge>
                )}
              </div>
              {slot.attempt?.scheduled_date && (
                <CardDescription className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Programado: {new Date(slot.attempt.scheduled_date).toLocaleDateString('es-ES')}
                </CardDescription>
              )}
            </CardHeader>

            {slot.attempt && (
              <CardContent className="space-y-3">
                {/* Show existing attempt details */}
                {slot.attempt.attempted_at && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Fecha: </span>
                    {new Date(slot.attempt.attempted_at).toLocaleString('es-ES')}
                  </div>
                )}

                {slot.attempt.courier_notes && (
                  <div className="text-sm">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <FileText className="h-3 w-3" />
                      Notas:
                    </span>
                    <p className="mt-1">{slot.attempt.courier_notes}</p>
                  </div>
                )}

                {slot.attempt.failure_reason && (
                  <div className="text-sm text-red-600 dark:text-red-400">
                    <span className="font-medium flex items-center gap-1">
                      <XCircle className="h-3 w-3" />
                      Motivo de falla:
                    </span>
                    <p className="mt-1">{slot.attempt.failure_reason}</p>
                  </div>
                )}

                {/* Show completion form if this retry is selected and can be completed */}
                {slot.canComplete && slot.attempt && expandedRetry === slot.number && (
                  <div className="border-t pt-4 mt-4 space-y-4">
                    <div>
                      <Label>Estado de Entrega *</Label>
                      <Select value={deliveryStatus} onValueChange={(v: any) => setDeliveryStatus(v)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="delivered">Entregado</SelectItem>
                          <SelectItem value="failed">Fallido</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {deliveryStatus === 'delivered' ? (
                      <div>
                        <Label>Método de Pago *</Label>
                        <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecciona método" />
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
                    ) : (
                      <div>
                        <Label>Motivo de Falla *</Label>
                        <Select value={failureReason} onValueChange={setFailureReason}>
                          <SelectTrigger>
                            <SelectValue placeholder="Selecciona motivo" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cliente_ausente">Cliente Ausente</SelectItem>
                            <SelectItem value="direccion_incorrecta">Dirección Incorrecta</SelectItem>
                            <SelectItem value="telefono_no_contesta">Teléfono No Contesta</SelectItem>
                            <SelectItem value="zona_peligrosa">Zona Peligrosa</SelectItem>
                            <SelectItem value="otro">Otro</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    <div>
                      <Label>Notas Adicionales</Label>
                      <Textarea
                        value={courierNotes}
                        onChange={(e) => setCourierNotes(e.target.value)}
                        placeholder="Detalles adicionales..."
                        rows={2}
                      />
                    </div>

                    <div>
                      <Label>Foto de Comprobante (opcional)</Label>
                      <div className="mt-2">
                        <label
                          htmlFor="photo-upload"
                          className="flex items-center gap-2 px-4 py-2 border rounded-md cursor-pointer hover:bg-accent"
                        >
                          <Upload className="h-4 w-4" />
                          {photoFile ? photoFile.name : 'Seleccionar foto'}
                        </label>
                        <input
                          id="photo-upload"
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) setPhotoFile(file);
                          }}
                        />
                      </div>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setExpandedRetry(null);
                          setSelectedRetryId(null);
                        }}
                        className="flex-1"
                      >
                        Cancelar
                      </Button>
                      <Button
                        onClick={() => handleCompleteRetry(slot.attempt!.id!)}
                        disabled={submitting}
                        className="flex-1"
                      >
                        {submitting ? 'Guardando...' : 'Confirmar'}
                      </Button>
                    </div>
                  </div>
                )}

                {/* Button to start completing this retry */}
                {slot.canComplete && slot.attempt && expandedRetry !== slot.number && (
                  <Button
                    onClick={() => {
                      setExpandedRetry(slot.number);
                      setSelectedRetryId(slot.attempt!.id!);
                    }}
                    className="w-full"
                    size="sm"
                  >
                    Completar Intento
                  </Button>
                )}
              </CardContent>
            )}

            {/* Empty slot */}
            {!slot.attempt && (
              <CardContent>
                <p className="text-sm text-muted-foreground text-center py-2">
                  Reintento no programado
                </p>
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
