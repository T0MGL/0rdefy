import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import {
  Webhook,
  Copy,
  CheckCircle2,
  AlertCircle,
  Loader2,
  RefreshCw,
  Clock,
  XCircle,
  Package,
  AlertTriangle,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  externalWebhookService,
  ExternalWebhookConfig,
  WebhookLog,
} from '@/services/external-webhook.service';

interface ExternalWebhookManagementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDisconnect?: () => void;
}

// Payload example for documentation
const PAYLOAD_EXAMPLE = {
  idempotency_key: "order-unique-id-123",
  customer: {
    name: "Juan Pérez",
    email: "juan@email.com",
    phone: "+595981123456"
  },
  shipping_address: {
    address: "Av. España 1234",
    city: "Asunción",
    country: "Paraguay",
    reference: "Casa blanca, enfrente al supermercado",
    notes: "Entregar después de las 6pm"
  },
  items: [
    {
      name: "Producto Premium",
      sku: "SKU-001",
      quantity: 2,
      price: 150000,
      variant_title: "Talla M"
    }
  ],
  totals: {
    subtotal: 300000,
    shipping: 25000,
    discount: 10000,
    total: 315000
  },
  payment_method: "cash_on_delivery",
  metadata: {
    source: "landing-page",
    campaign: "black-friday"
  }
};

