import { useParams, Link } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { carriersService, CarrierReview, RatingDistribution } from '@/services/carriers.service';
import { ordersService } from '@/services/orders.service';
import { formatCurrency } from '@/utils/currency';
import { format, formatDistanceToNow } from 'date-fns';
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
  ExternalLink,
  Star,
  MessageSquare,
  User,
  Calendar
} from 'lucide-react';
import { Order } from '@/types';
import { useToast } from '@/hooks/use-toast';

// Safe date formatting helpers
const safeFormatDate = (dateString: string | null | undefined, formatStr: string): string => {
  try {
    if (!dateString) return 'Sin fecha';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Sin fecha';
    return format(date, formatStr, { locale: es });
  } catch {
    return 'Sin fecha';
  }
};

const safeFormatDistance = (dateString: string | null | undefined): string => {
  try {
    if (!dateString) return 'Sin fecha';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Sin fecha';
    return formatDistanceToNow(date, { addSuffix: true, locale: es });
  } catch {
    return 'Sin fecha';
  }
};

const safeNumber = (value: any, decimals: number = 1): string => {
  const num = parseFloat(value);
  if (isNaN(num)) return '0.0';
  return num.toFixed(decimals);
};

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

  // Reviews State
  const [reviews, setReviews] = useState<CarrierReview[]>([]);
  const [ratingDistribution, setRatingDistribution] = useState<RatingDistribution>({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  const [reviewsLoading, setReviewsLoading] = useState(false);

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

          // Fetch reviews for this carrier
          setReviewsLoading(true);
          try {
            const reviewsData = await carriersService.getReviews(foundCarrier.id, { limit: 50 });
            setReviews(reviewsData.reviews);
            setRatingDistribution(reviewsData.rating_distribution);
            // Update carrier with latest rating from reviews endpoint
            if (reviewsData.courier) {
              setCarrier((prev: any) => ({
                ...prev,
                average_rating: reviewsData.courier.average_rating,
                total_ratings: reviewsData.courier.total_ratings
              }));
            }
          } catch (reviewError) {
            logger.error('Error loading reviews:', reviewError);
          } finally {
            setReviewsLoading(false);
          }
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
      safeFormatDate(o.date, 'yyyy-MM-dd'),
      o.shopify_order_number || o.id?.slice(0, 8) || 'N/A',
      `"${(o.customer || '').replace(/"/g, '""')}"`, // Quote and escape for CSV
      `"${(o.neighborhood || '').replace(/"/g, '""')}"`,
      o.cod_amount || 0,
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
              <div className="flex items-center gap-3 mt-1">
                <Badge variant={carrier.is_active ? 'default' : 'secondary'}>
                  {carrier.is_active ? 'Activo' : 'Inactivo'}
                </Badge>
                {(carrier.total_ratings || 0) > 0 && (
                  <div className="flex items-center gap-1.5">
                    <Star size={16} className="fill-yellow-400 text-yellow-400" />
                    <span className="font-semibold">{safeNumber(carrier.average_rating)}</span>
                    <span className="text-sm text-muted-foreground">
                      ({carrier.total_ratings} {carrier.total_ratings === 1 ? 'reseña' : 'reseñas'})
                    </span>
                  </div>
                )}
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
                          {safeFormatDate(order.date, 'dd MMM yyyy')}
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
          {/* Delivery Metrics Cards */}
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

          {/* Rating Summary Section */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Average Rating Card */}
            <Card className="p-6 bg-card">
              <div className="flex items-center gap-2 mb-4">
                <Star className="text-yellow-500" size={20} />
                <h3 className="font-semibold text-card-foreground">Calificación Promedio</h3>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-5xl font-bold text-card-foreground">
                  {safeNumber(carrier?.average_rating)}
                </div>
                <div className="flex flex-col">
                  <div className="flex">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        size={20}
                        className={
                          star <= Math.round(carrier?.average_rating || 0)
                            ? 'fill-yellow-400 text-yellow-400'
                            : 'text-muted-foreground/30'
                        }
                      />
                    ))}
                  </div>
                  <span className="text-sm text-muted-foreground mt-1">
                    {carrier?.total_ratings || 0} calificaciones
                  </span>
                </div>
              </div>
              {(carrier?.total_ratings || 0) === 0 && (
                <p className="text-sm text-muted-foreground mt-4">
                  Aún no hay calificaciones de clientes
                </p>
              )}
            </Card>

            {/* Rating Distribution Card */}
            <Card className="p-6 bg-card lg:col-span-2">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="text-blue-500" size={20} />
                <h3 className="font-semibold text-card-foreground">Distribución de Calificaciones</h3>
              </div>
              {(carrier?.total_ratings || 0) > 0 ? (
                <div className="space-y-3">
                  {[5, 4, 3, 2, 1].map((rating) => {
                    const count = ratingDistribution[rating as keyof RatingDistribution] || 0;
                    const total = carrier?.total_ratings || 1;
                    const percentage = (count / total) * 100;
                    return (
                      <div key={rating} className="flex items-center gap-3">
                        <div className="flex items-center gap-1 w-12">
                          <span className="text-sm font-medium">{rating}</span>
                          <Star size={14} className="fill-yellow-400 text-yellow-400" />
                        </div>
                        <div className="flex-1">
                          <Progress
                            value={percentage}
                            className="h-2"
                          />
                        </div>
                        <span className="text-sm text-muted-foreground w-16 text-right">
                          {count} ({percentage.toFixed(0)}%)
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center justify-center h-32 text-muted-foreground">
                  <p>Sin datos de distribución aún</p>
                </div>
              )}
            </Card>
          </div>

          {/* Customer Reviews Section */}
          <Card className="bg-card">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="text-primary" size={20} />
                <h3 className="font-semibold">Reseñas de Clientes</h3>
                <Badge variant="secondary" className="ml-2">
                  {reviews.length}
                </Badge>
              </div>
            </div>

            {reviewsLoading ? (
              <div className="p-8 text-center text-muted-foreground">
                Cargando reseñas...
              </div>
            ) : reviews.length === 0 ? (
              <div className="p-12 text-center">
                <MessageSquare className="mx-auto text-muted-foreground/50 mb-4" size={48} />
                <h4 className="font-medium text-card-foreground mb-2">Sin reseñas aún</h4>
                <p className="text-sm text-muted-foreground">
                  Las reseñas aparecerán aquí cuando los clientes califiquen sus entregas
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
                {reviews.map((review) => (
                  <div key={review.id} className="p-4 hover:bg-accent/30 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        {/* Header: Customer + Order */}
                        <div className="flex items-center gap-3 mb-2">
                          <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                            <User size={16} className="text-muted-foreground" />
                          </div>
                          <div>
                            <span className="font-medium text-card-foreground">
                              {review.customer_name}
                            </span>
                            <span className="text-muted-foreground mx-2">·</span>
                            <Link
                              to={`/orders/${review.id}`}
                              className="text-sm text-primary hover:underline"
                            >
                              Pedido {review.order_number}
                            </Link>
                          </div>
                        </div>

                        {/* Rating Stars */}
                        <div className="flex items-center gap-2 mb-2">
                          <div className="flex">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Star
                                key={star}
                                size={16}
                                className={
                                  star <= review.rating
                                    ? 'fill-yellow-400 text-yellow-400'
                                    : 'text-muted-foreground/30'
                                }
                              />
                            ))}
                          </div>
                          <Badge
                            variant={
                              review.rating >= 4
                                ? 'default'
                                : review.rating >= 3
                                ? 'secondary'
                                : 'destructive'
                            }
                            className={
                              review.rating >= 4
                                ? 'bg-green-100 text-green-800 hover:bg-green-100'
                                : review.rating >= 3
                                ? ''
                                : ''
                            }
                          >
                            {review.rating === 5
                              ? 'Excelente'
                              : review.rating === 4
                              ? 'Muy Bueno'
                              : review.rating === 3
                              ? 'Bueno'
                              : review.rating === 2
                              ? 'Regular'
                              : 'Malo'}
                          </Badge>
                        </div>

                        {/* Comment */}
                        {review.comment && (
                          <p className="text-sm text-card-foreground bg-muted/50 rounded-lg p-3 mt-2">
                            "{review.comment}"
                          </p>
                        )}
                      </div>

                      {/* Date */}
                      <div className="text-right text-sm text-muted-foreground shrink-0">
                        <div className="flex items-center gap-1">
                          <Calendar size={14} />
                          <span>{safeFormatDistance(review.rated_at)}</span>
                        </div>
                        {review.delivery_date && (
                          <div className="mt-1 text-xs">
                            Entregado: {safeFormatDate(review.delivery_date, 'dd/MM/yyyy')}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}
