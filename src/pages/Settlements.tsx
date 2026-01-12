/**
 * Settlements Page - Conciliaciones (Redesigned)
 * Manual reconciliation workflow for courier deliveries
 *
 * Flow:
 * 1. selection - View cards grouped by courier/date, select one
 * 2. reconciliation - Mark deliveries with checkboxes, enter amount
 * 3. review - Review summary and confirm
 * 4. complete - Settlement completed
 *
 * @author Bright Idea
 * @date 2026-01-09
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
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

type WorkflowStep = 'selection' | 'reconciliation' | 'review' | 'complete';

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

export default function Settlements() {
  const { toast } = useToast();
  const { hasFeature, loading: subscriptionLoading } = useSubscription();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State
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

  const hasWarehouseFeature = hasFeature('warehouse');

  useEffect(() => {
    if (!hasWarehouseFeature) return;
    loadGroups();
  }, [loadGroups, hasWarehouseFeature]);

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

  // Calculate stats
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

  // Validation for proceeding
  const canProceedToReview = useMemo(() => {
    if (!stats) return false;
    if (stats.missingReasons > 0) return false;
    if (totalAmountCollected === null || totalAmountCollected < 0) return false;

    const hasDiscrepancy = totalAmountCollected !== stats.codExpected;
    if (hasDiscrepancy && !confirmDiscrepancy) return false;

    return true;
  }, [stats, totalAmountCollected, confirmDiscrepancy]);

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

  // CSV Import (legacy fallback)
  const handleImportCSV = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    toast({
      title: 'Funcion en desarrollo',
      description: 'La importacion CSV estara disponible proximamente',
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
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
