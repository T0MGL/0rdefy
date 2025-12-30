// ================================================================
// SHOPIFY DIAGNOSTICS PANEL
// ================================================================
// Debug panel to diagnose Shopify integration issues
// ================================================================

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Info,
  Settings,
  ExternalLink
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { config } from '@/config';

interface WebhookInfo {
  id: string;
  topic: string;
  address: string;
  format: string;
  created_at: string;
}

interface IntegrationInfo {
  id: string;
  shop_domain: string;
  shop_name: string;
  status: string;
  webhook_registration_success?: number;
  webhook_registration_failed?: number;
  webhook_registration_errors?: string[];
  last_webhook_attempt?: string;
}

export function ShopifyDiagnostics() {
  const { toast } = useToast();
  const [integration, setIntegration] = useState<IntegrationInfo | null>(null);
  const [webhooks, setWebhooks] = useState<WebhookInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSettingUpWebhooks, setIsSettingUpWebhooks] = useState(false);

  useEffect(() => {
    loadDiagnostics();
  }, []);

  const loadDiagnostics = async () => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('auth_token');
      const storeId = localStorage.getItem('current_store_id');
      const apiUrl = config.api.baseUrl;

      // Load integration info
      const integrationRes = await fetch(`${apiUrl}/api/shopify/integration`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Store-ID': storeId || '',
        },
      });
      const integrationData = await integrationRes.json();

      if (integrationData.success && integrationData.integration) {
        setIntegration(integrationData.integration);

        // Load webhooks list
        try {
          const webhooksRes = await fetch(`${apiUrl}/api/shopify/webhooks/list`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'X-Store-ID': storeId || '',
            },
          });
          const webhooksData = await webhooksRes.json();

          if (webhooksData.success) {
            setWebhooks(webhooksData.webhooks || []);
          }
        } catch (err) {
          console.error('Error loading webhooks:', err);
        }
      } else {
        setIntegration(null);
      }
    } catch (error) {
      console.error('Error loading diagnostics:', error);
      toast({
        title: 'Error al cargar diagnósticos',
        description: 'No se pudo cargar la información de diagnóstico',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadDiagnostics();
    setIsRefreshing(false);
    toast({
      title: 'Diagnósticos actualizados',
      description: 'La información se ha recargado exitosamente',
    });
  };

  const handleSetupWebhooks = async () => {
    if (!integration) return;

    setIsSettingUpWebhooks(true);
    try {
      const token = localStorage.getItem('auth_token');
      const storeId = localStorage.getItem('current_store_id');
      const apiUrl = config.api.baseUrl;

      const response = await fetch(`${apiUrl}/api/shopify/webhooks/setup`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Store-ID': storeId || '',
        },
      });

      const data = await response.json();

      if (data.success) {
        toast({
          title: 'Webhooks configurados',
          description: `${data.registered} webhooks registrados exitosamente`,
        });
        await loadDiagnostics();
      } else {
        throw new Error(data.error || 'Error configurando webhooks');
      }
    } catch (error: any) {
      toast({
        title: 'Error al configurar webhooks',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSettingUpWebhooks(false);
    }
  };

  const handleVerifyWebhooks = async () => {
    if (!integration) return;

    try {
      const token = localStorage.getItem('auth_token');
      const storeId = localStorage.getItem('current_store_id');
      const apiUrl = config.api.baseUrl;

      const response = await fetch(`${apiUrl}/api/shopify/webhooks/verify`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Store-ID': storeId || '',
        },
      });

      const data = await response.json();

      if (data.success) {
        if (data.valid) {
          toast({
            title: '✅ Webhooks verificados',
            description: 'Todos los webhooks están configurados correctamente',
          });
        } else {
          toast({
            title: '⚠️ Webhooks incompletos',
            description: `${data.missing.length} webhooks faltantes, ${data.misconfigured.length} mal configurados`,
            variant: 'destructive',
          });
        }
      }
    } catch (error: any) {
      toast({
        title: 'Error al verificar webhooks',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-8 w-8 animate-spin text-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!integration) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Diagnósticos de Shopify</CardTitle>
          <CardDescription>
            No hay integración de Shopify configurada
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const expectedWebhooks = [
    'orders/create',
    'orders/updated',
    'products/delete',
    'app/uninstalled'
  ];

  const registeredTopics = webhooks.map(w => w.topic);
  const missingWebhooks = expectedWebhooks.filter(topic => !registeredTopics.includes(topic));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Diagnósticos de Shopify
            </CardTitle>
            <CardDescription>
              Estado detallado de la integración y webhooks
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Integration Status */}
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">Estado de Integración</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Tienda</p>
              <p className="font-medium text-sm">{integration.shop_domain}</p>
            </div>
            <div className="p-3 bg-muted/30 rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Estado</p>
              <Badge variant={integration.status === 'active' ? 'default' : 'secondary'}>
                {integration.status}
              </Badge>
            </div>
          </div>
        </div>

        {/* Webhook Registration Results */}
        {integration.last_webhook_attempt && (
          <div className="space-y-3">
            <h3 className="font-semibold text-sm">Último Intento de Registro de Webhooks</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                <p className="text-xs text-green-700 dark:text-green-300 mb-1">Exitosos</p>
                <p className="text-2xl font-bold text-green-700 dark:text-green-300">
                  {integration.webhook_registration_success || 0}
                </p>
              </div>
              <div className="p-3 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-800">
                <p className="text-xs text-red-700 dark:text-red-300 mb-1">Fallidos</p>
                <p className="text-2xl font-bold text-red-700 dark:text-red-300">
                  {integration.webhook_registration_failed || 0}
                </p>
              </div>
            </div>

            {integration.webhook_registration_errors && integration.webhook_registration_errors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <p className="font-semibold mb-2">Errores de registro:</p>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    {integration.webhook_registration_errors.map((error, i) => (
                      <li key={i}>{error}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Registered Webhooks */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">Webhooks Registrados en Shopify</h3>
            <Badge variant="outline">
              {webhooks.length} / {expectedWebhooks.length}
            </Badge>
          </div>

          {webhooks.length === 0 ? (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                No hay webhooks registrados. Haz clic en "Configurar Webhooks" para registrarlos.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-2">
              {webhooks.map((webhook) => (
                <div
                  key={webhook.id}
                  className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <div>
                      <p className="font-medium text-sm">{webhook.topic}</p>
                      <p className="text-xs text-muted-foreground truncate max-w-md">
                        {webhook.address}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    ID: {webhook.id}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Missing Webhooks */}
        {missingWebhooks.length > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <p className="font-semibold mb-2">Webhooks faltantes ({missingWebhooks.length}):</p>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {missingWebhooks.map((topic) => (
                  <li key={topic}>{topic}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-4 border-t">
          <Button
            variant="default"
            onClick={handleSetupWebhooks}
            disabled={isSettingUpWebhooks}
            className="flex-1"
          >
            {isSettingUpWebhooks ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Configurando...
              </>
            ) : (
              <>
                <Settings className="h-4 w-4 mr-2" />
                Configurar Webhooks
              </>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleVerifyWebhooks}
            className="flex-1"
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Verificar Webhooks
          </Button>
        </div>

        {/* Link to Shopify Admin */}
        <div className="pt-4 border-t">
          <a
            href={`https://${integration.shop_domain}/admin/settings/notifications`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <ExternalLink className="h-4 w-4" />
            Ver webhooks en Shopify Admin
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
