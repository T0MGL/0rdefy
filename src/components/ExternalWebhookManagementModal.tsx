import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
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
  Search,
  CheckCheck,
  Plus,
  ChevronDown,
  ChevronRight,
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

// ============================================================================
// PAYLOADS
// ============================================================================

const PAYLOAD_CREAR_MINIMO = {
  customer: {
    name: "Juan Perez",
    phone: "0981123456"
  },
  shipping_address: {
    address: "Av. Espana 1234",
    city: "Asuncion"
  },
  items: [
    { name: "Mi Producto", quantity: 1, price: 150000 }
  ],
  totals: { total: 150000 },
  payment_method: "cash_on_delivery"
};

const PAYLOAD_CREAR_COMPLETO = {
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
    { name: "NOCTE Glasses Pack Pareja", sku: "NOCTE-GLASSES-PAREJA", quantity: 1, price: 299000 }
  ],
  totals: { subtotal: 299000, shipping: 30000, total: 329000 },
  payment_method: "cash_on_delivery",
  metadata: { source: "landing-nocte", campaign: "promo-enero" }
};

const PAYLOAD_CONFIRMAR = {
  order_number: "1315"
};

const PAYLOAD_CONFIRMAR_COMPLETO = {
  order_number: "1315",
  courier_id: "uuid-del-transportista",
  shipping_cost: 30000,
  delivery_zone: "CENTRAL",
  is_pickup: false,
  delivery_preferences: {
    not_before_date: "2026-03-10",
    preferred_time_slot: "afternoon"
  }
};

// ============================================================================
// CODE GENERATORS
// ============================================================================

const genCurlCrear = (url: string, key: string) =>
`curl -X POST '${url}' \\
  -H 'Content-Type: application/json' \\
  -H 'X-API-Key: ${key}' \\
  -d '${JSON.stringify(PAYLOAD_CREAR_MINIMO)}'`;

const genCurlBuscar = (url: string, key: string) =>
`# Por telefono
curl '${url}/lookup?phone=0981123456' \\
  -H 'X-API-Key: ${key}'

# Por numero de orden
curl '${url}/lookup?order_number=1315' \\
  -H 'X-API-Key: ${key}'

# Con filtro de estado
curl '${url}/lookup?order_number=1315&status=pending' \\
  -H 'X-API-Key: ${key}'`;

const genCurlConfirmar = (url: string, key: string) =>
`# Confirmar (el admin asigna transportadora despues)
curl -X POST '${url}/confirm' \\
  -H 'Content-Type: application/json' \\
  -H 'X-API-Key: ${key}' \\
  -d '{"order_number": "1315"}'

# Confirmar con transportadora
curl -X POST '${url}/confirm' \\
  -H 'Content-Type: application/json' \\
  -H 'X-API-Key: ${key}' \\
  -d '${JSON.stringify({ order_number: "1315", courier_id: "uuid-transportista", shipping_cost: 30000 })}'`;

const genJsCrear = (url: string, key: string) =>
`const response = await fetch('${url}', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': '${key}'
  },
  body: JSON.stringify({
    customer: { name: datos.nombre, phone: datos.telefono },
    shipping_address: { address: datos.direccion, city: datos.ciudad },
    items: [{ name: datos.producto, quantity: 1, price: datos.precio }],
    totals: { total: datos.precio },
    payment_method: 'cash_on_delivery'
  })
});
const result = await response.json();
console.log(result.order_number);`;

const genJsBuscar = (url: string, key: string) =>
`const response = await fetch(
  '${url}/lookup?phone=' + telefono,
  { headers: { 'X-API-Key': '${key}' } }
);
const { orders } = await response.json();
orders.forEach(o => console.log(o.order_number, o.status));`;

