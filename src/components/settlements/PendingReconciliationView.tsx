/**
 * PendingReconciliationView - Delivery-Based Reconciliation
 *
 * Simplified reconciliation workflow that groups by DELIVERY DATE
 * instead of dispatch date. This makes it easier for users to
 * reconcile all deliveries from a specific day.
 *
 * Flow:
 * 1. View list of dates with pending deliveries
 * 2. Select a date/carrier combination
 * 3. Mark orders as delivered/not delivered
 * 4. Enter amount collected
 * 5. Confirm and create settlement
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
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
import {
  Loader2,
  Calendar,
  Truck,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  Package,
  RefreshCw,
  AlertTriangle,
  DollarSign,
  ChevronRight,
  Search,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { logger } from '@/utils/logger';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const getAuthHeaders = () => ({
  'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
  'X-Store-ID': localStorage.getItem('current_store_id') || '',
  'Content-Type': 'application/json',
});

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('es-PY', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount) + ' Gs';
};

// Types
interface DeliveryDateGroup {
  delivery_date: string;
  carrier_id: string;
  carrier_name: string;
  failed_attempt_fee_percent: number;
  total_orders: number;
  total_cod: number;
  total_prepaid: number;
}

interface PendingOrder {
  id: string;
  display_order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  customer_city: string;
  total_price: number;
  cod_amount: number;
  payment_method: string;
  is_cod: boolean;
  delivered_at: string;
}

interface OrderReconciliation {
  delivered: boolean;
  failure_reason?: string;
}

type WorkflowStep = 'selection' | 'reconciliation' | 'confirm' | 'payment' | 'complete';

type PaymentOption = 'paid_by_carrier' | 'paid_to_carrier' | 'deducted_from_cod' | 'pending';

interface ReconciliationResult {
  settlement_id: string;
  settlement_code: string;
  total_orders: number;
  total_delivered: number;
  total_not_delivered: number;
  total_cod_expected: number;
  total_cod_collected: number;
  total_carrier_fees: number;
  failed_attempt_fee: number;
  net_receivable: number;
}

const FAILURE_REASONS = [
  { value: 'no_answer', label: 'No contesta' },
  { value: 'wrong_address', label: 'Direccion incorrecta' },
  { value: 'customer_absent', label: 'Cliente ausente' },
  { value: 'customer_rejected', label: 'Cliente rechazo' },
  { value: 'insufficient_funds', label: 'Sin dinero' },
  { value: 'rescheduled', label: 'Reprogramado' },
  { value: 'other', label: 'Otro' },
];

export function PendingReconciliationView() {
  const { toast } = useToast();

  // State
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [groups, setGroups] = useState<DeliveryDateGroup[]>([]);
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('selection');
  const [selectedGroup, setSelectedGroup] = useState<DeliveryDateGroup | null>(null);
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Reconciliation state
  const [reconciliationState, setReconciliationState] = useState<Map<string, OrderReconciliation>>(new Map());
  const [totalAmountCollected, setTotalAmountCollected] = useState<number | null>(null);
  const [discrepancyNotes, setDiscrepancyNotes] = useState('');

  // Payment step state
  const [reconciliationResult, setReconciliationResult] = useState<ReconciliationResult | null>(null);
  const [selectedPaymentOption, setSelectedPaymentOption] = useState<PaymentOption | null>(null);
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentProcessing, setPaymentProcessing] = useState(false);

  // Load pending reconciliation groups
  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/settlements/pending-reconciliation`, {
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error('Error al cargar las conciliaciones pendientes');
      }

      const result = await response.json();
      setGroups(result.data || []);
    } catch (error: any) {
      logger.error('[PendingReconciliation] Error loading groups:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar las conciliaciones pendientes',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Load orders for a specific date/carrier
  const loadOrders = useCallback(async (deliveryDate: string, carrierId: string) => {
    setLoading(true);
    try {
      const response = await fetch(
        `${API_BASE}/api/settlements/pending-reconciliation/${deliveryDate}/${carrierId}`,
        { headers: getAuthHeaders() }
      );

      if (!response.ok) {
        throw new Error('Error al cargar los pedidos');
      }

      const result = await response.json();
      const ordersData = result.data || [];
      setOrders(ordersData);

      // Initialize reconciliation state - all delivered by default
      const initialState = new Map<string, OrderReconciliation>();
      ordersData.forEach((order: PendingOrder) => {
        initialState.set(order.id, { delivered: true });
      });
      setReconciliationState(initialState);
    } catch (error: any) {
      logger.error('[PendingReconciliation] Error loading orders:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar los pedidos',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Initial load
  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  // Group by date for visual hierarchy
  const groupedByDate = useMemo(() => {
    const dateMap = new Map<string, DeliveryDateGroup[]>();

    groups.forEach(group => {
      const existing = dateMap.get(group.delivery_date) || [];
      existing.push(group);
      dateMap.set(group.delivery_date, existing);
    });

    return Array.from(dateMap.entries()).sort((a, b) =>
      new Date(b[0]).getTime() - new Date(a[0]).getTime()
    );
  }, [groups]);

  // Filtered orders
  const filteredOrders = useMemo(() => {
    if (!searchTerm) return orders;
    const term = searchTerm.toLowerCase();
    return orders.filter(order =>
      order.display_order_number.toLowerCase().includes(term) ||
      order.customer_name.toLowerCase().includes(term) ||
      order.customer_phone.includes(term)
    );
  }, [orders, searchTerm]);

  // Calculate stats
  const stats = useMemo(() => {
    let delivered = 0;
    let notDelivered = 0;
    let codExpected = 0;
    let missingReasons = 0;

    orders.forEach(order => {
      const state = reconciliationState.get(order.id);
      const isDelivered = state?.delivered ?? true;

      if (isDelivered) {
        delivered++;
        if (order.is_cod) {
          codExpected += order.cod_amount;
        }
      } else {
        notDelivered++;
        if (!state?.failure_reason) {
          missingReasons++;
        }
      }
    });

    return { delivered, notDelivered, codExpected, missingReasons, total: orders.length };
  }, [orders, reconciliationState]);

  // Calculate financial summary (PREVIEW - actual calculation done on backend with real zone rates)
  const financialSummary = useMemo(() => {
    if (!selectedGroup) return null;

    // NOTE: This is an ESTIMATE for preview purposes only
    // The actual carrier fees are calculated on the backend using real zone rates
    // We use 25,000 Gs as a typical average rate for Paraguay
    const carrierFeePerDelivery = 25000; // Estimate - real rates vary by zone
    const failedFeePercent = selectedGroup.failed_attempt_fee_percent / 100;

    const totalCarrierFees = stats.delivered * carrierFeePerDelivery;
    const failedAttemptFees = stats.notDelivered * carrierFeePerDelivery * failedFeePercent;
    const codCollected = totalAmountCollected || 0;
    const netReceivable = codCollected - totalCarrierFees - failedAttemptFees;

    const discrepancy = codCollected - stats.codExpected;
    const hasDiscrepancy = Math.abs(discrepancy) > 0.01;

    return {
      totalCarrierFees,
      failedAttemptFees,
      codCollected,
      netReceivable,
      discrepancy,
      hasDiscrepancy,
      carrierFeePerDelivery,
    };
  }, [selectedGroup, stats, totalAmountCollected]);

  // Handle group selection
  const handleSelectGroup = (group: DeliveryDateGroup) => {
    setSelectedGroup(group);
    setCurrentStep('reconciliation');
    loadOrders(group.delivery_date, group.carrier_id);
  };

  // Handle toggle delivered
  const handleToggleDelivered = (orderId: string, delivered: boolean) => {
    setReconciliationState(prev => {
      const newState = new Map(prev);
      const current = newState.get(orderId) || { delivered: true };
      newState.set(orderId, { ...current, delivered });
      return newState;
    });
  };

  // Handle failure reason
  const handleSetFailureReason = (orderId: string, reason: string) => {
    setReconciliationState(prev => {
      const newState = new Map(prev);
      const current = newState.get(orderId) || { delivered: false };
      newState.set(orderId, { ...current, failure_reason: reason });
      return newState;
    });
  };

  // Handle toggle all
  const handleToggleAll = (delivered: boolean) => {
    setReconciliationState(prev => {
      const newState = new Map(prev);
      orders.forEach(order => {
        const current = newState.get(order.id) || { delivered: true };
        newState.set(order.id, { ...current, delivered });
      });
      return newState;
    });
  };

  // Process reconciliation
  const handleProcessReconciliation = async () => {
    if (!selectedGroup || totalAmountCollected === null) return;

    setProcessing(true);
    try {
      const ordersData = orders.map(order => {
        const state = reconciliationState.get(order.id);
        return {
          order_id: order.id,
          delivered: state?.delivered ?? true,
          failure_reason: state?.failure_reason,
        };
      });

      const response = await fetch(`${API_BASE}/api/settlements/reconcile-delivery`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          carrier_id: selectedGroup.carrier_id,
          delivery_date: selectedGroup.delivery_date,
          orders: ordersData,
          total_amount_collected: totalAmountCollected,
          discrepancy_notes: discrepancyNotes || null,
        }),
      });

      if (!response.ok) {
        let errorMessage = 'Error al procesar la conciliacion';
        try {
          const error = await response.json();
          errorMessage = error.error || errorMessage;
        } catch {
          // Response wasn't JSON
          if (response.status === 401) {
            errorMessage = 'Sesion expirada. Por favor, recarga la pagina.';
          } else if (response.status === 500) {
            errorMessage = 'Error del servidor. Intenta nuevamente.';
          }
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();

      // Save the result for payment step
      setReconciliationResult(result.data);

      // If net_receivable is 0, skip payment step
      if (Math.abs(result.data.net_receivable) < 1) {
        toast({
          title: 'Conciliacion completada',
          description: `Liquidacion ${result.data.settlement_code} creada. Balance en cero.`,
        });
        setCurrentStep('complete');
      } else {
        // Go to payment step to determine how the balance was settled
        setCurrentStep('payment');
      }
    } catch (error: any) {
      logger.error('[PendingReconciliation] Error processing:', error);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo procesar la conciliacion',
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
    }
  };

  // Handle payment registration
  const handleRegisterPayment = async () => {
    if (!reconciliationResult || !selectedPaymentOption) return;

    // If pending, just go to complete without registering payment
    if (selectedPaymentOption === 'pending') {
      toast({
        title: 'Liquidacion creada',
        description: `${reconciliationResult.settlement_code} - Pago pendiente de registrar`,
      });
      setCurrentStep('complete');
      return;
    }

    setPaymentProcessing(true);
    try {
      const netReceivable = reconciliationResult.net_receivable;
      const amount = Math.abs(netReceivable);

      // Determine payment direction and method based on selection
      let direction: 'from_carrier' | 'to_carrier';
      let method: string;

      if (selectedPaymentOption === 'paid_by_carrier') {
        direction = 'from_carrier';
        method = 'cash';
      } else if (selectedPaymentOption === 'paid_to_carrier') {
        direction = 'to_carrier';
        method = 'bank_transfer';
      } else {
        // deducted_from_cod - courier already deducted, so it's effectively a payment
        direction = netReceivable > 0 ? 'from_carrier' : 'to_carrier';
        method = 'deduction';
      }

      // Call the settlement payment API
      const response = await fetch(
        `${API_BASE}/api/settlements/v2/${reconciliationResult.settlement_id}/pay`,
        {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            amount,
            method,
            reference: paymentReference || `${direction === 'from_carrier' ? 'Pago recibido' : 'Pago enviado'} - ${reconciliationResult.settlement_code}`,
            notes: selectedPaymentOption === 'deducted_from_cod'
              ? 'Descontado del COD por el courier'
              : null,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Error al registrar el pago');
      }

      toast({
        title: 'Pago registrado',
        description: `Liquidacion ${reconciliationResult.settlement_code} completada`,
      });

      setCurrentStep('complete');
    } catch (error: any) {
      logger.error('[PendingReconciliation] Error registering payment:', error);
      toast({
        title: 'Error',
        description: error.message || 'No se pudo registrar el pago',
        variant: 'destructive',
      });
    } finally {
      setPaymentProcessing(false);
    }
  };

  // Reset and go back
  const handleBack = () => {
    if (currentStep === 'reconciliation') {
      setCurrentStep('selection');
      setSelectedGroup(null);
      setOrders([]);
      setReconciliationState(new Map());
      setTotalAmountCollected(null);
      setDiscrepancyNotes('');
      setSearchTerm('');
    } else if (currentStep === 'confirm') {
      setCurrentStep('reconciliation');
    } else if (currentStep === 'payment') {
      // Can't go back from payment - reconciliation already done
      // Just complete without payment
      setCurrentStep('complete');
    } else if (currentStep === 'complete') {
      setCurrentStep('selection');
      setSelectedGroup(null);
      setOrders([]);
      setReconciliationState(new Map());
      setTotalAmountCollected(null);
      setDiscrepancyNotes('');
      setSearchTerm('');
      setReconciliationResult(null);
      setSelectedPaymentOption(null);
      setPaymentReference('');
      loadGroups();
    }
  };

  // Can proceed to confirm
  const canProceed = stats.missingReasons === 0 && totalAmountCollected !== null && totalAmountCollected >= 0;

  // Render selection view
  const renderSelection = () => (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Pendientes de Conciliar</h2>
          <p className="text-sm text-muted-foreground">
            Selecciona una fecha y transportadora para conciliar
          </p>
        </div>
        <Button variant="outline" onClick={loadGroups} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Fechas Pendientes</CardTitle>
            <Calendar className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{groupedByDate.length}</div>
            <p className="text-xs text-muted-foreground">
              Con entregas sin conciliar
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pedidos Entregados</CardTitle>
            <Package className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {groups.reduce((sum, g) => sum + g.total_orders, 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              Esperando conciliacion
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">COD Pendiente</CardTitle>
            <DollarSign className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(groups.reduce((sum, g) => sum + g.total_cod, 0))}
            </div>
            <p className="text-xs text-muted-foreground">
              Por cobrar
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Date Groups */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : groupedByDate.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
            <h3 className="text-lg font-medium">Todo conciliado</h3>
            <p className="text-muted-foreground text-center mt-2">
              No hay entregas pendientes de conciliar
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groupedByDate.map(([date, dateGroups]) => (
            <div key={date} className="space-y-3">
              {/* Date Header */}
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <h3 className="font-semibold capitalize">
                  {format(parseISO(date), "EEEE d 'de' MMMM yyyy", { locale: es })}
                </h3>
              </div>

              {/* Carrier Cards for this date */}
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {dateGroups.map(group => (
                  <Card
                    key={`${group.carrier_id}_${group.delivery_date}`}
                    className="cursor-pointer hover:border-primary transition-colors"
                    onClick={() => handleSelectGroup(group)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Truck className="h-4 w-4 text-muted-foreground" />
                            <span className="font-medium">{group.carrier_name}</span>
                          </div>
                          <div className="text-2xl font-bold">
                            {group.total_orders} pedidos
                          </div>
                          <div className="text-sm text-muted-foreground">
                            COD: {formatCurrency(group.total_cod)}
                            {group.total_prepaid > 0 && (
                              <span className="ml-2">
                                + {group.total_prepaid} prepago
                              </span>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="h-5 w-5 text-muted-foreground" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // Render reconciliation view
  const renderReconciliation = () => {
    if (!selectedGroup) return null;

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1">
            <h2 className="text-lg font-semibold">
              {selectedGroup.carrier_name} - {format(parseISO(selectedGroup.delivery_date), "d 'de' MMMM", { locale: es })}
            </h2>
            <p className="text-sm text-muted-foreground">
              {orders.length} pedidos entregados
            </p>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span className="text-sm font-medium">{stats.delivered} entregados</span>
          </div>
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-red-600" />
            <span className="text-sm font-medium">{stats.notDelivered} no entregados</span>
          </div>
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-medium">COD esperado: {formatCurrency(stats.codExpected)}</span>
          </div>

          {stats.missingReasons > 0 && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <Badge variant="destructive">
                {stats.missingReasons} sin motivo
              </Badge>
            </>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por numero, cliente o telefono..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Orders Table */}
        <Card>
          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={stats.delivered === orders.length}
                      onCheckedChange={(checked) => handleToggleAll(!!checked)}
                    />
                  </TableHead>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="hidden md:table-cell">Ciudad</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="w-48">Motivo (si no entregado)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : filteredOrders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      No se encontraron pedidos
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredOrders.map(order => {
                    const state = reconciliationState.get(order.id);
                    const isDelivered = state?.delivered ?? true;

                    return (
                      <TableRow key={order.id} className={!isDelivered ? 'bg-red-50 dark:bg-red-950/20' : ''}>
                        <TableCell>
                          <Checkbox
                            checked={isDelivered}
                            onCheckedChange={(checked) => handleToggleDelivered(order.id, !!checked)}
                          />
                        </TableCell>
                        <TableCell>
                          <span className="font-mono font-bold text-sm">
                            {order.display_order_number}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium text-sm">{order.customer_name}</p>
                            <p className="text-xs text-muted-foreground">{order.customer_phone}</p>
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <span className="text-sm">{order.customer_city}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          {order.is_cod ? (
                            <span className="font-semibold text-green-600">
                              {formatCurrency(order.cod_amount)}
                            </span>
                          ) : (
                            <Badge variant="secondary">Prepago</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {!isDelivered && (
                            <Select
                              value={state?.failure_reason || ''}
                              onValueChange={(value) => handleSetFailureReason(order.id, value)}
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder="Seleccionar motivo..." />
                              </SelectTrigger>
                              <SelectContent>
                                {FAILURE_REASONS.map(reason => (
                                  <SelectItem key={reason.value} value={reason.value}>
                                    {reason.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </Card>

        {/* Amount Input */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monto Cobrado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Label htmlFor="amount">Total recibido del courier (Gs)</Label>
                <Input
                  id="amount"
                  type="number"
                  placeholder="0"
                  value={totalAmountCollected ?? ''}
                  onChange={(e) => setTotalAmountCollected(e.target.value ? Number(e.target.value) : null)}
                  className="mt-1 text-lg font-mono"
                />
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">COD esperado</p>
                <p className="text-lg font-semibold">{formatCurrency(stats.codExpected)}</p>
              </div>
            </div>

            {totalAmountCollected !== null && financialSummary?.hasDiscrepancy && (
              <div className={`p-3 rounded-lg ${financialSummary.discrepancy < 0 ? 'bg-red-50 dark:bg-red-950/20' : 'bg-green-50 dark:bg-green-950/20'}`}>
                <div className="flex items-center gap-2">
                  <AlertTriangle className={`h-4 w-4 ${financialSummary.discrepancy < 0 ? 'text-red-600' : 'text-green-600'}`} />
                  <span className="text-sm font-medium">
                    Diferencia: {financialSummary.discrepancy > 0 ? '+' : ''}{formatCurrency(financialSummary.discrepancy)}
                  </span>
                </div>
                <Textarea
                  placeholder="Notas sobre la diferencia..."
                  value={discrepancyNotes}
                  onChange={(e) => setDiscrepancyNotes(e.target.value)}
                  className="mt-2"
                  rows={2}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Financial Summary */}
        {totalAmountCollected !== null && financialSummary && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                Resumen Financiero
                <Badge variant="outline" className="text-xs font-normal">Estimado</Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Las tarifas finales se calculan con las tarifas reales por zona
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Entregados ({stats.delivered})</span>
                  <span className="text-green-600">+{formatCurrency(stats.codExpected)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Fallidos ({stats.notDelivered})</span>
                  <span className="text-muted-foreground">0 Gs</span>
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span>COD Esperado</span>
                  <span>{formatCurrency(stats.codExpected)}</span>
                </div>
                <div className="flex justify-between">
                  <span>COD Cobrado</span>
                  <span>{formatCurrency(financialSummary.codCollected)}</span>
                </div>
                {financialSummary.hasDiscrepancy && (
                  <div className={`flex justify-between ${financialSummary.discrepancy < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    <span>Diferencia</span>
                    <span>{financialSummary.discrepancy > 0 ? '+' : ''}{formatCurrency(financialSummary.discrepancy)}</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between text-muted-foreground">
                  <span>Tarifas entregas ({stats.delivered} x {formatCurrency(financialSummary.carrierFeePerDelivery)})</span>
                  <span>-{formatCurrency(financialSummary.totalCarrierFees)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Tarifas fallidos ({stats.notDelivered} x {selectedGroup?.failed_attempt_fee_percent}%)</span>
                  <span>-{formatCurrency(financialSummary.failedAttemptFees)}</span>
                </div>
                <Separator />
                <div className={`flex justify-between text-lg font-bold ${financialSummary.netReceivable >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  <span>NETO A RECIBIR</span>
                  <span>{formatCurrency(financialSummary.netReceivable)}</span>
                </div>
                <p className="text-xs text-muted-foreground text-right">
                  {financialSummary.netReceivable >= 0 ? 'El courier te debe' : 'Le debes al courier'}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={handleBack}>
            Cancelar
          </Button>
          <Button
            onClick={handleProcessReconciliation}
            disabled={!canProceed || processing}
          >
            {processing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Procesando...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Confirmar Conciliacion
              </>
            )}
          </Button>
        </div>
      </div>
    );
  };

  // Render payment step view
  const renderPayment = () => {
    if (!reconciliationResult) return null;

    const netReceivable = reconciliationResult.net_receivable;
    const isPositive = netReceivable > 0; // Courier owes us

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
            <DollarSign className="h-8 w-8 text-amber-600" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Registrar Pago</h2>
          <p className="text-muted-foreground">
            Liquidacion {reconciliationResult.settlement_code} creada exitosamente
          </p>
        </div>

        {/* Balance Summary */}
        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                {isPositive ? 'El courier te debe:' : 'Le debes al courier:'}
              </p>
              <p className={`text-4xl font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(Math.abs(netReceivable))}
              </p>
              <p className="text-xs text-muted-foreground">
                {reconciliationResult.total_delivered} entregados · {reconciliationResult.total_not_delivered} fallidos
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Payment Options */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Como se resolvio este saldo?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isPositive ? (
              // Courier owes us - payment options
              <>
                <label
                  className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                    selectedPaymentOption === 'paid_by_carrier'
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={() => setSelectedPaymentOption('paid_by_carrier')}
                >
                  <input
                    type="radio"
                    name="paymentOption"
                    checked={selectedPaymentOption === 'paid_by_carrier'}
                    onChange={() => setSelectedPaymentOption('paid_by_carrier')}
                    className="mt-1"
                  />
                  <div>
                    <p className="font-medium">El courier me pago</p>
                    <p className="text-sm text-muted-foreground">
                      Recibi el dinero en efectivo o transferencia
                    </p>
                  </div>
                </label>

                <label
                  className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                    selectedPaymentOption === 'deducted_from_cod'
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={() => setSelectedPaymentOption('deducted_from_cod')}
                >
                  <input
                    type="radio"
                    name="paymentOption"
                    checked={selectedPaymentOption === 'deducted_from_cod'}
                    onChange={() => setSelectedPaymentOption('deducted_from_cod')}
                    className="mt-1"
                  />
                  <div>
                    <p className="font-medium">Ya fue descontado del COD</p>
                    <p className="text-sm text-muted-foreground">
                      El courier me entrego el monto neto (ya descontadas las tarifas)
                    </p>
                  </div>
                </label>
              </>
            ) : (
              // We owe courier - payment options
              <>
                <label
                  className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                    selectedPaymentOption === 'paid_to_carrier'
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={() => setSelectedPaymentOption('paid_to_carrier')}
                >
                  <input
                    type="radio"
                    name="paymentOption"
                    checked={selectedPaymentOption === 'paid_to_carrier'}
                    onChange={() => setSelectedPaymentOption('paid_to_carrier')}
                    className="mt-1"
                  />
                  <div>
                    <p className="font-medium">Ya pague al courier</p>
                    <p className="text-sm text-muted-foreground">
                      Le pague las tarifas en efectivo o transferencia
                    </p>
                  </div>
                </label>

                <label
                  className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                    selectedPaymentOption === 'deducted_from_cod'
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50'
                  }`}
                  onClick={() => setSelectedPaymentOption('deducted_from_cod')}
                >
                  <input
                    type="radio"
                    name="paymentOption"
                    checked={selectedPaymentOption === 'deducted_from_cod'}
                    onChange={() => setSelectedPaymentOption('deducted_from_cod')}
                    className="mt-1"
                  />
                  <div>
                    <p className="font-medium">Se descontara del proximo COD</p>
                    <p className="text-sm text-muted-foreground">
                      El courier lo descontara de entregas futuras
                    </p>
                  </div>
                </label>
              </>
            )}

            <label
              className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                selectedPaymentOption === 'pending'
                  ? 'border-primary bg-primary/5'
                  : 'hover:bg-muted/50'
              }`}
              onClick={() => setSelectedPaymentOption('pending')}
            >
              <input
                type="radio"
                name="paymentOption"
                checked={selectedPaymentOption === 'pending'}
                onChange={() => setSelectedPaymentOption('pending')}
                className="mt-1"
              />
              <div>
                <p className="font-medium">Pendiente de pago</p>
                <p className="text-sm text-muted-foreground">
                  Registrar el pago mas tarde desde la seccion de Cuentas
                </p>
              </div>
            </label>

            {/* Reference input for paid options */}
            {selectedPaymentOption && selectedPaymentOption !== 'pending' && (
              <div className="pt-3 space-y-2">
                <Label htmlFor="paymentRef">Referencia (opcional)</Label>
                <Input
                  id="paymentRef"
                  placeholder="Numero de transferencia, recibo, etc."
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => {
              setSelectedPaymentOption('pending');
              handleRegisterPayment();
            }}
            disabled={paymentProcessing}
          >
            Omitir por ahora
          </Button>
          <Button
            onClick={handleRegisterPayment}
            disabled={!selectedPaymentOption || paymentProcessing}
          >
            {paymentProcessing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Registrando...
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {selectedPaymentOption === 'pending' ? 'Finalizar' : 'Registrar Pago'}
              </>
            )}
          </Button>
        </div>
      </div>
    );
  };

  // Render complete view
  const renderComplete = () => (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
        <CheckCircle2 className="h-8 w-8 text-green-600" />
      </div>
      <h2 className="text-xl font-semibold mb-2">Conciliacion Completada</h2>
      <p className="text-muted-foreground text-center max-w-md mb-6">
        {reconciliationResult?.settlement_code
          ? `Liquidacion ${reconciliationResult.settlement_code} procesada.`
          : 'La liquidacion ha sido creada exitosamente.'
        }
        {' '}Puedes ver el detalle en la seccion de Cuentas.
      </p>
      <Button onClick={handleBack}>
        Volver al Inicio
      </Button>
    </div>
  );

  // Main render
  return (
    <div className="space-y-6">
      {currentStep === 'selection' && renderSelection()}
      {currentStep === 'reconciliation' && renderReconciliation()}
      {currentStep === 'payment' && renderPayment()}
      {currentStep === 'complete' && renderComplete()}
    </div>
  );
}