export function ExternalWebhookManagementModal({
  open,
  onOpenChange,
  onDisconnect,
}: ExternalWebhookManagementModalProps) {
  const { toast } = useToast();
  const [config, setConfig] = useState<ExternalWebhookConfig | null>(null);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isDisabling, setIsDisabling] = useState(false);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [logsPage, setLogsPage] = useState(1);
  const [totalLogs, setTotalLogs] = useState(0);

  useEffect(() => {
    if (open) {
      loadConfig();
      loadLogs();
    }
  }, [open]);

  const loadConfig = async () => {
    setIsLoading(true);
    try {
      const result = await externalWebhookService.getConfig();
      if (result.success && result.config) {
        setConfig(result.config);
      }
    } catch (error) {
      console.error('[ExternalWebhookManagement] Error loading config:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadLogs = async (page: number = 1) => {
    try {
      const result = await externalWebhookService.getLogs(page, 10);
      if (result.success) {
        setLogs(result.logs || []);
        setTotalLogs(result.total || 0);
        setLogsPage(page);
      }
    } catch (error) {
      console.error('[ExternalWebhookManagement] Error loading logs:', error);
    }
  };

  const handleRegenerateKey = async () => {
    setIsRegenerating(true);
    try {
      const result = await externalWebhookService.regenerateApiKey();
      if (result.success && result.api_key) {
        setNewApiKey(result.api_key);
        toast({
          title: 'API Key regenerada',
          description: 'La nueva clave ha sido generada. Guárdala de forma segura.',
        });
        loadConfig();
      } else {
        throw new Error(result.error || 'Error al regenerar');
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'No se pudo regenerar la API Key',
        variant: 'destructive',
      });
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleDisable = async () => {
    if (!confirm('¿Estás seguro de que quieres desactivar este webhook? No podrás recibir más pedidos externos.')) {
      return;
    }

    setIsDisabling(true);
    try {
      const result = await externalWebhookService.disable(true);
      if (result.success) {
        toast({
          title: 'Webhook desactivado',
          description: 'El webhook ha sido desactivado exitosamente.',
        });
        onDisconnect?.();
        onOpenChange(false);
      } else {
        throw new Error(result.error || 'Error al desactivar');
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'No se pudo desactivar el webhook',
        variant: 'destructive',
      });
    } finally {
      setIsDisabling(false);
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'No se pudo copiar al portapapeles',
        variant: 'destructive',
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'success':
        return <Badge variant="outline" className="border-green-500 text-green-600"><CheckCircle2 className="w-3 h-3 mr-1" /> Exitoso</Badge>;
      case 'failed':
        return <Badge variant="outline" className="border-red-500 text-red-600"><XCircle className="w-3 h-3 mr-1" /> Error</Badge>;
      case 'duplicate':
        return <Badge variant="outline" className="border-yellow-500 text-yellow-600"><AlertTriangle className="w-3 h-3 mr-1" /> Duplicado</Badge>;
      case 'validation_error':
        return <Badge variant="outline" className="border-orange-500 text-orange-600"><AlertCircle className="w-3 h-3 mr-1" /> Validación</Badge>;
      default:
        return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" /> Pendiente</Badge>;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('es-PY', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Webhook className="h-6 w-6 text-primary" />
            </div>
            <div>
              <DialogTitle>Gestionar Webhook Externo</DialogTitle>
              <DialogDescription>
                {config?.name || 'Webhook Externo'} - {config?.is_active ? 'Activo' : 'Inactivo'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs defaultValue="config" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="config">Configuración</TabsTrigger>
            <TabsTrigger value="payload">Payload</TabsTrigger>
            <TabsTrigger value="logs">Actividad</TabsTrigger>
          </TabsList>

          {/* Tab: Configuración */}
          <TabsContent value="config" className="flex-1 overflow-y-auto space-y-4 mt-4">
            {/* Stats */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg border bg-muted/30">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Package className="h-4 w-4" />
                  Pedidos recibidos
                </div>
                <p className="text-2xl font-bold mt-1">{config?.total_orders_received || 0}</p>
              </div>
              <div className="p-4 rounded-lg border bg-muted/30">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  Último uso
                </div>
                <p className="text-sm font-medium mt-1">
                  {config?.last_used_at ? formatDate(config.last_used_at) : 'Nunca'}
                </p>
              </div>
            </div>

            {/* Webhook URL */}
            <div className="space-y-2">
              <Label>URL del Webhook</Label>
              <div className="flex gap-2">
                <Input
                  value={config?.webhook_url || ''}
                  readOnly
                  className="font-mono text-xs"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(config?.webhook_url || '', 'url')}
                >
                  {copied === 'url' ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            {/* API Key */}
            <div className="space-y-2">
              <Label>API Key</Label>
              {newApiKey ? (
                <Alert className="border-green-500/50 bg-green-500/10">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <AlertDescription>
                    <p className="text-sm font-medium mb-2">Nueva API Key generada:</p>
                    <div className="flex gap-2">
                      <Input
                        value={newApiKey}
                        readOnly
                        className="font-mono text-xs"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => copyToClipboard(newApiKey, 'newKey')}
                      >
                        {copied === 'newKey' ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Guarda esta clave de forma segura, no se mostrará de nuevo.
                    </p>
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="flex gap-2">
                  <Input
                    value={config?.api_key_prefix || 'wh_***...'}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    onClick={handleRegenerateKey}
                    disabled={isRegenerating}
                  >
                    {isRegenerating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    <span className="ml-2">Regenerar</span>
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Incluye esta clave en el header <code className="px-1 py-0.5 rounded bg-muted">X-API-Key</code>
              </p>
            </div>

            {/* Danger Zone */}
            <div className="pt-4 border-t space-y-3">
              <h4 className="text-sm font-semibold text-destructive">Zona de Peligro</h4>
              <Button
                variant="outline"
                className="w-full border-destructive text-destructive hover:bg-destructive/10"
                onClick={handleDisable}
                disabled={isDisabling}
              >
                {isDisabling ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4 mr-2" />
                )}
                Desactivar Webhook
              </Button>
            </div>
          </TabsContent>

          {/* Tab: Payload */}
          <TabsContent value="payload" className="flex-1 overflow-y-auto space-y-4 mt-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Este es el formato del payload que debes enviar en el body de tu petición POST.
              </AlertDescription>
            </Alert>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Ejemplo de Payload</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(JSON.stringify(PAYLOAD_EXAMPLE, null, 2), 'payload')}
                >
                  {copied === 'payload' ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 mr-1" />
                  ) : (
                    <Copy className="h-4 w-4 mr-1" />
                  )}
                  Copiar
                </Button>
              </div>
              <pre className="p-4 rounded-lg bg-muted/50 border text-xs overflow-x-auto max-h-[400px]">
                {JSON.stringify(PAYLOAD_EXAMPLE, null, 2)}
              </pre>
            </div>

            <div className="space-y-2">
              <Label>Headers Requeridos</Label>
              <div className="p-4 rounded-lg bg-muted/50 border space-y-2 font-mono text-xs">
                <div>Content-Type: application/json</div>
                <div>X-API-Key: {config?.api_key_prefix || 'tu_api_key_aqui'}</div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Campos Requeridos</Label>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                <li><code>customer.name</code> - Nombre del cliente</li>
                <li><code>customer.email</code> o <code>customer.phone</code> - Al menos uno requerido</li>
                <li><code>shipping_address.address</code> - Dirección de entrega</li>
                <li><code>shipping_address.city</code> - Ciudad</li>
                <li><code>items[]</code> - Al menos un producto</li>
                <li><code>totals.total</code> - Total del pedido</li>
                <li><code>payment_method</code> - cash_on_delivery | online | pending</li>
              </ul>
            </div>
          </TabsContent>

          {/* Tab: Logs */}
          <TabsContent value="logs" className="flex-1 overflow-y-auto space-y-4 mt-4">
            {logs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No hay actividad registrada</p>
                <p className="text-sm">Los pedidos recibidos aparecerán aquí</p>
              </div>
            ) : (
              <div className="space-y-3">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      {getStatusBadge(log.status)}
                      <span className="text-xs text-muted-foreground">
                        {formatDate(log.created_at)}
                      </span>
                    </div>
                    <div className="text-sm">
                      {log.order_id ? (
                        <span className="font-medium">Orden creada</span>
                      ) : log.error_message ? (
                        <span className="text-destructive">{log.error_message}</span>
                      ) : (
                        <span>Procesando...</span>
                      )}
                    </div>
                    {log.processing_time_ms && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Procesado en {log.processing_time_ms}ms
                      </div>
                    )}
                  </div>
                ))}

                {totalLogs > 10 && (
                  <div className="flex justify-center gap-2 pt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={logsPage <= 1}
                      onClick={() => loadLogs(logsPage - 1)}
                    >
                      Anterior
                    </Button>
                    <span className="text-sm text-muted-foreground py-2">
                      Página {logsPage} de {Math.ceil(totalLogs / 10)}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={logsPage >= Math.ceil(totalLogs / 10)}
                      onClick={() => loadLogs(logsPage + 1)}
                    >
                      Siguiente
                    </Button>
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

export default ExternalWebhookManagementModal;
