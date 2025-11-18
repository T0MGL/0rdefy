import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TableSkeleton } from '@/components/skeletons/TableSkeleton';
import { Trophy, AlertTriangle, TrendingUp, Package } from 'lucide-react';

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
  const [topCouriers, setTopCouriers] = useState<CourierStats[]>([]);
  const [underperforming, setUnderperforming] = useState<CourierStats[]>([]);

  useEffect(() => {
    fetchPerformanceData();
  }, []);

  const fetchPerformanceData = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const storeId = localStorage.getItem('current_store_id');

      // Fetch all couriers performance
      const allResponse = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/couriers/performance/all`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Store-ID': storeId || '',
        },
      });

      if (allResponse.ok) {
        const allData = await allResponse.json();
        setCouriers(allData.data || []);
      }

      // Fetch top performers
      const topResponse = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/couriers/performance/top?limit=3`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Store-ID': storeId || '',
        },
      });

      if (topResponse.ok) {
        const topData = await topResponse.json();
        setTopCouriers(topData.data || []);
      }

      // Fetch underperforming
      const underResponse = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/couriers/performance/underperforming?threshold=85`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Store-ID': storeId || '',
        },
      });

      if (underResponse.ok) {
        const underData = await underResponse.json();
        setUnderperforming(underData.data || []);
      }
    } catch (error) {
      console.error('Error fetching courier performance:', error);
    } finally {
      setLoading(false);
    }
  };

  const getPerformanceBadge = (rate: number) => {
    if (rate >= 95) return <Badge className="bg-green-500">Excelente</Badge>;
    if (rate >= 85) return <Badge className="bg-blue-500">Bueno</Badge>;
    if (rate >= 75) return <Badge className="bg-yellow-500">Regular</Badge>;
    return <Badge variant="destructive">Bajo</Badge>;
  };

  if (loading) {
    return <TableSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Rendimiento de Repartidores</h1>
        <p className="text-muted-foreground mt-1">
          Métricas de desempeño y estadísticas de entrega
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Top Performers */}
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
                      <span className="text-2xl">{index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}</span>
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

        {/* Needs Improvement */}
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

        {/* Average Stats */}
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
                  <p className="text-xs text-muted-foreground">Tasa de Éxito</p>
                  <p className="text-2xl font-bold">
                    {(
                      couriers.reduce((sum, c) => sum + c.delivery_rate, 0) / couriers.length
                    ).toFixed(1)}%
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

      {/* Detailed Table */}
      <Card>
        <CardHeader>
          <CardTitle>Todos los Repartidores</CardTitle>
          <CardDescription>
            Estadísticas detalladas de rendimiento por repartidor
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
                  <th className="text-center py-3 px-4 font-medium">Tasa de Éxito</th>
                  <th className="text-center py-3 px-4 font-medium">Tiempo Promedio</th>
                  <th className="text-center py-3 px-4 font-medium">Desempeño</th>
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
