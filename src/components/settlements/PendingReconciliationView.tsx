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

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
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
  Save,
  Trash2,
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
  prepaid_method: string | null;
  is_cod: boolean;
  delivered_at: string;
  carrier_fee: number;
  fee_source: 'coverage' | 'zone' | 'default';
  normalized_city: string;
}

/** Get display label for prepaid method */
function getPrepaidMethodLabel(paymentMethod: string, prepaidMethod: string | null): string {
  // If COD was marked as prepaid, use prepaid_method
  if (prepaidMethod) {
    const method = prepaidMethod.toLowerCase().trim();
    if (method === 'transfer' || method === 'transferencia') return 'Transferencia';
    if (method === 'qr') return 'QR';
    if (method === 'card' || method === 'tarjeta') return 'Tarjeta';
    return prepaidMethod.charAt(0).toUpperCase() + prepaidMethod.slice(1);
  }
  // Otherwise use payment_method
  const normalized = (paymentMethod || '').toLowerCase().trim();
  if (normalized === 'transferencia' || normalized === 'transfer') return 'Transferencia';
  if (normalized === 'qr') return 'QR';
  if (normalized === 'tarjeta' || normalized === 'card') return 'Tarjeta';
  if (normalized === 'online') return 'Online';
  if (normalized === 'paypal') return 'PayPal';
  if (normalized === 'stripe') return 'Stripe';
  if (normalized === 'mercadopago') return 'MercadoPago';
  return 'Prepago';
}

