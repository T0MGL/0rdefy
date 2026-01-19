import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { TableSkeleton } from '@/components/skeletons/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { FirstTimeWelcomeBanner } from '@/components/FirstTimeTooltip';
import { logger } from '@/utils/logger';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Calendar,
  Phone,
  MapPin,
  Package,
  User,
  Clock,
  FileText,
  RotateCcw,
  X
} from 'lucide-react';
import apiClient from '@/services/api.client';

interface RetryAttempt {
  id: string;
  retry_number: number;
  scheduled_date: string;
  status: string;
  courier_notes?: string;
  failure_reason?: string;
  attempted_at?: string;
  created_at: string;
}

interface Incident {
  incident_id: string;
  order_id: string;
  store_id: string;
  incident_status: string;
  current_retry_count: number;
  max_retry_attempts: number;
  incident_created_at: string;
  shopify_order_number: string;
  customer_first_name: string;
  customer_last_name: string;
  customer_phone: string;
  customer_address: string;
  total_price: number;
  delivery_failure_reason: string;
  courier_notes: string;
  sleeves_status: string;
  carrier_name: string;
  carrier_phone: string;
  initial_failure_reason: string;
  initial_failure_notes: string;
  initial_attempt_date: string;
  retry_attempts: RetryAttempt[];
}

const statusColors = {
  active: 'bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400 border-orange-300 dark:border-orange-800',
  resolved: 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 border-green-300 dark:border-green-800',
  expired: 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border-red-300 dark:border-red-800',
};

const statusLabels = {
  active: 'Activa',
  resolved: 'Resuelta',
  expired: 'Expirada',
};

const retryStatusColors = {
  scheduled: 'bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400',
  in_progress: 'bg-yellow-50 dark:bg-yellow-950/20 text-yellow-700 dark:text-yellow-400',
  delivered: 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400',
  failed: 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400',
  cancelled: 'bg-gray-50 dark:bg-gray-950/20 text-gray-700 dark:text-gray-400',
};

const retryStatusLabels = {
  scheduled: 'Programado',
  in_progress: 'En Proceso',
  delivered: 'Entregado',
  failed: 'Fallido',
  cancelled: 'Cancelado',
};