const genJsConfirmar = (url: string, key: string) =>
`const response = await fetch('${url}/confirm', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': '${key}'
  },
  body: JSON.stringify({ order_number: '1315' })
});
const result = await response.json();
console.log(result.status, result.awaiting_carrier);`;

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function CopyButton({ text, id, copied, onCopy }: { text: string; id: string; copied: string | null; onCopy: (text: string, id: string) => void }) {
  return (
    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onCopy(text, id)}>
      {copied === id ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
      <span className="ml-1 text-xs">Copiar</span>
    </Button>
  );
}

function CollapsibleResponse({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full py-1.5">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {title}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <pre className="p-3 rounded-lg bg-zinc-900 text-zinc-100 text-[11px] overflow-x-auto max-h-[220px] font-mono leading-relaxed">
      {code}
    </pre>
  );
}

// ============================================================================
// ACTION SELECTOR PILLS
// ============================================================================

type ApiAction = 'crear' | 'buscar' | 'confirmar';

const ACTION_CONFIG: Record<ApiAction, { label: string; icon: typeof Plus; method: string; color: string; methodBg: string }> = {
  crear: { label: 'Crear Pedido', icon: Plus, method: 'POST', color: 'text-green-600', methodBg: 'bg-green-500/10 text-green-600 border-green-500/30' },
  buscar: { label: 'Buscar Ordenes', icon: Search, method: 'GET', color: 'text-blue-600', methodBg: 'bg-blue-500/10 text-blue-600 border-blue-500/30' },
  confirmar: { label: 'Confirmar Orden', icon: CheckCheck, method: 'POST', color: 'text-emerald-600', methodBg: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
};

function ActionPills({ selected, onChange }: { selected: ApiAction; onChange: (a: ApiAction) => void }) {
  return (
    <div className="flex gap-1.5">
      {(Object.entries(ACTION_CONFIG) as [ApiAction, typeof ACTION_CONFIG[ApiAction]][]).map(([key, cfg]) => {
        const Icon = cfg.icon;
        const isActive = selected === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              isActive
                ? `${cfg.methodBg} ring-1 ring-current/20`
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            }`}
          >
            <Icon className="h-3 w-3" />
            {cfg.label}
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

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
  const [payloadAction, setPayloadAction] = useState<ApiAction>('crear');
  const [codeAction, setCodeAction] = useState<ApiAction>('crear');

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
    if (!confirm('Desactivar este webhook? No podras recibir mas pedidos externos.')) {
      return;
    }

    setIsDisabling(true);
    try {
      const result = await externalWebhookService.disable(true);
      if (result.success) {
        toast({ title: 'Webhook desactivado' });
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
    } catch {
      toast({ title: 'Error', description: 'No se pudo copiar', variant: 'destructive' });
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
        return <Badge variant="outline" className="border-orange-500 text-orange-600"><AlertCircle className="w-3 h-3 mr-1" /> Validacion</Badge>;
      default:
        return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" /> Pendiente</Badge>;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('es-PY', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  };

  const webhookUrl = config?.webhook_url || 'TU_URL';
  const apiKey = newApiKey || config?.api_key_prefix || 'TU_API_KEY';

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

          {/* ================================================================ */}
          {/* Tab: Configuracion                                               */}
          {/* ================================================================ */}
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
                  Ultimo uso
                </div>
                <p className="text-sm font-medium mt-1">
                  {config?.last_used_at ? formatDate(config.last_used_at) : 'Nunca'}
                </p>
              </div>
            </div>

            {/* Endpoints */}
            <div className="space-y-3">
              <Label>Endpoints</Label>

              {/* Crear */}
              <div className="p-3 rounded-lg border bg-muted/20 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-green-500/10 text-green-600 border-green-500/30">POST</Badge>
                  <span className="text-xs font-medium">Crear Pedido</span>
                </div>
                <div className="flex gap-2">
                  <Input value={webhookUrl} readOnly className="font-mono text-[10px] h-8" />
                  <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => copyToClipboard(webhookUrl, 'url-create')}>
                    {copied === 'url-create' ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>

              {/* Buscar */}
              <div className="p-3 rounded-lg border bg-muted/20 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-blue-500/10 text-blue-600 border-blue-500/30">GET</Badge>
                  <span className="text-xs font-medium">Buscar Ordenes</span>
                </div>
                <div className="flex gap-2">
                  <Input value={`${webhookUrl}/lookup`} readOnly className="font-mono text-[10px] h-8" />
                  <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => copyToClipboard(`${webhookUrl}/lookup`, 'url-lookup')}>
                    {copied === 'url-lookup' ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">?phone=0981... o ?order_number=1315</p>
              </div>

              {/* Confirmar */}
              <div className="p-3 rounded-lg border bg-muted/20 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-emerald-500/10 text-emerald-600 border-emerald-500/30">POST</Badge>
                  <span className="text-xs font-medium">Confirmar Orden</span>
                </div>
                <div className="flex gap-2">
                  <Input value={`${webhookUrl}/confirm`} readOnly className="font-mono text-[10px] h-8" />
                  <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => copyToClipboard(`${webhookUrl}/confirm`, 'url-confirm')}>
                    {copied === 'url-confirm' ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">Sin courier_id = pendiente de asignacion en el dashboard</p>
              </div>
            </div>

            {/* API Key */}
            <div className="space-y-2">
              <Label>API Key</Label>
              {newApiKey ? (
                <Alert className="border-green-500/50 bg-green-500/10">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <AlertDescription>
                    <p className="text-sm font-medium mb-2">Nueva API Key:</p>
                    <div className="flex gap-2">
                      <Input value={newApiKey} readOnly className="font-mono text-xs" />
                      <Button variant="outline" size="icon" onClick={() => copyToClipboard(newApiKey, 'newKey')}>
                        {copied === 'newKey' ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">Guardala, no se mostrara de nuevo.</p>
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="flex gap-2">
                  <Input value={config?.api_key_prefix || 'wh_***...'} readOnly className="font-mono text-xs" />
                  <Button variant="outline" onClick={handleRegenerateKey} disabled={isRegenerating}>
                    {isRegenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    <span className="ml-2">Regenerar</span>
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Header: <code className="px-1 py-0.5 rounded bg-muted">X-API-Key</code>
              </p>
            </div>

            {/* Danger */}
            <div className="pt-4 border-t space-y-3">
              <h4 className="text-sm font-semibold text-destructive">Zona de Peligro</h4>
              <Button
                variant="outline"
                className="w-full border-destructive text-destructive hover:bg-destructive/10"
                onClick={handleDisable}
                disabled={isDisabling}
              >
                {isDisabling ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <XCircle className="h-4 w-4 mr-2" />}
                Desactivar Webhook
              </Button>
            </div>
          </TabsContent>

          {/* ================================================================ */}
          {/* Tab: Payload                                                     */}
          {/* ================================================================ */}
          <TabsContent value="payload" className="flex-1 overflow-y-auto space-y-4 mt-4">
            <ActionPills selected={payloadAction} onChange={setPayloadAction} />

            {/* --- CREAR PEDIDO --- */}
            {payloadAction === 'crear' && (
              <div className="space-y-3">
                {/* Payload minimo */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium flex items-center gap-1.5">
                      <FileJson className="h-3.5 w-3.5 text-green-500" />
                      Payload minimo
                    </Label>
                    <CopyButton text={JSON.stringify(PAYLOAD_CREAR_MINIMO, null, 2)} id="p-crear-min" copied={copied} onCopy={copyToClipboard} />
                  </div>
                  <pre className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-[11px] overflow-x-auto max-h-[200px] font-mono">
                    {JSON.stringify(PAYLOAD_CREAR_MINIMO, null, 2)}
                  </pre>
                </div>

                {/* Payload completo (collapsible) */}
                <CollapsibleResponse title="Ver payload completo (todos los campos)">
                  <div className="space-y-1.5 pl-4">
                    <div className="flex justify-end">
                      <CopyButton text={JSON.stringify(PAYLOAD_CREAR_COMPLETO, null, 2)} id="p-crear-full" copied={copied} onCopy={copyToClipboard} />
                    </div>
                    <pre className="p-3 rounded-lg bg-muted/50 border text-[11px] overflow-x-auto max-h-[240px] font-mono">
                      {JSON.stringify(PAYLOAD_CREAR_COMPLETO, null, 2)}
                    </pre>
                  </div>
                </CollapsibleResponse>

                {/* Campos requeridos */}
                <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
                  <Label className="text-xs font-medium">Campos requeridos</Label>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                    <code className="text-green-600">customer.name</code>
                    <span className="text-muted-foreground">Nombre del cliente</span>
                    <code className="text-green-600">customer.phone</code>
                    <span className="text-muted-foreground">Telefono</span>
                    <code className="text-green-600">shipping_address.address</code>
                    <span className="text-muted-foreground">Direccion</span>
                    <code className="text-green-600">shipping_address.city</code>
                    <span className="text-muted-foreground">Ciudad</span>
                    <code className="text-green-600">items[].name</code>
                    <span className="text-muted-foreground">Nombre del producto</span>
                    <code className="text-green-600">items[].quantity</code>
                    <span className="text-muted-foreground">Cantidad</span>
                    <code className="text-green-600">items[].price</code>
                    <span className="text-muted-foreground">Precio unitario</span>
                    <code className="text-green-600">totals.total</code>
                    <span className="text-muted-foreground">Total del pedido</span>
                    <code className="text-green-600">payment_method</code>
                    <span className="text-muted-foreground">cash_on_delivery | online | pending</span>
                  </div>
                </div>

                {/* Campos opcionales (collapsible) */}
                <CollapsibleResponse title="Ver campos opcionales">
                  <div className="p-3 rounded-lg border bg-muted/20 space-y-2 ml-4">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                      <code className="text-muted-foreground">idempotency_key</code>
                      <span className="text-muted-foreground">Previene duplicados</span>
                      <code className="text-muted-foreground">customer.email</code>
                      <span className="text-muted-foreground">Email del cliente</span>
                      <code className="text-muted-foreground">shipping_address.reference</code>
                      <span className="text-muted-foreground">Referencia (casa blanca...)</span>
                      <code className="text-muted-foreground">shipping_address.notes</code>
                      <span className="text-muted-foreground">Instrucciones de entrega</span>
                      <code className="text-muted-foreground">items[].sku</code>
                      <span className="text-muted-foreground">SKU para mapear producto</span>
                      <code className="text-muted-foreground">totals.subtotal</code>
                      <span className="text-muted-foreground">Subtotal</span>
                      <code className="text-muted-foreground">totals.shipping</code>
                      <span className="text-muted-foreground">Costo de envio</span>
                      <code className="text-muted-foreground">metadata</code>
                      <span className="text-muted-foreground">Datos extra (source, campaign)</span>
                    </div>
                  </div>
                </CollapsibleResponse>

                {/* Respuesta (collapsible) */}
                <CollapsibleResponse title="Ver respuesta exitosa (201)">
                  <pre className="p-3 rounded-lg border bg-muted/20 text-[11px] font-mono text-green-600 ml-4">
{`{
  "success": true,
  "order_id": "uuid",
  "order_number": "ORD-001234",
  "customer_id": "uuid",
  "message": "Order created successfully"
}`}
                  </pre>
                </CollapsibleResponse>
              </div>
            )}

            {/* --- BUSCAR ORDENES --- */}
            {payloadAction === 'buscar' && (
              <div className="space-y-3">
                <div className="p-3 rounded-lg border bg-blue-500/10 border-blue-500/30 space-y-2">
                  <Label className="text-xs font-medium">Query Parameters (al menos uno requerido)</Label>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                    <code className="text-blue-600 font-semibold">phone</code>
                    <span className="text-muted-foreground">Telefono del cliente</span>
                    <code className="text-blue-600 font-semibold">order_number</code>
                    <span className="text-muted-foreground">Numero de orden (ej: 1315)</span>
                  </div>
                  <div className="border-t pt-1.5 mt-1.5">
                    <Label className="text-[10px] text-muted-foreground">Filtros opcionales</Label>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] mt-0.5">
                      <code className="text-muted-foreground">status</code>
                      <span className="text-muted-foreground">pending, confirmed, delivered...</span>
                      <code className="text-muted-foreground">limit</code>
                      <span className="text-muted-foreground">Max resultados (1-100)</span>
                    </div>
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground">
                  No se envia body. Los filtros van como query params en la URL.
                </p>

                {/* Respuesta (collapsible) */}
                <CollapsibleResponse title="Ver respuesta">
                  <pre className="p-3 rounded-lg border bg-muted/20 text-[11px] font-mono text-blue-600 ml-4">
{`{
  "success": true,
  "orders": [{
    "order_number": "#1315",
    "status": "pending",
    "customer_name": "Juan Perez",
    "customer_phone": "0981123456",
    "total_price": 150000,
    "payment_method": "cod",
    "city": "Asuncion",
    "created_at": "2026-03-01T10:00:00Z",
    "items": [{ "name": "Producto", "quantity": 1, "price": 150000 }]
  }],
  "total": 1
}`}
                  </pre>
                </CollapsibleResponse>

                {/* Todos los campos de respuesta (collapsible) */}
                <CollapsibleResponse title="Ver todos los campos de cada orden">
                  <div className="p-3 rounded-lg border bg-muted/20 space-y-1 ml-4">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                      <code>order_number</code><span className="text-muted-foreground">#1315</span>
                      <code>status</code><span className="text-muted-foreground">Estado actual</span>
                      <code>customer_name</code><span className="text-muted-foreground">Nombre</span>
                      <code>customer_phone</code><span className="text-muted-foreground">Telefono</span>
                      <code>customer_email</code><span className="text-muted-foreground">Email</span>
                      <code>address</code><span className="text-muted-foreground">Direccion</span>
                      <code>city</code><span className="text-muted-foreground">Ciudad</span>
                      <code>total_price</code><span className="text-muted-foreground">Total</span>
                      <code>payment_method</code><span className="text-muted-foreground">Metodo de pago</span>
                      <code>is_pickup</code><span className="text-muted-foreground">Retiro en local</span>
                      <code>created_at</code><span className="text-muted-foreground">Fecha creacion</span>
                      <code>confirmed_at</code><span className="text-muted-foreground">Fecha confirmacion</span>
                      <code>items[]</code><span className="text-muted-foreground">Productos</span>
                    </div>
                  </div>
                </CollapsibleResponse>
              </div>
            )}

            {/* --- CONFIRMAR ORDEN --- */}
            {payloadAction === 'confirmar' && (
              <div className="space-y-3">
                {/* Payload simple */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium flex items-center gap-1.5">
                      <FileJson className="h-3.5 w-3.5 text-emerald-500" />
                      Confirmar orden (minimo)
                    </Label>
                    <CopyButton text={JSON.stringify(PAYLOAD_CONFIRMAR, null, 2)} id="p-confirm-min" copied={copied} onCopy={copyToClipboard} />
                  </div>
                  <pre className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] overflow-x-auto font-mono">
                    {JSON.stringify(PAYLOAD_CONFIRMAR, null, 2)}
                  </pre>
                  <p className="text-[10px] text-muted-foreground">
                    La orden se confirma y queda pendiente de asignacion de transportadora desde el dashboard.
                  </p>
                </div>

                {/* Payload completo (collapsible) */}
                <CollapsibleResponse title="Ver payload completo (con transportadora)">
                  <div className="space-y-1.5 pl-4">
                    <div className="flex justify-end">
                      <CopyButton text={JSON.stringify(PAYLOAD_CONFIRMAR_COMPLETO, null, 2)} id="p-confirm-full" copied={copied} onCopy={copyToClipboard} />
                    </div>
                    <pre className="p-3 rounded-lg bg-muted/50 border text-[11px] overflow-x-auto font-mono">
                      {JSON.stringify(PAYLOAD_CONFIRMAR_COMPLETO, null, 2)}
                    </pre>
                  </div>
                </CollapsibleResponse>

                {/* Campos */}
                <div className="p-3 rounded-lg border bg-muted/30 space-y-2">
                  <Label className="text-xs font-medium">Campos</Label>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                    <code className="text-emerald-600 font-semibold">order_number *</code>
                    <span className="text-muted-foreground">Numero de orden (ej: 1315, #1315)</span>
                    <code className="text-muted-foreground">courier_id</code>
                    <span className="text-muted-foreground">UUID transportista (opcional)</span>
                    <code className="text-muted-foreground">is_pickup</code>
                    <span className="text-muted-foreground">true = retiro en local</span>
                    <code className="text-muted-foreground">shipping_cost</code>
                    <span className="text-muted-foreground">Costo de envio</span>
                    <code className="text-muted-foreground">delivery_zone</code>
                    <span className="text-muted-foreground">Zona de entrega</span>
                    <code className="text-muted-foreground">delivery_preferences</code>
                    <span className="text-muted-foreground">Preferencias de entrega</span>
                  </div>
                </div>

                {/* Respuesta (collapsible) */}
                <CollapsibleResponse title="Ver respuesta exitosa">
                  <pre className="p-3 rounded-lg border bg-muted/20 text-[11px] font-mono text-emerald-600 ml-4">
{`{
  "success": true,
  "order_number": "#1315",
  "status": "confirmed",
  "awaiting_carrier": true,
  "confirmed_at": "2026-03-01T12:00:00Z",
  "total_price": 150000,
  "shipping_cost": 0
}`}
                  </pre>
                </CollapsibleResponse>

                {/* Estados validos */}
                <CollapsibleResponse title="Que ordenes se pueden confirmar?">
                  <div className="p-3 rounded-lg border bg-muted/20 text-[11px] ml-4 space-y-1">
                    <p>Solo ordenes con estado <code className="text-emerald-600">pending</code> o <code className="text-emerald-600">contacted</code>.</p>
                    <p className="text-muted-foreground">Si la orden ya esta confirmada, enviada o entregada, devuelve error.</p>
                  </div>
                </CollapsibleResponse>
              </div>
            )}
          </TabsContent>

          {/* ================================================================ */}
          {/* Tab: Codigo                                                      */}
          {/* ================================================================ */}
          <TabsContent value="codigo" className="flex-1 overflow-y-auto space-y-4 mt-4">
            <ActionPills selected={codeAction} onChange={setCodeAction} />

            {/* --- CREAR PEDIDO --- */}
            {codeAction === 'crear' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs flex items-center gap-1.5"><Code className="h-3.5 w-3.5" /> cURL</Label>
                    <CopyButton text={genCurlCrear(webhookUrl, apiKey)} id="c-crear-curl" copied={copied} onCopy={copyToClipboard} />
                  </div>
                  <CodeBlock code={genCurlCrear(webhookUrl, apiKey)} />
                </div>

                <CollapsibleResponse title="Ver ejemplo JavaScript">
                  <div className="pl-4 space-y-1.5">
                    <div className="flex justify-end">
                      <CopyButton text={genJsCrear(webhookUrl, apiKey)} id="c-crear-js" copied={copied} onCopy={copyToClipboard} />
                    </div>
                    <CodeBlock code={genJsCrear(webhookUrl, apiKey)} />
                  </div>
                </CollapsibleResponse>

                <CollapsibleResponse title="Ver respuesta exitosa (201)">
                  <pre className="p-3 rounded-lg border bg-muted/20 text-[11px] font-mono text-green-600 ml-4">
{`{
  "success": true,
  "order_id": "uuid",
  "order_number": "ORD-001234",
  "message": "Order created successfully"
}`}
                  </pre>
                </CollapsibleResponse>
              </div>
            )}

            {/* --- BUSCAR ORDENES --- */}
            {codeAction === 'buscar' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs flex items-center gap-1.5"><Code className="h-3.5 w-3.5" /> cURL</Label>
                    <CopyButton text={genCurlBuscar(webhookUrl, apiKey)} id="c-buscar-curl" copied={copied} onCopy={copyToClipboard} />
                  </div>
                  <CodeBlock code={genCurlBuscar(webhookUrl, apiKey)} />
                </div>

                <CollapsibleResponse title="Ver ejemplo JavaScript">
                  <div className="pl-4 space-y-1.5">
                    <div className="flex justify-end">
                      <CopyButton text={genJsBuscar(webhookUrl, apiKey)} id="c-buscar-js" copied={copied} onCopy={copyToClipboard} />
                    </div>
                    <CodeBlock code={genJsBuscar(webhookUrl, apiKey)} />
                  </div>
                </CollapsibleResponse>
              </div>
            )}

            {/* --- CONFIRMAR ORDEN --- */}
            {codeAction === 'confirmar' && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs flex items-center gap-1.5"><Code className="h-3.5 w-3.5" /> cURL</Label>
                    <CopyButton text={genCurlConfirmar(webhookUrl, apiKey)} id="c-confirm-curl" copied={copied} onCopy={copyToClipboard} />
                  </div>
                  <CodeBlock code={genCurlConfirmar(webhookUrl, apiKey)} />
                </div>

                <CollapsibleResponse title="Ver ejemplo JavaScript">
                  <div className="pl-4 space-y-1.5">
                    <div className="flex justify-end">
                      <CopyButton text={genJsConfirmar(webhookUrl, apiKey)} id="c-confirm-js" copied={copied} onCopy={copyToClipboard} />
                    </div>
                    <CodeBlock code={genJsConfirmar(webhookUrl, apiKey)} />
                  </div>
                </CollapsibleResponse>

                <CollapsibleResponse title="Ver respuesta exitosa">
                  <pre className="p-3 rounded-lg border bg-muted/20 text-[11px] font-mono text-emerald-600 ml-4">
{`{
  "success": true,
  "order_number": "#1315",
  "status": "confirmed",
  "awaiting_carrier": true,
  "confirmed_at": "2026-03-01T12:00:00Z"
}`}
                  </pre>
                </CollapsibleResponse>
              </div>
            )}
          </TabsContent>

          {/* ================================================================ */}
          {/* Tab: Logs                                                        */}
          {/* ================================================================ */}
          <TabsContent value="logs" className="flex-1 overflow-y-auto space-y-4 mt-4">
            {logs.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No hay actividad registrada</p>
                <p className="text-sm">Los pedidos recibidos apareceran aqui</p>
              </div>
            ) : (
              <div className="space-y-3">
                {logs.map((log) => (
                  <div key={log.id} className="p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      {getStatusBadge(log.status)}
                      <span className="text-xs text-muted-foreground">{formatDate(log.created_at)}</span>
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
                    <Button variant="outline" size="sm" disabled={logsPage <= 1} onClick={() => loadLogs(logsPage - 1)}>
                      Anterior
                    </Button>
                    <span className="text-sm text-muted-foreground py-2">
                      Pagina {logsPage} de {Math.ceil(totalLogs / 10)}
                    </span>
                    <Button variant="outline" size="sm" disabled={logsPage >= Math.ceil(totalLogs / 10)} onClick={() => loadLogs(logsPage + 1)}>
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