interface OrderReconciliation {
  delivered: boolean;
  failure_reason?: string;
  override_prepaid?: boolean; // Override COD to prepaid during reconciliation
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

// Draft persistence utilities (24h expiry)
const DRAFT_PREFIX = 'ordefy_reconciliation_draft_';
const DRAFT_EXPIRY_MS = 24 * 60 * 60 * 1000;

interface ReconciliationDraft {
  reconciliationState: Record<string, OrderReconciliation>;
  totalAmountCollected: number | null;
  discrepancyNotes: string;
  savedAt: number;
}

function getDraftKey(date: string, carrierId: string) {
  const storeId = localStorage.getItem('current_store_id') || 'default';
  return `${DRAFT_PREFIX}${storeId}_${date}_${carrierId}`;
}

function saveDraft(date: string, carrierId: string, draft: ReconciliationDraft) {
  try {
    localStorage.setItem(getDraftKey(date, carrierId), JSON.stringify(draft));
  } catch { /* quota exceeded - ignore */ }
}

function loadDraft(date: string, carrierId: string): ReconciliationDraft | null {
  try {
    const raw = localStorage.getItem(getDraftKey(date, carrierId));
    if (!raw) return null;
    const draft: ReconciliationDraft = JSON.parse(raw);
    if (Date.now() - draft.savedAt > DRAFT_EXPIRY_MS) {
      localStorage.removeItem(getDraftKey(date, carrierId));
      return null;
    }
    return draft;
  } catch { return null; }
}

function clearDraft(date: string, carrierId: string) {
  localStorage.removeItem(getDraftKey(date, carrierId));
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

  // Abort controller for cancelling stale order fetches on group switch
  const loadOrdersAbortRef = useRef<AbortController | null>(null);

  // Draft state
  const [hasDraft, setHasDraft] = useState(false);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    // Cancel any in-flight request to prevent stale data from overwriting current state
    if (loadOrdersAbortRef.current) {
      loadOrdersAbortRef.current.abort();
    }
    const abortController = new AbortController();
    loadOrdersAbortRef.current = abortController;

    setLoading(true);
    try {
      const response = await fetch(
        `${API_BASE}/api/settlements/pending-reconciliation/${deliveryDate}/${carrierId}`,
        { headers: getAuthHeaders(), signal: abortController.signal }
      );

      if (!response.ok) {
        throw new Error('Error al cargar los pedidos');
      }

      // If this request was aborted while awaiting json(), bail out
      if (abortController.signal.aborted) return;

      const result = await response.json();
      const ordersData = result.data || [];
      setOrders(ordersData);

      // Initialize reconciliation state - all delivered by default
      const initialState = new Map<string, OrderReconciliation>();
      ordersData.forEach((order: PendingOrder) => {
        initialState.set(order.id, { delivered: true });
      });

      // Restore draft if available
      const draft = loadDraft(deliveryDate, carrierId);
      if (draft) {
        const restoredState = new Map<string, OrderReconciliation>();
        Object.entries(draft.reconciliationState).forEach(([k, v]) => {
          if (initialState.has(k)) restoredState.set(k, v);
        });
        // Only restore if we matched at least some orders
        if (restoredState.size > 0) {
          // Fill any new orders not in draft with defaults
          initialState.forEach((v, k) => { if (!restoredState.has(k)) restoredState.set(k, v); });
          setReconciliationState(restoredState);
          setTotalAmountCollected(draft.totalAmountCollected);
          setDiscrepancyNotes(draft.discrepancyNotes);
          setHasDraft(true);
        } else {
          setReconciliationState(initialState);
        }
      } else {
        setReconciliationState(initialState);
      }
    } catch (error: any) {
      // Don't show error toast for aborted requests (user switched groups)
      if (error.name === 'AbortError') return;
      logger.error('[PendingReconciliation] Error loading orders:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar los pedidos',
        variant: 'destructive',
      });
    } finally {
      // Only clear loading if this is still the active request
      if (!abortController.signal.aborted) {
        setLoading(false);
      }
    }
  }, [toast]);

  // Initial load
  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  // Auto-save draft (debounced 500ms)
  useEffect(() => {
    if (!selectedGroup || currentStep !== 'reconciliation' || orders.length === 0) return;

    // Skip saving if all values are defaults (no user changes)
    const hasCustomState = Array.from(reconciliationState.values()).some(
      s => !s.delivered || s.failure_reason || s.override_prepaid
    );
    const hasAmount = totalAmountCollected !== null;
    const hasNotes = discrepancyNotes.length > 0;
    if (!hasCustomState && !hasAmount && !hasNotes) return;

    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      const stateObj: Record<string, OrderReconciliation> = {};
      reconciliationState.forEach((v, k) => { stateObj[k] = v; });
      saveDraft(selectedGroup.delivery_date, selectedGroup.carrier_id, {
        reconciliationState: stateObj,
        totalAmountCollected,
        discrepancyNotes,
        savedAt: Date.now(),
      });
      setHasDraft(true);
    }, 500);

    return () => { if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current); };
  }, [reconciliationState, totalAmountCollected, discrepancyNotes, selectedGroup, currentStep, orders.length]);

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
    let prepaidCount = 0;
    let prepaidValue = 0;
    let missingReasons = 0;
    let deliveredCarrierFees = 0;
    let notDeliveredCarrierFees = 0;

    orders.forEach(order => {
      const state = reconciliationState.get(order.id);
      const isDelivered = state?.delivered ?? true;
      const fee = order.carrier_fee || 0;
      // Allow user to override COD to prepaid during reconciliation
      const effectiveIsCod = state?.override_prepaid ? false : order.is_cod;

      if (isDelivered) {
        delivered++;
        deliveredCarrierFees += fee;
        if (effectiveIsCod) {
          codExpected += order.cod_amount;
        } else {
          prepaidCount++;
          prepaidValue += order.total_price || 0;
        }
      } else {
        notDelivered++;
        notDeliveredCarrierFees += fee;
        if (!state?.failure_reason) {
          missingReasons++;
        }
      }
    });

    return { delivered, notDelivered, codExpected, prepaidCount, prepaidValue, missingReasons, total: orders.length, deliveredCarrierFees, notDeliveredCarrierFees };
  }, [orders, reconciliationState]);

  // Calculate financial summary using real per-order carrier fees from backend
  const financialSummary = useMemo(() => {
    if (!selectedGroup) return null;

    const failedFeePercent = (selectedGroup.failed_attempt_fee_percent ?? 50) / 100;

    const totalCarrierFees = stats.deliveredCarrierFees;
    const failedAttemptFees = stats.notDeliveredCarrierFees * failedFeePercent;
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
          // Override: if user marked COD order as "Ya pagó", treat as prepaid for calculation
          override_prepaid: state?.override_prepaid ?? false,
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

      // Show warnings if any (non-blocking issues like failed carrier movement creation)
      if (result.warnings?.length > 0) {
        toast({
          title: 'Advertencia',
          description: result.warnings.join(' '),
        });
      }

      // Clear draft on successful reconciliation
      if (selectedGroup) {
        clearDraft(selectedGroup.delivery_date, selectedGroup.carrier_id);
        setHasDraft(false);
      }

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

    // If pending, settlement already exists in DB with status 'pending' — no API call needed
    if (selectedPaymentOption === 'pending') {
      toast({
        title: 'Liquidacion guardada',
        description: `${reconciliationResult.settlement_code} creada exitosamente. Registra el pago desde la pestana "Pagos" cuando se concrete.`,
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

  // Discard the current draft
  const handleDiscardDraft = () => {
    if (!selectedGroup) return;
    clearDraft(selectedGroup.delivery_date, selectedGroup.carrier_id);
    setHasDraft(false);
    // Reset reconciliation to defaults
    const initialState = new Map<string, OrderReconciliation>();
    orders.forEach(order => { initialState.set(order.id, { delivered: true }); });
    setReconciliationState(initialState);
    setTotalAmountCollected(null);
    setDiscrepancyNotes('');
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
      setHasDraft(false);
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
      setHasDraft(false);
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
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold">
                {selectedGroup.carrier_name} - {format(parseISO(selectedGroup.delivery_date), "d 'de' MMMM", { locale: es })}
              </h2>
              {hasDraft && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Save className="h-3 w-3" /> Borrador
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {orders.length} pedidos entregados
            </p>
          </div>
          {hasDraft && (
            <Button variant="ghost" size="sm" className="text-muted-foreground gap-1" onClick={handleDiscardDraft}>
              <Trash2 className="h-3.5 w-3.5" /> Descartar
            </Button>
          )}
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
            <span className="text-sm font-medium">
              {stats.codExpected > 0 && stats.prepaidCount > 0
                ? `COD: ${formatCurrency(stats.codExpected)} · ${stats.prepaidCount} prepago`
                : stats.codExpected > 0
                  ? `COD: ${formatCurrency(stats.codExpected)}`
                  : stats.prepaidCount > 0
                    ? `${stats.prepaidCount} prepago`
                    : 'Sin monto a cobrar'
              }
            </span>
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
                  <TableHead className="text-right hidden sm:table-cell">Tarifa</TableHead>
                  <TableHead className="w-48">Motivo (si no entregado)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : filteredOrders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
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
                            <div className="flex items-center justify-end gap-2">
                              <span className={`font-semibold ${state?.override_prepaid ? 'line-through text-muted-foreground' : 'text-green-600'}`}>
                                {formatCurrency(order.cod_amount)}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setReconciliationState(prev => {
                                    const newState = new Map(prev);
                                    const current = newState.get(order.id) || { delivered: true };
                                    newState.set(order.id, { ...current, override_prepaid: !current.override_prepaid });
                                    return newState;
                                  });
                                }}
                                className={`text-xs px-2 py-0.5 rounded border ${
                                  state?.override_prepaid
                                    ? 'bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-950 dark:border-blue-700 dark:text-blue-300'
                                    : 'bg-muted/50 border-border text-muted-foreground hover:bg-muted'
                                }`}
                                title={state?.override_prepaid ? 'Click para marcar como COD' : 'Click si el cliente ya pagó por transferencia/QR'}
                              >
                                {state?.override_prepaid ? '✓ Pagó' : 'Ya pagó?'}
                              </button>
                            </div>
                          ) : (
                            <Badge variant="secondary" className="font-medium">
                              {getPrepaidMethodLabel(order.payment_method, order.prepaid_method)}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right hidden sm:table-cell">
                          <span className="text-sm font-mono text-muted-foreground" title={`Ciudad normalizada: "${order.normalized_city}" | Fuente: ${order.fee_source}`}>
                            {formatCurrency(order.carrier_fee)}
                          </span>
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
                  onWheel={(e) => (e.target as HTMLInputElement).blur()}
                  className="mt-1 text-lg font-mono"
                />
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">
                  {stats.codExpected > 0 ? 'COD esperado' : 'Todo prepago'}
                </p>
                <p className="text-lg font-semibold">{formatCurrency(stats.codExpected)}</p>
                {stats.codExpected > 0 && totalAmountCollected !== stats.codExpected && (
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                    onClick={() => setTotalAmountCollected(stats.codExpected)}
                  >
                    Usar monto esperado
                  </Button>
                )}
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
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2 text-sm">
                {/* Delivery counts */}
                <div className="flex justify-between">
                  <span>Entregados ({stats.delivered})</span>
                  {stats.codExpected > 0 && stats.prepaidCount > 0 ? (
                    <span className="text-green-600">+{formatCurrency(stats.codExpected)} COD</span>
                  ) : stats.codExpected > 0 ? (
                    <span className="text-green-600">+{formatCurrency(stats.codExpected)}</span>
                  ) : (
                    <span className="text-muted-foreground">{stats.prepaidCount} prepago</span>
                  )}
                </div>
                {stats.notDelivered > 0 && (
                  <div className="flex justify-between">
                    <span>Fallidos ({stats.notDelivered})</span>
                    <span className="text-muted-foreground">0 Gs</span>
                  </div>
                )}
                <Separator />

                {/* COD section - only when there are COD orders */}
                {stats.codExpected > 0 && (
                  <>
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
                  </>
                )}

                {/* Prepaid info - only when there are prepaid orders */}
                {stats.prepaidCount > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Prepago ({stats.prepaidCount} pedidos)</span>
                    <span>{formatCurrency(stats.prepaidValue)}</span>
                  </div>
                )}

                {/* Carrier fees */}
                <div className="flex justify-between text-muted-foreground">
                  <span>Tarifas entregas ({stats.delivered} pedidos)</span>
                  <span>-{formatCurrency(financialSummary.totalCarrierFees)}</span>
                </div>
                {stats.notDelivered > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Tarifas fallidos ({stats.notDelivered} x {selectedGroup?.failed_attempt_fee_percent}%)</span>
                    <span>-{formatCurrency(financialSummary.failedAttemptFees)}</span>
                  </div>
                )}

                {/* Net receivable */}
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
