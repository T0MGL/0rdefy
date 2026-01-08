import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExportButton } from '@/components/ExportButton';
import { TrendingUp, TrendingDown, DollarSign, Trophy, ShoppingBag } from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { cn } from '@/lib/utils';
import { analyticsService } from '@/services/analytics.service';
import { ordersService } from '@/services/orders.service';
import { useDateRange } from '@/contexts/DateRangeContext';
import { InfoTooltip } from '@/components/InfoTooltip';
import type { DashboardOverview, Product } from '@/types';

const getMarginColor = (margin: number) => {
  if (margin > 40) return 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950';
  if (margin >= 20) return 'text-yellow-600 bg-yellow-50 dark:text-yellow-400 dark:bg-yellow-950';
  return 'text-red-600 bg-red-50 dark:text-red-400 dark:bg-red-950';
};

export function RevenueIntelligence() {
  const [isLoading, setIsLoading] = useState(true);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [topProducts, setTopProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [productFilter, setProductFilter] = useState<'sales' | 'profitability'>('sales');

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

        const [overviewData, productsData, ordersData] = await Promise.all([
          analyticsService.getOverview(dateParams),
          analyticsService.getTopProducts(10, dateParams),
          ordersService.getAll(),
        ]);
        setOverview(overviewData);
        setTopProducts(productsData);
        setOrders(ordersData);
      } catch (error) {
        console.error('Error loading revenue intelligence data:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, [dateRange]);

  if (isLoading || !overview) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="p-6">
              <div className="space-y-4">
                <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                <div className="h-24 bg-muted animate-pulse rounded" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ===== MÉTRICAS REALES (Solo pedidos entregados) =====
  // Usamos métricas "real" para mostrar números precisos de dinero efectivamente cobrado
  const totalRevenue = overview.realRevenue ?? overview.revenue;
  const totalProductCosts = overview.realProductCosts ?? overview.productCosts ?? 0;
  const totalDeliveryCosts = overview.realDeliveryCosts ?? overview.deliveryCosts ?? 0;
  const totalConfirmationCosts = overview.realConfirmationCosts ?? overview.confirmationCosts ?? 0;
  const gasto_publicitario = overview.gasto_publicitario ?? 0;

  // COGS = Costo de productos solamente (sin envío ni publicidad)
  const totalCOGS = totalProductCosts;

  // Margen bruto = Ingresos - Costo de productos
  const grossMargin = overview.realGrossProfit ?? (totalRevenue - totalCOGS);
  const grossMarginPercent = overview.realGrossMargin ?? (totalRevenue > 0 ? ((grossMargin / totalRevenue) * 100) : 0);

  const revenueBreakdown = [
    { name: 'Margen Bruto', value: Math.round(grossMargin), color: 'hsl(142, 76%, 45%)' },
    { name: 'COGS', value: Math.round(totalCOGS), color: 'hsl(0, 84%, 60%)' },
  ];

  // ===== DESGLOSE DE MARGEN NETO =====
  // Margen neto = Ingresos - (Productos + Envío + Publicidad)
  const netProfit = overview.realNetProfit ?? overview.netProfit;

  const netMarginData = [
    { name: 'Bruto', value: Math.round(grossMargin), color: 'hsl(142, 76%, 45%)' },
    { name: 'Gasto Publicitario', value: Math.round(gasto_publicitario), color: 'hsl(217, 91%, 60%)' },
    { name: 'Envío', value: Math.round(totalDeliveryCosts), color: 'hsl(48, 96%, 53%)' },
    { name: 'Confirmación', value: Math.round(totalConfirmationCosts), color: 'hsl(280, 91%, 60%)' },
    { name: 'Ops', value: Math.round(totalProductCosts + totalDeliveryCosts + totalConfirmationCosts + gasto_publicitario - grossMargin), color: 'hsl(0, 0%, 60%)' },
    { name: 'NETO', value: Math.round(netProfit), color: 'hsl(84, 81%, 63%)' },
  ];

  // ===== DESGLOSE DE COSTOS OPERATIVOS =====
  const totalCosts = totalProductCosts + totalDeliveryCosts + totalConfirmationCosts + gasto_publicitario;
  const costBreakdown = [
    { name: 'Productos', value: Math.round(totalProductCosts), color: 'hsl(0, 84%, 60%)' },
    { name: 'Envío', value: Math.round(totalDeliveryCosts), color: 'hsl(48, 96%, 53%)' },
    { name: 'Confirmación', value: Math.round(totalConfirmationCosts), color: 'hsl(280, 91%, 60%)' },
    { name: 'Publicidad', value: Math.round(gasto_publicitario), color: 'hsl(217, 91%, 60%)' },
  ].filter(item => item.value > 0); // Only show non-zero costs

  // Calculate product profitability
  const productProfitability = topProducts.map((product) => {
    const revenue = product.sales * Number(product.price);
    // Use total_cost from backend (includes packaging + additional costs)
    // Fallback to manual calculation if not provided
    const totalUnitCost = product.total_cost
      ? Number(product.total_cost)
      : (Number(product.cost || 0) + Number(product.packaging_cost || 0) + Number(product.additional_costs || 0));
    const cogs = product.sales * totalUnitCost;
    const margin = revenue - cogs;
    const marginPercent = revenue > 0 ? parseFloat(((margin / revenue) * 100).toFixed(1)) : 0;
    const roi = cogs > 0 ? parseFloat(((revenue / cogs) * 100).toFixed(1)) : 0;

    return {
      id: product.id,
      product: product.name,
      units: product.sales,
      stock: product.stock,
      price: Number(product.price),
      revenue: Math.round(revenue),
      cogs: Math.round(cogs),
      marginPercent,
      roi,
      isTopPerformer: marginPercent > 40,
      isTopSeller: true, // Will be marked after sorting
    };
  }).filter(p => p.units > 0);

  // Sort products based on selected filter
  const sortedProducts = [...productProfitability].sort((a, b) => {
    if (productFilter === 'sales') {
      return b.units - a.units; // Sort by sales (descending)
    } else {
      return b.marginPercent - a.marginPercent; // Sort by profitability (descending)
    }
  });

  // Mark top performers based on current filter
  const finalProducts = sortedProducts.map((product, index) => ({
    ...product,
    isTopPerformer: productFilter === 'profitability' ? product.marginPercent > 40 : false,
    isTopSeller: productFilter === 'sales' && index < 3,
  }));

  // Calculate revenue per customer
  const totalCustomers = new Set(orders.map(o => o.customer || o.customer_email)).size;
  const avgRevenuePerCustomer = totalCustomers > 0 ? totalRevenue / totalCustomers : 0;
  const customerRevenues = orders.map(o => o.total || 0).sort((a, b) => a - b);
  const medianRevenue = customerRevenues.length > 0
    ? customerRevenues[Math.floor(customerRevenues.length / 2)]
    : 0;
  const minRevenue = customerRevenues.length > 0 ? customerRevenues[0] : 0;
  const maxRevenue = customerRevenues.length > 0 ? customerRevenues[customerRevenues.length - 1] : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-card-foreground">Revenue Intelligence</h2>
          <p className="text-sm text-muted-foreground">
            Análisis detallado de rentabilidad y márgenes
          </p>
        </div>
        <ExportButton
          data={productProfitability}
          filename="revenue-intelligence"
          variant="default"
          columns={[
            { header: 'Producto', key: 'product' },
            { header: 'Unidades', key: 'units' },
            { header: 'Stock', key: 'stock' },
            {
              header: 'Precio',
              key: 'price',
              format: (val: any) => new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG', maximumFractionDigits: 0 }).format(Number(val))
            },
            {
              header: 'Ingresos',
              key: 'revenue',
              format: (val: any) => new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG', maximumFractionDigits: 0 }).format(Number(val))
            },
            {
              header: 'COGS',
              key: 'cogs',
              format: (val: any) => new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG', maximumFractionDigits: 0 }).format(Number(val))
            },
            { header: 'Margen (%)', key: 'marginPercent', format: (val: any) => `${val}%` },
            { header: 'ROI', key: 'roi', format: (val: any) => `${val}%` },
          ]}
        />
      </div>

      {/* Top Section - 4 Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Card 1: Revenue vs COGS */}
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="text-base">Ingresos vs Costo de Venta</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0">
                <ResponsiveContainer width={100} height={100}>
                  <PieChart>
                    <Pie
                      data={revenueBreakdown}
                      cx="50%"
                      cy="50%"
                      innerRadius={30}
                      outerRadius={45}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {revenueBreakdown.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="text-2xl font-bold text-card-foreground">Gs. {totalRevenue.toLocaleString()}</p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">COGS</span>
                    <span className="font-semibold text-red-600 dark:text-red-400">
                      Gs. {totalCOGS.toLocaleString()} ({totalRevenue > 0 ? ((totalCOGS / totalRevenue) * 100).toFixed(1) : 0}%)
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Margen Bruto</span>
                    <span className="font-semibold text-green-600 dark:text-green-400">
                      Gs. {grossMargin.toLocaleString()} ({grossMarginPercent.toFixed(1)}%)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Net Margin */}
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="text-base flex items-center">
              Margen Neto Real
              <InfoTooltip
                content="Cálculo: (Ventas Totales - Devoluciones) - (Costo de Productos + Costos de Envío + Costos de Empaque). Representa tu ganancia líquida antes de impuestos."
              />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div className="flex-shrink-0">
                <ResponsiveContainer width={100} height={140}>
                  <BarChart data={netMarginData} layout="vertical">
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="name" hide />
                    <Bar dataKey="value" radius={[4, 4, 4, 4]}>
                      {netMarginData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1.5">
                {netMarginData.map((item) => (
                  <div key={item.name} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground flex items-center">
                      {item.name}
                      {item.name === 'NETO' && (
                        <InfoTooltip
                          content="Porcentaje de beneficio que retienes por cada venta. Fórmula: (Beneficio Neto / Ventas Totales) × 100."
                          side="left"
                        />
                      )}
                    </span>
                    <span className="font-semibold text-card-foreground">
                      Gs. {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Revenue per Customer */}
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="text-base">Revenue per Customer</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <DollarSign className="text-primary" size={20} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Promedio</p>
                  <p className="text-2xl font-bold text-card-foreground">
                    Gs. {Math.round(avgRevenuePerCustomer).toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="pt-3 border-t border-border space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Mediano</span>
                  <span className="font-semibold text-card-foreground">
                    Gs. {Math.round(medianRevenue).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Rango</span>
                  <span className="font-semibold text-card-foreground">
                    Gs. {Math.round(minRevenue).toLocaleString()} - {Math.round(maxRevenue).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Cost Breakdown */}
        <Card className="border-primary/20">
          <CardHeader>
            <CardTitle className="text-base">Desglose de Costos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950">
                  <TrendingDown className="text-red-600 dark:text-red-400" size={20} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="text-2xl font-bold text-card-foreground">
                    Gs. {Math.round(totalCosts).toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="pt-3 border-t border-border space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Productos</span>
                  <span className="font-semibold text-card-foreground">
                    Gs. {Math.round(totalProductCosts).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Envío</span>
                  <span className="font-semibold text-orange-600 dark:text-orange-400">
                    Gs. {Math.round(totalDeliveryCosts).toLocaleString()}
                  </span>
                </div>
                {totalConfirmationCosts > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Confirmación</span>
                    <span className="font-semibold text-purple-600 dark:text-purple-400">
                      Gs. {Math.round(totalConfirmationCosts).toLocaleString()}
                    </span>
                  </div>
                )}
                {gasto_publicitario > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Publicidad</span>
                    <span className="font-semibold text-blue-600 dark:text-blue-400">
                      Gs. {Math.round(gasto_publicitario).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Table */}
      <Card className="border-primary/20">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              {productFilter === 'sales' ? 'Productos Más Vendidos' : 'Productos Más Rentables'}
            </CardTitle>
            <div className="flex gap-2">
              <Button
                variant={productFilter === 'sales' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setProductFilter('sales')}
                className="gap-2"
              >
                <ShoppingBag size={16} />
                Más Vendidos
              </Button>
              <Button
                variant={productFilter === 'profitability' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setProductFilter('profitability')}
                className="gap-2"
              >
                <Trophy size={16} />
                Más Rentables
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 text-sm font-medium text-muted-foreground">
                    Producto
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                    Stock
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                    Precio
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                    Unidades
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                    Ingresos
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                    Margen %
                  </th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-muted-foreground">
                    ROI %
                  </th>
                </tr>
              </thead>
              <tbody>
                {finalProducts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      No hay datos disponibles
                    </td>
                  </tr>
                ) : (
                  finalProducts.map((product) => (
                    <tr
                      key={product.id}
                      className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors"
                    >
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-card-foreground">
                            {product.product}
                          </span>
                          {product.isTopSeller && productFilter === 'sales' && (
                            <Badge variant="default" className="text-xs bg-blue-600">
                              <ShoppingBag size={12} className="mr-1" />
                              TOP SELLER
                            </Badge>
                          )}
                          {product.isTopPerformer && productFilter === 'profitability' && (
                            <Badge variant="default" className="text-xs bg-green-600">
                              <Trophy size={12} className="mr-1" />
                              TOP PERFORMER
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="text-right py-4 px-4 text-sm text-card-foreground">
                        {product.stock}
                      </td>
                      <td className="text-right py-4 px-4 text-sm text-card-foreground">
                        Gs. {product.price.toLocaleString()}
                      </td>
                      <td className="text-right py-4 px-4 text-sm text-card-foreground">
                        {product.units}
                      </td>
                      <td className="text-right py-4 px-4 text-sm text-card-foreground">
                        Gs. {product.revenue.toLocaleString()}
                      </td>
                      <td className="text-right py-4 px-4">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm font-semibold',
                            getMarginColor(product.marginPercent)
                          )}
                        >
                          {product.marginPercent}%
                        </span>
                      </td>
                      <td className="text-right py-4 px-4">
                        <span className="inline-flex items-center gap-1 text-sm font-semibold text-green-700 dark:text-green-400">
                          {product.roi > 100 ? (
                            <TrendingUp size={14} />
                          ) : (
                            <TrendingDown size={14} />
                          )}
                          {product.roi}%
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-4">
            {finalProducts.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                No hay datos disponibles
              </div>
            ) : (
              finalProducts.map((product) => (
                <Card key={product.id} className="border-border">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-card-foreground">{product.product}</h4>
                      {product.isTopSeller && productFilter === 'sales' && (
                        <Badge variant="default" className="text-xs bg-blue-600">
                          <ShoppingBag size={10} className="mr-1" />
                          TOP
                        </Badge>
                      )}
                      {product.isTopPerformer && productFilter === 'profitability' && (
                        <Badge variant="default" className="text-xs bg-green-600">
                          <Trophy size={10} className="mr-1" />
                          TOP
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-muted-foreground">Stock</p>
                        <p className="font-medium text-card-foreground">{product.stock}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Precio</p>
                        <p className="font-medium text-card-foreground">
                          Gs. {product.price.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Unidades</p>
                        <p className="font-medium text-card-foreground">{product.units}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Ingresos</p>
                        <p className="font-medium text-card-foreground">
                          Gs. {product.revenue.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Margen</p>
                        <span
                          className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold',
                            getMarginColor(product.marginPercent)
                          )}
                        >
                          {product.marginPercent}%
                        </span>
                      </div>
                      <div>
                        <p className="text-muted-foreground">ROI</p>
                        <p className="font-medium text-green-700 dark:text-green-400">{product.roi}%</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
