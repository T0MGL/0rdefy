import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/utils/logger';
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
  Code,
  FileJson,
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

// Payload MINIMO - lo mas simple posible
const PAYLOAD_MINIMO = {
  customer: {
    name: "Juan Perez",
    phone: "0981123456"
  },
  shipping_address: {
    address: "Av. Espana 1234",
    city: "Asuncion"
  },
  items: [
    {
      name: "Mi Producto",
      quantity: 1,
      price: 150000
    }
  ],
  totals: {
    total: 150000
  },
  payment_method: "cash_on_delivery"
};

// Payload COMPLETO - todos los campos
const PAYLOAD_COMPLETO = {
  idempotency_key: "landing-12345",
  customer: {
    name: "Juan Perez",
    email: "juan@email.com",
    phone: "0981123456"
  },
  shipping_address: {
    address: "Av. Espana 1234 c/ Brasil",
    city: "Asuncion",
    reference: "Casa blanca, porton negro",
    notes: "Entregar despues de las 6pm"
  },
  items: [
    {
      name: "NOCTE Glasses Pack Pareja",
      sku: "NOCTE-GLASSES-PAREJA",
      quantity: 1,
      price: 299000
    }
  ],
  totals: {
    subtotal: 299000,
    shipping: 30000,
    total: 329000
  },
  payment_method: "cash_on_delivery",
  metadata: {
    source: "landing-nocte",
    campaign: "promo-enero"
  }
};

// Payload con Google Maps
const PAYLOAD_MAPS = {
  customer: {
    name: "Maria Garcia",
    phone: "0982456789"
  },
  shipping_address: {
    google_maps_url: "https://maps.google.com/?q=-25.2867,-57.6470",
    notes: "Casa de dos pisos"
  },
  items: [
    {
      name: "Producto",
      quantity: 1,
      price: 50000
    }
  ],
  totals: {
    total: 50000
  },
  payment_method: "cash_on_delivery"
};

// Funcion para generar ejemplo de cURL
const generateCurlExample = (url: string, apiKey: string) => `curl -X POST '${url}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-API-Key: ${apiKey}' \\
  -d '${JSON.stringify(PAYLOAD_MINIMO)}'`;

// Funcion para generar ejemplo de JavaScript
const generateJsExample = (url: string, apiKey: string) => `// Enviar pedido a Ordefy
async function enviarPedido(datos) {
  const response = await fetch('${url}', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': '${apiKey}'
    },
    body: JSON.stringify({
      customer: {
        name: datos.nombre,
        phone: datos.telefono
      },
      shipping_address: {
        address: datos.direccion,
        city: datos.ciudad
      },
      items: [{
        name: datos.producto,
        quantity: 1,
        price: datos.precio
      }],
      totals: { total: datos.precio },
      payment_method: 'cash_on_delivery'
    })
  });

  const result = await response.json();
  if (result.success) {
    console.log('Pedido creado:', result.order_number);
  }
}`;

