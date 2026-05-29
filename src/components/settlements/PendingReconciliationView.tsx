/**
 * PendingReconciliationView - Carrier-Based Reconciliation (Migration 182)
 *
 * Replaces the legacy by-(delivery_date, carrier) grouping. In practice the
 * courier rinde the WHOLE pending backlog when they come by, not one day at
 * a time. Fecha de entrega becomes per-row metadata, not a grouping axis.
 *
 * Flow:
 *   1. Selection: one card per carrier with non-zero backlog. Sorted by
 *      urgency (days_oldest desc). Click a card -> reconciliation step.
 *   2. Reconciliation: ALL pending orders for that carrier in one table,
 *      with `Fecha entrega` as a sortable column (default ASC, oldest first).
 *   3. Confirm: financial summary shows the date range the settlement covers.
 *   4. Payment: register cash flow (unchanged vs legacy).
 *   5. Complete: success state mentions the LIQ code AND the covered range.
 *
 * Robustness preserved from legacy: AbortController on `loadOrders`, draft
 * persistence with 24h TTL, optimistic-free server-of-truth posting.
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
  Download,
  Calendar,
  Clock,
  ArrowUpDown,
  HelpCircle,
  Wallet,
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { logger } from '@/utils/logger';
import { formatCurrency } from '@/utils/currency';
import { generateReconciliationPDF } from './ReconciliationPDF';
import { ExtraChargesEditor, type ExtraCharge } from './ExtraChargesEditor';
import { getActiveStoreId } from '@/lib/activeStore';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const getAuthHeaders = () => ({
  'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
  'X-Store-ID': getActiveStoreId() || '',
  'Content-Type': 'application/json',
});

// ============================================================
// Types
// ============================================================

interface CarrierReconciliationGroup {
  store_id: string;
  carrier_id: string;
  carrier_name: string;
  failed_attempt_fee_percent: number;
  total_orders: number;
  total_cod: number;
  total_prepaid: number;
  oldest_delivery_date: string;
  newest_delivery_date: string;
  days_oldest: number;
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
  fee_source: 'coverage' | 'coverage_zone' | 'zone' | 'default';
  normalized_city: string;
}

/** Friendly label for the prepaid payment method (or 'Prepago' fallback). */
function getPrepaidMethodLabel(paymentMethod: string, prepaidMethod: string | null): string {
  if (prepaidMethod) {
    const m = prepaidMethod.toLowerCase().trim();
    if (m === 'transfer' || m === 'transferencia') return 'Transferencia';
    if (m === 'qr') return 'QR';
    if (m === 'card' || m === 'tarjeta') return 'Tarjeta';
    return prepaidMethod.charAt(0).toUpperCase() + prepaidMethod.slice(1);
  }
  const n = (paymentMethod || '').toLowerCase().trim();
  if (n === 'transferencia' || n === 'transfer') return 'Transferencia';
  if (n === 'qr') return 'QR';
  if (n === 'tarjeta' || n === 'card') return 'Tarjeta';
  if (n === 'online') return 'Online';
  if (n === 'paypal') return 'PayPal';
  if (n === 'stripe') return 'Stripe';
  if (n === 'mercadopago') return 'MercadoPago';
  return 'Prepago';
}

interface OrderReconciliation {
  delivered: boolean;
  failure_reason?: string;
  override_prepaid?: boolean;
}

type WorkflowStep = 'selection' | 'reconciliation' | 'confirm' | 'payment' | 'complete';
type PaymentOption = 'paid_by_carrier' | 'paid_to_carrier' | 'deducted_from_cod' | 'pending';

interface ReconciliationResult {
  settlement_id: string;
  settlement_code: string;
  settlement_date: string;
  min_delivery_date: string;
  max_delivery_date: string;
  total_orders: number;
  total_delivered: number;
  total_not_delivered: number;
  total_cod_expected: number;
  total_cod_collected: number;
  /** Includes extras (Migration 184). */
  total_carrier_fees: number;
  /** Migration 184. Already counted inside total_carrier_fees. */
  total_extra_charges?: number;
  failed_attempt_fee: number;
  net_receivable: number;
}

// ============================================================
// Draft persistence (24h TTL, key scoped by store + carrier)
// ============================================================

const DRAFT_PREFIX = 'ordefy_reconciliation_draft_';
const DRAFT_EXPIRY_MS = 24 * 60 * 60 * 1000;

interface ReconciliationDraft {
  reconciliationState: Record<string, OrderReconciliation>;
  totalAmountCollected: number | null;
  discrepancyNotes: string;
  /** Manual flete lines (Migration 184). Optional for back-compat with older drafts. */
  extraCharges?: ExtraCharge[];
  savedAt: number;
}

function getDraftKey(carrierId: string) {
  // Key is now scoped to (storeId, carrierId). Legacy keys with a date
  // segment will simply expire on their own 24h TTL.
  const storeId = getActiveStoreId() || 'default';
  return `${DRAFT_PREFIX}${storeId}_${carrierId}`;
}

function saveDraft(carrierId: string, draft: ReconciliationDraft) {
  try {
    localStorage.setItem(getDraftKey(carrierId), JSON.stringify(draft));
  } catch { /* quota exceeded - ignore */ }
}

function loadDraft(carrierId: string): ReconciliationDraft | null {
  try {
    const raw = localStorage.getItem(getDraftKey(carrierId));
    if (!raw) return null;
    const draft: ReconciliationDraft = JSON.parse(raw);
    if (Date.now() - draft.savedAt > DRAFT_EXPIRY_MS) {
      localStorage.removeItem(getDraftKey(carrierId));
      return null;
    }
    return draft;
  } catch { return null; }
}

