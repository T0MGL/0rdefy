/**
 * Settlements Page
 * Complete dispatch, reconciliation and settlement workflow
 * Flujo: Despacho → Conciliación → Liquidación → Pago
 *
 * @author Bright Idea
 * @date 2026-01-07
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  settlementsService,
  DispatchSession,
  DispatchSessionOrder,
  DispatchStatus,
  DeliveryResult,
  ReconciliationSummary,
  formatCurrency,
  getStatusColor,
  getDeliveryResultColor,
  translateStatus,
  translateDeliveryResult,
} from '@/services/settlements.service';
import { carriersService } from '@/services/carriers.service';
import { ordersService } from '@/services/orders.service';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Progress } from '@/components/ui/progress';
import { EmptyState } from '@/components/EmptyState';
import { TableSkeleton } from '@/components/skeletons/TableSkeleton';
import {
  Loader2,
  Truck,
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  DollarSign,
  TrendingUp,
  Package,
  ChevronLeft,
  Download,
  RefreshCw,
  Eye,
  Plus,
  Clock,
  Calendar,
  Filter,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

type View = 'sessions' | 'create' | 'detail' | 'reconcile';

interface Carrier {
  id: string;
  name: string;
}

interface Order {
  id: string;
  order_number?: string;
  customer_first_name?: string;
  customer_last_name?: string;
  customer_phone?: string;
  customer_address?: string;
  customer_city?: string;
  total_price: number;
  payment_status?: string;
  sleeves_status?: string;
}

export default function Settlements() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // View state
  const [view, setView] = useState<View>('sessions');
  const [loading, setLoading] = useState(false);

  // Sessions list
  const [sessions, setSessions] = useState<DispatchSession[]>([]);
  const [filterStatus, setFilterStatus] = useState<DispatchStatus | 'all'>('all');
  const [filterCarrier, setFilterCarrier] = useState<string>('all');

  // Create session
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [selectedCarrier, setSelectedCarrier] = useState<string>('');
  const [availableOrders, setAvailableOrders] = useState<Order[]>([]);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [sessionNotes, setSessionNotes] = useState('');

  // Session detail
  const [currentSession, setCurrentSession] = useState<DispatchSession | null>(null);
  const [sessionOrders, setSessionOrders] = useState<DispatchSessionOrder[]>([]);

  // Reconciliation
  const [reconciliationData, setReconciliationData] = useState<ReconciliationSummary | null>(null);
  const [showSettlementDialog, setShowSettlementDialog] = useState(false);

  // Summary stats
  const [summary, setSummary] = useState<any>(null);
  const [pendingByCarrier, setPendingByCarrier] = useState<any[]>([]);

  // Load sessions
  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { limit: 50 };
      if (filterStatus !== 'all') params.status = filterStatus;
      if (filterCarrier !== 'all') params.carrier_id = filterCarrier;

      const [sessionsRes, summaryRes, pendingRes] = await Promise.all([
        settlementsService.dispatch.getAll(params),
        settlementsService.v2.getSummary(),
        settlementsService.v2.getPendingByCarrier(),
      ]);

      setSessions(sessionsRes.data);
      setSummary(summaryRes);
      setPendingByCarrier(pendingRes);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudieron cargar las sesiones',
      });
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterCarrier, toast]);

  // Load carriers and ready orders for create view
  const loadCreateData = useCallback(async () => {
    setLoading(true);
    try {
      const carriersRes = await carriersService.getAll();
      setCarriers(carriersRes);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudieron cargar los datos',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Load orders for selected carrier
  const loadOrdersForCarrier = useCallback(async (carrierId: string) => {
    if (!carrierId) {
      setAvailableOrders([]);
      return;
    }

    setLoading(true);
    try {
      // Get orders that are ready_to_ship for this carrier
      const allOrders = await ordersService.getAll();
      const readyOrders = allOrders.filter(
        (o: any) =>
          o.sleeves_status === 'ready_to_ship' &&
          (o.carrier_id === carrierId || o.carriers?.id === carrierId)
      );
      setAvailableOrders(readyOrders);
    } catch (error: any) {
      console.error('Error loading orders:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load session detail
  const loadSessionDetail = useCallback(async (sessionId: string) => {
    setLoading(true);
    try {
      const data = await settlementsService.dispatch.getById(sessionId);
      setCurrentSession(data.session);
      setSessionOrders(data.orders);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo cargar la sesión',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (view === 'sessions') {
      loadSessions();
    } else if (view === 'create') {
      loadCreateData();
    }
  }, [view, loadSessions, loadCreateData]);

  useEffect(() => {
    if (selectedCarrier) {
      loadOrdersForCarrier(selectedCarrier);
    }
  }, [selectedCarrier, loadOrdersForCarrier]);

  // Create dispatch session
  const handleCreateSession = async () => {
    if (!selectedCarrier || selectedOrders.size === 0) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Selecciona un courier y al menos un pedido',
      });
      return;
    }

    setLoading(true);
    try {
      const session = await settlementsService.dispatch.create({
        carrier_id: selectedCarrier,
        dispatch_date: new Date().toISOString().split('T')[0],
        order_ids: Array.from(selectedOrders),
        notes: sessionNotes || undefined,
      });

      toast({
        title: 'Sesión creada',
        description: `Sesión ${session.session_code} creada con ${selectedOrders.size} pedidos`,
      });

      // Reset and go to detail
      setSelectedOrders(new Set());
      setSessionNotes('');
      setSelectedCarrier('');
      await loadSessionDetail(session.id);
      setView('detail');
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo crear la sesión',
      });
    } finally {
      setLoading(false);
    }
  };

  // Mark session as dispatched
  const handleMarkDispatched = async () => {
    if (!currentSession) return;

    setLoading(true);
    try {
      const updated = await settlementsService.dispatch.markDispatched(currentSession.id);
      setCurrentSession(updated);

      toast({
        title: 'Sesión despachada',
        description: 'Los pedidos han sido marcados como en tránsito',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo marcar como despachado',
      });
    } finally {
      setLoading(false);
    }
  };

  // Export CSV
  const handleExportCSV = async () => {
    if (!currentSession) return;

    try {
      await settlementsService.dispatch.downloadCSV(currentSession.id, currentSession.session_code);
      toast({
        title: 'CSV exportado',
        description: 'El archivo se ha descargado correctamente',
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo exportar el CSV',
      });
    }
  };

  // Import CSV results
  const handleImportCSV = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !currentSession) return;

    setLoading(true);
    try {
      const content = await file.text();
      const results = settlementsService.dispatch.parseCSV(content);

      if (results.length === 0) {
        throw new Error('No se encontraron resultados válidos en el CSV');
      }

      const reconciliation = await settlementsService.dispatch.importResults(
        currentSession.id,
        results
      );

      setReconciliationData(reconciliation);
      setView('reconcile');

      toast({
        title: 'CSV importado',
        description: `Se procesaron ${results.length} registros`,
      });

      // Reload session
      await loadSessionDetail(currentSession.id);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error de importación',
        description: error.message || 'No se pudo procesar el CSV',
      });
    } finally {
      setLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Process settlement
  const handleProcessSettlement = async () => {
    if (!currentSession) return;

    setLoading(true);
    try {
      const result = await settlementsService.dispatch.settle(currentSession.id);

      toast({
        title: 'Liquidación procesada',
        description: `Monto neto a cobrar: ${formatCurrency(result.summary.net_receivable)}`,
      });

      setShowSettlementDialog(false);
      setView('sessions');
      loadSessions();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo procesar la liquidación',
      });
    } finally {
      setLoading(false);
    }
  };

  // Toggle order selection
  const toggleOrderSelection = (orderId: string) => {
    const newSelected = new Set(selectedOrders);
    if (newSelected.has(orderId)) {
      newSelected.delete(orderId);
    } else {
      newSelected.add(orderId);
    }
    setSelectedOrders(newSelected);
  };

  // Toggle all orders
  const toggleAllOrders = () => {
    if (selectedOrders.size === availableOrders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(availableOrders.map((o) => o.id)));
    }
  };

  // Render sessions list
  const renderSessionsList = () => (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Despachos y Liquidaciones</h1>
          <p className="text-muted-foreground">
            Gestiona entregas, conciliaciones y pagos a couriers
          </p>
        </div>
        <Button onClick={() => setView('create')}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo Despacho
        </Button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Tasa de Entrega</CardTitle>
              <TrendingUp className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {summary.delivery_rate?.toFixed(1) || 0}%
              </div>
              <p className="text-xs text-muted-foreground">
                {summary.total_delivered || 0} de {summary.total_dispatched || 0} entregados
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">COD Cobrado</CardTitle>
              <DollarSign className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(summary.total_cod_collected || 0)}
              </div>
              <p className="text-xs text-muted-foreground">
                de {formatCurrency(summary.total_cod_expected || 0)} esperado
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Costo de Envío</CardTitle>
              <Truck className="h-4 w-4 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">
                {formatCurrency(summary.total_shipping_cost || 0)}
              </div>
              <p className="text-xs text-muted-foreground">Total tarifas de courier</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Neto a Cobrar</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">
                {formatCurrency(summary.total_net_receivable || 0)}
              </div>
              <p className="text-xs text-muted-foreground">
                Pendiente: {formatCurrency(summary.pending_payment || 0)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Pending by Carrier */}
      {pendingByCarrier.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pendiente por Courier</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              {pendingByCarrier.map((item) => (
                <div
                  key={item.carrier_id}
                  className="flex items-center justify-between p-3 border rounded-lg dark:border-gray-800"
                >
                  <div>
                    <p className="font-medium">{item.carrier_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.pending_sessions} sesiones pendientes
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-lg">{formatCurrency(item.pending_amount)}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex gap-4 items-center">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as any)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="open">Abierto</SelectItem>
              <SelectItem value="dispatched">Despachado</SelectItem>
              <SelectItem value="reconciled">Conciliado</SelectItem>
              <SelectItem value="settled">Liquidado</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button variant="outline" size="sm" onClick={loadSessions}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Actualizar
        </Button>
      </div>

      {/* Sessions Table */}
      {loading ? (
        <TableSkeleton columns={7} rows={5} />
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="Sin sesiones de despacho"
          description="Crea tu primera sesión para comenzar a gestionar entregas"
          actionLabel="Nuevo Despacho"
          onAction={() => setView('create')}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Courier</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-center">Pedidos</TableHead>
                  <TableHead className="text-center">Entregados</TableHead>
                  <TableHead className="text-right">COD Cobrado</TableHead>
                  <TableHead className="text-right">Neto</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell className="font-mono font-medium">
                      {session.session_code}
                    </TableCell>
                    <TableCell>{session.carrier_name || 'Sin courier'}</TableCell>
                    <TableCell>
                      {format(new Date(session.dispatch_date), 'dd MMM yyyy', { locale: es })}
                    </TableCell>
                    <TableCell className="text-center">{session.total_orders}</TableCell>
                    <TableCell className="text-center">
                      <span className="text-green-600">{session.delivered_count}</span>
                      {session.failed_count > 0 && (
                        <span className="text-red-600 ml-1">/ {session.failed_count}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(session.total_cod_collected)}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(session.net_receivable)}
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(session.status)}>
                        {translateStatus(session.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          loadSessionDetail(session.id);
                          setView('detail');
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );

  // Render create session view
  const renderCreateSession = () => (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => setView('sessions')}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          Volver
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Nuevo Despacho</h1>
          <p className="text-muted-foreground">
            Selecciona el courier y los pedidos a despachar
          </p>
        </div>
      </div>

      {/* Carrier Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Seleccionar Courier</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Courier</Label>
              <Select value={selectedCarrier} onValueChange={setSelectedCarrier}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona un courier..." />
                </SelectTrigger>
                <SelectContent>
                  {carriers.map((carrier) => (
                    <SelectItem key={carrier.id} value={carrier.id}>
                      {carrier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notas (opcional)</Label>
              <Input
                value={sessionNotes}
                onChange={(e) => setSessionNotes(e.target.value)}
                placeholder="Observaciones del despacho..."
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Orders Selection */}
      {selectedCarrier && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Pedidos Listos para Despacho</CardTitle>
                <CardDescription>
                  {availableOrders.length} pedidos disponibles • {selectedOrders.size} seleccionados
                </CardDescription>
              </div>
              {availableOrders.length > 0 && (
                <Button variant="outline" size="sm" onClick={toggleAllOrders}>
                  {selectedOrders.size === availableOrders.length
                    ? 'Deseleccionar todos'
                    : 'Seleccionar todos'}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <TableSkeleton columns={6} rows={5} />
            ) : availableOrders.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No hay pedidos listos para despacho para este courier</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <Checkbox
                        checked={selectedOrders.size === availableOrders.length}
                        onCheckedChange={toggleAllOrders}
                      />
                    </TableHead>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Ciudad</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Pago</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {availableOrders.map((order) => (
                    <TableRow
                      key={order.id}
                      className="cursor-pointer"
                      onClick={() => toggleOrderSelection(order.id)}
                    >
                      <TableCell>
                        <Checkbox
                          checked={selectedOrders.has(order.id)}
                          onCheckedChange={() => toggleOrderSelection(order.id)}
                        />
                      </TableCell>
                      <TableCell className="font-mono">
                        {order.order_number || order.id.slice(0, 8)}
                      </TableCell>
                      <TableCell>
                        {order.customer_first_name} {order.customer_last_name}
                      </TableCell>
                      <TableCell>{order.customer_city || '-'}</TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(order.total_price)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={order.payment_status === 'collected' ? 'default' : 'outline'}>
                          {order.payment_status === 'collected' ? 'Pagado' : 'COD'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create Button */}
      {selectedOrders.size > 0 && (
        <div className="flex justify-end gap-4">
          <Button variant="outline" onClick={() => setView('sessions')}>
            Cancelar
          </Button>
          <Button onClick={handleCreateSession} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Crear Despacho ({selectedOrders.size} pedidos)
          </Button>
        </div>
      )}
    </div>
  );

  // Render session detail view
  const renderSessionDetail = () => {
    if (!currentSession) return null;

    const progress =
      currentSession.total_orders > 0
        ? ((currentSession.delivered_count + currentSession.failed_count + currentSession.rejected_count) /
            currentSession.total_orders) *
          100
        : 0;

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setView('sessions')}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Volver
            </Button>
            <div>
              <h1 className="text-2xl font-bold font-mono">{currentSession.session_code}</h1>
              <p className="text-muted-foreground">
                {currentSession.carrier_name} •{' '}
                {format(new Date(currentSession.dispatch_date), "dd 'de' MMMM yyyy", {
                  locale: es,
                })}
              </p>
            </div>
          </div>
          <Badge className={getStatusColor(currentSession.status)}>
            {translateStatus(currentSession.status)}
          </Badge>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Pedidos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{currentSession.total_orders}</div>
              <Progress value={progress} className="mt-2" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Entregados</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {currentSession.delivered_count}
              </div>
              <p className="text-xs text-muted-foreground">
                {currentSession.total_orders > 0
                  ? ((currentSession.delivered_count / currentSession.total_orders) * 100).toFixed(1)
                  : 0}
                % de éxito
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">No Entregados</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {currentSession.failed_count + currentSession.rejected_count}
              </div>
              <p className="text-xs text-muted-foreground">
                {currentSession.failed_count} fallidos, {currentSession.rejected_count} rechazados
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Pendientes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{currentSession.pending_count}</div>
              <p className="text-xs text-muted-foreground">Sin resultado reportado</p>
            </CardContent>
          </Card>
        </div>

        {/* Financial Summary */}
        <Card>
          <CardHeader>
            <CardTitle>Resumen Financiero</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <p className="text-sm text-muted-foreground">COD Esperado</p>
                <p className="text-xl font-bold">
                  {formatCurrency(currentSession.total_cod_expected)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">COD Cobrado</p>
                <p className="text-xl font-bold text-green-600">
                  {formatCurrency(currentSession.total_cod_collected)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Costo Envío</p>
                <p className="text-xl font-bold text-orange-600">
                  {formatCurrency(currentSession.total_shipping_cost)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Neto a Cobrar</p>
                <p className="text-xl font-bold text-emerald-600">
                  {formatCurrency(currentSession.net_receivable)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex gap-4">
          {currentSession.status === 'open' && (
            <>
              <Button onClick={handleExportCSV}>
                <Download className="mr-2 h-4 w-4" />
                Exportar CSV
              </Button>
              <Button onClick={handleMarkDispatched} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Truck className="mr-2 h-4 w-4" />
                Marcar Despachado
              </Button>
            </>
          )}

          {currentSession.status === 'dispatched' && (
            <>
              <Button onClick={handleExportCSV} variant="outline">
                <Download className="mr-2 h-4 w-4" />
                Exportar CSV
              </Button>
              <Button onClick={() => fileInputRef.current?.click()}>
                <Upload className="mr-2 h-4 w-4" />
                Importar Resultados
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleImportCSV}
                className="hidden"
              />
            </>
          )}

          {currentSession.status === 'reconciled' && (
            <Button onClick={() => setShowSettlementDialog(true)}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Procesar Liquidación
            </Button>
          )}
        </div>

        {/* Orders Table */}
        <Card>
          <CardHeader>
            <CardTitle>Pedidos del Despacho</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Dirección</TableHead>
                  <TableHead className="text-right">COD</TableHead>
                  <TableHead className="text-right">Cobrado</TableHead>
                  <TableHead className="text-right">Envío</TableHead>
                  <TableHead>Resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessionOrders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-mono">
                      {order.order_number || order.order_id.slice(0, 8)}
                    </TableCell>
                    <TableCell>{order.customer_name || '-'}</TableCell>
                    <TableCell className="max-w-xs truncate">
                      {order.customer_address || '-'}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(order.cod_amount)}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(order.collected_amount)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(order.shipping_cost)}
                    </TableCell>
                    <TableCell>
                      <Badge className={getDeliveryResultColor(order.delivery_result)}>
                        {translateDeliveryResult(order.delivery_result)}
                      </Badge>
                      {order.failure_reason && (
                        <p className="text-xs text-muted-foreground mt-1">{order.failure_reason}</p>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Settlement Dialog */}
        <Dialog open={showSettlementDialog} onOpenChange={setShowSettlementDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Procesar Liquidación</DialogTitle>
              <DialogDescription>
                Confirma los datos antes de crear la liquidación final
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg dark:bg-gray-900 space-y-3">
                <div className="flex justify-between">
                  <span>COD Cobrado:</span>
                  <span className="font-bold text-green-600">
                    {formatCurrency(currentSession.total_cod_collected)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Costo de Envío:</span>
                  <span className="font-bold text-orange-600">
                    -{formatCurrency(currentSession.total_shipping_cost)}
                  </span>
                </div>
                <hr className="dark:border-gray-700" />
                <div className="flex justify-between text-lg">
                  <span className="font-semibold">Neto a Cobrar:</span>
                  <span className="font-bold text-emerald-600">
                    {formatCurrency(currentSession.net_receivable)}
                  </span>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowSettlementDialog(false)}>
                Cancelar
              </Button>
              <Button onClick={handleProcessSettlement} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirmar Liquidación
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  };

  // Render reconciliation view
  const renderReconciliation = () => {
    if (!reconciliationData || !currentSession) return null;

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              loadSessionDetail(currentSession.id);
              setView('detail');
            }}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Volver al detalle
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Resultado de Conciliación</h1>
            <p className="text-muted-foreground">
              Sesión {reconciliationData.session_code} - {reconciliationData.carrier_name}
            </p>
          </div>
        </div>

        {/* Summary */}
        <div className="grid gap-4 md:grid-cols-5">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{reconciliationData.total_orders}</div>
              <p className="text-sm text-muted-foreground">Total</p>
            </CardContent>
          </Card>
          <Card className="border-green-200 dark:border-green-900">
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-green-600">
                {reconciliationData.delivered}
              </div>
              <p className="text-sm text-muted-foreground">Entregados</p>
            </CardContent>
          </Card>
          <Card className="border-red-200 dark:border-red-900">
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-red-600">{reconciliationData.failed}</div>
              <p className="text-sm text-muted-foreground">Fallidos</p>
            </CardContent>
          </Card>
          <Card className="border-orange-200 dark:border-orange-900">
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-orange-600">
                {reconciliationData.rejected}
              </div>
              <p className="text-sm text-muted-foreground">Rechazados</p>
            </CardContent>
          </Card>
          <Card className="border-amber-200 dark:border-amber-900">
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-amber-600">{reconciliationData.pending}</div>
              <p className="text-sm text-muted-foreground">Pendientes</p>
            </CardContent>
          </Card>
        </div>

        {/* Financial Summary */}
        <Card>
          <CardHeader>
            <CardTitle>Resumen Financiero</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-4">
              <div>
                <p className="text-sm text-muted-foreground">COD Esperado</p>
                <p className="text-xl font-bold">
                  {formatCurrency(reconciliationData.total_cod_expected)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">COD Cobrado</p>
                <p className="text-xl font-bold text-green-600">
                  {formatCurrency(reconciliationData.total_cod_collected)}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Costo de Envío</p>
                <p className="text-xl font-bold text-orange-600">
                  {formatCurrency(reconciliationData.total_shipping_cost)}
                </p>
              </div>
              <div className="p-3 bg-emerald-50 rounded-lg dark:bg-emerald-900/20">
                <p className="text-sm text-muted-foreground">Neto a Cobrar</p>
                <p className="text-2xl font-bold text-emerald-600">
                  {formatCurrency(reconciliationData.net_receivable)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Discrepancies */}
        {reconciliationData.discrepancies && reconciliationData.discrepancies.length > 0 && (
          <Card className="border-amber-200 dark:border-amber-900">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <CardTitle>Discrepancias Detectadas</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pedido</TableHead>
                    <TableHead>Problema</TableHead>
                    <TableHead className="text-right">Esperado</TableHead>
                    <TableHead className="text-right">Reportado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reconciliationData.discrepancies.map((d, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono">{d.order_number}</TableCell>
                      <TableCell>{d.issue}</TableCell>
                      <TableCell className="text-right">{formatCurrency(d.expected)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(d.actual)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <div className="flex gap-4">
          <Button
            variant="outline"
            onClick={() => {
              loadSessionDetail(currentSession.id);
              setView('detail');
            }}
          >
            Ver Detalle
          </Button>
          <Button onClick={() => setShowSettlementDialog(true)}>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Procesar Liquidación
          </Button>
        </div>
      </div>
    );
  };

  // Main render
  return (
    <div className="p-6">
      {view === 'sessions' && renderSessionsList()}
      {view === 'create' && renderCreateSession()}
      {view === 'detail' && renderSessionDetail()}
      {view === 'reconcile' && renderReconciliation()}
    </div>
  );
}
