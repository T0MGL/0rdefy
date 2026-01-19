import { useParams, Link } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { carriersService } from '@/services/carriers.service';
import { ordersService } from '@/services/orders.service';
import { formatCurrency } from '@/utils/currency';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { logger } from '@/utils/logger';
import {
  ArrowLeft,
  Package,
  AlertCircle,
  TrendingUp,
  DollarSign,
  Download,
  CreditCard,
  Search,
  CheckCircle2,
  MapPin,
  ExternalLink
} from 'lucide-react';
import { Order } from '@/types';
import { useToast } from '@/hooks/use-toast';

export default function CarrierDetail() {
  const { id } = useParams();
  const { toast } = useToast();
  const [carrier, setCarrier] = useState<any>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  // Reconciliation State
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [zoneFilter, setZoneFilter] = useState('');
  const [showReconciled, setShowReconciled] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [allCarriers, ordersResponse] = await Promise.all([
          carriersService.getAll(),
          ordersService.getAll() // Fetching all orders to client-side filter. Optimize later if needed.
        ]);

        const foundCarrier = allCarriers.find((c) => c.id === id);
        setCarrier(foundCarrier);

        const allOrders = ordersResponse.data || [];
        if (foundCarrier) {
          // Filter orders for this carrier
          // Match by carrier_id if available, or fall back to name matching
          const carrierOrders = allOrders.filter(o =>
            o.carrier_id === foundCarrier.id ||
            o.carrier?.toLowerCase() === foundCarrier.name.toLowerCase() ||
            o.carrier?.toLowerCase() === foundCarrier.carrier_name?.toLowerCase()
          );
          setOrders(carrierOrders);
        }

      } catch (error) {
        logger.error('Error loading carrier data:', error);
        toast({ title: 'Error', description: 'No se pudieron cargar los datos', variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [id, toast]);

  // --- METRICS CALCULATION ---
  const metrics = useMemo(() => {
    const total = orders.length;
    const delivered = orders.filter(o => o.status === 'delivered').length;
    const deliveryRate = total > 0 ? (delivered / total) * 100 : 0;

    // Average time (Mock logic or Real if dates exist)
    // For now simple placeholder or basic calc if delivered_at exists

    return {
      total,
      delivered,
      deliveryRate: deliveryRate.toFixed(1),
      // delivered_at - date
    };
  }, [orders]);


  // --- RECONCILIATION LOGIC ---
  const reconciliationData = useMemo(() => {
    // 1. Filter by Delivered (COD implies we collect money upon delivery)
    // 2. Filter by Payment Method (COD/Effective) if applicable? User said "COD".
    //    Usually COD orders have `cod_amount` > 0 over payment_status.
    //    Let's stick to: Status = Delivered AND COD Amount > 0.

    let relevantOrders = orders.filter(o =>
      o.status === 'delivered' &&
      (o.cod_amount || 0) > 0
    );

    // Filter by Reconciliation Status (Paid vs Unpaid)
    relevantOrders = relevantOrders.filter(o => showReconciled ? !!o.reconciled_at : !o.reconciled_at);

    // Filter by Zone (Client side text match on neighborhood/address)
    if (zoneFilter) {
      const lowerFilter = zoneFilter.toLowerCase();
      relevantOrders = relevantOrders.filter(o =>
        (o.neighborhood || '').toLowerCase().includes(lowerFilter) ||
        (o.customer_address || '').toLowerCase().includes(lowerFilter)
      );
    }

    const totalDebt = relevantOrders.reduce((sum, o) => sum + (o.cod_amount || 0), 0);

    return {
      orders: relevantOrders,
      totalDebt
    };
  }, [orders, zoneFilter, showReconciled]);


  // --- ACTIONS ---
  const handleToggleSelect = (orderId: string) => {
    setSelectedOrders(prev =>
      prev.includes(orderId)
        ? prev.filter(id => id !== orderId)
        : [...prev, orderId]
    );
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedOrders(reconciliationData.orders.map(o => o.id));
    } else {
      setSelectedOrders([]);
    }
  };

  const handleExport = () => {
    if (reconciliationData.orders.length === 0) {
      toast({ title: 'Sin datos', description: 'No hay órdenes para exportar', variant: 'outline' });
      return;
    }

    // CSV Generation
    const headers = ['Fecha', 'Orden #', 'Cliente', 'Barrio/Zona', 'Monto COD', 'Estado'];
    const rows = reconciliationData.orders.map(o => [
      format(new Date(o.date), 'yyyy-MM-dd'),
      o.shopify_order_number || o.id.slice(0, 8),
      `"${o.customer}"`, // Quote to handle commas
      `"${o.neighborhood || ''}"`,
      o.cod_amount,
      o.reconciled_at ? 'Pagado' : 'Pendiente'
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `conciliacion_transportadora_${carrier?.name || 'export'}_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSettle = async () => {
    if (selectedOrders.length === 0) return;

    try {
      await ordersService.reconcile(selectedOrders);
      toast({ title: 'Éxito', description: `${selectedOrders.length} órdenes marcadas como pagadas.` });

      // Refresh local state (Optimistic or Refetch)
      // Let's refetch to be safe and simple
      const updatedOrdersResponse = await ordersService.getAll();
      const updatedOrders = updatedOrdersResponse.data || [];
      setOrders(updatedOrders.filter(o =>
        o.carrier_id === carrier.id ||
        o.carrier?.toLowerCase() === carrier.name?.toLowerCase() ||
        o.carrier?.toLowerCase() === carrier.carrier_name?.toLowerCase()
      ));
      setSelectedOrders([]);
    } catch (error) {
      logger.error('Error settling orders:', error);
      toast({ title: 'Error', description: 'Falló el registro del pago.', variant: 'destructive' });
    }
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <p className="text-muted-foreground">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!carrier) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <AlertCircle className="mx-auto text-muted-foreground mb-4" size={48} />
          <h3 className="text-xl font-semibold mb-2">Transportadora no encontrada</h3>
          <Link to="/carriers">
            <Button variant="outline" className="mt-4">
              <ArrowLeft size={16} className="mr-2" />
              Volver a Transportadoras
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/carriers">
          <Button variant="outline" size="icon">
            <ArrowLeft size={18} />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
              <span className="text-2xl font-bold text-primary">
                {carrier.name?.charAt(0) || carrier.carrier_name?.charAt(0) || 'C'}
              </span>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-card-foreground">{carrier.name || carrier.carrier_name}</h2>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={carrier.is_active ? 'default' : 'secondary'}>
                  {carrier.is_active ? 'Activo' : 'Inactivo'}
                </Badge>
              </div>
            </div>
          </div>
        </div>
        <Button>Editar Transportadora</Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="reconciliation" className="space-y-6">
        <TabsList className="bg-muted">
          <TabsTrigger value="reconciliation">Conciliaciones y Deuda</TabsTrigger>
          <TabsTrigger value="overview">Métricas</TabsTrigger>
        </TabsList>

        {/* --- RECONCILIATION TAB --- */}
        <TabsContent value="reconciliation" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Debt Card */}
            <Card className="p-6 bg-card border-l-4 border-l-primary">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">
                {showReconciled ? 'Total Pagado (Histórico)' : 'Total a Cobrar (Deuda)'}
              </h3>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-card-foreground">
                  {formatCurrency(reconciliationData.totalDebt)}
                </span>
                <span className="text-sm text-muted-foreground">
                  en {reconciliationData.orders.length} órdenes
                </span>
              </div>
            </Card>

            {/* Actions / Filters Card */}
            <Card className="p-6 bg-card md:col-span-2 flex flex-col gap-4">
              <div className="flex justify-between items-center">
                <h3 className="font-semibold text-card-foreground">Filtros y Acciones</h3>
                <div className="flex gap-2">
                  <Button
                    variant={showReconciled ? "default" : "outline"}
                    onClick={() => setShowReconciled(!showReconciled)}
                    size="sm"
                  >
                    {showReconciled ? 'Ver Pendientes' : 'Ver Historial Pagados'}
                  </Button>
                </div>
              </div>

              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                  <Label htmlFor="zoneFilter">Filtrar por Zona (Barrio)</Label>
                  <div className="relative mt-1">
                    <MapPin className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="zoneFilter"
                      placeholder="Ej: Villa Morra, Centro..."
                      className="pl-8"
                      value={zoneFilter}
                      onChange={(e) => setZoneFilter(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex items-end gap-2">
                  <Button variant="outline" onClick={handleExport} className="gap-2">
                    <Download size={16} />
                    Exportar
                  </Button>
                  {!showReconciled && (
                    <Button onClick={handleSettle} disabled={selectedOrders.length === 0} className="gap-2">
                      <CreditCard size={16} />
                      Registrar Pago ({selectedOrders.length})
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          </div>

          {/* Orders Table */}
          <Card className="bg-card overflow-hidden">
            <div className="p-4 border-b">
              <h3 className="font-semibold">Detalle de Órdenes ({reconciliationData.orders.length})</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="p-4 w-10">
                      <Checkbox
                        checked={selectedOrders.length === reconciliationData.orders.length && reconciliationData.orders.length > 0}
                        onCheckedChange={handleSelectAll}
                        disabled={showReconciled}
                      />
                    </th>
                    <th className="p-4 font-medium">Fecha</th>
                    <th className="p-4 font-medium">Orden</th>
                    <th className="p-4 font-medium">Cliente / Dirección</th>
                    <th className="p-4 font-medium">Zona</th>
                    <th className="p-4 font-medium">Ubicación</th>
                    <th className="p-4 font-medium text-right">Monto (Gs)</th>
                    <th className="p-4 font-medium text-center">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {reconciliationData.orders.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-muted-foreground">
                        No se encontraron órdenes para este filtro.
                      </td>
                    </tr>
                  ) : (
                    reconciliationData.orders.map(order => (
                      <tr key={order.id} className="hover:bg-accent/50">
                        <td className="p-4">
                          <Checkbox
                            checked={selectedOrders.includes(order.id)}
                            onCheckedChange={() => handleToggleSelect(order.id)}
                            disabled={showReconciled}
                          />
                        </td>
                        <td className="p-4">
                          {format(new Date(order.date), 'dd MMM yyyy', { locale: es })}
                        </td>
                        <td className="p-4 font-mono font-medium">
                          <Link to={`/orders/${order.id}`} className="hover:underline text-primary">
                            #{order.shopify_order_number || order.id.slice(0, 8)}
                          </Link>
                        </td>
                        <td className="p-4">
                          <div className="font-medium">{order.customer}</div>
                          <div className="text-xs text-muted-foreground truncate max-w-[200px]">
                            {order.customer_address || order.address}
                          </div>
                        </td>
                        <td className="p-4">
                          <Badge variant="outline" className="font-normal text-xs">
                            {order.neighborhood || 'Sin Zona'}
                          </Badge>
                        </td>
                        <td className="p-4">
                          {order.google_maps_link ? (
                            <a
                              href={order.google_maps_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-primary hover:underline text-sm"
                            >
                              <MapPin className="h-4 w-4" />
                              Abrir Maps
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">Sin ubicación</span>
                          )}
                        </td>
                        <td className="p-4 text-right font-bold text-card-foreground">
                          {formatCurrency(order.cod_amount || 0)}
                        </td>
                        <td className="p-4 text-center">
                          {order.reconciled_at ? (
                            <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-none">
                              Pagado
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-yellow-700 bg-yellow-100 hover:bg-yellow-100 font-normal">
                              Pendiente
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* --- METRICS OVERVIEW TAB --- */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-6 bg-card">
              <div className="flex items-center gap-3 mb-2">
                <Package className="text-primary" size={20} />
                <span className="text-sm text-muted-foreground">Total Envíos</span>
              </div>
              <p className="text-3xl font-bold text-card-foreground">{metrics.total}</p>
            </Card>
            <Card className="p-6 bg-card">
              <div className="flex items-center gap-3 mb-2">
                <CheckCircle2 className="text-green-600" size={20} />
                <span className="text-sm text-muted-foreground">Entregados</span>
              </div>
              <p className="text-3xl font-bold text-card-foreground">{metrics.delivered}</p>
            </Card>
            <Card className="p-6 bg-card">
              <div className="flex items-center gap-3 mb-2">
                <TrendingUp className="text-blue-600" size={20} />
                <span className="text-sm text-muted-foreground">Tasa de Entrega</span>
              </div>
              <p className="text-3xl font-bold text-card-foreground">{metrics.deliveryRate}%</p>
            </Card>
            <Card className="p-6 bg-card">
              <div className="flex items-center gap-3 mb-2">
                <DollarSign className="text-purple-600" size={20} />
                <span className="text-sm text-muted-foreground">Envíos COD</span>
              </div>
              <p className="text-3xl font-bold text-card-foreground">
                {orders.filter(o => (o.cod_amount || 0) > 0).length}
              </p>
            </Card>
          </div>

          {/* Visual check that we removed the empty regions table as requested */}
          <Card className="p-12 text-center text-muted-foreground bg-muted/20 border-dashed">
            <p>Las métricas detalladas por región han sido removidas para enfocar en la conciliación por zonas.</p>
            <p className="text-sm mt-2">Utilice la pestaña "Conciliaciones" para filtrar por barrios específicos.</p>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}