function clearDraft(carrierId: string) {
  localStorage.removeItem(getDraftKey(carrierId));
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

// ============================================================
// Date helpers (locale-aware, defensive against bad ISO strings)
// ============================================================

function fmtDayMonth(iso: string): string {
  try {
    return format(parseISO(iso), 'd MMM', { locale: es });
  } catch {
    return iso;
  }
}

function fmtFullDate(iso: string): string {
  try {
    return format(parseISO(iso), "d 'de' MMMM yyyy", { locale: es });
  } catch {
    return iso;
  }
}

function fmtDateOnly(iso: string): string {
  try {
    return format(parseISO(iso), 'dd/MM', { locale: es });
  } catch {
    return iso;
  }
}

/** Pick the badge tone for age-since-oldest. */
function ageBadgeVariant(days: number): {
  variant: 'secondary' | 'default' | 'destructive';
  className: string;
} {
  if (days > 7) {
    return {
      variant: 'destructive',
      className: '',
    };
  }
  if (days >= 3) {
    return {
      variant: 'default',
      className: 'bg-amber-500 hover:bg-amber-600 text-white border-transparent',
    };
  }
  return {
    variant: 'secondary',
    className: '',
  };
}

// ============================================================
// Component
// ============================================================

export function PendingReconciliationView() {
  const { toast } = useToast();

  // Steps + data
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [groups, setGroups] = useState<CarrierReconciliationGroup[]>([]);
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('selection');
  const [selectedGroup, setSelectedGroup] = useState<CarrierReconciliationGroup | null>(null);
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortDeliveredAtAsc, setSortDeliveredAtAsc] = useState(true);

  // Reconciliation state
  const [reconciliationState, setReconciliationState] = useState<Map<string, OrderReconciliation>>(
    new Map()
  );
  const [totalAmountCollected, setTotalAmountCollected] = useState<number | null>(null);
  const [discrepancyNotes, setDiscrepancyNotes] = useState('');

  // Manual extra flete lines (Migration 184). Relay handoffs to other
  // couriers, operational charges that are not system orders.
  const [extraCharges, setExtraCharges] = useState<ExtraCharge[]>([]);

  // Cancel stale order fetches on group switch
  const loadOrdersAbortRef = useRef<AbortController | null>(null);

  // Draft state
  const [hasDraft, setHasDraft] = useState(false);
  const draftSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Payment step state
  const [reconciliationResult, setReconciliationResult] = useState<ReconciliationResult | null>(null);
  const [selectedPaymentOption, setSelectedPaymentOption] = useState<PaymentOption | null>(null);
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentProcessing, setPaymentProcessing] = useState(false);

  // ----------------------------------------------------------
  // Fetchers
  // ----------------------------------------------------------

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `${API_BASE}/api/settlements/pending-reconciliation-by-carrier`,
        { headers: getAuthHeaders() }
      );
      if (!response.ok) {
        throw new Error('Error al cargar las conciliaciones pendientes');
      }
      const result = await response.json();
      setGroups((result.data || []) as CarrierReconciliationGroup[]);
    } catch (error) {
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

  const loadOrders = useCallback(
    async (carrierId: string) => {
      // Cancel any in-flight request to prevent stale data from overwriting state.
      if (loadOrdersAbortRef.current) {
        loadOrdersAbortRef.current.abort();
      }
      const abortController = new AbortController();
      loadOrdersAbortRef.current = abortController;

      setLoading(true);
      try {
        const response = await fetch(
          `${API_BASE}/api/settlements/pending-reconciliation-by-carrier/${carrierId}`,
          { headers: getAuthHeaders(), signal: abortController.signal }
        );
        if (!response.ok) {
          throw new Error('Error al cargar los pedidos');
        }
        if (abortController.signal.aborted) return;

        const result = await response.json();
        const ordersData = (result.data || []) as PendingOrder[];
        setOrders(ordersData);

        // Initialize reconciliation state: all delivered by default.
        const initialState = new Map<string, OrderReconciliation>();
        ordersData.forEach(order => {
          initialState.set(order.id, { delivered: true });
        });

        // Restore draft if compatible.
        const draft = loadDraft(carrierId);
        if (draft) {
          const restoredState = new Map<string, OrderReconciliation>();
          Object.entries(draft.reconciliationState).forEach(([k, v]) => {
            if (initialState.has(k)) restoredState.set(k, v);
          });
          // Extras + amount + notes always restore if the draft has any
          // material content, even when reconciliationState had no overrides.
          const draftExtras = Array.isArray(draft.extraCharges) ? draft.extraCharges : [];
          const hasMaterialDraft =
            restoredState.size > 0 ||
            draft.totalAmountCollected !== null ||
            (draft.discrepancyNotes && draft.discrepancyNotes.length > 0) ||
            draftExtras.length > 0;

          if (hasMaterialDraft) {
            initialState.forEach((v, k) => {
              if (!restoredState.has(k)) restoredState.set(k, v);
            });
            setReconciliationState(restoredState);
            setTotalAmountCollected(draft.totalAmountCollected);
            setDiscrepancyNotes(draft.discrepancyNotes);
            setExtraCharges(draftExtras);
            setHasDraft(true);
          } else {
            setReconciliationState(initialState);
            setExtraCharges([]);
          }
        } else {
          setReconciliationState(initialState);
          setExtraCharges([]);
        }
      } catch (error: unknown) {
        const e = error as { name?: string };
        if (e?.name === 'AbortError') return;
        logger.error('[PendingReconciliation] Error loading orders:', error);
        toast({
          title: 'Error',
          description: 'No se pudieron cargar los pedidos',
          variant: 'destructive',
        });
      } finally {
        if (!abortController.signal.aborted) setLoading(false);
      }
    },
    [toast]
  );

  // Initial load
  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  // Auto-save draft (debounced 500ms)
  useEffect(() => {
    if (!selectedGroup || currentStep !== 'reconciliation' || orders.length === 0) return;

    const hasCustomState = Array.from(reconciliationState.values()).some(
      s => !s.delivered || s.failure_reason || s.override_prepaid
    );
    const hasAmount = totalAmountCollected !== null;
    const hasNotes = discrepancyNotes.length > 0;
    const hasExtras = extraCharges.length > 0;
    if (!hasCustomState && !hasAmount && !hasNotes && !hasExtras) return;

    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      const stateObj: Record<string, OrderReconciliation> = {};
      reconciliationState.forEach((v, k) => {
        stateObj[k] = v;
      });
      saveDraft(selectedGroup.carrier_id, {
        reconciliationState: stateObj,
        totalAmountCollected,
        discrepancyNotes,
        extraCharges,
        savedAt: Date.now(),
      });
      setHasDraft(true);
    }, 500);

    return () => {
      if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    };
  }, [reconciliationState, totalAmountCollected, discrepancyNotes, extraCharges, selectedGroup, currentStep, orders.length]);

  // ----------------------------------------------------------
  // Derived state
  // ----------------------------------------------------------

  // Filtered + sorted orders for the reconciliation table.
  const visibleOrders = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    const base = term
      ? orders.filter(o =>
          o.display_order_number.toLowerCase().includes(term) ||
          o.customer_name.toLowerCase().includes(term) ||
          o.customer_phone.includes(term)
        )
      : orders;

    const sorted = [...base].sort((a, b) => {
      const da = a.delivered_at ? new Date(a.delivered_at).getTime() : 0;
      const db = b.delivered_at ? new Date(b.delivered_at).getTime() : 0;
      return sortDeliveredAtAsc ? da - db : db - da;
    });
    return sorted;
  }, [orders, searchTerm, sortDeliveredAtAsc]);

  // Aggregate stats from reconciliation state.
  const stats = useMemo(() => {
    let delivered = 0;
    let notDelivered = 0;
    let excluded = 0;
    let codExpected = 0;
    let prepaidCount = 0;
    let prepaidValue = 0;
    let deliveredCarrierFees = 0;
    let notDeliveredCarrierFees = 0;

    orders.forEach(order => {
      const state = reconciliationState.get(order.id);
      const isDelivered = state?.delivered ?? true;
      const hasFailureReason = !!state?.failure_reason;
      const fee = order.carrier_fee || 0;
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
      } else if (hasFailureReason) {
        notDelivered++;
        notDeliveredCarrierFees += fee;
      } else {
        // Unchecked without failure reason = excluded from this cycle.
        // Stays pending for the next reconciliation. NOT counted as failed.
        excluded++;
      }
    });

    return {
      delivered,
      notDelivered,
      excluded,
      codExpected,
      prepaidCount,
      prepaidValue,
      missingReasons: 0,
      total: orders.length,
      deliveredCarrierFees,
      notDeliveredCarrierFees,
    };
  }, [orders, reconciliationState]);

  // Sum of manual extra flete lines (Migration 184). Coerced through Number
  // to defend against partially-typed amounts coming from controlled inputs.
  const extraChargesTotal = useMemo(
    () =>
      extraCharges.reduce(
        (sum, c) => sum + (Number.isFinite(c.amount) && c.amount > 0 ? c.amount : 0),
        0
      ),
    [extraCharges]
  );

  // Financial summary
  const financialSummary = useMemo(() => {
    if (!selectedGroup) return null;
    const failedFeePercent = (selectedGroup.failed_attempt_fee_percent ?? 50) / 100;
    const orderCarrierFees = stats.deliveredCarrierFees;
    const failedAttemptFees = stats.notDeliveredCarrierFees * failedFeePercent;
    // total_carrier_fees on the settlement row INCLUDES extras. Keep this
    // memo consistent with that contract so the preview matches what gets
    // persisted on the server.
    const totalCarrierFees = orderCarrierFees + extraChargesTotal;
    const codCollected = totalAmountCollected || 0;
    // expectedNet is what the courier SHOULD hand over after netting flete.
    // If the courier collected COD in full and pays you flete separately,
    // codCollected == codExpected and you owe the courier totalCarrierFees;
    // either way the math closes on the same expectedNet.
    const expectedNet = stats.codExpected - totalCarrierFees - failedAttemptFees;
    // gap > 0 = courier brought more than expected (overcollected).
    // gap < 0 = courier brought less; missing money.
    // gap ~ 0 = closed clean (typical when admin uses the "neto" preset).
    const gap = codCollected - expectedNet;
    const isClosed = Math.abs(gap) <= 0.01;
    return {
      orderCarrierFees,
      extraChargesTotal,
      totalCarrierFees,
      failedAttemptFees,
      codCollected,
      expectedNet,
      gap,
      isClosed,
      // legacy fields kept for any external read (PDF, summary, etc).
      netReceivable: -gap,
      discrepancy: codCollected - stats.codExpected,
      hasDiscrepancy: Math.abs(codCollected - stats.codExpected) > 0.01,
    };
  }, [selectedGroup, stats, totalAmountCollected, extraChargesTotal]);

  // The covered date range as a human string ("4/5 -> 9/5"). Falls back to
  // a single date when the range collapses to one day.
  const coveredRangeLabel = useMemo(() => {
    if (!selectedGroup) return '';
    const oldest = selectedGroup.oldest_delivery_date;
    const newest = selectedGroup.newest_delivery_date;
    if (!oldest || !newest) return '';
    if (oldest === newest) return fmtFullDate(oldest);
    return `${fmtFullDate(oldest)} a ${fmtFullDate(newest)}`;
  }, [selectedGroup]);

  // ----------------------------------------------------------
  // Handlers
  // ----------------------------------------------------------

  const handleSelectGroup = (group: CarrierReconciliationGroup) => {
    setSelectedGroup(group);
    setCurrentStep('reconciliation');
    setSortDeliveredAtAsc(true);
    void loadOrders(group.carrier_id);
  };

  const handleToggleDelivered = (orderId: string, delivered: boolean) => {
    setReconciliationState(prev => {
      const next = new Map(prev);
      const cur = next.get(orderId) || { delivered: true };
      next.set(orderId, { ...cur, delivered });
      return next;
    });
  };

  const handleSetFailureReason = (orderId: string, reason: string) => {
    setReconciliationState(prev => {
      const next = new Map(prev);
      const cur = next.get(orderId) || { delivered: false };
      next.set(orderId, { ...cur, failure_reason: reason });
      return next;
    });
  };

  const handleToggleAll = (delivered: boolean) => {
    setReconciliationState(prev => {
      const next = new Map(prev);
      orders.forEach(order => {
        const cur = next.get(order.id) || { delivered: true };
        next.set(order.id, { ...cur, delivered });
      });
      return next;
    });
  };

  const handleProcessReconciliation = async () => {
    if (!selectedGroup || totalAmountCollected === null) return;
    setProcessing(true);
    try {
      // Filter excluded rows out of the payload. The new checkbox semantic is:
      // - checked (default)             -> entra al cierre como entregada
      // - unchecked + failure_reason    -> entra al cierre como fallida (fee)
      // - unchecked + sin failure_reason -> EXCLUIR del cierre (queda pending)
      // Excluded orders keep reconciled_at NULL and reappear on the next cycle.
      const ordersData = orders
        .filter(order => {
          const s = reconciliationState.get(order.id);
          const isDelivered = s?.delivered ?? true;
          const hasFailureReason = !!s?.failure_reason;
          return isDelivered || hasFailureReason;
        })
        .map(order => {
          const s = reconciliationState.get(order.id);
          return {
            order_id: order.id,
            delivered: s?.delivered ?? true,
            failure_reason: s?.failure_reason,
            override_prepaid: s?.override_prepaid ?? false,
          };
        });

      // Strip client-only ids; backend only needs {description, amount} and
      // re-validates+sanitizes anyway.
      const extrasPayload = extraCharges
        .filter(c => c.description.trim().length > 0 && c.amount > 0)
        .map(c => ({ description: c.description.trim(), amount: c.amount }));

      const response = await fetch(`${API_BASE}/api/settlements/reconcile-by-carrier`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          carrier_id: selectedGroup.carrier_id,
          orders: ordersData,
          total_amount_collected: totalAmountCollected,
          discrepancy_notes: discrepancyNotes || null,
          extra_charges: extrasPayload.length > 0 ? extrasPayload : undefined,
        }),
      });

      if (!response.ok) {
        let errorMessage = 'Error al procesar la conciliacion';
        try {
          const err = await response.json();
          errorMessage = err.error || errorMessage;
        } catch {
          if (response.status === 401) errorMessage = 'Sesion expirada. Recarga la pagina.';
          else if (response.status === 500) errorMessage = 'Error del servidor. Intenta nuevamente.';
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();

      if (result.warnings?.length > 0) {
        toast({
          title: 'Advertencia',
          description: (result.warnings as string[]).join(' '),
        });
      }

      clearDraft(selectedGroup.carrier_id);
      setHasDraft(false);

      const data = result.data as ReconciliationResult;
      setReconciliationResult(data);

      // Toast with the covered range so the user sees what got included.
      const rangeStr =
        data.min_delivery_date === data.max_delivery_date
          ? fmtFullDate(data.min_delivery_date)
          : `${fmtDateOnly(data.min_delivery_date)} a ${fmtDateOnly(data.max_delivery_date)}`;

      const extrasCount = extrasPayload.length;
      const extrasSum = extrasPayload.reduce((s, e) => s + e.amount, 0);
      const extrasSuffix = extrasCount > 0
        ? ` · ${extrasCount} ${extrasCount === 1 ? 'envío extra' : 'envíos extra'} (${formatCurrency(extrasSum)})`
        : '';

      if (Math.abs(data.net_receivable) < 1) {
        toast({
          title: 'Conciliacion completada',
          description: `${data.settlement_code} creada. Cubre ${rangeStr}. Balance en cero.${extrasSuffix}`,
        });
        setCurrentStep('complete');
      } else {
        toast({
          title: 'Conciliacion lista',
          description: `${data.settlement_code} cubre ${rangeStr}. ${data.total_delivered} entregados, ${data.total_not_delivered} fallidos.${extrasSuffix}`,
        });
        setCurrentStep('payment');
      }
    } catch (error: unknown) {
      const e = error as { message?: string };
      logger.error('[PendingReconciliation] Error processing:', error);
      toast({
        title: 'Error',
        description: e?.message || 'No se pudo procesar la conciliacion',
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleRegisterPayment = async () => {
    if (!reconciliationResult || !selectedPaymentOption) return;

    if (selectedPaymentOption === 'pending') {
      toast({
        title: 'Liquidacion guardada',
        description: `${reconciliationResult.settlement_code} creada. Registra el pago desde "Pagos" cuando se concrete.`,
      });
      setCurrentStep('complete');
      return;
    }

    setPaymentProcessing(true);
    try {
      const netReceivable = reconciliationResult.net_receivable;
      const amount = Math.abs(netReceivable);

      let direction: 'from_carrier' | 'to_carrier';
      let method: string;

      if (selectedPaymentOption === 'paid_by_carrier') {
        direction = 'from_carrier';
        method = 'cash';
      } else if (selectedPaymentOption === 'paid_to_carrier') {
        direction = 'to_carrier';
        method = 'bank_transfer';
      } else {
        // deducted_from_cod
        direction = netReceivable > 0 ? 'from_carrier' : 'to_carrier';
        method = 'deduction';
      }

      const response = await fetch(
        `${API_BASE}/api/settlements/v2/${reconciliationResult.settlement_id}/pay`,
        {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            amount,
            method,
            reference:
              paymentReference ||
              `${direction === 'from_carrier' ? 'Pago recibido' : 'Pago enviado'} - ${reconciliationResult.settlement_code}`,
            notes:
              selectedPaymentOption === 'deducted_from_cod'
                ? 'Descontado del COD por el courier'
                : null,
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Error al registrar el pago' }));
        throw new Error(err.error || 'Error al registrar el pago');
      }

      toast({
        title: 'Pago registrado',
        description: `Liquidacion ${reconciliationResult.settlement_code} completada`,
      });

      setCurrentStep('complete');
    } catch (error: unknown) {
      const e = error as { message?: string };
      logger.error('[PendingReconciliation] Error registering payment:', error);
      toast({
        title: 'Error',
        description: e?.message || 'No se pudo registrar el pago',
        variant: 'destructive',
      });
    } finally {
      setPaymentProcessing(false);
    }
  };

  const handleDiscardDraft = () => {
    if (!selectedGroup) return;
    clearDraft(selectedGroup.carrier_id);
    setHasDraft(false);
    const initialState = new Map<string, OrderReconciliation>();
    orders.forEach(order => initialState.set(order.id, { delivered: true }));
    setReconciliationState(initialState);
    setTotalAmountCollected(null);
    setDiscrepancyNotes('');
    setExtraCharges([]);
  };

  const resetSelectionState = () => {
    setSelectedGroup(null);
    setOrders([]);
    setReconciliationState(new Map());
    setTotalAmountCollected(null);
    setDiscrepancyNotes('');
    setExtraCharges([]);
    setSearchTerm('');
    setHasDraft(false);
  };

  const handleBack = () => {
    if (currentStep === 'reconciliation') {
      setCurrentStep('selection');
      resetSelectionState();
    } else if (currentStep === 'confirm') {
      setCurrentStep('reconciliation');
    } else if (currentStep === 'payment') {
      // Can't go back from payment - reconciliation already done. Skip to complete.
      setCurrentStep('complete');
    } else if (currentStep === 'complete') {
      setCurrentStep('selection');
      resetSelectionState();
      setReconciliationResult(null);
      setSelectedPaymentOption(null);
      setPaymentReference('');
      void loadGroups();
    }
  };

  // Confirm button gating + reason. Excluded rows (unchecked without failure
  // reason) are silently skipped from the settlement, they do NOT block.
  const canProceed =
    totalAmountCollected !== null &&
    totalAmountCollected >= 0 &&
    (stats.delivered + stats.notDelivered) > 0;

  const blockingReason = (() => {
    if (totalAmountCollected === null) return 'Ingresa el monto total cobrado por el courier.';
    if (totalAmountCollected < 0) return 'El monto cobrado no puede ser negativo.';
    if ((stats.delivered + stats.notDelivered) === 0)
      return 'Todas las ordenes estan excluidas. Marca al menos una como entregada o fallida.';
    return null;
  })();

  // Aggregate totals shown on the selection summary cards.
  const summaryTotals = useMemo(() => {
    const carriers = groups.length;
    const totalOrders = groups.reduce((s, g) => s + g.total_orders, 0);
    const totalCod = groups.reduce((s, g) => s + g.total_cod, 0);
    return { carriers, totalOrders, totalCod };
  }, [groups]);

  // ----------------------------------------------------------
  // Renderers
  // ----------------------------------------------------------

  const renderSelection = () => (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Pendientes de Conciliar</h2>
          <p className="text-sm text-muted-foreground">
            Una fila por courier con todo el backlog acumulado. Mas viejos primero.
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
            <CardTitle className="text-sm font-medium">Couriers Pendientes</CardTitle>
            <Truck className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summaryTotals.carriers}</div>
            <p className="text-xs text-muted-foreground">Con backlog sin conciliar</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pedidos Entregados</CardTitle>
            <Package className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summaryTotals.totalOrders}</div>
            <p className="text-xs text-muted-foreground">Esperando conciliacion</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">COD Pendiente</CardTitle>
            <DollarSign className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(summaryTotals.totalCod)}</div>
            <p className="text-xs text-muted-foreground">Por cobrar al cliente</p>
          </CardContent>
        </Card>
      </div>

      {/* Carrier cards */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <CheckCircle2 className="h-12 w-12 text-green-500 mb-4" />
            <h3 className="text-lg font-medium">Todo conciliado</h3>
            <p className="text-muted-foreground text-center mt-2">
              No hay couriers con entregas pendientes de conciliar
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {groups.map(group => {
            const ageStyle = ageBadgeVariant(group.days_oldest);
            const isCritical = group.days_oldest > 7;
            return (
              <Card
                key={group.carrier_id}
                role="button"
                tabIndex={0}
                aria-label={`Conciliar ${group.carrier_name}, ${group.total_orders} pedidos`}
                className="cursor-pointer hover:border-primary transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
                onClick={() => handleSelectGroup(group)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelectGroup(group);
                  }
                }}
              >
                <CardContent className="p-4 space-y-3">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Truck className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="font-medium truncate">{group.carrier_name}</span>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  </div>

                  {/* Body: totals */}
                  <div>
                    <div className="text-2xl font-bold">{group.total_orders} pedidos</div>
                    <div className="text-sm text-muted-foreground space-x-2">
                      <span>COD: {formatCurrency(group.total_cod)}</span>
                      {group.total_prepaid > 0 && (
                        <span>{group.total_prepaid} prepago</span>
                      )}
                      <span className="text-xs">
                        Fee fallido {group.failed_attempt_fee_percent}%
                      </span>
                    </div>
                  </div>

                  {/* Footer: oldest age */}
                  <div className="flex items-center justify-between pt-1 border-t">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      <span>
                        Mas viejo hace {group.days_oldest}{' '}
                        {group.days_oldest === 1 ? 'dia' : 'dias'}
                      </span>
                    </div>
                    <Badge
                      variant={ageStyle.variant}
                      className={`text-xs gap-1 ${ageStyle.className}`}
                    >
                      {isCritical && <AlertTriangle className="h-3 w-3" />}
                      {fmtDayMonth(group.oldest_delivery_date)}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderReconciliation = () => {
    if (!selectedGroup) return null;
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleBack} aria-label="Volver">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-semibold truncate">
                Conciliando con {selectedGroup.carrier_name}
              </h2>
              {hasDraft && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Save className="h-3 w-3" /> Borrador
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {orders.length} pedidos · {coveredRangeLabel}
            </p>
          </div>
          {hasDraft && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground gap-1"
              onClick={handleDiscardDraft}
            >
              <Trash2 className="h-3.5 w-3.5" /> Descartar
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              if (!selectedGroup) return;
              // Reuse the existing PDF renderer. It expects a `deliveryDate`
              // string, so we pass the oldest covered date - the PDF can
              // still display a single header date; per-row dates already
              // appear in the body table.
              void generateReconciliationPDF({
                carrierName: selectedGroup.carrier_name,
                deliveryDate: selectedGroup.oldest_delivery_date,
                orders,
                reconciliationState,
                totalAmountCollected,
                minDeliveryDate: selectedGroup.oldest_delivery_date,
                maxDeliveryDate: selectedGroup.newest_delivery_date,
              });
            }}
          >
            <Download className="h-3.5 w-3.5" />
            Descargar
          </Button>
        </div>

        {/* Stats Bar */}
        <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg flex-wrap">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span className="text-sm font-medium">{stats.delivered} entregados</span>
          </div>
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-red-600" />
            <span className="text-sm font-medium">{stats.notDelivered} no entregados</span>
          </div>
          {stats.excluded > 0 && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-2 cursor-help">
                      <Clock className="h-4 w-4 text-amber-600" />
                      <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                        {stats.excluded} excluidos
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <p className="text-xs leading-snug">
                      Pedidos desmarcados sin razón. NO entran a este cierre y quedan
                      pending para la próxima conciliación. Útil cuando el courier los va
                      a rendir otro día.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          )}
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
                : 'Sin monto a cobrar'}
            </span>
          </div>
          {stats.missingReasons > 0 && (
            <>
              <Separator orientation="vertical" className="h-4" />
              <Badge variant="destructive">{stats.missingReasons} sin motivo</Badge>
            </>
          )}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por numero, cliente o telefono..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
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
                      checked={stats.delivered === orders.length && orders.length > 0}
                      onCheckedChange={checked => handleToggleAll(!!checked)}
                      aria-label="Marcar todos como entregados"
                    />
                  </TableHead>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => setSortDeliveredAtAsc(s => !s)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      aria-label="Ordenar por fecha de entrega"
                    >
                      <Calendar className="h-3.5 w-3.5" />
                      Fecha entrega
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </TableHead>
                  <TableHead className="hidden md:table-cell">Ciudad</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Tarifa</TableHead>
                  <TableHead className="w-48">Motivo (si no entregado)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : visibleOrders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No se encontraron pedidos
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleOrders.map(order => {
                    const state = reconciliationState.get(order.id);
                    const isDelivered = state?.delivered ?? true;
                    const hasFailureReason = !!state?.failure_reason;
                    // 3-state visual:
                    //  - delivered: default white
                    //  - failed (unchecked + reason): red
                    //  - excluded (unchecked + no reason): amber, queda pending
                    const rowClass = isDelivered
                      ? ''
                      : hasFailureReason
                      ? 'bg-red-50 dark:bg-red-950/20'
                      : 'bg-amber-50 dark:bg-amber-950/20 opacity-70';
                    return (
                      <TableRow key={order.id} className={rowClass}>
                        <TableCell>
                          <Checkbox
                            checked={isDelivered}
                            onCheckedChange={checked =>
                              handleToggleDelivered(order.id, !!checked)
                            }
                            aria-label={`Marcar ${order.display_order_number}`}
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
                        <TableCell>
                          <span className="text-sm font-mono">
                            {fmtDateOnly(order.delivered_at)}
                          </span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <span className="text-sm">{order.customer_city}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          {order.is_cod ? (
                            <div className="flex items-center justify-end gap-2">
                              <span
                                className={`font-semibold ${
                                  state?.override_prepaid
                                    ? 'line-through text-muted-foreground'
                                    : 'text-green-600'
                                }`}
                              >
                                {formatCurrency(order.cod_amount)}
                              </span>
                              <TooltipProvider delayDuration={150}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setReconciliationState(prev => {
                                          const next = new Map(prev);
                                          const cur = next.get(order.id) || { delivered: true };
                                          next.set(order.id, {
                                            ...cur,
                                            override_prepaid: !cur.override_prepaid,
                                          });
                                          return next;
                                        });
                                      }}
                                      className={`text-xs px-2 py-0.5 rounded border ${
                                        state?.override_prepaid
                                          ? 'bg-blue-100 border-blue-300 text-blue-700 dark:bg-blue-950 dark:border-blue-700 dark:text-blue-300'
                                          : 'bg-muted/50 border-border text-muted-foreground hover:bg-muted'
                                      }`}
                                    >
                                      {state?.override_prepaid ? 'Pagado' : '¿Ya pagó?'}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="left" className="max-w-xs">
                                    {state?.override_prepaid ? (
                                      <p className="text-xs leading-snug">
                                        Marcaste que el cliente pagó por transferencia o QR antes
                                        de la entrega. Click para volver al cobro en efectivo
                                        (COD) por el courier.
                                      </p>
                                    ) : (
                                      <p className="text-xs leading-snug">
                                        Click si el cliente <strong>ya pagó online</strong> (transferencia
                                        o QR) y el courier NO cobró efectivo en la entrega. El COD
                                        de este pedido sale del total a recibir del courier.
                                      </p>
                                    )}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>
                          ) : (
                            <Badge variant="secondary" className="font-medium">
                              {getPrepaidMethodLabel(order.payment_method, order.prepaid_method)}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right hidden sm:table-cell">
                          <span
                            className="text-sm font-mono text-muted-foreground"
                            title={`Ciudad normalizada: "${order.normalized_city}" | Fuente: ${order.fee_source}`}
                          >
                            {formatCurrency(order.carrier_fee)}
                          </span>
                        </TableCell>
                        <TableCell>
                          {!isDelivered && (
                            <Select
                              value={state?.failure_reason || ''}
                              onValueChange={value => handleSetFailureReason(order.id, value)}
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

        {/* Extra flete lines (Migration 184). Mounted ABOVE the amount input
            so the user sees them before deciding the COD net. */}
        <ExtraChargesEditor
          charges={extraCharges}
          onChange={setExtraCharges}
          disabled={processing}
        />

        {/* Amount Input */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monto Cobrado</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-1.5 mb-1">
                  <Label htmlFor="amount">Total recibido del courier (Gs)</Label>
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="Ayuda">
                          <HelpCircle className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-sm">
                        <p className="text-xs leading-snug">
                          El dinero que el courier <strong>te trae en mano hoy</strong>. Si descontó
                          su tarifa antes de pagarte, ingresá el neto. Si te dio el COD completo
                          y le pagás la tarifa aparte, ingresá el COD entero. Usá los presets
                          de abajo para auto-rellenar.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Input
                  id="amount"
                  type="number"
                  placeholder="0"
                  value={totalAmountCollected ?? ''}
                  onChange={e =>
                    setTotalAmountCollected(e.target.value ? Number(e.target.value) : null)
                  }
                  onWheel={e => (e.target as HTMLInputElement).blur()}
                  className="mt-1 text-lg font-mono"
                />
                {/* Modalidad de cobro presets. Pre-rellenan el input segun como
                    se resolvio operativamente entre courier y store. Si todo es
                    prepago no aparecen porque solo hay un escenario (cero cash). */}
                {stats.codExpected > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => {
                              const net = Math.max(
                                0,
                                stats.codExpected - (financialSummary?.totalCarrierFees || 0) - (financialSummary?.failedAttemptFees || 0)
                              );
                              setTotalAmountCollected(net);
                            }}
                            className="text-xs px-2 py-1 rounded border bg-muted/30 hover:bg-muted text-foreground"
                          >
                            Cobró neto (descontó flete)
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs">
                          <p className="text-xs leading-snug">
                            El courier ya descontó su tarifa de envío y los fees por entregas
                            fallidas. Te entrega solo el monto neto. Pre-rellena con: COD esperado
                            − total flete − fees fallidos.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <TooltipProvider delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            onClick={() => setTotalAmountCollected(stats.codExpected)}
                            className="text-xs px-2 py-1 rounded border bg-muted/30 hover:bg-muted text-foreground"
                          >
                            Cobró COD completo
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs">
                          <p className="text-xs leading-snug">
                            El courier te entrega el COD completo sin descontar nada. Vos le pagás
                            la tarifa de flete por separado (transferencia o efectivo aparte). El
                            neto va a salir negativo: vos le debes a él.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    {totalAmountCollected !== null && (
                      <button
                        type="button"
                        onClick={() => setTotalAmountCollected(null)}
                        className="text-xs px-2 py-1 rounded border border-dashed text-muted-foreground hover:bg-muted/30"
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">
                  {stats.codExpected > 0 ? 'COD esperado' : 'Todo prepago'}
                </p>
                <p className="text-lg font-semibold">{formatCurrency(stats.codExpected)}</p>
                {financialSummary && financialSummary.totalCarrierFees > 0 && (
                  <div className="mt-2 pt-2 border-t border-dashed">
                    <p className="text-xs text-muted-foreground flex items-center justify-end gap-1">
                      <Wallet className="h-3 w-3" />
                      Total flete
                    </p>
                    <p className="font-mono text-amber-600 dark:text-amber-400">
                      {formatCurrency(financialSummary.totalCarrierFees)}
                    </p>
                  </div>
                )}
              </div>
            </div>

          </CardContent>
        </Card>

        {/* Resumen claro: COD esperado − flete = Neto que debe entrar.
            Comparamos contra lo cobrado. Si cuadra: verde con check. Si falta
            o sobra: amber/rojo con monto exacto y textarea para notas. */}
        {totalAmountCollected !== null && financialSummary && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">Resumen</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-xs text-muted-foreground flex items-center gap-1.5 pb-2 border-b">
                <Calendar className="h-3.5 w-3.5" />
                Cubre: {coveredRangeLabel}
              </div>

              {/* Cálculo del neto que debe entregar el courier */}
              <div className="space-y-1.5 text-sm">
                {stats.codExpected > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      COD a cobrar ({stats.delivered - stats.prepaidCount} entregados)
                    </span>
                    <span className="font-mono">{formatCurrency(stats.codExpected)}</span>
                  </div>
                )}
                {stats.prepaidCount > 0 && (
                  <div className="flex justify-between text-muted-foreground text-xs">
                    <span>+ {stats.prepaidCount} prepago entregados (ya en tu cuenta)</span>
                    <span>{formatCurrency(stats.prepaidValue)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    − Flete entregas ({stats.delivered} pedidos)
                  </span>
                  <span className="font-mono text-amber-700 dark:text-amber-400">
                    −{formatCurrency(financialSummary.orderCarrierFees)}
                  </span>
                </div>
                {financialSummary.extraChargesTotal !== 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {financialSummary.extraChargesTotal > 0 ? '−' : '+'} Envíos extra (
                      {extraCharges.length})
                    </span>
                    <span
                      className={`font-mono ${
                        financialSummary.extraChargesTotal > 0
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {financialSummary.extraChargesTotal > 0 ? '−' : '+'}
                      {formatCurrency(Math.abs(financialSummary.extraChargesTotal))}
                    </span>
                  </div>
                )}
                {stats.notDelivered > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      − Fees por fallidos ({stats.notDelivered} × {selectedGroup?.failed_attempt_fee_percent}%)
                    </span>
                    <span className="font-mono text-amber-700 dark:text-amber-400">
                      −{formatCurrency(financialSummary.failedAttemptFees)}
                    </span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between text-base font-semibold">
                  <span>Neto que debe entrar al store</span>
                  <span className="font-mono">{formatCurrency(financialSummary.expectedNet)}</span>
                </div>
              </div>

              {/* Comparación con lo cobrado */}
              <div
                className={`rounded-lg p-3 border ${
                  financialSummary.isClosed
                    ? 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900'
                    : financialSummary.gap < 0
                    ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900'
                    : 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900'
                }`}
              >
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Cobrado por el courier hoy</span>
                  <span className="font-mono font-semibold">
                    {formatCurrency(financialSummary.codCollected)}
                  </span>
                </div>
                <Separator className="my-2" />
                {financialSummary.isClosed ? (
                  <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="text-sm font-medium">
                      Cuadra exacto. El cierre está saldado.
                    </span>
                  </div>
                ) : financialSummary.gap < 0 ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="text-sm font-medium">
                        Faltan {formatCurrency(Math.abs(financialSummary.gap))} por entregar
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-6">
                      El courier todavía te debe esa diferencia. Registralo en notas si querés
                      arrastrarlo al próximo cierre.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
                      <DollarSign className="h-4 w-4" />
                      <span className="text-sm font-medium">
                        Cobró {formatCurrency(financialSummary.gap)} de más
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground pl-6">
                      Llegó más plata que la esperada. Puede ser propinas, redondeo o algún
                      pedido prepago que el courier cobró en efectivo igual.
                    </p>
                  </div>
                )}
                {!financialSummary.isClosed && (
                  <Textarea
                    placeholder="Notas sobre la diferencia (opcional)..."
                    value={discrepancyNotes}
                    onChange={e => setDiscrepancyNotes(e.target.value)}
                    className="mt-3"
                    rows={2}
                  />
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <div className="flex flex-col items-end gap-2">
          {blockingReason && (
            <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>{blockingReason}</span>
            </div>
          )}
          <div className="flex gap-3">
            <Button variant="outline" onClick={handleBack}>
              Cancelar
            </Button>
            <Button
              onClick={handleProcessReconciliation}
              disabled={!canProceed || processing}
              title={blockingReason ?? undefined}
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
      </div>
    );
  };

  const renderPayment = () => {
    if (!reconciliationResult) return null;
    const netReceivable = reconciliationResult.net_receivable;
    const isPositive = netReceivable > 0;
    const range =
      reconciliationResult.min_delivery_date === reconciliationResult.max_delivery_date
        ? fmtFullDate(reconciliationResult.min_delivery_date)
        : `${fmtDateOnly(reconciliationResult.min_delivery_date)} a ${fmtDateOnly(
            reconciliationResult.max_delivery_date
          )}`;

    return (
      <div className="space-y-6">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
            <DollarSign className="h-8 w-8 text-amber-600" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Registrar Pago</h2>
          <p className="text-muted-foreground">
            Liquidacion {reconciliationResult.settlement_code} creada · cubre {range}
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                {isPositive ? 'El courier te debe:' : 'Le debes al courier:'}
              </p>
              <p
                className={`text-4xl font-bold ${
                  isPositive ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {formatCurrency(Math.abs(netReceivable))}
              </p>
              <p className="text-xs text-muted-foreground">
                {reconciliationResult.total_delivered} entregados · {reconciliationResult.total_not_delivered} fallidos
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">¿Como se resolvio este saldo?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isPositive ? (
              <>
                <PaymentRadio
                  selected={selectedPaymentOption === 'paid_by_carrier'}
                  onSelect={() => setSelectedPaymentOption('paid_by_carrier')}
                  title="El courier me pago"
                  subtitle="Recibi el dinero en efectivo o transferencia"
                  name="paymentOption"
                  tooltip="El courier te entregó el saldo neto que te debe, sea en efectivo o por transferencia. El saldo queda saldado en cero al confirmar."
                />
                <PaymentRadio
                  selected={selectedPaymentOption === 'deducted_from_cod'}
                  onSelect={() => setSelectedPaymentOption('deducted_from_cod')}
                  title="Ya fue descontado del COD"
                  subtitle="El courier me entrego el monto neto (ya descontadas las tarifas)"
                  name="paymentOption"
                  tooltip="El courier ya hizo el cálculo al pagarte: te dio COD cobrado menos su tarifa de flete y los fees por fallidos. No hay nada más que mover. Marca el settlement como pagado."
                />
              </>
            ) : (
              <>
                <PaymentRadio
                  selected={selectedPaymentOption === 'paid_to_carrier'}
                  onSelect={() => setSelectedPaymentOption('paid_to_carrier')}
                  title="Ya pague al courier"
                  subtitle="Le pague las tarifas en efectivo o transferencia"
                  name="paymentOption"
                  tooltip="Vos le pagaste al courier el monto que le debes (por ejemplo todas las tarifas de envío de pedidos prepagos online, o la diferencia cuando el COD no alcanzó a cubrir el flete). Saldo cerrado."
                />
                <PaymentRadio
                  selected={selectedPaymentOption === 'deducted_from_cod'}
                  onSelect={() => setSelectedPaymentOption('deducted_from_cod')}
                  title="Se descontara del proximo COD"
                  subtitle="El courier lo descontara de entregas futuras"
                  name="paymentOption"
                  tooltip="Le quedás debiendo al courier. En la próxima rendición, el courier va a descontar este saldo del COD que cobre antes de entregártelo. Útil cuando no querés pagar hoy."
                />
              </>
            )}
            <PaymentRadio
              selected={selectedPaymentOption === 'pending'}
              onSelect={() => setSelectedPaymentOption('pending')}
              title="Pendiente de pago"
              subtitle='Registrar el pago mas tarde desde la pestana "Pagos"'
              name="paymentOption"
              tooltip="El settlement queda creado pero el cobro o pago todavía no se hizo. Vas a poder marcarlo como pagado más tarde desde la pestaña 'Pagos' con la referencia de transferencia o recibo."
            />

            {selectedPaymentOption && selectedPaymentOption !== 'pending' && (
              <div className="pt-3 space-y-2">
                <Label htmlFor="paymentRef">Referencia (opcional)</Label>
                <Input
                  id="paymentRef"
                  placeholder="Numero de transferencia, recibo, etc."
                  value={paymentReference}
                  onChange={e => setPaymentReference(e.target.value)}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => {
              setSelectedPaymentOption('pending');
              void handleRegisterPayment();
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

  const renderComplete = () => {
    const range = reconciliationResult
      ? reconciliationResult.min_delivery_date === reconciliationResult.max_delivery_date
        ? fmtFullDate(reconciliationResult.min_delivery_date)
        : `del ${fmtDateOnly(reconciliationResult.min_delivery_date)} al ${fmtDateOnly(
            reconciliationResult.max_delivery_date
          )}`
      : '';
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-4">
          <CheckCircle2 className="h-8 w-8 text-green-600" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Conciliacion Completada</h2>
        <p className="text-muted-foreground text-center max-w-md mb-6">
          {reconciliationResult?.settlement_code
            ? `Liquidacion ${reconciliationResult.settlement_code} procesada${range ? ` · cubre ${range}` : ''}.`
            : 'La liquidacion ha sido creada exitosamente.'}
          {' '}Puedes ver el detalle en la pestana de Cuentas.
        </p>
        <Button onClick={handleBack}>Volver al Inicio</Button>
      </div>
    );
  };

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

// ============================================================
// Small UI helpers
// ============================================================

interface PaymentRadioProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  subtitle: string;
  name: string;
  tooltip?: string;
}
function PaymentRadio({ selected, onSelect, title, subtitle, name, tooltip }: PaymentRadioProps) {
  return (
    <label
      className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
        selected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
      }`}
      onClick={onSelect}
    >
      <input
        type="radio"
        name={name}
        checked={selected}
        onChange={onSelect}
        className="mt-1"
        aria-label={title}
      />
      <div className="flex-1">
        <div className="flex items-center gap-1.5">
          <p className="font-medium">{title}</p>
          {tooltip && (
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => e.stopPropagation()}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Ayuda: ${title}`}
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-sm">
                  <p className="text-xs leading-snug">{tooltip}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </label>
  );
}
