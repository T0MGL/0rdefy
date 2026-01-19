import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ExportButton } from '@/components/ExportButton';
import { analyticsService, ShippingCostsMetrics, LogisticsMetrics } from '@/services/analytics.service';
import { useDateRange } from '@/contexts/DateRangeContext';
import { FirstTimeWelcomeBanner } from '@/components/FirstTimeTooltip';
import { InfoTooltip } from '@/components/InfoTooltip';
import {
  DollarSign,
  Package,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Wallet,
  CreditCard,
  TrendingUp,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

export default function Logistics() {
  const [isLoading, setIsLoading] = useState(true);
  const [shippingCosts, setShippingCosts] = useState<ShippingCostsMetrics | null>(null);
  const [logisticsMetrics, setLogisticsMetrics] = useState<LogisticsMetrics | null>(null);

  // Use global date range context
  const { getDateRange } = useDateRange();

  // Calculate date ranges from global context
  const dateRange = useMemo(() => {
    const range = getDateRange();
    return {
      startDate: range.from.toISOString().split('T')[0],
      endDate: range.to.toISOString().split('T')[0],
    };
  }, [getDateRange]);

  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        const dateParams = {
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
        };

        const [shippingData, logisticsData] = await Promise.all([
          analyticsService.getShippingCosts(dateParams),
          analyticsService.getLogisticsMetrics(dateParams).catch(() => null),
        ]);

        setShippingCosts(shippingData);
        setLogisticsMetrics(logisticsData);
      } catch (error) {
        logger.error('Error loading logistics data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, [dateRange]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="p-6">
              <div className="space-y-4">
                <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                <div className="h-12 bg-muted animate-pulse rounded" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Prepare data for carrier breakdown chart
  const carrierBreakdown = shippingCosts?.carrierBreakdown || [];
  const carrierChartData = carrierBreakdown.map(c => ({
    name: c.name,
    entregados: c.deliveredCosts,
    enTransito: c.inTransitCosts,
    orders: c.deliveredOrders + c.inTransitOrders,
  }));

  // Pie chart data for payment status
  const paymentStatusData = shippingCosts ? [
    {
      name: 'Pagado a Couriers',
      value: shippingCosts.costs.paidToCarriers,
      color: 'hsl(142, 76%, 45%)', // green
    },
    {
      name: 'A Pagar (Entregados)',
      value: Math.max(0, shippingCosts.costs.toPayCarriers - shippingCosts.costs.paidToCarriers),
      color: 'hsl(48, 96%, 53%)', // yellow
    },
    {
      name: 'En Tránsito',
      value: shippingCosts.costs.inTransit,
      color: 'hsl(217, 91%, 60%)', // blue
    },
  ].filter(item => item.value > 0) : [];

  // Export data for carrier breakdown
  const exportData = carrierBreakdown.map(c => ({
    transportista: c.name,
    pedidos_entregados: c.deliveredOrders,
    costos_entregados: c.deliveredCosts,
    pedidos_en_transito: c.inTransitOrders,
    costos_en_transito: c.inTransitCosts,
    costos_liquidados: c.settledCosts,
    costos_pagados: c.paidCosts,
    pendiente_pago: c.pendingPaymentCosts,
  }));

  return (
    <div className="space-y-6">
      <FirstTimeWelcomeBanner
        moduleId="logistics"
        title="¡Bienvenido a Logística!"
        description="Analiza costos de envío y rendimiento de tus couriers. Visualiza métricas clave de tu operación logística."
        tips={['Ve costos por courier', 'Analiza entregas exitosas', 'Monitorea pagos pendientes']}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-card-foreground">Dashboard Logístico</h2>
          <p className="text-sm text-muted-foreground">
            Seguimiento de costos de envío y pagos a transportistas
          </p>
        </div>
        <ExportButton
          data={exportData}
          filename="logistics-delivery-costs"
          variant="default"
          columns={[
            { header: 'Transportista', key: 'transportista' },
            { header: 'Pedidos Entregados', key: 'pedidos_entregados' },
            {
              header: 'Costos Entregados',
              key: 'costos_entregados',
              format: (val: any) =>
                new Intl.NumberFormat('es-PY', {
                  style: 'currency',
                  currency: 'PYG',
                  maximumFractionDigits: 0,
                }).format(Number(val)),
            },
            { header: 'Pedidos En Tránsito', key: 'pedidos_en_transito' },
            {
              header: 'Costos En Tránsito',
              key: 'costos_en_transito',
              format: (val: any) =>
                new Intl.NumberFormat('es-PY', {
                  style: 'currency',
                  currency: 'PYG',
                  maximumFractionDigits: 0,
                }).format(Number(val)),
            },
            {
              header: 'Costos Pagados',
              key: 'costos_pagados',
              format: (val: any) =>
                new Intl.NumberFormat('es-PY', {
                  style: 'currency',
                  currency: 'PYG',
                  maximumFractionDigits: 0,
                }).format(Number(val)),
            },
            {
              header: 'Pendiente de Pago',
              key: 'pendiente_pago',
              format: (val: any) =>
                new Intl.NumberFormat('es-PY', {
                  style: 'currency',
                  currency: 'PYG',
                  maximumFractionDigits: 0,
                }).format(Number(val)),
            },
          ]}
        />
      </div>

      {/* Main Cost Metrics - 4 columns */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Costos de Envío</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* A Pagar (Entregados) */}
          <Card className="border-yellow-500/30 bg-yellow-50/50 dark:bg-yellow-950/10">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center">
                <Wallet className="mr-2 text-yellow-600" size={18} />
                A Pagar
                <InfoTooltip content="Costos de envío de pedidos ya entregados que todavía no se han liquidado a los transportistas. Este monto se genera cuando un courier entrega un pedido pero aún no se le ha pagado su comisión." />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-card-foreground">
                Gs. {(shippingCosts?.costs.toPayCarriers || 0).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {shippingCosts?.costs.toPayCarriersOrders || 0} pedidos entregados
              </p>
            </CardContent>
          </Card>

          {/* Pagados */}
          <Card className="border-green-500/30 bg-green-50/50 dark:bg-green-950/10">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center">
                <CreditCard className="mr-2 text-green-600" size={18} />
                Pagado
                <InfoTooltip content="Costos de envío que ya fueron liquidados y pagados a los transportistas. Este monto refleja las liquidaciones con estado 'pagado' en el sistema." />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-card-foreground">
                Gs. {(shippingCosts?.costs.paidToCarriers || 0).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {shippingCosts?.settlements.paid || 0} liquidaciones pagadas
              </p>
            </CardContent>
          </Card>

          {/* Pendiente en Tránsito */}
          <Card className="border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/10">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center">
                <Clock className="mr-2 text-blue-600" size={18} />
                En Tránsito
                <InfoTooltip content="Costos de envío de pedidos que están actualmente en camino (despachados pero no entregados). Estos costos se materializarán cuando el courier entregue o devuelva los pedidos." />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-card-foreground">
                Gs. {(shippingCosts?.costs.inTransit || 0).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {shippingCosts?.costs.inTransitOrders || 0} pedidos en tránsito
              </p>
            </CardContent>
          </Card>

          {/* Costo por Entrega */}
          <Card className="border-purple-500/30 bg-purple-50/50 dark:bg-purple-950/10">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center">
                <Package className="mr-2 text-purple-600" size={18} />
                Costo por Entrega
                <InfoTooltip content="Costo promedio de envío por cada pedido entregado exitosamente. Se calcula dividiendo el total de costos de envío entre el número de pedidos entregados." />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-card-foreground">
                Gs. {(shippingCosts?.averages.costPerDelivery || 0).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Promedio por pedido</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Summary Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Total Comprometido */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center">
              <DollarSign className="mr-2 text-orange-600" size={18} />
              Total Comprometido
              <InfoTooltip content="Suma de todos los costos de envío comprometidos: pedidos entregados (por pagar) + pedidos en tránsito. Representa el total de obligaciones con los transportistas." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-card-foreground">
              Gs. {(shippingCosts?.costs.totalCommitted || 0).toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Entregados + En Tránsito
            </p>
          </CardContent>
        </Card>

        {/* Liquidaciones Pendientes */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center">
              <AlertTriangle className="mr-2 text-amber-600" size={18} />
              Liquidaciones Pendientes
              <InfoTooltip content="Liquidaciones ya procesadas pero que aún no se han pagado a los transportistas. Incluye liquidaciones en estado 'pendiente' y 'parcial'." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-card-foreground">
              {shippingCosts?.settlements.pending || 0} + {shippingCosts?.settlements.partial || 0}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Gs. {(shippingCosts?.settlements.totalPending || 0).toLocaleString()} por liquidar
            </p>
          </CardContent>
        </Card>

        {/* Tiempo Promedio de Entrega */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center">
              <TrendingUp className="mr-2 text-teal-600" size={18} />
              Tiempo de Entrega
              <InfoTooltip content="Promedio de días desde la creación del pedido hasta su entrega. Un menor tiempo indica mejor eficiencia logística." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-card-foreground">
              {shippingCosts?.averages.deliveryDays || 0} días
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Promedio de entrega
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Performance Metrics */}
      {logisticsMetrics && logisticsMetrics.totalOrders > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Métricas de Rendimiento</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <Card className="border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center">
                  <CheckCircle2 className="mr-2 text-green-600" size={18} />
                  Tasa de Éxito
                  <InfoTooltip content="Porcentaje de pedidos entregados exitosamente sobre el total de pedidos despachados. Una tasa alta indica operaciones de entrega eficientes." />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-card-foreground">
                  {(100 - logisticsMetrics.failedRate).toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {logisticsMetrics.deliveredOrders} de {logisticsMetrics.totalDispatched} despachados
                </p>
              </CardContent>
            </Card>

            <Card className="border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center">
                  <XCircle className="mr-2 text-red-600" size={18} />
                  Tasa de Fallo
                  <InfoTooltip content="Porcentaje de pedidos que fallaron después del despacho (cancelados en tránsito, devueltos, entregas fallidas). Estos pedidos generan costos de envío sin generar ingresos." />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-card-foreground">
                  {logisticsMetrics.failedRate.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {logisticsMetrics.totalFailed} pedidos fallidos
                </p>
              </CardContent>
            </Card>

            <Card className="border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center">
                  <AlertTriangle className="mr-2 text-orange-600" size={18} />
                  Rechazo en Puerta
                  <InfoTooltip content="Porcentaje de pedidos rechazados por el cliente al momento de la entrega. Causas comunes: cliente no tiene dinero, no reconoce el pedido, o cambió de opinión." />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-card-foreground">
                  {logisticsMetrics.doorRejectionRate.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {logisticsMetrics.doorRejections} rechazos
                </p>
              </CardContent>
            </Card>

            <Card className="border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center">
                  <Clock className="mr-2 text-blue-600" size={18} />
                  Tiempo de Entrega
                  <InfoTooltip content="Promedio de días transcurridos desde la confirmación del pedido hasta la entrega exitosa al cliente." />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-card-foreground">
                  {logisticsMetrics.avgDeliveryDays.toFixed(1)} días
                </p>
                <p className="text-xs text-muted-foreground mt-1">Promedio de entrega</p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Carrier Breakdown Chart */}
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="text-base flex items-center">
              Costos por Transportista
              <InfoTooltip content="Desglose de costos de envío por cada transportista. Muestra los costos de pedidos entregados (ya comprometidos) y en tránsito (pendientes de resultado)." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {carrierChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={carrierChartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="name"
                    className="stroke-muted-foreground"
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <YAxis
                    className="stroke-muted-foreground"
                    tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                    tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      color: 'hsl(var(--card-foreground))',
                    }}
                    formatter={(value: number, name: string) => [
                      `Gs. ${value.toLocaleString()}`,
                      name === 'entregados' ? 'Entregados (A Pagar)' : 'En Tránsito'
                    ]}
                  />
                  <Legend
                    wrapperStyle={{ color: 'hsl(var(--card-foreground))' }}
                    formatter={(value) => value === 'entregados' ? 'Entregados' : 'En Tránsito'}
                  />
                  <Bar dataKey="entregados" fill="hsl(48, 96%, 53%)" name="entregados" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="enTransito" fill="hsl(217, 91%, 60%)" name="enTransito" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No hay datos de transportistas disponibles
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payment Status Pie Chart */}
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="text-base flex items-center">
              Estado de Pagos a Couriers
              <InfoTooltip content="Distribución del estado de pagos a transportistas. Verde = ya pagado, Amarillo = entregado pero no pagado, Azul = en tránsito (pendiente de resultado)." />
            </CardTitle>
          </CardHeader>
          <CardContent>
            {paymentStatusData.length > 0 ? (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width="50%" height={200}>
                  <PieChart>
                    <Pie
                      data={paymentStatusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {paymentStatusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => `Gs. ${value.toLocaleString()}`}
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        color: 'hsl(var(--card-foreground))',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-3">
                  {paymentStatusData.map((item, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="text-sm text-muted-foreground">{item.name}</span>
                      </div>
                      <span className="text-sm font-semibold text-card-foreground">
                        Gs. {item.value.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-[200px] flex items-center justify-center text-muted-foreground">
                No hay datos de pagos disponibles
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Carrier Details Table */}
      <Card className="border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center">
            Detalle por Transportista
            <InfoTooltip content="Tabla detallada con todos los costos por transportista, incluyendo pedidos entregados, en tránsito, liquidados y pagados." />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {carrierBreakdown.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                      Transportista
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                      <div className="flex items-center justify-end gap-1">
                        Entregados
                        <InfoTooltip content="Pedidos entregados exitosamente" side="top" />
                      </div>
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                      <div className="flex items-center justify-end gap-1">
                        A Pagar
                        <InfoTooltip content="Costos de pedidos entregados pendientes de liquidación" side="top" />
                      </div>
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                      <div className="flex items-center justify-end gap-1">
                        En Tránsito
                        <InfoTooltip content="Costos de pedidos actualmente en camino" side="top" />
                      </div>
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                      <div className="flex items-center justify-end gap-1">
                        Liquidado
                        <InfoTooltip content="Costos incluidos en liquidaciones procesadas" side="top" />
                      </div>
                    </th>
                    <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                      <div className="flex items-center justify-end gap-1">
                        Pagado
                        <InfoTooltip content="Costos ya pagados al transportista" side="top" />
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {carrierBreakdown.map((carrier, index) => (
                    <tr
                      key={index}
                      className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors"
                    >
                      <td className="py-4 px-4">
                        <span className="text-sm font-medium text-card-foreground">
                          {carrier.name}
                        </span>
                      </td>
                      <td className="text-right py-4 px-4 text-sm text-card-foreground">
                        {carrier.deliveredOrders}
                        <span className="text-muted-foreground ml-1">pedidos</span>
                      </td>
                      <td className="text-right py-4 px-4">
                        <Badge variant="outline" className="bg-yellow-50 dark:bg-yellow-950/20 text-yellow-700 dark:text-yellow-400 border-yellow-300 dark:border-yellow-700">
                          Gs. {Math.round(carrier.deliveredCosts).toLocaleString()}
                        </Badge>
                      </td>
                      <td className="text-right py-4 px-4">
                        <Badge variant="outline" className="bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700">
                          Gs. {Math.round(carrier.inTransitCosts).toLocaleString()}
                        </Badge>
                      </td>
                      <td className="text-right py-4 px-4 text-sm text-muted-foreground">
                        Gs. {Math.round(carrier.settledCosts).toLocaleString()}
                      </td>
                      <td className="text-right py-4 px-4">
                        <Badge variant="outline" className="bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700">
                          Gs. {Math.round(carrier.paidCosts).toLocaleString()}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-border">
                  <tr className="bg-muted/30">
                    <td className="py-4 px-4">
                      <span className="text-sm font-bold text-card-foreground">TOTAL</span>
                    </td>
                    <td className="text-right py-4 px-4 text-sm font-bold text-card-foreground">
                      {carrierBreakdown.reduce((sum, c) => sum + c.deliveredOrders, 0)} pedidos
                    </td>
                    <td className="text-right py-4 px-4">
                      <Badge className="bg-yellow-500 text-white">
                        Gs. {Math.round(carrierBreakdown.reduce((sum, c) => sum + c.deliveredCosts, 0)).toLocaleString()}
                      </Badge>
                    </td>
                    <td className="text-right py-4 px-4">
                      <Badge className="bg-blue-500 text-white">
                        Gs. {Math.round(carrierBreakdown.reduce((sum, c) => sum + c.inTransitCosts, 0)).toLocaleString()}
                      </Badge>
                    </td>
                    <td className="text-right py-4 px-4 text-sm font-bold text-card-foreground">
                      Gs. {Math.round(carrierBreakdown.reduce((sum, c) => sum + c.settledCosts, 0)).toLocaleString()}
                    </td>
                    <td className="text-right py-4 px-4">
                      <Badge className="bg-green-500 text-white">
                        Gs. {Math.round(carrierBreakdown.reduce((sum, c) => sum + c.paidCosts, 0)).toLocaleString()}
                      </Badge>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              No hay datos de transportistas disponibles
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
