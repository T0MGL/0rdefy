import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Store, RefreshCw, Package, Users, ShoppingCart, CheckCircle2, Bug, Lock } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useSubscription, FEATURE_MIN_PLAN } from '@/contexts/SubscriptionContext';
import { config } from '@/config';

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

interface ShopifyIntegrationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  onDisconnect?: () => void;
}

export function ShopifyIntegrationModal({ open, onOpenChange, onSuccess, onDisconnect }: ShopifyIntegrationModalProps) {
  const { toast } = useToast();
  const { hasFeature, canUpgrade } = useSubscription();
  const [integration, setIntegration] = useState<ShopifyIntegration | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [debugInfo, setDebugInfo] = useState<any>(null);

  // Check if user has bidirectional sync feature (Growth+ plan)
  const hasBidirectionalSync = hasFeature('shopify_bidirectional');

  // Load Shopify integration when modal opens
  useEffect(() => {
    if (open) {
      loadIntegration();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const loadIntegration = async () => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const storeId = localStorage.getItem('current_store_id');

      const response = await fetch(`${config.api.baseUrl}/api/shopify/integration`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Store-ID': storeId || '',
        },
      });

      const data = await response.json();

      if (data.success && data.integration) {
        setIntegration(data.integration);
      }
    } catch (error) {
      console.error('Error loading integration:', error);
      toast({
        title: 'Error al cargar',
        description: 'No se pudo cargar la configuración de Shopify',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualSync = async (syncType: 'products' | 'customers' | 'orders' | 'all') => {
    if (!integration) return;

    setIsSyncing(true);

    try {
      const token = localStorage.getItem('auth_token');
      const storeId = localStorage.getItem('current_store_id');

      const response = await fetch(`${config.api.baseUrl}/api/shopify/manual-sync`, {
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
          description: 'La sincronización manual ha comenzado. Verás el progreso en la página de Integraciones.',
        });
        onSuccess?.();
        onOpenChange(false);
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

  const handleDebug = async () => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const storeId = localStorage.getItem('current_store_id');

      const response = await fetch(`${config.api.baseUrl}/api/shopify/debug`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Store-ID': storeId || '',
        },
      });

      const data = await response.json();

      if (data.success) {
        setDebugInfo(data.diagnostic);
        setShowDebugInfo(true);
        toast({
          title: '🔍 Diagnóstico completado',
          description: `Productos en Shopify: ${data.diagnostic.shopify_api_test.productCount}, En Ordefy: ${data.diagnostic.products_in_ordefy}`,
        });
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      toast({
        title: 'Error en diagnóstico',
        description: error.message || 'No se pudo obtener información de diagnóstico',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!integration) return;

    const confirmed = window.confirm(
      '¿Estás seguro de que deseas desconectar tu tienda de Shopify?\n\n' +
      'Los datos ya importados se conservarán en Ordefy.\n\n' +
      'IMPORTANTE: También debes desinstalar manualmente la Custom App desde tu panel de Shopify (Settings → Apps → Develop apps → Ordefy Integration → Uninstall).'
    );

    if (!confirmed) return;

    setIsLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const storeId = localStorage.getItem('current_store_id');

      const response = await fetch(`${config.api.baseUrl}/api/shopify/disconnect?shop=${integration.shop_domain}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Store-ID': storeId || '',
        },
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Error al desconectar');
      }

      toast({
        title: '✅ Integración desconectada',
        description: 'Recuerda desinstalar la Custom App desde tu panel de Shopify para completar el proceso.',
        duration: 8000,
      });

      onDisconnect?.();
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: 'Error al desconectar',
        description: error.message || 'No se pudo desconectar la tienda',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader className="hidden">
            <DialogTitle>Cargando</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center py-8">
            <RefreshCw className="h-8 w-8 animate-spin text-primary mb-4" />
            <DialogDescription>Cargando configuración...</DialogDescription>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!integration) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>No hay integración configurada</DialogTitle>
            <DialogDescription>
              No se encontró ninguna integración de Shopify. Por favor, conecta tu tienda primero.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Store className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-xl">Gestionar integración de Shopify</DialogTitle>
              <DialogDescription>
                Sincroniza tus datos y administra la conexión
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Store Information */}
          <div className="p-4 bg-muted/30 rounded-lg space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-lg">{integration.shop_domain}</p>
                <p className="text-sm text-muted-foreground">Tienda conectada</p>
              </div>
              <Badge variant="outline" className="gap-1">
                <CheckCircle2 size={14} className="text-green-600" />
                Activa
              </Badge>
            </div>
            {integration.last_sync_at && (
              <p className="text-xs text-muted-foreground">
                Última sincronización: {new Date(integration.last_sync_at).toLocaleString('es-ES')}
              </p>
            )}
          </div>

          {/* Sync Actions */}
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold mb-3">Sincronización Manual</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Importa productos y clientes desde tu tienda de Shopify
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 p-2 rounded">
                ℹ️ Las nuevas órdenes se cargan automáticamente vía webhook. No sincronizamos órdenes históricas para mantener la precisión de tus analíticas.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Sync All (only products + customers, never orders) - Requires Growth+ plan */}
              {hasBidirectionalSync ? (
                <Button
                  variant="default"
                  className="col-span-2 gap-2"
                  onClick={() => handleManualSync('all')}
                  disabled={isSyncing || isLoading}
                >
                  {isSyncing ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" />
                      Sincronizando...
                    </>
                  ) : (
                    <>
                      <RefreshCw size={16} />
                      Sincronizar Todo (Productos y Clientes)
                    </>
                  )}
                </Button>
              ) : (
                <div className="col-span-2 p-4 rounded-lg border bg-purple-50 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800">
                  <div className="flex items-center gap-3">
                    <Lock className="h-5 w-5 text-purple-600" />
                    <div className="flex-1">
                      <p className="font-medium text-sm text-purple-900 dark:text-purple-100">Sincronización Bidireccional</p>
                      <p className="text-xs text-purple-700 dark:text-purple-300">
                        Disponible en plan Growth. {canUpgrade && <a href="/billing" className="underline hover:no-underline">Ver planes</a>}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Debug Button */}
              <Button
                variant="outline"
                className="col-span-2 gap-2"
                onClick={handleDebug}
                disabled={isLoading || isSyncing}
              >
                <Bug size={16} />
                Ver diagnóstico de importación
              </Button>
            </div>

            {/* Debug Info */}
            {showDebugInfo && debugInfo && (
              <Alert>
                <Bug className="h-4 w-4" />
                <AlertDescription className="space-y-2 mt-2">
                  <div className="text-sm space-y-1">
                    <p><strong>Productos en Ordefy:</strong> {debugInfo.products_in_ordefy}</p>
                    <p><strong>Productos en Shopify:</strong> {debugInfo.shopify_api_test.productCount}</p>
                    <p><strong>Jobs de importación:</strong> {debugInfo.import_jobs.total}</p>
                    {debugInfo.shopify_api_test.error && (
                      <p className="text-destructive"><strong>Error API:</strong> {debugInfo.shopify_api_test.error}</p>
                    )}
                    {debugInfo.import_jobs.jobs.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer font-semibold">Ver jobs</summary>
                        <div className="mt-2 space-y-2 text-xs">
                          {debugInfo.import_jobs.jobs.map((job: any, i: number) => (
                            <div key={i} className="border-l-2 border-primary pl-2">
                              <p><strong>{job.resource}</strong> - {job.status}</p>
                              <p>Procesados: {job.items_processed}/{job.total_items}</p>
                              {job.error && <p className="text-destructive">Error: {job.error}</p>}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* Danger Zone */}
          <div className="pt-4 border-t space-y-3">
            <h3 className="text-sm font-semibold text-destructive">Zona de peligro</h3>
            <Button
              variant="outline"
              className="w-full border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
              onClick={handleDisconnect}
              disabled={isLoading || isSyncing}
            >
              Desconectar tienda de Shopify
            </Button>
            <p className="text-xs text-muted-foreground">
              Esto desconectará la integración con tu tienda. Los datos ya importados se conservarán en Ordefy.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
