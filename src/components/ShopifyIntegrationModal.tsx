import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Store, RefreshCw, Package, Users, ShoppingCart, CheckCircle2 } from 'lucide-react';

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
}

export function ShopifyIntegrationModal({ open, onOpenChange, onSuccess }: ShopifyIntegrationModalProps) {
  const { toast } = useToast();
  const [integration, setIntegration] = useState<ShopifyIntegration | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Load Shopify integration when modal opens
  useEffect(() => {
    if (open) {
      loadIntegration();
    }
  }, [open]);

  const loadIntegration = async () => {
    setIsLoading(true);
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

  const handleDisconnect = async () => {
    if (!integration) return;

    const confirmed = window.confirm(
      '¿Estás seguro de que deseas desconectar tu tienda de Shopify? Esta acción no eliminará tus datos importados.'
    );

    if (!confirmed) return;

    setIsLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const storeId = localStorage.getItem('current_store_id');

      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/shopify-oauth/disconnect?shop=${integration.shop_domain}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Store-ID': storeId || '',
        },
      });

      if (!response.ok) {
        throw new Error('Error al desconectar');
      }

      toast({
        title: 'Tienda desconectada',
        description: 'Tu tienda de Shopify ha sido desconectada exitosamente',
      });

      onSuccess?.();
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
          <div className="flex flex-col items-center justify-center py-8">
            <RefreshCw className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-sm text-muted-foreground">Cargando configuración...</p>
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
                Importa datos manualmente desde tu tienda de Shopify
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Sync All */}
              <Button
                variant="default"
                className="col-span-2 gap-2"
                onClick={() => handleManualSync('all')}
                disabled={isSyncing}
              >
                {isSyncing ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    Sincronizando...
                  </>
                ) : (
                  <>
                    <RefreshCw size={16} />
                    Sincronizar Todo
                  </>
                )}
              </Button>

              {/* Products */}
              {integration.import_products && (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => handleManualSync('products')}
                  disabled={isSyncing}
                >
                  <Package size={16} />
                  Productos
                </Button>
              )}

              {/* Customers */}
              {integration.import_customers && (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => handleManualSync('customers')}
                  disabled={isSyncing}
                >
                  <Users size={16} />
                  Clientes
                </Button>
              )}

              {/* Orders */}
              {integration.import_orders && (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => handleManualSync('orders')}
                  disabled={isSyncing}
                >
                  <ShoppingCart size={16} />
                  Pedidos
                </Button>
              )}
            </div>
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
              Al desconectar, los datos ya importados se conservarán, pero no se sincronizarán nuevos cambios.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
