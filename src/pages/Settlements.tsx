/**
 * Settlements Page - Conciliaciones, Cuentas y Pagos
 * Unified carrier account management with reconciliation workflow
 *
 * Tabs:
 * 1. Conciliaciones - Manual reconciliation workflow for courier deliveries
 * 2. Cuentas - Carrier account balances (what each carrier owes or is owed)
 * 3. Pagos - Payment history and registration
 *
 * @author Bright Idea
 * @date 2026-01-13
 */

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { EmptyState } from '@/components/EmptyState';
import { TableSkeleton } from '@/components/skeletons/TableSkeleton';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { FeatureBlockedPage } from '@/components/FeatureGate';
import { FirstTimeWelcomeBanner } from '@/components/FirstTimeTooltip';
import { onboardingService } from '@/services/onboarding.service';
import {
  CourierDateGroupCard,
  ReconciliationTable,
  AmountInputSection,
  ReconciliationSummary,
  type CourierDateGroup,
} from '@/components/settlements';
import type { ReconciliationOrder, OrderReconciliation } from '@/components/settlements/ReconciliationTable';
import {
  Loader2,
  Truck,
  Upload,
  CheckCircle2,
  XCircle,
  RefreshCw,
  DollarSign,
  ArrowLeft,
  ArrowRight,
  FileSpreadsheet,
  Calendar,
  Package,
  AlertTriangle,
  FileUp,
  Wallet,
  CreditCard,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  MoreHorizontal,
  Eye,
  Plus,
  Settings,
  History,
  BanknoteIcon,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import {
  getCarrierBalances,
  getCarrierAccountSummary,
  getCarrierMovements,
  getCarrierPayments,
  registerCarrierPayment,
  createCarrierAdjustment,
  updateCarrierConfig,
  type CarrierBalance,
  type CarrierAccountSummary,
  type CarrierMovement,
  type CarrierPayment,
} from '@/services/settlements.service';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type WorkflowStep = 'selection' | 'reconciliation' | 'review' | 'complete';

// CSV Import types
interface CSVImportRow {
  order_number: string;
  delivery_status: 'delivered' | 'not_delivered' | 'rejected' | 'rescheduled';
  amount_collected: number;
  failure_reason?: string;
  notes?: string;
}

interface CSVImportResult {
  rows: CSVImportRow[];
  errors: string[];
  warnings: string[];
}

/**
 * Parse amount in Latin American format
 * Handles: 25.000, 25,000, 25000, 25.000,50, 25,000.50
 *
 * Paraguay uses: 25.000 Gs (dot as thousands separator)
 * Some use: 25,000 (comma as thousands separator)
 *
 * @param raw - Raw amount string from CSV
 * @returns Parsed number value
 */
function parseLatinAmount(raw: string): number {
  if (!raw) return 0;

  // Remove currency symbols, Gs, spaces
  const clean = raw.replace(/[^\d.,]/g, '').trim();

  if (!clean) return 0;

  // Detect format based on separator positions
  const lastDot = clean.lastIndexOf('.');
  const lastComma = clean.lastIndexOf(',');

  if (lastDot === -1 && lastComma === -1) {
    // No separators: "25000"
    return parseFloat(clean) || 0;
  }

  if (lastDot !== -1 && lastComma !== -1) {
    // Both separators present
    if (lastComma > lastDot) {
      // European/Latin: "1.234,56" -> comma is decimal
      return parseFloat(clean.replace(/\./g, '').replace(',', '.')) || 0;
    } else {
      // US format: "1,234.56" -> dot is decimal
      return parseFloat(clean.replace(/,/g, '')) || 0;
    }
  }

  // Only one separator
  if (lastDot !== -1) {
    // Check if dot is thousands separator (25.000) or decimal (25.50)
    const afterDot = clean.substring(lastDot + 1);
    if (afterDot.length === 3 && !clean.includes(',')) {
      // "25.000" - dot is thousands separator
      return parseFloat(clean.replace(/\./g, '')) || 0;
    }
    // "25.50" or "1.5" - dot is decimal
    return parseFloat(clean) || 0;
  }

  if (lastComma !== -1) {
    // Check if comma is thousands separator (25,000) or decimal (25,50)
    const afterComma = clean.substring(lastComma + 1);
    if (afterComma.length === 3) {
      // "25,000" - comma is thousands separator
      return parseFloat(clean.replace(/,/g, '')) || 0;
    }
    // "25,50" - comma is decimal (European)
    return parseFloat(clean.replace(',', '.')) || 0;
  }

  return parseFloat(clean) || 0;
}

// Parse CSV content
function parseCSVContent(content: string): CSVImportResult {
  const lines = content.split('\n').filter(line => line.trim());
  const rows: CSVImportRow[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  if (lines.length < 2) {
    errors.push('El archivo CSV debe tener al menos una fila de encabezados y una de datos');
    return { rows, errors, warnings };
  }

  // Parse headers - support multiple formats
  const headerLine = lines[0];
  const headers = headerLine.split(',').map(h =>
    h.trim().toLowerCase().replace(/"/g, '').replace(/[\uFEFF]/g, '')
  );

  // Column name mappings (Spanish and English)
  const columnMap: Record<string, string> = {
    // Order number
    'pedido': 'order_number',
    'nroreferencia': 'order_number',
    'order_number': 'order_number',
    'n° pedido': 'order_number',
    'numero_pedido': 'order_number',
    // Delivery status
    'estado_entrega': 'delivery_status',
    'estado': 'delivery_status',
    'delivery_status': 'delivery_status',
    'resultado': 'delivery_status',
    // Amount collected
    'monto_cobrado': 'amount_collected',
    'amount_collected': 'amount_collected',
    'cobrado': 'amount_collected',
    'importe_cobrado': 'amount_collected',
    // Failure reason
    'motivo_falla': 'failure_reason',
    'motivo_no_entrega': 'failure_reason',
    'failure_reason': 'failure_reason',
    'motivo': 'failure_reason',
    // Notes
    'notas': 'notes',
    'notes': 'notes',
    'observaciones': 'notes',
  };

  // Status mappings (Spanish to internal)
  const statusMap: Record<string, CSVImportRow['delivery_status']> = {
    'entregado': 'delivered',
    'delivered': 'delivered',
    'si': 'delivered',
    'yes': 'delivered',
    '1': 'delivered',
    'no entregado': 'not_delivered',
    'not_delivered': 'not_delivered',
    'fallido': 'not_delivered',
    'failed': 'not_delivered',
    'no': 'not_delivered',
    '0': 'not_delivered',
    'rechazado': 'rejected',
    'rejected': 'rejected',
    'reprogramado': 'rescheduled',
    'rescheduled': 'rescheduled',
  };

  // Find column indices
  const columnIndices: Record<string, number> = {};
  headers.forEach((header, index) => {
    const mappedName = columnMap[header];
    if (mappedName) {
      columnIndices[mappedName] = index;
    }
  });

  // Validate required columns
  if (columnIndices['order_number'] === undefined) {
    errors.push('No se encontró la columna de número de pedido (PEDIDO, NroReferencia, order_number)');
    return { rows, errors, warnings };
  }

  if (columnIndices['delivery_status'] === undefined) {
    errors.push('No se encontró la columna de estado de entrega (ESTADO_ENTREGA, estado, delivery_status)');
    return { rows, errors, warnings };
  }

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV values (handle quoted values with commas)
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim().replace(/^"|"$/g, ''));

    // Get values
    const orderNumber = values[columnIndices['order_number']]?.trim();
    const statusRaw = values[columnIndices['delivery_status']]?.trim().toLowerCase();
    const amountRaw = values[columnIndices['amount_collected']]?.trim();
    const failureReason = values[columnIndices['failure_reason']]?.trim();
    const notes = values[columnIndices['notes']]?.trim();

    // Validate order number
    if (!orderNumber) {
      warnings.push(`Fila ${i + 1}: Sin número de pedido, ignorada`);
      continue;
    }

    // Parse status
    const deliveryStatus = statusMap[statusRaw];
    if (!deliveryStatus && statusRaw) {
      warnings.push(`Fila ${i + 1} (${orderNumber}): Estado "${statusRaw}" no reconocido, marcado como pendiente`);
      continue;
    }

    if (!deliveryStatus) {
      // Skip rows without status (empty cells)
      continue;
    }

    // Parse amount - handle both Latin (25.000 or 25,000) and English (25000) formats
    let amountCollected = 0;
    if (amountRaw) {
      amountCollected = parseLatinAmount(amountRaw);
    }

    // Validate: non-delivered orders should have failure reason
    if (deliveryStatus !== 'delivered' && !failureReason) {
      warnings.push(`Fila ${i + 1} (${orderNumber}): Pedido no entregado sin motivo de falla`);
    }

    rows.push({
      order_number: orderNumber,
      delivery_status: deliveryStatus,
      amount_collected: amountCollected,
      failure_reason: failureReason || undefined,
      notes: notes || undefined,
    });
  }

  if (rows.length === 0) {
    errors.push('No se encontraron filas válidas con datos de entrega');
  }

  return { rows, errors, warnings };
}

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

// Carrier fee configuration (should come from carrier_zones in production)
const DEFAULT_CARRIER_FEE = 25000;
const FAILED_ATTEMPT_FEE_RATE = 0.5;

// Main tab type
type MainTab = 'conciliaciones' | 'cuentas' | 'pagos';

export default function Settlements() {
  const { toast } = useToast();
  const { hasFeature, loading: subscriptionLoading } = useSubscription();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Main tab state
  const [activeTab, setActiveTab] = useState<MainTab>('conciliaciones');

  // State for Conciliaciones tab
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [groups, setGroups] = useState<CourierDateGroup[]>([]);
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('selection');
  const [selectedGroup, setSelectedGroup] = useState<CourierDateGroup | null>(null);

  // Reconciliation state
  const [reconciliationState, setReconciliationState] = useState<Map<string, OrderReconciliation>>(new Map());
  const [totalAmountCollected, setTotalAmountCollected] = useState<number | null>(null);
  const [discrepancyNotes, setDiscrepancyNotes] = useState('');
  const [confirmDiscrepancy, setConfirmDiscrepancy] = useState(false);

  // CSV Import state
  const [csvImportDialogOpen, setCsvImportDialogOpen] = useState(false);
  const [csvImportData, setCsvImportData] = useState<CSVImportResult | null>(null);
  const [csvFileName, setCsvFileName] = useState('');
  const [csvProcessing, setCsvProcessing] = useState(false);

  // Carrier Accounts state (Cuentas tab)
  const [carrierBalances, setCarrierBalances] = useState<CarrierBalance[]>([]);
  const [accountSummary, setAccountSummary] = useState<CarrierAccountSummary | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [selectedCarrier, setSelectedCarrier] = useState<CarrierBalance | null>(null);
  const [carrierMovements, setCarrierMovements] = useState<CarrierMovement[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);

  // Payments state (Pagos tab)
  const [payments, setPayments] = useState<CarrierPayment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);
  const [paymentCarrier, setPaymentCarrier] = useState<CarrierBalance | null>(null);

  // Payment form state
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDirection, setPaymentDirection] = useState<'from_carrier' | 'to_carrier'>('from_carrier');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentProcessing, setPaymentProcessing] = useState(false);

  // Adjustment form state
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [adjustmentType, setAdjustmentType] = useState<'credit' | 'debit'>('credit');
  const [adjustmentDescription, setAdjustmentDescription] = useState('');
  const [adjustmentProcessing, setAdjustmentProcessing] = useState(false);

  // Load groups
  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/settlements/shipped-orders-grouped`, {
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error('Error al cargar los pedidos');
      }

      const result = await response.json();
      setGroups(result.data || []);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudieron cargar los pedidos',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Load carrier account balances
  const loadCarrierAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const [balances, summary] = await Promise.all([
        getCarrierBalances(),
        getCarrierAccountSummary(),
      ]);
      setCarrierBalances(balances);
      setAccountSummary(summary);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudieron cargar las cuentas',
      });
    } finally {
      setAccountsLoading(false);
    }
  }, [toast]);

  // Load carrier movements
  const loadCarrierMovements = useCallback(async (carrierId: string) => {
    setMovementsLoading(true);
    try {
      const result = await getCarrierMovements(carrierId, { limit: 50 });
      setCarrierMovements(result.data);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudieron cargar los movimientos',
      });
    } finally {
      setMovementsLoading(false);
    }
  }, [toast]);

  // Load all payments
  const loadPayments = useCallback(async () => {
    setPaymentsLoading(true);
    try {
      const result = await getCarrierPayments(undefined, { limit: 50 });
      setPayments(result.data);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudieron cargar los pagos',
      });
    } finally {
      setPaymentsLoading(false);
    }
  }, [toast]);

  const hasWarehouseFeature = hasFeature('warehouse');

  // Load data based on active tab
  useEffect(() => {
    if (!hasWarehouseFeature) return;

    if (activeTab === 'conciliaciones') {
      loadGroups();
    } else if (activeTab === 'cuentas') {
      loadCarrierAccounts();
    } else if (activeTab === 'pagos') {
      loadPayments();
    }
  }, [activeTab, loadGroups, loadCarrierAccounts, loadPayments, hasWarehouseFeature]);

  // Load movements when a carrier is selected
  useEffect(() => {
    if (selectedCarrier) {
      loadCarrierMovements(selectedCarrier.carrier_id);
    } else {
      setCarrierMovements([]);
    }
  }, [selectedCarrier, loadCarrierMovements]);

  // Calculate stats - MUST be before early returns to follow React Hooks rules
  const stats = useMemo(() => {
    if (!selectedGroup) return null;

    let delivered = 0;
    let notDelivered = 0;
    let codExpected = 0;
    let missingReasons = 0;

    selectedGroup.orders.forEach(order => {
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

    return {
      delivered,
      notDelivered,
      codExpected,
      missingReasons,
    };
  }, [selectedGroup, reconciliationState]);

  // Validation for proceeding - MUST be before early returns
  const canProceedToReview = useMemo(() => {
    if (!stats) return false;
    if (stats.missingReasons > 0) return false;
    if (totalAmountCollected === null || totalAmountCollected < 0) return false;

    const hasDiscrepancy = totalAmountCollected !== stats.codExpected;
    if (hasDiscrepancy && !confirmDiscrepancy) return false;

    return true;
  }, [stats, totalAmountCollected, confirmDiscrepancy]);

  // Plan-based feature check (AFTER all hooks)
  // Wait for subscription to load to prevent flash of upgrade modal
  if (subscriptionLoading) {
    return null;
  }
  if (!hasWarehouseFeature) {
    return <FeatureBlockedPage feature="warehouse" />;
  }

  // Select a group to reconcile
  const handleSelectGroup = (group: CourierDateGroup) => {
    setSelectedGroup(group);
    // Initialize all orders as delivered by default
    const initialState = new Map<string, OrderReconciliation>();
    group.orders.forEach(order => {
      initialState.set(order.id, { delivered: true });
    });
    setReconciliationState(initialState);
    setTotalAmountCollected(null);
    setDiscrepancyNotes('');
    setConfirmDiscrepancy(false);
    setCurrentStep('reconciliation');
  };

  // Toggle delivered status
  const handleToggleDelivered = (orderId: string) => {
    setReconciliationState(prev => {
      const newState = new Map(prev);
      const current = newState.get(orderId);
      newState.set(orderId, {
        delivered: !(current?.delivered ?? true),
        failure_reason: current?.failure_reason,
      });
      return newState;
    });
  };

  // Toggle all
  const handleToggleAll = (delivered: boolean) => {
    setReconciliationState(prev => {
      const newState = new Map(prev);
      selectedGroup?.orders.forEach(order => {
        const current = newState.get(order.id);
        newState.set(order.id, {
          delivered,
          failure_reason: delivered ? undefined : current?.failure_reason,
        });
      });
      return newState;
    });
  };

  // Set failure reason
  const handleSetFailureReason = (orderId: string, reason: string) => {
    setReconciliationState(prev => {
      const newState = new Map(prev);
      const current = newState.get(orderId);
      newState.set(orderId, {
        delivered: current?.delivered ?? false,
        failure_reason: reason,
      });
      return newState;
    });
  };

  // Go to review step
  const handleProceedToReview = () => {
    if (!canProceedToReview) return;
    setCurrentStep('review');
  };

  // Process reconciliation
  const handleConfirmReconciliation = async () => {
    if (!selectedGroup || !stats) return;

    setProcessing(true);
    try {
      const ordersData = selectedGroup.orders.map(order => {
        const state = reconciliationState.get(order.id);
        return {
          order_id: order.id,
          delivered: state?.delivered ?? true,
          failure_reason: state?.failure_reason,
        };
      });

      const response = await fetch(`${API_BASE}/api/settlements/manual-reconciliation`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          carrier_id: selectedGroup.carrier_id,
          dispatch_date: selectedGroup.dispatch_date,
          orders: ordersData,
          total_amount_collected: totalAmountCollected,
          discrepancy_notes: discrepancyNotes || undefined,
          confirm_discrepancy: confirmDiscrepancy,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Error al procesar la conciliacion');
      }

      const result = await response.json();

      toast({
        title: 'Conciliacion completada',
        description: `Liquidacion ${result.data.settlement_code} creada exitosamente`,
      });

      // Mark first action completed (hides the onboarding tip)
      onboardingService.markFirstActionCompleted('settlements');

      setCurrentStep('complete');

      // Reload groups after a short delay
      setTimeout(() => {
        loadGroups();
      }, 1000);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo procesar la conciliacion',
      });
    } finally {
      setProcessing(false);
    }
  };

  // Go back
  const handleBack = () => {
    if (currentStep === 'reconciliation') {
      setSelectedGroup(null);
      setCurrentStep('selection');
    } else if (currentStep === 'review') {
      setCurrentStep('reconciliation');
    } else if (currentStep === 'complete') {
      setSelectedGroup(null);
      setCurrentStep('selection');
    }
  };

  // CSV Import - Read and parse file
  // Handles both UTF-8 and Latin-1 (Windows-1252) encodings
  const handleImportCSV = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setCsvFileName(file.name);

    try {
      // Try UTF-8 first, then fall back to Latin-1 for Windows Excel files
      let content: string;
      try {
        const buffer = await file.arrayBuffer();
        // Try UTF-8 first
        const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
        content = utf8Decoder.decode(buffer);
      } catch {
        // Fall back to Latin-1 (Windows-1252) if UTF-8 fails
        const buffer = await file.arrayBuffer();
        const latin1Decoder = new TextDecoder('windows-1252');
        content = latin1Decoder.decode(buffer);
      }
      const result = parseCSVContent(content);

      setCsvImportData(result);
      setCsvImportDialogOpen(true);

      if (result.errors.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Errores en el archivo',
          description: result.errors[0],
        });
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error al leer archivo',
        description: 'No se pudo leer el archivo CSV',
      });
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Normalize order number for matching (handles #1315 vs 1315, ORD-XXX vs OR#XXX, etc.)
  const normalizeOrderNumber = (num: string): string => {
    // Remove common prefixes: #, ORD-, OR#, ord-, or#
    // Then convert to lowercase and trim
    return num
      .replace(/^(ORD-|OR#|ord-|or#|#)/i, '')
      .toLowerCase()
      .trim();
  };

  // Process CSV import - match with groups and apply
  const handleProcessCSVImport = async () => {
    if (!csvImportData || csvImportData.rows.length === 0) return;

    setCsvProcessing(true);

    try {
      // Create a map of NORMALIZED order numbers to CSV data
      // This handles cases like "#1315" vs "1315" from courier input
      const csvOrderMap = new Map<string, CSVImportRow>();
      csvImportData.rows.forEach(row => {
        const normalizedNum = normalizeOrderNumber(row.order_number);
        csvOrderMap.set(normalizedNum, row);
      });

      // Find matching group(s) - match orders from CSV to shipped orders
      let matchedGroup: CourierDateGroup | null = null;
      let matchedOrders: Array<{ order: any; csvData: CSVImportRow }> = [];

      for (const group of groups) {
        const matches: Array<{ order: any; csvData: CSVImportRow }> = [];

        for (const order of group.orders) {
          // Normalize both for comparison
          const normalizedOrderNum = normalizeOrderNumber(order.order_number);
          const csvData = csvOrderMap.get(normalizedOrderNum);
          if (csvData) {
            matches.push({ order, csvData });
          }
        }

        if (matches.length > 0) {
          if (matches.length > matchedOrders.length) {
            matchedGroup = group;
            matchedOrders = matches;
          }
        }
      }

      if (!matchedGroup || matchedOrders.length === 0) {
        toast({
          variant: 'destructive',
          title: 'Sin coincidencias',
          description: 'No se encontraron pedidos del CSV en los despachos pendientes',
        });
        setCsvProcessing(false);
        return;
      }

      // Calculate totals from CSV
      let totalCollected = 0;
      const ordersData: Array<{
        order_id: string;
        delivered: boolean;
        failure_reason?: string;
        notes?: string;
      }> = [];

      for (const { order, csvData } of matchedOrders) {
        const isDelivered = csvData.delivery_status === 'delivered';

        if (isDelivered) {
          totalCollected += csvData.amount_collected;
        }

        ordersData.push({
          order_id: order.id,
          delivered: isDelivered,
          failure_reason: !isDelivered ? (csvData.failure_reason || 'other') : undefined,
          notes: csvData.notes,
        });
      }

      // Check for unmatched orders in the group
      const unmatchedCount = matchedGroup.orders.length - matchedOrders.length;
      if (unmatchedCount > 0) {
        // Add unmatched orders as delivered (default behavior)
        for (const order of matchedGroup.orders) {
          const isMatched = matchedOrders.some(m => m.order.id === order.id);
          if (!isMatched) {
            ordersData.push({
              order_id: order.id,
              delivered: true, // Default to delivered if not in CSV
            });
            if (order.is_cod) {
              totalCollected += order.cod_amount;
            }
          }
        }

        toast({
          title: 'Pedidos sin datos',
          description: `${unmatchedCount} pedido(s) no estaban en el CSV y se marcaron como entregados`,
        });
      }

      // Process reconciliation
      const response = await fetch(`${API_BASE}/api/settlements/manual-reconciliation`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          carrier_id: matchedGroup.carrier_id,
          dispatch_date: matchedGroup.dispatch_date,
          orders: ordersData,
          total_amount_collected: totalCollected,
          discrepancy_notes: `Importado desde CSV: ${csvFileName}`,
          confirm_discrepancy: true, // Auto-confirm since data comes from courier
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Error al procesar la conciliacion');
      }

      const result = await response.json();

      toast({
        title: 'Importacion exitosa',
        description: `Liquidacion ${result.data.settlement_code} creada con ${matchedOrders.length} pedidos`,
      });

      // Mark first action completed
      onboardingService.markFirstActionCompleted('settlements');

      // Close dialog and reload
      setCsvImportDialogOpen(false);
      setCsvImportData(null);
      loadGroups();
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'No se pudo procesar el archivo CSV',
      });
    } finally {
      setCsvProcessing(false);
    }
  };

  // Calculate totals for selection view
  const totalOrders = groups.reduce((sum, g) => sum + g.total_orders, 0);
  const totalCod = groups.reduce((sum, g) => sum + g.total_cod_expected, 0);

  // ============================================================
  // RENDER: SELECTION STEP
  // ============================================================
  if (currentStep === 'selection') {
    return (
      <div className="p-6 space-y-6">
        <FirstTimeWelcomeBanner
          moduleId="settlements"
          title="¡Bienvenido a Conciliaciones!"
          description="Reconcilia entregas con tus couriers. Marca resultados, ingresa montos cobrados y genera liquidaciones."
          tips={['Selecciona un despacho', 'Marca entregas o fallos', 'Ingresa monto total cobrado']}
        />

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Conciliaciones</h1>
            <p className="text-muted-foreground">
              Selecciona un despacho para conciliar los resultados de entrega
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={loadGroups} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Actualizar
            </Button>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" />
              Importar CSV
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleImportCSV}
              className="hidden"
            />
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Despachos Pendientes</CardTitle>
              <Truck className="h-4 w-4 text-blue-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{groups.length}</div>
              <p className="text-xs text-muted-foreground">
                Agrupados por courier y fecha
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pedidos en Transito</CardTitle>
              <Package className="h-4 w-4 text-purple-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalOrders}</div>
              <p className="text-xs text-muted-foreground">
                Esperando resultado
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">COD Pendiente</CardTitle>
              <DollarSign className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {formatCurrency(totalCod)}
              </div>
              <p className="text-xs text-muted-foreground">
                Monto a cobrar
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Groups Grid */}
        {loading ? (
          <TableSkeleton columns={3} rows={3} />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={Truck}
            title="Sin pedidos en transito"
            description="Los pedidos despachados apareceran aqui para conciliar cuando tengas pedidos con estado 'shipped'"
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {groups.map((group) => (
              <CourierDateGroupCard
                key={`${group.carrier_id}_${group.dispatch_date}`}
                group={group}
                onSelect={() => handleSelectGroup(group)}
              />
            ))}
          </div>
        )}

        {/* CSV Import Dialog */}
        <Dialog open={csvImportDialogOpen} onOpenChange={setCsvImportDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileUp className="h-5 w-5" />
                Importar Resultados de Entrega
              </DialogTitle>
              <DialogDescription>
                Archivo: {csvFileName}
              </DialogDescription>
            </DialogHeader>

            {csvImportData && (
              <div className="space-y-4">
                {/* Errors */}
                {csvImportData.errors.length > 0 && (
                  <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-red-800 dark:text-red-200 font-medium mb-2">
                      <XCircle className="h-4 w-4" />
                      Errores encontrados
                    </div>
                    <ul className="text-sm text-red-700 dark:text-red-300 list-disc list-inside">
                      {csvImportData.errors.map((error, i) => (
                        <li key={i}>{error}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Warnings */}
                {csvImportData.warnings.length > 0 && (
                  <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 font-medium mb-2">
                      <AlertTriangle className="h-4 w-4" />
                      Advertencias ({csvImportData.warnings.length})
                    </div>
                    <ScrollArea className="h-24">
                      <ul className="text-sm text-amber-700 dark:text-amber-300 list-disc list-inside">
                        {csvImportData.warnings.map((warning, i) => (
                          <li key={i}>{warning}</li>
                        ))}
                      </ul>
                    </ScrollArea>
                  </div>
                )}

                {/* Summary */}
                {csvImportData.rows.length > 0 && (
                  <>
                    <div className="grid grid-cols-4 gap-4">
                      <Card className="p-3">
                        <p className="text-xs text-muted-foreground">Total filas</p>
                        <p className="text-xl font-bold">{csvImportData.rows.length}</p>
                      </Card>
                      <Card className="p-3">
                        <p className="text-xs text-muted-foreground">Entregados</p>
                        <p className="text-xl font-bold text-green-600">
                          {csvImportData.rows.filter(r => r.delivery_status === 'delivered').length}
                        </p>
                      </Card>
                      <Card className="p-3">
                        <p className="text-xs text-muted-foreground">No entregados</p>
                        <p className="text-xl font-bold text-red-600">
                          {csvImportData.rows.filter(r => r.delivery_status !== 'delivered').length}
                        </p>
                      </Card>
                      <Card className="p-3">
                        <p className="text-xs text-muted-foreground">Monto total</p>
                        <p className="text-xl font-bold text-blue-600">
                          {formatCurrency(csvImportData.rows.reduce((sum, r) => sum + r.amount_collected, 0))}
                        </p>
                      </Card>
                    </div>

                    {/* Preview table */}
                    <div className="border rounded-lg">
                      <ScrollArea className="h-48">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Pedido</TableHead>
                              <TableHead>Estado</TableHead>
                              <TableHead className="text-right">Monto</TableHead>
                              <TableHead>Motivo</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {csvImportData.rows.slice(0, 20).map((row, i) => (
                              <TableRow key={i}>
                                <TableCell className="font-medium">{row.order_number}</TableCell>
                                <TableCell>
                                  <Badge variant={row.delivery_status === 'delivered' ? 'default' : 'destructive'}>
                                    {row.delivery_status === 'delivered' ? 'Entregado' :
                                      row.delivery_status === 'rejected' ? 'Rechazado' :
                                        row.delivery_status === 'rescheduled' ? 'Reprogramado' : 'No entregado'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">{formatCurrency(row.amount_collected)}</TableCell>
                                <TableCell className="text-muted-foreground text-sm">
                                  {row.failure_reason || '-'}
                                </TableCell>
                              </TableRow>
                            ))}
                            {csvImportData.rows.length > 20 && (
                              <TableRow>
                                <TableCell colSpan={4} className="text-center text-muted-foreground">
                                  ... y {csvImportData.rows.length - 20} filas mas
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </div>
                  </>
                )}
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setCsvImportDialogOpen(false);
                  setCsvImportData(null);
                }}
                disabled={csvProcessing}
              >
                Cancelar
              </Button>
              <Button
                onClick={handleProcessCSVImport}
                disabled={!csvImportData || csvImportData.errors.length > 0 || csvImportData.rows.length === 0 || csvProcessing}
                className="gap-2"
              >
                {csvProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Procesando...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Procesar Importacion
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ============================================================
  // RENDER: RECONCILIATION STEP
  // ============================================================
  if (currentStep === 'reconciliation' && selectedGroup) {
    const formattedDate = format(
      new Date(selectedGroup.dispatch_date + 'T12:00:00'),
      "EEEE, d 'de' MMMM",
      { locale: es }
    );

    return (
      <div className="p-6 space-y-6 pb-32">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{selectedGroup.carrier_name}</h1>
            <p className="text-muted-foreground capitalize">{formattedDate}</p>
          </div>
          <Badge variant="outline" className="text-sm">
            {selectedGroup.total_orders} pedidos
          </Badge>
        </div>

        {/* Progress indicator */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="default">1</Badge>
          <span>Marcar entregas</span>
          <ArrowRight className="h-4 w-4" />
          <Badge variant="outline">2</Badge>
          <span>Revisar y confirmar</span>
        </div>

        {/* Instructions */}
        <Card className="bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
          <CardContent className="py-3">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <strong>Instrucciones:</strong> Desmarca los pedidos que NO fueron entregados y selecciona el motivo.
              Luego ingresa el monto total en efectivo que entrega el courier.
            </p>
          </CardContent>
        </Card>

        {/* Table */}
        <ReconciliationTable
          orders={selectedGroup.orders}
          reconciliationState={reconciliationState}
          onToggleDelivered={handleToggleDelivered}
          onSetFailureReason={handleSetFailureReason}
          onToggleAll={handleToggleAll}
        />

        {/* Amount Input */}
        <AmountInputSection
          totalCodExpected={stats?.codExpected || 0}
          totalAmountCollected={totalAmountCollected}
          onAmountChange={setTotalAmountCollected}
          discrepancyNotes={discrepancyNotes}
          onDiscrepancyNotesChange={setDiscrepancyNotes}
          confirmDiscrepancy={confirmDiscrepancy}
          onConfirmDiscrepancyChange={setConfirmDiscrepancy}
        />

        {/* Floating Action Bar */}
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <Card className="px-6 py-4 shadow-xl border-primary/20 bg-card/95 backdrop-blur-sm">
            <div className="flex items-center gap-6">
              {/* Stats */}
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span>{stats?.delivered || 0} entregados</span>
                </div>
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-600" />
                  <span>{stats?.notDelivered || 0} fallidos</span>
                </div>
              </div>

              {/* Validation messages */}
              {stats?.missingReasons ? (
                <span className="text-xs text-amber-600">
                  {stats.missingReasons} pedido(s) sin motivo
                </span>
              ) : totalAmountCollected === null ? (
                <span className="text-xs text-muted-foreground">
                  Ingresa el monto cobrado
                </span>
              ) : null}

              {/* Action */}
              <Button
                onClick={handleProceedToReview}
                disabled={!canProceedToReview}
                className="gap-2"
              >
                Revisar
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // ============================================================
  // RENDER: REVIEW STEP
  // ============================================================
  if (currentStep === 'review' && selectedGroup && stats) {
    const formattedDate = format(
      new Date(selectedGroup.dispatch_date + 'T12:00:00'),
      "EEEE, d 'de' MMMM yyyy",
      { locale: es }
    );

    return (
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Confirmar Conciliacion</h1>
            <p className="text-muted-foreground">Revisa los datos antes de confirmar</p>
          </div>
        </div>

        {/* Summary */}
        <ReconciliationSummary
          carrierName={selectedGroup.carrier_name}
          dispatchDate={formattedDate}
          totalDispatched={selectedGroup.total_orders}
          totalDelivered={stats.delivered}
          totalNotDelivered={stats.notDelivered}
          totalCodExpected={stats.codExpected}
          totalCodCollected={totalAmountCollected || 0}
          carrierFeePerDelivery={DEFAULT_CARRIER_FEE}
          failedAttemptFeeRate={FAILED_ATTEMPT_FEE_RATE}
          discrepancyNotes={discrepancyNotes}
          onConfirm={handleConfirmReconciliation}
          onCancel={handleBack}
          isProcessing={processing}
        />
      </div>
    );
  }

  // ============================================================
  // RENDER: COMPLETE STEP
  // ============================================================
  if (currentStep === 'complete') {
    return (
      <div className="p-6 max-w-md mx-auto space-y-6 text-center">
        <div className="w-20 h-20 bg-green-100 dark:bg-green-950/30 rounded-full flex items-center justify-center mx-auto">
          <CheckCircle2 className="h-10 w-10 text-green-600" />
        </div>

        <div>
          <h1 className="text-2xl font-bold">Conciliacion Completada</h1>
          <p className="text-muted-foreground mt-2">
            La liquidacion ha sido creada exitosamente
          </p>
        </div>

        <Button onClick={handleBack} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Volver a Conciliaciones
        </Button>
      </div>
    );
  }

  return null;
}