// Funcion para generar ejemplo de PHP
const generatePhpExample = (url: string, apiKey: string) => `<?php
// Enviar pedido a Ordefy
$payload = [
  'customer' => [
    'name' => $_POST['nombre'],
    'phone' => $_POST['telefono']
  ],
  'shipping_address' => [
    'address' => $_POST['direccion'],
    'city' => $_POST['ciudad']
  ],
  'items' => [[
    'name' => $_POST['producto'],
    'quantity' => 1,
    'price' => (int)$_POST['precio']
  ]],
  'totals' => ['total' => (int)$_POST['precio']],
  'payment_method' => 'cash_on_delivery'
];

$ch = curl_init('${url}');
curl_setopt_array($ch, [
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_POST => true,
  CURLOPT_POSTFIELDS => json_encode($payload),
  CURLOPT_HTTPHEADER => [
    'Content-Type: application/json',
    'X-API-Key: ${apiKey}'
  ]
]);

$result = json_decode(curl_exec($ch), true);
if ($result['success']) {
  echo "Pedido: " . $result['order_number'];
}
?>`;

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
      logger.error('[ExternalWebhookManagement] Error loading config:', error);
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
      logger.error('[ExternalWebhookManagement] Error loading logs:', error);
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
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="config">Config</TabsTrigger>
            <TabsTrigger value="payload">Payload</TabsTrigger>
            <TabsTrigger value="codigo">Codigo</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
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
            {/* Payload Minimo */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <FileJson className="h-4 w-4 text-green-500" />
                  Payload Minimo (copiar y pegar)
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(JSON.stringify(PAYLOAD_MINIMO, null, 2), 'payloadMin')}
                >
                  {copied === 'payloadMin' ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 mr-1" />
                  ) : (
                    <Copy className="h-4 w-4 mr-1" />
                  )}
                  Copiar
                </Button>
              </div>
              <pre className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-xs overflow-x-auto max-h-[180px] font-mono">
                {JSON.stringify(PAYLOAD_MINIMO, null, 2)}
              </pre>
            </div>

            {/* Payload Completo */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <FileJson className="h-4 w-4" />
                  Payload Completo (todos los campos)
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(JSON.stringify(PAYLOAD_COMPLETO, null, 2), 'payloadFull')}
                >
                  {copied === 'payloadFull' ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 mr-1" />
                  ) : (
                    <Copy className="h-4 w-4 mr-1" />
                  )}
                  Copiar
                </Button>
              </div>
              <pre className="p-3 rounded-lg bg-muted/50 border text-xs overflow-x-auto max-h-[180px] font-mono">
                {JSON.stringify(PAYLOAD_COMPLETO, null, 2)}
              </pre>
            </div>

            {/* Con Google Maps */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <FileJson className="h-4 w-4 text-blue-500" />
                  Con Google Maps (sin direccion manual)
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(JSON.stringify(PAYLOAD_MAPS, null, 2), 'payloadMaps')}
                >
                  {copied === 'payloadMaps' ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 mr-1" />
                  ) : (
                    <Copy className="h-4 w-4 mr-1" />
                  )}
                  Copiar
                </Button>
              </div>
              <pre className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs overflow-x-auto max-h-[140px] font-mono">
                {JSON.stringify(PAYLOAD_MAPS, null, 2)}
              </pre>
            </div>

            {/* Campos */}
            <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
              <Label className="text-sm font-medium">Campos Requeridos</Label>
              <div className="grid grid-cols-2 gap-1 text-xs">
                <code className="text-green-600">customer.name</code>
                <span className="text-muted-foreground">Nombre</span>
                <code className="text-green-600">customer.phone</code>
                <span className="text-muted-foreground">Telefono</span>
                <code className="text-green-600">shipping_address.address</code>
                <span className="text-muted-foreground">Direccion</span>
                <code className="text-green-600">shipping_address.city</code>
                <span className="text-muted-foreground">Ciudad</span>
                <code className="text-green-600">items[].name</code>
                <span className="text-muted-foreground">Producto</span>
                <code className="text-green-600">items[].quantity</code>
                <span className="text-muted-foreground">Cantidad</span>
                <code className="text-green-600">items[].price</code>
                <span className="text-muted-foreground">Precio</span>
                <code className="text-green-600">totals.total</code>
                <span className="text-muted-foreground">Total</span>
                <code className="text-green-600">payment_method</code>
                <span className="text-muted-foreground">cash_on_delivery</span>
              </div>
            </div>
          </TabsContent>

          {/* Tab: Codigo */}
          <TabsContent value="codigo" className="flex-1 overflow-y-auto space-y-4 mt-4">
            {/* cURL */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <Code className="h-4 w-4" />
                  cURL (Terminal)
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(
                    generateCurlExample(config?.webhook_url || 'TU_URL', newApiKey || config?.api_key_prefix || 'TU_API_KEY'),
                    'curl'
                  )}
                >
                  {copied === 'curl' ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 mr-1" />
                  ) : (
                    <Copy className="h-4 w-4 mr-1" />
                  )}
                  Copiar
                </Button>
              </div>
              <pre className="p-3 rounded-lg bg-zinc-900 text-zinc-100 text-xs overflow-x-auto max-h-[120px] font-mono">
                {generateCurlExample(config?.webhook_url || 'TU_URL', newApiKey || config?.api_key_prefix || 'TU_API_KEY')}
              </pre>
            </div>

            {/* JavaScript */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <Code className="h-4 w-4 text-yellow-500" />
                  JavaScript (fetch)
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(
                    generateJsExample(config?.webhook_url || 'TU_URL', newApiKey || config?.api_key_prefix || 'TU_API_KEY'),
                    'js'
                  )}
                >
                  {copied === 'js' ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 mr-1" />
                  ) : (
                    <Copy className="h-4 w-4 mr-1" />
                  )}
                  Copiar
                </Button>
              </div>
              <pre className="p-3 rounded-lg bg-zinc-900 text-zinc-100 text-xs overflow-x-auto max-h-[200px] font-mono">
                {generateJsExample(config?.webhook_url || 'TU_URL', newApiKey || config?.api_key_prefix || 'TU_API_KEY')}
              </pre>
            </div>

            {/* PHP */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <Code className="h-4 w-4 text-purple-500" />
                  PHP (cURL)
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(
                    generatePhpExample(config?.webhook_url || 'TU_URL', newApiKey || config?.api_key_prefix || 'TU_API_KEY'),
                    'php'
                  )}
                >
                  {copied === 'php' ? (
                    <CheckCircle2 className="h-4 w-4 text-green-500 mr-1" />
                  ) : (
                    <Copy className="h-4 w-4 mr-1" />
                  )}
                  Copiar
                </Button>
              </div>
              <pre className="p-3 rounded-lg bg-zinc-900 text-zinc-100 text-xs overflow-x-auto max-h-[200px] font-mono">
                {generatePhpExample(config?.webhook_url || 'TU_URL', newApiKey || config?.api_key_prefix || 'TU_API_KEY')}
              </pre>
            </div>

            {/* Respuesta */}
            <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
              <Label className="text-sm font-medium">Respuesta Exitosa (201)</Label>
              <pre className="text-xs font-mono text-green-600">
{`{
  "success": true,
  "order_id": "uuid...",
  "order_number": "ORD-001234",
  "message": "Order created successfully"
}`}
              </pre>
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