export default function Incidents() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduleNotes, setScheduleNotes] = useState('');
  const [resolutionType, setResolutionType] = useState('cancelled');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('efectivo');
  const [statusFilter, setStatusFilter] = useState('active');
  const { toast } = useToast();

  useEffect(() => {
    loadIncidents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const loadIncidents = async () => {
    setIsLoading(true);
    try {
      const response = await apiClient.get('/incidents', {
        params: { status: statusFilter }
      });
      setIncidents(response.data.data || []);
    } catch (error: any) {
      logger.error('Error loading incidents:', error);
      toast({
        variant: 'destructive',
        title: 'Error al cargar incidencias',
        description: error.response?.data?.error || 'No se pudieron cargar las incidencias'
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleScheduleRetry = async () => {
    if (!selectedIncident || !scheduledDate) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Fecha programada es requerida'
      });
      return;
    }

    try {
      await apiClient.post(`/incidents/${selectedIncident.incident_id}/schedule-retry`, {
        scheduled_date: scheduledDate,
        notes: scheduleNotes
      });

      toast({
        title: 'Reintento programado',
        description: 'Se programó exitosamente un nuevo intento de entrega'
      });

      setScheduleDialogOpen(false);
      setScheduledDate('');
      setScheduleNotes('');
      loadIncidents();
    } catch (error: any) {
      logger.error('Error scheduling retry:', error);
      toast({
        variant: 'destructive',
        title: 'Error al programar reintento',
        description: error.response?.data?.message || error.response?.data?.error || 'No se pudo programar el reintento'
      });
    }
  };

  const handleResolveIncident = async () => {
    if (!selectedIncident) return;

    // Validate payment_method if resolution_type is 'delivered'
    if (resolutionType === 'delivered' && !paymentMethod) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Debe seleccionar un método de pago al marcar como entregado'
      });
      return;
    }

    try {
      const payload: any = {
        resolution_type: resolutionType,
        notes: resolutionNotes
      };

      if (resolutionType === 'delivered') {
        payload.payment_method = paymentMethod;
      }

      await apiClient.post(`/incidents/${selectedIncident.incident_id}/resolve`, payload);

      toast({
        title: 'Incidencia resuelta',
        description: resolutionType === 'delivered'
          ? 'La incidencia se resolvió y el pedido se marcó como entregado'
          : 'La incidencia se resolvió correctamente'
      });

      setResolveDialogOpen(false);
      setResolutionNotes('');
      setPaymentMethod('efectivo');
      loadIncidents();
    } catch (error: any) {
      logger.error('Error resolving incident:', error);
      toast({
        variant: 'destructive',
        title: 'Error al resolver incidencia',
        description: error.response?.data?.message || error.response?.data?.error || 'No se pudo resolver la incidencia'
      });
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };

  const formatDateTime = (dateString: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-6">
      <FirstTimeWelcomeBanner
        moduleId="incidents"
        title="¡Bienvenido a Incidencias!"
        description="Gestiona pedidos con problemas de entrega. Programa reintentos y resuelve incidencias para recuperar ventas."
        tips={['Ve pedidos con fallos', 'Programa reintentos', 'Resuelve o cancela']}
      />

      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight dark:text-white">Incidencias</h1>
          <p className="text-muted-foreground">
            Gestiona pedidos con problemas de entrega
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Activas</SelectItem>
              <SelectItem value="resolved">Resueltas</SelectItem>
              <SelectItem value="expired">Expiradas</SelectItem>
            </SelectContent>
          </Select>

          <Button onClick={loadIncidents} variant="outline" size="icon">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Incidents Table */}
      <Card className="p-6">
        {isLoading ? (
          <TableSkeleton />
        ) : incidents.length === 0 ? (
          <EmptyState
            icon={AlertCircle}
            title="No hay incidencias"
            description="No se encontraron incidencias con los filtros seleccionados"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b dark:border-gray-800">
                  <th className="px-4 py-3 text-left text-sm font-semibold dark:text-white">
                    Pedido
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold dark:text-white">
                    Cliente
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold dark:text-white">
                    Estado
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold dark:text-white">
                    Reintentos
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold dark:text-white">
                    Motivo Inicial
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-semibold dark:text-white">
                    Fecha Creación
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-semibold dark:text-white">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((incident) => (
                  <tr
                    key={incident.incident_id}
                    className="border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors cursor-pointer"
                    onClick={() => {
                      setSelectedIncident(incident);
                      setDetailsDialogOpen(true);
                    }}
                  >
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium dark:text-white">
                          {incident.shopify_order_number || `#${incident.order_id.slice(0, 8)}`}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          ${incident.total_price?.toFixed(2)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium dark:text-white">
                          {incident.customer_first_name} {incident.customer_last_name}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {incident.customer_phone}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={statusColors[incident.incident_status]}>
                        {statusLabels[incident.incident_status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <RotateCcw className="h-4 w-4 text-muted-foreground" />
                        <span className="dark:text-white">
                          {incident.current_retry_count}/{incident.max_retry_attempts}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm dark:text-gray-300">
                        {incident.delivery_failure_reason || incident.initial_failure_reason || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm dark:text-gray-300">
                        {formatDateTime(incident.incident_created_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {incident.incident_status === 'active' &&
                         incident.current_retry_count < incident.max_retry_attempts && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedIncident(incident);
                              setScheduleDialogOpen(true);
                            }}
                          >
                            <Calendar className="h-4 w-4 mr-1" />
                            Programar
                          </Button>
                        )}
                        {incident.incident_status === 'active' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedIncident(incident);
                              setResolveDialogOpen(true);
                            }}
                          >
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                            Resolver
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Details Dialog */}
      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalles de Incidencia</DialogTitle>
          </DialogHeader>

          {selectedIncident && (
            <div className="space-y-6">
              {/* Order Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-semibold text-muted-foreground">
                    Pedido
                  </label>
                  <p className="text-lg font-medium dark:text-white">
                    {selectedIncident.shopify_order_number || `#${selectedIncident.order_id.slice(0, 8)}`}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-semibold text-muted-foreground">
                    Total
                  </label>
                  <p className="text-lg font-medium dark:text-white">
                    ${selectedIncident.total_price?.toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Customer Info */}
              <div className="border-t dark:border-gray-800 pt-4">
                <h3 className="text-lg font-semibold mb-3 dark:text-white flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Cliente
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-muted-foreground">Nombre</label>
                    <p className="dark:text-white">
                      {selectedIncident.customer_first_name} {selectedIncident.customer_last_name}
                    </p>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">Teléfono</label>
                    <p className="dark:text-white flex items-center gap-1">
                      <Phone className="h-4 w-4" />
                      {selectedIncident.customer_phone}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <label className="text-sm text-muted-foreground">Dirección</label>
                    <p className="dark:text-white flex items-center gap-1">
                      <MapPin className="h-4 w-4" />
                      {selectedIncident.customer_address}
                    </p>
                  </div>
                </div>
              </div>

              {/* Initial Failure Info */}
              <div className="border-t dark:border-gray-800 pt-4">
                <h3 className="text-lg font-semibold mb-3 dark:text-white flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-red-500" />
                  Falla Inicial
                </h3>
                <div className="space-y-2">
                  <div>
                    <label className="text-sm text-muted-foreground">Motivo</label>
                    <p className="dark:text-white">
                      {selectedIncident.delivery_failure_reason || selectedIncident.initial_failure_reason}
                    </p>
                  </div>
                  {(selectedIncident.courier_notes || selectedIncident.initial_failure_notes) && (
                    <div>
                      <label className="text-sm text-muted-foreground">Notas del Transportista</label>
                      <p className="dark:text-white">
                        {selectedIncident.courier_notes || selectedIncident.initial_failure_notes}
                      </p>
                    </div>
                  )}
                  {selectedIncident.carrier_name && (
                    <div>
                      <label className="text-sm text-muted-foreground">Transportista</label>
                      <p className="dark:text-white">
                        {selectedIncident.carrier_name}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Retry Attempts */}
              <div className="border-t dark:border-gray-800 pt-4">
                <h3 className="text-lg font-semibold mb-3 dark:text-white flex items-center gap-2">
                  <RotateCcw className="h-5 w-5" />
                  Intentos de Reentrega ({selectedIncident.current_retry_count}/{selectedIncident.max_retry_attempts})
                </h3>

                {selectedIncident.retry_attempts && selectedIncident.retry_attempts.length > 0 ? (
                  <div className="space-y-3">
                    {selectedIncident.retry_attempts.map((retry) => (
                      <div
                        key={retry.id}
                        className={`p-4 rounded-lg border ${
                          retryStatusColors[retry.status]
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-semibold">
                            Intento #{retry.retry_number}
                          </span>
                          <Badge variant="outline">
                            {retryStatusLabels[retry.status]}
                          </Badge>
                        </div>
                        <div className="space-y-1 text-sm">
                          {retry.scheduled_date && (
                            <p>
                              <Clock className="h-4 w-4 inline mr-1" />
                              Programado: {formatDate(retry.scheduled_date)}
                            </p>
                          )}
                          {retry.attempted_at && (
                            <p>
                              <Clock className="h-4 w-4 inline mr-1" />
                              Intentado: {formatDateTime(retry.attempted_at)}
                            </p>
                          )}
                          {retry.courier_notes && (
                            <p>
                              <FileText className="h-4 w-4 inline mr-1" />
                              Notas: {retry.courier_notes}
                            </p>
                          )}
                          {retry.failure_reason && (
                            <p className="text-red-600 dark:text-red-400">
                              <XCircle className="h-4 w-4 inline mr-1" />
                              Motivo: {retry.failure_reason}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No hay reintentos programados
                  </p>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Schedule Retry Dialog */}
      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Programar Reintento de Entrega</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">
                Fecha Programada *
              </label>
              <Input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1 block">
                Notas (opcional)
              </label>
              <Textarea
                value={scheduleNotes}
                onChange={(e) => setScheduleNotes(e.target.value)}
                placeholder="Instrucciones especiales para el transportista..."
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setScheduleDialogOpen(false);
                  setScheduledDate('');
                  setScheduleNotes('');
                }}
              >
                Cancelar
              </Button>
              <Button onClick={handleScheduleRetry} disabled={!scheduledDate}>
                <Calendar className="h-4 w-4 mr-2" />
                Programar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Resolve Incident Dialog */}
      <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolver Incidencia</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">
                Tipo de Resolución *
              </label>
              <Select value={resolutionType} onValueChange={setResolutionType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="delivered">Entregado ✅</SelectItem>
                  <SelectItem value="cancelled">Cancelado</SelectItem>
                  <SelectItem value="customer_rejected">Cliente Rechazó</SelectItem>
                  <SelectItem value="other">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {resolutionType === 'delivered' && (
              <div>
                <label className="text-sm font-medium mb-1 block">
                  Método de Pago *
                </label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger>
                    <SelectValue />
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
            )}

            <div>
              <label className="text-sm font-medium mb-1 block">
                Notas {resolutionType === 'delivered' ? '(opcional)' : ''}
              </label>
              <Textarea
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                placeholder="Explicación de la resolución..."
                rows={3}
              />
            </div>

            <div className="flex justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setResolveDialogOpen(false);
                  setResolutionNotes('');
                  setPaymentMethod('efectivo');
                }}
              >
                Cancelar
              </Button>
              <Button onClick={handleResolveIncident}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {resolutionType === 'delivered' ? 'Marcar como Entregado' : 'Resolver'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
