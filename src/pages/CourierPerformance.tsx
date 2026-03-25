import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableSkeleton } from '@/components/skeletons/TableSkeleton';
import { Trophy, AlertTriangle, TrendingUp, Package, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/utils/logger';
import apiClient from '@/services/api.client';

interface CourierStats {
  courier_id: string;
  courier_name: string;
  phone?: string;
  total_deliveries: number;
  successful_deliveries: number;
  failed_deliveries: number;
  delivery_rate: number;
  assigned_orders?: number;
  delivered_orders?: number;
  failed_orders?: number;
  pending_orders?: number;
  avg_delivery_time_hours?: number | null;
}

export default function CourierPerformance() {
  const [couriers, setCouriers] = useState<CourierStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topCouriers, setTopCouriers] = useState<CourierStats[]>([]);
  const [underperforming, setUnderperforming] = useState<CourierStats[]>([]);
  const { toast } = useToast();

  const isMountedRef = useRef(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    fetchPerformanceData();
  }, []);

  const fetchPerformanceData = async () => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    const [allResult, topResult, underResult] = await Promise.allSettled([
      apiClient.get('/couriers/performance/all', { signal: controller.signal }),
      apiClient.get('/couriers/performance/top', { params: { limit: 3 }, signal: controller.signal }),
      apiClient.get('/couriers/performance/underperforming', { params: { threshold: 85 }, signal: controller.signal }),
    ]);

    if (!isMountedRef.current) return;

    let hasAnyData = false;
    const failedCalls: string[] = [];

    if (allResult.status === 'fulfilled') {
      setCouriers(allResult.value.data.data || []);
      hasAnyData = true;
    } else {
      failedCalls.push('rendimiento general');
      logger.error('Failed to fetch all couriers performance:', allResult.reason);
    }

    if (topResult.status === 'fulfilled') {
      setTopCouriers(topResult.value.data.data || []);
      hasAnyData = true;
    } else {
      failedCalls.push('top performers');
      logger.error('Failed to fetch top performers:', topResult.reason);
    }

    if (underResult.status === 'fulfilled') {
      setUnderperforming(underResult.value.data.data || []);
      hasAnyData = true;
    } else {
      failedCalls.push('bajo rendimiento');
      logger.error('Failed to fetch underperforming:', underResult.reason);
    }

    if (failedCalls.length > 0 && hasAnyData) {
      toast({
        variant: 'destructive',
        title: 'Carga parcial',
        description: `No se pudieron cargar: ${failedCalls.join(', ')}`,
      });
    }

    if (!hasAnyData) {
      setError('No se pudieron cargar los datos de rendimiento. Verifica tu conexion e intenta de nuevo.');
    }

    if (isMountedRef.current) setLoading(false);
  };

  const getPerformanceBadge = (rate: number) => {
    if (rate >= 95) return <Badge className="bg-green-500">Excelente</Badge>;
    if (rate >= 85) return <Badge className="bg-blue-500">Bueno</Badge>;
    if (rate >= 75) return <Badge className="bg-yellow-500">Regular</Badge>;
    return <Badge variant="destructive">Bajo</Badge>;
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Rendimiento de Repartidores</h1>
          <p className="text-muted-foreground mt-1">
            Cargando metricas de desempeno...
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-3">
                <div className="h-4 w-32 bg-muted animate-pulse rounded" />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[1, 2, 3].map((j) => (
                    <div key={j} className="flex items-center justify-between">
                      <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                      <div className="h-4 w-12 bg-muted animate-pulse rounded" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <TableSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Rendimiento de Repartidores</h1>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <AlertTriangle className="h-12 w-12 text-destructive" />
            <p className="text-muted-foreground text-center">{error}</p>
            <Button onClick={fetchPerformanceData} variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Reintentar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Rendimiento de Repartidores</h1>
          <p className="text-muted-foreground mt-1">
            Metricas de desempeno y estadisticas de entrega
          </p>
        </div>
        <Button onClick={fetchPerformanceData} variant="outline" size="icon">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Trophy className="h-4 w-4 text-yellow-500" />
              Top Performers
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topCouriers.length > 0 ? (
              <div className="space-y-2">
                {topCouriers.map((courier, index) => (
                  <div key={courier.courier_id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-bold text-muted-foreground">#{index + 1}</span>
                      <div>
                        <p className="font-medium text-sm">{courier.courier_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {courier.total_deliveries} entregas
                        </p>
                      </div>
                    </div>
                    <span className="font-bold text-green-600">
                      {courier.delivery_rate.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No hay datos suficientes</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              Necesitan Mejorar
            </CardTitle>
          </CardHeader>
          <CardContent>
            {underperforming.length > 0 ? (
              <div className="space-y-2">
                {underperforming.slice(0, 3).map((courier) => (
                  <div key={courier.courier_id} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{courier.courier_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {courier.failed_deliveries} fallidas
                      </p>
                    </div>
                    <span className="font-bold text-orange-600">
                      {courier.delivery_rate.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Todos rinden bien</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-500" />
              Promedio General
            </CardTitle>
          </CardHeader>
          <CardContent>
            {couriers.length > 0 ? (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Tasa de Exito</p>
                  <p className="text-2xl font-bold">
                    {(() => {
                      const couriersWithDeliveries = couriers.filter(c => c.total_deliveries > 0);
                      if (couriersWithDeliveries.length === 0) return '0.0';
                      return (
                        couriersWithDeliveries.reduce((sum, c) => sum + c.delivery_rate, 0) / couriersWithDeliveries.length
                      ).toFixed(1);
                    })()}%
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Entregas</p>
                  <p className="text-xl font-semibold">
                    {couriers.reduce((sum, c) => sum + c.total_deliveries, 0)}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sin datos</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Todos los Repartidores</CardTitle>
          <CardDescription>
            Estadisticas detalladas de rendimiento por repartidor
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium">Repartidor</th>
                  <th className="text-center py-3 px-4 font-medium">Total</th>
                  <th className="text-center py-3 px-4 font-medium">Exitosas</th>
                  <th className="text-center py-3 px-4 font-medium">Fallidas</th>
                  <th className="text-center py-3 px-4 font-medium">Pendientes</th>
                  <th className="text-center py-3 px-4 font-medium">Tasa de Exito</th>
                  <th className="text-center py-3 px-4 font-medium">Tiempo Promedio</th>
                  <th className="text-center py-3 px-4 font-medium">Desempeno</th>
                </tr>
              </thead>
              <tbody>
                {couriers.length > 0 ? (
                  couriers.map((courier) => (
                    <tr key={courier.courier_id} className="border-b hover:bg-muted/50">
                      <td className="py-3 px-4">
                        <div>
                          <p className="font-medium">{courier.courier_name}</p>
                          {courier.phone && (
                            <p className="text-xs text-muted-foreground">{courier.phone}</p>
                          )}
                        </div>
                      </td>
                      <td className="text-center py-3 px-4">
                        <Badge variant="outline" className="font-mono">
                          {courier.total_deliveries}
                        </Badge>
                      </td>
                      <td className="text-center py-3 px-4">
                        <span className="text-green-600 font-semibold">
                          {courier.successful_deliveries}
                        </span>
                      </td>
                      <td className="text-center py-3 px-4">
                        <span className="text-red-600 font-semibold">
                          {courier.failed_deliveries}
                        </span>
                      </td>
                      <td className="text-center py-3 px-4">
                        <span className="text-yellow-600 font-semibold">
                          {courier.pending_orders || 0}
                        </span>
                      </td>
                      <td className="text-center py-3 px-4">
                        <span className="text-lg font-bold">
                          {courier.delivery_rate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="text-center py-3 px-4">
                        {courier.avg_delivery_time_hours ? (
                          <span className="text-sm">
                            {courier.avg_delivery_time_hours.toFixed(1)}h
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">N/A</span>
                        )}
                      </td>
                      <td className="text-center py-3 px-4">
                        {getPerformanceBadge(courier.delivery_rate)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="text-center py-8 text-muted-foreground">
                      <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p>No hay repartidores con entregas registradas</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
