// Componente para mostrar el estado de sincronizacion de Shopify en tiempo real

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { RefreshCw, CheckCircle2, AlertCircle, Clock, Package, Users, ShoppingCart } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface ShopifyIntegration {
  id: string;
  shop_domain: string;
  shop_name: string;
  status: string;
  last_sync_at: string | null;
  import_products: boolean;
  import_customers: boolean;
  import_orders: boolean;
}

interface ImportJob {
  id: string;
  import_type: string;
  status: string;
  total_items: number;
  processed_items: number;
  failed_items: number;
  success_items: number;
  started_at: string | null;
  completed_at: string | null;
}

interface SyncStatus {
  integration_id: string;
  jobs: ImportJob[];
  overall_status: 'idle' | 'syncing' | 'completed' | 'error';
  total_progress: number;
  last_sync_at: string | null;
}

export function ShopifySyncStatus() {
  const { toast } = useToast();
  const [integration, setIntegration] = useState<ShopifyIntegration | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Cargar configuracion de integracion al montar
  useEffect(() => {
    loadIntegration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll para estado de sincronizacion cada 3 segundos si esta sincronizando
  useEffect(() => {
    if (integration && syncStatus?.overall_status === 'syncing') {
      const interval = setInterval(() => {
        loadSyncStatus(integration.id);
      }, 3000);

      return () => clearInterval(interval);
    }
  }, [integration, syncStatus?.overall_status]);

  const loadIntegration = async () => {
    try {
      const token = localStorage.getItem('auth_token');
      const storeId = localStorage.getItem('current_store_id');

      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/shopify/integration`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Store-ID': storeId || '',
        },
      });

      const data = await response.json();

      if (data.success && data.integration) {
        setIntegration(data.integration);
        loadSyncStatus(data.integration.id);
      }
    } catch (error) {
      console.error('Error loading integration:', error);
    }
  };

  const loadSyncStatus = async (integrationId: string) => {
    try {
      const token = localStorage.getItem('auth_token');
      const storeId = localStorage.getItem('current_store_id');

      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/shopify/import-status/${integrationId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Store-ID': storeId || '',
        },
      });

      const data = await response.json();

      if (data.success) {
        setSyncStatus({
          integration_id: data.integration_id,
          jobs: data.jobs || [],
          overall_status: data.overall_status,
          total_progress: data.total_progress,
          last_sync_at: data.last_sync_at,
        });
      }
    } catch (error) {
      console.error('Error loading sync status:', error);
    }
  };

  const handleManualSync = async (syncType: 'products' | 'customers' | 'orders' | 'all') => {
    if (!integration) return;

    setIsSyncing(true);

    try {
      const token = localStorage.getItem('auth_token');
      const storeId = localStorage.getItem('current_store_id');

      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/shopify/manual-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Store-ID': storeId || '',
        },
        body: JSON.stringify({ sync_type: syncType }),
      });

      const data = await response.json();

      if (data.success) {
        toast({
          title: 'Sincronización iniciada',
          description: 'La sincronización manual ha comenzado. Verás el progreso en tiempo real.',
        });

        // Recargar estado después de un momento
        setTimeout(() => {
          loadSyncStatus(integration.id);
        }, 1000);
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      toast({
        title: 'Error al sincronizar',
        description: error.message || 'No se pudo iniciar la sincronización',
        variant: 'destructive',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const getJobIcon = (importType: string) => {
    switch (importType) {
      case 'products':
        return <Package size={16} />;
      case 'customers':
        return <Users size={16} />;
      case 'orders':
        return <ShoppingCart size={16} />;
      default:
        return <Clock size={16} />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge className="bg-green-500"><CheckCircle2 size={12} className="mr-1" /> Completado</Badge>;
      case 'running':
        return <Badge className="bg-blue-500"><RefreshCw size={12} className="mr-1 animate-spin" /> Sincronizando</Badge>;
      case 'failed':
        return <Badge variant="destructive"><AlertCircle size={12} className="mr-1" /> Error</Badge>;
      case 'pending':
        return <Badge variant="secondary"><Clock size={12} className="mr-1" /> Pendiente</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getJobTypeLabel = (importType: string) => {
    switch (importType) {
      case 'products':
        return 'Productos';
      case 'customers':
        return 'Clientes';
      case 'orders':
        return 'Pedidos';
      default:
        return importType;
    }
  };

  if (!integration) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Estado de Sincronización</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No hay integración de Shopify configurada. Conecta tu tienda para ver el estado de sincronización.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            Estado de Sincronización
            {syncStatus?.overall_status === 'syncing' && (
              <RefreshCw size={18} className="text-primary animate-spin" />
            )}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleManualSync('all')}
            disabled={isSyncing || syncStatus?.overall_status === 'syncing'}
          >
            <RefreshCw size={16} className="mr-2" />
            Sincronizar Todo
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Informacion de la tienda */}
        <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
          <div>
            <p className="font-medium">{integration.shop_name || integration.shop_domain}</p>
            <p className="text-sm text-muted-foreground">{integration.shop_domain}</p>
          </div>
          {integration.last_sync_at && (
            <p className="text-xs text-muted-foreground">
              Última sincronización: {new Date(integration.last_sync_at).toLocaleString('es-ES')}
            </p>
          )}
        </div>

        {/* Progreso general */}
        {syncStatus && syncStatus.overall_status === 'syncing' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Progreso General</span>
              <span className="font-medium">{syncStatus.total_progress}%</span>
            </div>
            <Progress value={syncStatus.total_progress} />
          </div>
        )}

        {/* Lista de trabajos de importacion */}
        {syncStatus && syncStatus.jobs.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Trabajos de Importación</h4>
            {syncStatus.jobs.map((job) => (
              <div key={job.id} className="p-3 border rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {getJobIcon(job.import_type)}
                    <span className="font-medium">{getJobTypeLabel(job.import_type)}</span>
                  </div>
                  {getStatusBadge(job.status)}
                </div>

                {job.status === 'running' && job.total_items > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{job.processed_items} / {job.total_items} items</span>
                      <span>{Math.round((job.processed_items / job.total_items) * 100)}%</span>
                    </div>
                    <Progress value={(job.processed_items / job.total_items) * 100} className="h-1.5" />
                  </div>
                )}

                {job.status === 'completed' && (
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>✅ Exitosos: {job.success_items}</span>
                    {job.failed_items > 0 && (
                      <span className="text-orange-600">⚠️ Fallidos: {job.failed_items}</span>
                    )}
                  </div>
                )}

                {job.started_at && (
                  <p className="text-xs text-muted-foreground">
                    Iniciado: {new Date(job.started_at).toLocaleString('es-ES')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Botones de sincronizacion manual */}
        <div className="grid grid-cols-3 gap-2 pt-2">
          {integration.import_products && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleManualSync('products')}
              disabled={isSyncing || syncStatus?.overall_status === 'syncing'}
            >
              <Package size={14} className="mr-1" />
              Productos
            </Button>
          )}
          {integration.import_customers && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleManualSync('customers')}
              disabled={isSyncing || syncStatus?.overall_status === 'syncing'}
            >
              <Users size={14} className="mr-1" />
              Clientes
            </Button>
          )}
          {integration.import_orders && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleManualSync('orders')}
              disabled={isSyncing || syncStatus?.overall_status === 'syncing'}
            >
              <ShoppingCart size={14} className="mr-1" />
              Pedidos
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
