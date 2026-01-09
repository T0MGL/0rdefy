/**
 * Returns Page
 * Manages product return and refund processing
 * Batch processing with inventory integration
 *
 * @author Bright Idea
 * @date 2025-12-02
 */

import { useState, useEffect, useCallback } from 'react';
import { PackageX, RotateCcw, Check, X, AlertTriangle, ChevronLeft, Plus, TrendingDown, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { MetricCard } from '@/components/MetricCard';
import { formatCurrency } from '@/utils/currency';
import { analyticsService, ReturnsMetrics } from '@/services/analytics.service';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { TableSkeleton } from '@/components/skeletons/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { FeatureBlockedPage } from '@/components/FeatureGate';
import * as returnsService from '@/services/returns.service';
import type {
  ReturnSession,
  ReturnSessionDetail,
  ReturnSessionItem,
  EligibleOrder,
} from '@/services/returns.service';

type View = 'sessions' | 'create' | 'process';

export default function Returns() {
  const { toast } = useToast();
  const { hasFeature } = useSubscription();

  // Plan-based feature check - returns requires Starter+ plan
  if (!hasFeature('returns')) {
    return <FeatureBlockedPage feature="returns" />;
  }

  const [view, setView] = useState<View>('sessions');
  const [currentSession, setCurrentSession] = useState<ReturnSessionDetail | null>(null);

  // Sessions view state
  const [sessions, setSessions] = useState<ReturnSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [returnsMetrics, setReturnsMetrics] = useState<ReturnsMetrics | null>(null);

  // Create session state
  const [eligibleOrders, setEligibleOrders] = useState<EligibleOrder[]>([]);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [sessionNotes, setSessionNotes] = useState('');
  const [ordersInActiveSessions, setOrdersInActiveSessions] = useState<Set<string>>(new Set());

  // Process session state
  const [items, setItems] = useState<ReturnSessionItem[]>([]);
  const [acceptedItems, setAcceptedItems] = useState<ReturnSessionItem[]>([]);
  const [rejectedItems, setRejectedItems] = useState<ReturnSessionItem[]>([]);

  // Load sessions list
  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const [sessionsData, metricsData] = await Promise.all([
        returnsService.getReturnSessions(),
        analyticsService.getReturnsMetrics().catch(() => null),
      ]);
      setSessions(sessionsData);
      setReturnsMetrics(metricsData);
    } catch (error) {
      console.error('Error loading sessions:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar las sesiones de devoluciones',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Load eligible orders for return
  const loadEligibleOrders = useCallback(async () => {
    setLoading(true);
    try {
      const [orders, inProgressSessions] = await Promise.all([
        returnsService.getEligibleOrders(),
        returnsService.getReturnSessions(),
      ]);

      setEligibleOrders(orders);

      // Find orders that are already in active return sessions
      const activeSessionOrders = new Set<string>();
      const activeSessions = inProgressSessions.filter(s => s.status === 'in_progress');

      for (const session of activeSessions) {
        // Fetch session details to get order IDs
        const sessionDetail = await returnsService.getReturnSession(session.id);
        sessionDetail.orders.forEach((order: any) => {
          activeSessionOrders.add(order.order_id);
        });
      }

      setOrdersInActiveSessions(activeSessionOrders);
    } catch (error) {
      console.error('Error loading eligible orders:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar los pedidos elegibles',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Load session details
  const loadSession = useCallback(async (sessionId: string) => {
    setLoading(true);
    try {
      const session = await returnsService.getReturnSession(sessionId);
      setCurrentSession(session);
      setItems(session.items);

      // Categorize items
      const accepted = session.items.filter(item => item.quantity_accepted > 0);
      const rejected = session.items.filter(item => item.quantity_rejected > 0);
      setAcceptedItems(accepted);
      setRejectedItems(rejected);
    } catch (error) {
      console.error('Error loading session:', error);
      toast({
        title: 'Error',
        description: 'No se pudo cargar la sesión',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (view === 'sessions') {
      loadSessions();
    } else if (view === 'create') {
      loadEligibleOrders();
    }
  }, [view, loadSessions, loadEligibleOrders]);

  // Create new return session
  const handleCreateSession = async () => {
    if (selectedOrders.size === 0) {
      toast({
        title: 'Error',
        description: 'Selecciona al menos un pedido',
        variant: 'destructive',
      });
      return;
    }

    // Check if any selected orders are in active sessions
    const ordersInSession = Array.from(selectedOrders).filter(orderId =>
      ordersInActiveSessions.has(orderId)
    );

    if (ordersInSession.length > 0) {
      toast({
        title: 'Error',
        description: `${ordersInSession.length} pedido(s) seleccionado(s) ya están en una sesión de devolución activa. Por favor, deselecciónalos o completa la sesión existente.`,
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const session = await returnsService.createReturnSession(
        Array.from(selectedOrders),
        sessionNotes || undefined
      );

      toast({
        title: 'Éxito',
        description: `Sesión ${session.session_code} creada exitosamente`,
      });

      // Load the new session and switch to process view
      await loadSession(session.id);
      setView('process');
      setSelectedOrders(new Set());
      setSessionNotes('');
    } catch (error: any) {
      console.error('Error creating session:', error);
      const errorMessage = error?.message || 'No se pudo crear la sesión';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Update item quantities and reasons
  const handleUpdateItem = async (
    itemId: string,
    updates: {
      quantity_accepted?: number;
      quantity_rejected?: number;
      rejection_reason?: string;
      rejection_notes?: string;
    }
  ) => {
    // Optimistic update - update UI immediately
    const previousItems = [...items];
    const previousAcceptedItems = [...acceptedItems];
    const previousRejectedItems = [...rejectedItems];

    // Update local state
    const updatedItems = items.map(item => {
      if (item.id === itemId) {
        return { ...item, ...updates };
      }
      return item;
    });

    setItems(updatedItems);

    // Re-categorize items
    const newAccepted = updatedItems.filter(item => item.quantity_accepted > 0);
    const newRejected = updatedItems.filter(item => item.quantity_rejected > 0);
    setAcceptedItems(newAccepted);
    setRejectedItems(newRejected);

    try {
      await returnsService.updateReturnItem(itemId, updates);

      // Optionally refresh from server to ensure sync (but UI already updated)
      if (currentSession) {
        await loadSession(currentSession.id);
      }
    } catch (error) {
      console.error('Error updating item:', error);

      // Revert optimistic update on error
      setItems(previousItems);
      setAcceptedItems(previousAcceptedItems);
      setRejectedItems(previousRejectedItems);

      toast({
        title: 'Error',
        description: 'No se pudo actualizar el item',
        variant: 'destructive',
      });
    }
  };

  // Complete return session
  const handleCompleteSession = async () => {
    if (!currentSession) return;

    // Check if all items have been processed
    const unprocessedItems = items.filter(
      item => item.quantity_accepted === 0 && item.quantity_rejected === 0
    );

    if (unprocessedItems.length > 0) {
      toast({
        title: 'Advertencia',
        description: 'Hay items sin procesar. Todos los items deben ser aceptados o rechazados.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      await returnsService.completeReturnSession(currentSession.id);

      toast({
        title: 'Éxito',
        description: 'Sesión completada. El inventario ha sido actualizado.',
      });

      setView('sessions');
      setCurrentSession(null);
      setItems([]);
      setAcceptedItems([]);
      setRejectedItems([]);
    } catch (error) {
      console.error('Error completing session:', error);
      toast({
        title: 'Error',
        description: 'No se pudo completar la sesión',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Cancel session
  const handleCancelSession = async () => {
    if (!currentSession) return;

    if (!confirm('¿Estás seguro de cancelar esta sesión?')) return;

    setLoading(true);
    try {
      await returnsService.cancelReturnSession(currentSession.id);

      toast({
        title: 'Éxito',
        description: 'Sesión cancelada',
      });

      setView('sessions');
      setCurrentSession(null);
    } catch (error) {
      console.error('Error cancelling session:', error);
      toast({
        title: 'Error',
        description: 'No se pudo cancelar la sesión',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Render sessions list view
  const renderSessionsView = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Devoluciones</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Gestiona las devoluciones de productos
          </p>
        </div>
        <Button onClick={() => setView('create')} className="gap-2">
          <Plus className="h-4 w-4" />
          Nueva Sesión
        </Button>
      </div>

      {/* Métricas de Devolución */}
      {returnsMetrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Tasa de Devolución"
            value={`${returnsMetrics.returnRate}%`}
            subtitle={`${returnsMetrics.returnedOrders} de ${returnsMetrics.deliveredOrders + returnsMetrics.returnedOrders} pedidos`}
            icon={<TrendingDown className="text-red-600" size={20} />}
          />
          <MetricCard
            title="Valor Devuelto"
            value={formatCurrency(returnsMetrics.returnedValue)}
            subtitle={`${returnsMetrics.returnedOrders} pedidos devueltos`}
            icon={<PackageX className="text-orange-600" size={20} />}
            variant="secondary"
          />
          <MetricCard
            title="Tasa de Aceptación"
            value={`${returnsMetrics.acceptanceRate}%`}
            subtitle={`${returnsMetrics.itemsAccepted} aceptados · ${returnsMetrics.itemsRejected} rechazados`}
            icon={<Check className="text-green-600" size={20} />}
            variant="accent"
          />
          <MetricCard
            title="Sesiones Completadas"
            value={returnsMetrics.completedSessions}
            subtitle={`${returnsMetrics.totalSessions} sesiones totales · ${returnsMetrics.inProgressSessions} en progreso`}
            icon={<Package className="text-blue-600" size={20} />}
          />
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={3} columns={4} />
      ) : sessions.length === 0 ? (
        <EmptyState
          icon={PackageX}
          title="No hay sesiones de devolución"
          description="Crea una nueva sesión para procesar devoluciones"
          action={{
            label: 'Crear Primera Sesión',
            onClick: () => setView('create')
          }}
        />
      ) : (
        <div className="grid gap-4">
          {sessions.map((session) => (
            <Card key={session.id} className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold text-lg">{session.session_code}</h3>
                    <Badge variant={
                      session.status === 'completed' ? 'default' :
                      session.status === 'cancelled' ? 'destructive' :
                      'secondary'
                    }>
                      {session.status === 'completed' ? 'Completada' :
                       session.status === 'cancelled' ? 'Cancelada' :
                       'En Progreso'}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Pedidos:</span>
                      <span className="ml-1 font-medium">{session.processed_orders}/{session.total_orders}</span>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Items:</span>
                      <span className="ml-1 font-medium">{session.total_items}</span>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Aceptados:</span>
                      <span className="ml-1 font-medium text-green-600">{session.accepted_items}</span>
                    </div>
                    <div>
                      <span className="text-gray-600 dark:text-gray-400">Rechazados:</span>
                      <span className="ml-1 font-medium text-red-600">{session.rejected_items}</span>
                    </div>
                  </div>
                  {session.notes && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                      {session.notes}
                    </p>
                  )}
                </div>
                {session.status === 'in_progress' && (
                  <Button
                    onClick={() => {
                      loadSession(session.id);
                      setView('process');
                    }}
                  >
                    Continuar
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );

  // Render create session view
  const renderCreateView = () => (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => setView('sessions')}>
          <ChevronLeft className="h-4 w-4 mr-2" />
          Volver
        </Button>
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Nueva Sesión de Devolución</h1>
          <p className="text-gray-600 dark:text-gray-400">
            Selecciona los pedidos a procesar
          </p>
        </div>
      </div>

      <Card className="p-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">
              Notas de la sesión (opcional)
            </label>
            <Textarea
              placeholder="Ej: Devoluciones del lote de envío #123"
              value={sessionNotes}
              onChange={(e) => setSessionNotes(e.target.value)}
              rows={2}
            />
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Pedidos Elegibles</h2>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {selectedOrders.size} pedido(s) seleccionado(s)
        </div>
      </div>

      {loading ? (
        <TableSkeleton rows={3} columns={3} />
      ) : eligibleOrders.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="No hay pedidos elegibles"
          description="Los pedidos deben estar en estado: entregado, enviado o cancelado"
        />
      ) : (
        <div className="grid gap-4">
          {eligibleOrders.map((order) => {
            const isInActiveSession = ordersInActiveSessions.has(order.id);
            const hasNoItems = order.items_count === 0;
            const isDisabled = isInActiveSession || hasNoItems;

            return (
              <Card key={order.id} className={`p-6 ${isDisabled ? 'opacity-50' : ''}`}>
                <div className="flex items-center gap-4">
                  <Checkbox
                    checked={selectedOrders.has(order.id)}
                    disabled={isDisabled}
                    onCheckedChange={(checked) => {
                      const newSelected = new Set(selectedOrders);
                      if (checked) {
                        newSelected.add(order.id);
                      } else {
                        newSelected.delete(order.id);
                      }
                      setSelectedOrders(newSelected);
                    }}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="font-semibold">#{order.order_number}</h3>
                      <Badge variant={
                        order.status === 'delivered' ? 'default' :
                        order.status === 'shipped' ? 'secondary' :
                        'destructive'
                      }>
                        {order.status === 'delivered' ? 'Entregado' :
                         order.status === 'shipped' ? 'Enviado' :
                         'Cancelado'}
                      </Badge>
                      {isInActiveSession && (
                        <Badge variant="outline" className="bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200 border-yellow-300 dark:border-yellow-700">
                          En Sesión Activa
                        </Badge>
                      )}
                      {hasNoItems && (
                        <Badge variant="outline" className="bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-200 border-red-300 dark:border-red-700">
                          Sin Items Mapeados
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600 dark:text-gray-400">Cliente:</span>
                        <span className="ml-1 font-medium">{order.customer_name}</span>
                      </div>
                      <div>
                        <span className="text-gray-600 dark:text-gray-400">Items:</span>
                        <span className="ml-1 font-medium">{order.items_count}</span>
                      </div>
                      <div>
                        <span className="text-gray-600 dark:text-gray-400">Total:</span>
                        <span className="ml-1 font-medium">${order.total_price.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {eligibleOrders.length > 0 && (
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setView('sessions')}>
            Cancelar
          </Button>
          <Button
            onClick={handleCreateSession}
            disabled={selectedOrders.size === 0 || loading}
          >
            Crear Sesión
          </Button>
        </div>
      )}
    </div>
  );

  // Render process session view
  const renderProcessView = () => {
    if (!currentSession) return null;

    const progress = items.length > 0
      ? ((acceptedItems.length + rejectedItems.length) / items.length) * 100
      : 0;

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => setView('sessions')}>
            <ChevronLeft className="h-4 w-4 mr-2" />
            Volver
          </Button>
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              {currentSession.session_code}
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Procesar items devueltos
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleCancelSession}>
              Cancelar Sesión
            </Button>
            <Button onClick={handleCompleteSession} disabled={loading || progress < 100}>
              <Check className="h-4 w-4 mr-2" />
              Finalizar Sesión
            </Button>
          </div>
        </div>

        {/* Progress */}
        <Card className="p-6">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="font-medium">Progreso</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} />
            <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
              <div>
                <span className="text-gray-600 dark:text-gray-400">Total Items:</span>
                <span className="ml-1 font-medium">{items.length}</span>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Aceptados:</span>
                <span className="ml-1 font-medium text-green-600">{acceptedItems.length}</span>
              </div>
              <div>
                <span className="text-gray-600 dark:text-gray-400">Rechazados:</span>
                <span className="ml-1 font-medium text-red-600">{rejectedItems.length}</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Items List */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Items to Process */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">Items por Procesar</h2>
            {items.filter(item => item.quantity_accepted === 0 && item.quantity_rejected === 0).map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                onUpdate={handleUpdateItem}
              />
            ))}
          </div>

          {/* Processed Items */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-green-600">Aceptados</h2>
            {acceptedItems.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                onUpdate={handleUpdateItem}
                readOnly
              />
            ))}

            <h2 className="text-xl font-semibold text-red-600 mt-8">Rechazados</h2>
            {rejectedItems.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                onUpdate={handleUpdateItem}
                readOnly
              />
            ))}
          </div>
        </div>
      </div>
    );
  };

  // Main render
  return (
    <div className="p-6">
      {view === 'sessions' && renderSessionsView()}
      {view === 'create' && renderCreateView()}
      {view === 'process' && renderProcessView()}
    </div>
  );
}

// Item Card Component
interface ItemCardProps {
  item: ReturnSessionItem;
  onUpdate: (itemId: string, updates: any) => Promise<void>;
  readOnly?: boolean;
}

function ItemCard({ item, onUpdate, readOnly }: ItemCardProps) {
  const [accepted, setAccepted] = useState(item.quantity_accepted);
  const [rejected, setRejected] = useState(item.quantity_rejected);
  const [reason, setReason] = useState(item.rejection_reason || '');
  const [notes, setNotes] = useState(item.rejection_notes || '');

  const handleAccept = () => {
    const newAccepted = Math.min(accepted + 1, item.quantity_expected);
    setAccepted(newAccepted);
    setRejected(item.quantity_expected - newAccepted);
  };

  const handleReject = () => {
    const newRejected = Math.min(rejected + 1, item.quantity_expected);
    setRejected(newRejected);
    setAccepted(item.quantity_expected - newRejected);
  };

  const handleSave = () => {
    onUpdate(item.id, {
      quantity_accepted: accepted,
      quantity_rejected: rejected,
      rejection_reason: reason || undefined,
      rejection_notes: notes || undefined,
    });
  };

  const hasChanges =
    accepted !== item.quantity_accepted ||
    rejected !== item.quantity_rejected ||
    reason !== (item.rejection_reason || '') ||
    notes !== (item.rejection_notes || '');

  return (
    <Card className="p-4">
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          {item.product?.image_url && (
            <img
              src={item.product.image_url}
              alt={item.product.name}
              className="w-16 h-16 rounded object-cover"
            />
          )}
          <div className="flex-1">
            <h3 className="font-semibold">{item.product?.name}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              SKU: {item.product?.sku}
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Cantidad esperada: {item.quantity_expected}
            </p>
          </div>
        </div>

        {!readOnly ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Aceptar</label>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAccepted(Math.max(0, accepted - 1))}
                  >
                    -
                  </Button>
                  <Input
                    type="number"
                    value={accepted}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setAccepted(Math.min(val, item.quantity_expected));
                      setRejected(item.quantity_expected - Math.min(val, item.quantity_expected));
                    }}
                    className="text-center"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleAccept}
                  >
                    +
                  </Button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Rechazar</label>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRejected(Math.max(0, rejected - 1))}
                  >
                    -
                  </Button>
                  <Input
                    type="number"
                    value={rejected}
                    onChange={(e) => {
                      const val = parseInt(e.target.value) || 0;
                      setRejected(Math.min(val, item.quantity_expected));
                      setAccepted(item.quantity_expected - Math.min(val, item.quantity_expected));
                    }}
                    className="text-center"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleReject}
                  >
                    +
                  </Button>
                </div>
              </div>
            </div>

            {rejected > 0 && (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">Razón de rechazo</label>
                  <Select value={reason} onValueChange={setReason}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona una razón" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="damaged">Dañado</SelectItem>
                      <SelectItem value="defective">Defectuoso</SelectItem>
                      <SelectItem value="incomplete">Incompleto</SelectItem>
                      <SelectItem value="wrong_item">Item Equivocado</SelectItem>
                      <SelectItem value="other">Otro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Notas adicionales</label>
                  <Textarea
                    placeholder="Describe el problema..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                </div>
              </>
            )}

            {hasChanges && (
              <Button onClick={handleSave} className="w-full">
                Guardar Cambios
              </Button>
            )}
          </>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Aceptados:</span>
              <span className="font-medium text-green-600">{item.quantity_accepted}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Rechazados:</span>
              <span className="font-medium text-red-600">{item.quantity_rejected}</span>
            </div>
            {item.rejection_reason && (
              <div>
                <span className="text-gray-600 dark:text-gray-400">Razón:</span>
                <span className="ml-1 font-medium">
                  {item.rejection_reason === 'damaged' ? 'Dañado' :
                   item.rejection_reason === 'defective' ? 'Defectuoso' :
                   item.rejection_reason === 'incomplete' ? 'Incompleto' :
                   item.rejection_reason === 'wrong_item' ? 'Item Equivocado' :
                   'Otro'}
                </span>
              </div>
            )}
            {item.rejection_notes && (
              <div>
                <span className="text-gray-600 dark:text-gray-400">Notas:</span>
                <p className="text-sm mt-1">{item.rejection_notes}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
