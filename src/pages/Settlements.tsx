/**
 * Settlements Page - Conciliaciones
 * Simplified reconciliation workflow for courier deliveries
 *
 * Flow:
 * 1. Shows all orders currently in transit (shipped status)
 * 2. User imports CSV with delivery results from courier
 * 3. System updates order statuses automatically
 * 4. Failed deliveries return to ready_to_ship for re-dispatch
 *
 * @author Bright Idea
 * @date 2026-01-09
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { ordersService } from '@/services/orders.service';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { EmptyState } from '@/components/EmptyState';
import { TableSkeleton } from '@/components/skeletons/TableSkeleton';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { FeatureBlockedPage } from '@/components/FeatureGate';
import {
  Loader2,
  Truck,
  Upload,
  CheckCircle2,
  XCircle,
  Package,
  RefreshCw,
  DollarSign,
  AlertTriangle,
  FileSpreadsheet,
  Clock,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface InTransitOrder {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  customer_city: string;
  carrier_name: string;
  carrier_id: string;
  total_price: number;
  cod_amount: number;
  shipped_at: string;
  payment_status: string;
}

interface ImportResult {
  order_number: string;
  status: 'delivered' | 'failed' | 'rejected' | 'not_found';
  collected_amount?: number;
  failure_reason?: string;
}

interface ReconciliationSummary {
  total: number;
  delivered: number;
  failed: number;
  rejected: number;
  notFound: number;
  totalCollected: number;
}

// Format currency in Guaranies
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('es-PY', {
    style: 'decimal',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount) + ' Gs';
};

export default function Settlements() {
  const { toast } = useToast();
  const { hasFeature } = useSubscription();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Plan-based feature check - settlements requires warehouse feature (Starter+ plan)
  if (!hasFeature('warehouse')) {
    return <FeatureBlockedPage feature="warehouse" />;
  }

  // State
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [orders, setOrders] = useState<InTransitOrder[]>([]);

  // Import results
  const [showResultsDialog, setShowResultsDialog] = useState(false);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [summary, setSummary] = useState<ReconciliationSummary | null>(null);

  // Load orders in transit
  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const allOrders = await ordersService.getAll();

      // Filter only shipped orders
      const shippedOrders = allOrders
        .filter((o: any) => o.sleeves_status === 'shipped')
        .map((o: any) => ({
          id: o.id,
          order_number: o.order_number || o.id.slice(0, 8),
          customer_name: `${o.customer_first_name || ''} ${o.customer_last_name || ''}`.trim() || 'Cliente',
          customer_phone: o.customer_phone || '',
          customer_address: o.customer_address || o.shipping_address?.address1 || '',
          customer_city: o.customer_city || o.shipping_address?.city || '',
          carrier_name: o.carriers?.name || 'Sin courier',
          carrier_id: o.carrier_id,
          total_price: o.total_price || 0,
          cod_amount: o.payment_status !== 'collected' ? (o.total_price || 0) : 0,
          shipped_at: o.in_transit_at || o.updated_at,
          payment_status: o.payment_status,
        }));

      setOrders(shippedOrders);
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

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // Parse CSV file
  const parseCSV = (content: string): ImportResult[] => {
    const lines = content.split('\n').filter(line => line.trim());
    if (lines.length < 2) return [];

    // Get headers (first line)
    const headers = lines[0].split(',').map(h =>
      h.trim().replace(/^["']|["']$/g, '').toUpperCase()
    );

    // Find column indexes
    const orderIdx = headers.findIndex(h =>
      h.includes('PEDIDO') || h.includes('ORDER') || h.includes('NUMERO')
    );
    const statusIdx = headers.findIndex(h =>
      h.includes('ESTADO') || h.includes('STATUS') || h.includes('RESULTADO')
    );
    const amountIdx = headers.findIndex(h =>
      h.includes('COBRADO') || h.includes('COLLECTED') || h.includes('MONTO_COBRADO')
    );
    const reasonIdx = headers.findIndex(h =>
      h.includes('MOTIVO') || h.includes('REASON') || h.includes('FALLA')
    );

    if (orderIdx === -1) {
      throw new Error('No se encontró la columna de número de pedido');
    }

    const results: ImportResult[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v =>
        v.trim().replace(/^["']|["']$/g, '')
      );

      const orderNumber = values[orderIdx];
      if (!orderNumber) continue;

      const statusValue = statusIdx !== -1 ? values[statusIdx]?.toUpperCase() : '';
      const collectedAmount = amountIdx !== -1 ? parseFloat(values[amountIdx]) || 0 : 0;
      const failureReason = reasonIdx !== -1 ? values[reasonIdx] : '';

      // Determine status from CSV value
      let status: ImportResult['status'] = 'not_found';

      if (statusValue.includes('ENTREG') || statusValue.includes('DELIVER') || statusValue === 'OK' || statusValue === 'SI') {
        status = 'delivered';
      } else if (statusValue.includes('RECHAZ') || statusValue.includes('REJECT')) {
        status = 'rejected';
      } else if (statusValue.includes('FALL') || statusValue.includes('FAIL') || statusValue.includes('NO') || statusValue.includes('PEND')) {
        status = 'failed';
      } else if (statusValue) {
        // If there's any status value but we couldn't match it, treat as failed
        status = 'failed';
      }

      // Find matching order
      const matchingOrder = orders.find(o =>
        o.order_number === orderNumber ||
        o.order_number.includes(orderNumber) ||
        orderNumber.includes(o.order_number)
      );

      if (!matchingOrder) {
        status = 'not_found';
      }

      results.push({
        order_number: orderNumber,
        status,
        collected_amount: status === 'delivered' ? (collectedAmount || matchingOrder?.cod_amount || 0) : 0,
        failure_reason: failureReason || undefined,
      });
    }

    return results;
  };

  // Process import results
  const processResults = async (results: ImportResult[]) => {
    setProcessing(true);

    const summary: ReconciliationSummary = {
      total: results.length,
      delivered: 0,
      failed: 0,
      rejected: 0,
      notFound: 0,
      totalCollected: 0,
    };

    try {
      for (const result of results) {
        if (result.status === 'not_found') {
          summary.notFound++;
          continue;
        }

        // Find the order
        const order = orders.find(o =>
          o.order_number === result.order_number ||
          o.order_number.includes(result.order_number) ||
          result.order_number.includes(o.order_number)
        );

        if (!order) {
          summary.notFound++;
          continue;
        }

        try {
          if (result.status === 'delivered') {
            // Mark as delivered
            await ordersService.updateStatus(order.id, 'delivered');
            summary.delivered++;
            summary.totalCollected += result.collected_amount || 0;
          } else if (result.status === 'failed' || result.status === 'rejected') {
            // Return to ready_to_ship for re-dispatch
            await ordersService.updateStatus(order.id, 'ready_to_ship');
            if (result.status === 'failed') {
              summary.failed++;
            } else {
              summary.rejected++;
            }
          }
        } catch (err) {
          console.error(`Error updating order ${order.order_number}:`, err);
        }
      }

      setSummary(summary);
      setImportResults(results);
      setShowResultsDialog(true);

      // Reload orders
      await loadOrders();

      toast({
        title: 'Conciliación completada',
        description: `${summary.delivered} entregados, ${summary.failed + summary.rejected} para re-despacho`,
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Error al procesar la conciliación',
      });
    } finally {
      setProcessing(false);
    }
  };

  // Handle file import
  const handleImportCSV = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      const results = parseCSV(content);

      if (results.length === 0) {
        throw new Error('No se encontraron datos válidos en el archivo');
      }

      // Show confirmation before processing
      const delivered = results.filter(r => r.status === 'delivered').length;
      const failed = results.filter(r => r.status === 'failed' || r.status === 'rejected').length;
      const notFound = results.filter(r => r.status === 'not_found').length;

      const confirmProcess = window.confirm(
        `Se encontraron ${results.length} registros:\n\n` +
        `- ${delivered} entregados\n` +
        `- ${failed} no entregados (volverán a despacho)\n` +
        `- ${notFound} no encontrados\n\n` +
        `¿Desea procesar la conciliación?`
      );

      if (confirmProcess) {
        await processResults(results);
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error al leer el archivo',
        description: error.message || 'No se pudo procesar el CSV',
      });
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Calculate totals
  const totalCOD = orders.reduce((sum, o) => sum + o.cod_amount, 0);
  const ordersByCarrier = orders.reduce((acc, o) => {
    const carrier = o.carrier_name || 'Sin courier';
    if (!acc[carrier]) acc[carrier] = { count: 0, cod: 0 };
    acc[carrier].count++;
    acc[carrier].cod += o.cod_amount;
    return acc;
  }, {} as Record<string, { count: number; cod: number }>);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Conciliaciones</h1>
          <p className="text-muted-foreground">
            Importa los resultados de entrega del courier
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={loadOrders} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading || processing || orders.length === 0}
            size="lg"
            className="gap-2"
          >
            {processing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
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
            <CardTitle className="text-sm font-medium">Pedidos en Tránsito</CardTitle>
            <Truck className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{orders.length}</div>
            <p className="text-xs text-muted-foreground">
              Esperando resultado del courier
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
              {formatCurrency(totalCOD)}
            </div>
            <p className="text-xs text-muted-foreground">
              Monto a cobrar por entregas
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Couriers Activos</CardTitle>
            <Package className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Object.keys(ordersByCarrier).length}</div>
            <p className="text-xs text-muted-foreground">
              Con pedidos en tránsito
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Orders by Carrier */}
      {Object.keys(ordersByCarrier).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Por Transportadora</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3">
              {Object.entries(ordersByCarrier).map(([carrier, data]) => (
                <div
                  key={carrier}
                  className="flex items-center justify-between p-3 border rounded-lg dark:border-gray-800"
                >
                  <div>
                    <p className="font-medium">{carrier}</p>
                    <p className="text-sm text-muted-foreground">
                      {data.count} pedido{data.count !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-green-600">{formatCurrency(data.cod)}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Instructions Card */}
      {orders.length > 0 && (
        <Card className="border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/20">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-base">Cómo importar resultados</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>1. Exporta el CSV desde la sección de <strong>Despacho</strong></p>
            <p>2. El courier completa la columna <strong>ESTADO_ENTREGA</strong> con:</p>
            <ul className="list-disc list-inside ml-4 space-y-1">
              <li><Badge variant="outline" className="text-green-600">ENTREGADO</Badge> - Pedido entregado exitosamente</li>
              <li><Badge variant="outline" className="text-red-600">NO ENTREGADO</Badge> - No se pudo entregar (volverá a despacho)</li>
              <li><Badge variant="outline" className="text-orange-600">RECHAZADO</Badge> - Cliente rechazó (volverá a despacho)</li>
            </ul>
            <p>3. Importa el CSV completado y el sistema actualizará los estados automáticamente</p>
          </CardContent>
        </Card>
      )}

      {/* Orders Table */}
      {loading ? (
        <TableSkeleton columns={6} rows={5} />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="Sin pedidos en tránsito"
          description="Los pedidos despachados aparecerán aquí para conciliar"
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Pedidos en Tránsito</CardTitle>
            <CardDescription>
              {orders.length} pedido{orders.length !== 1 ? 's' : ''} esperando resultado
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Dirección</TableHead>
                  <TableHead>Courier</TableHead>
                  <TableHead className="text-right">COD</TableHead>
                  <TableHead>Despachado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id}>
                    <TableCell className="font-mono font-medium">
                      {order.order_number}
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{order.customer_name}</p>
                        <p className="text-xs text-muted-foreground">{order.customer_phone}</p>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <p className="truncate">{order.customer_address}</p>
                      {order.customer_city && (
                        <p className="text-xs text-muted-foreground">{order.customer_city}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{order.carrier_name}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {order.cod_amount > 0 ? (
                        <span className="font-medium text-green-600">
                          {formatCurrency(order.cod_amount)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Pagado</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span className="text-xs">
                          {format(new Date(order.shipped_at), 'dd MMM', { locale: es })}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Results Dialog */}
      <Dialog open={showResultsDialog} onOpenChange={setShowResultsDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Conciliación Completada</DialogTitle>
            <DialogDescription>
              Resumen de los resultados importados
            </DialogDescription>
          </DialogHeader>

          {summary && (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium">Entregados</span>
                  </div>
                  <p className="text-2xl font-bold text-green-600 mt-1">{summary.delivered}</p>
                </div>

                <div className="p-3 bg-red-50 dark:bg-red-950/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-600" />
                    <span className="text-sm font-medium">Para Re-despacho</span>
                  </div>
                  <p className="text-2xl font-bold text-red-600 mt-1">{summary.failed + summary.rejected}</p>
                </div>
              </div>

              {/* COD Collected */}
              {summary.totalCollected > 0 && (
                <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <DollarSign className="h-5 w-5 text-emerald-600" />
                      <span className="font-medium">COD Cobrado</span>
                    </div>
                    <span className="text-xl font-bold text-emerald-600">
                      {formatCurrency(summary.totalCollected)}
                    </span>
                  </div>
                </div>
              )}

              {/* Not Found Warning */}
              {summary.notFound > 0 && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      {summary.notFound} pedido{summary.notFound !== 1 ? 's' : ''} no encontrado{summary.notFound !== 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      Verifica que los números de pedido coincidan
                    </p>
                  </div>
                </div>
              )}

              {/* Info about failed orders */}
              {(summary.failed + summary.rejected) > 0 && (
                <p className="text-sm text-muted-foreground">
                  Los pedidos no entregados han vuelto a la sección de Despacho para ser re-despachados.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setShowResultsDialog(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
