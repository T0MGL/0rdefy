import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/utils/logger';
import {
  outboundWebhookService,
  type OutboundWebhookConfig,
  type OutboundWebhookDelivery,
  type WebhookEvent,
} from '@/services/outbound-webhook.service';
import {
  Plus,
  Trash2,
  Send,
  RefreshCw,
  Copy,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
  ArrowLeft,
  Key,
  Globe,
  Activity,
  Loader2,
} from 'lucide-react';

// ================================================================
// Props
// ================================================================

interface OutboundWebhookManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ================================================================
// Main Component
// ================================================================

export function OutboundWebhookManager({ open, onOpenChange }: OutboundWebhookManagerProps) {
  const { toast } = useToast();
  const isMountedRef = useRef(true);
  const configsAbortRef = useRef<AbortController | null>(null);
  const deliveriesAbortRef = useRef<AbortController | null>(null);

  const [configs, setConfigs] = useState<OutboundWebhookConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('configs');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState<OutboundWebhookConfig | null>(null);

  // Create form state
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formEvents, setFormEvents] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  // Secret display
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  // Deliveries
  const [deliveries, setDeliveries] = useState<OutboundWebhookDelivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [deliveriesTotal, setDeliveriesTotal] = useState(0);

  // Available events
  const [availableEvents, setAvailableEvents] = useState<WebhookEvent[]>([]);

  // Testing
  const [testingId, setTestingId] = useState<string | null>(null);

  // Toggle disabled state
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Confirmation dialogs
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmRegenerateId, setConfirmRegenerateId] = useState<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      configsAbortRef.current?.abort();
      deliveriesAbortRef.current?.abort();
    };
  }, []);

  // Reset state when dialog closes
  const handleOpenChange = useCallback((isOpen: boolean) => {
    if (!isOpen) {
      setRevealedSecret(null);
      setShowCreateForm(false);
      setEditingConfig(null);
      setFormName('');
      setFormUrl('');
      setFormEvents([]);
      setConfirmDeleteId(null);
      setConfirmRegenerateId(null);
    }
    onOpenChange(isOpen);
  }, [onOpenChange]);

  const loadConfigs = useCallback(async () => {
    if (!open) return;

    configsAbortRef.current?.abort();
    const controller = new AbortController();
    configsAbortRef.current = controller;

    setLoading(true);
    try {
      const [configsRes, eventsRes] = await Promise.all([
        outboundWebhookService.getConfigs(controller.signal),
        outboundWebhookService.getEvents(controller.signal),
      ]);
      if (!isMountedRef.current) return;
      if (configsRes.success) setConfigs(configsRes.configs);
      if (eventsRes.success) setAvailableEvents(eventsRes.events);
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (!isMountedRef.current) return;
      logger.error('Error loading outbound webhook configs:', err);
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (open) loadConfigs();
  }, [open, loadConfigs]);

  const loadDeliveries = useCallback(async () => {
    deliveriesAbortRef.current?.abort();
    const controller = new AbortController();
    deliveriesAbortRef.current = controller;

    setDeliveriesLoading(true);
    try {
      const res = await outboundWebhookService.getDeliveries(undefined, 50, 0, controller.signal);
      if (!isMountedRef.current) return;
      if (res.success) {
        setDeliveries(res.deliveries);
        setDeliveriesTotal(res.total);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (!isMountedRef.current) return;
      logger.error('Error loading deliveries:', err);
    } finally {
      if (isMountedRef.current) setDeliveriesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'deliveries' && open) loadDeliveries();
  }, [activeTab, open, loadDeliveries]);

  // ================================================================
  // Handlers
  // ================================================================

  const handleCreate = async () => {
    if (!formUrl || formEvents.length === 0) {
      toast({ title: 'Completa los campos requeridos', variant: 'destructive' });
      return;
    }

    setCreating(true);
    try {
      const res = await outboundWebhookService.createConfig({
        name: formName || 'Mi Webhook',
        url: formUrl,
        events: formEvents,
      });

      if (!isMountedRef.current) return;

      if (res.success && res.config) {
        setConfigs(prev => [...prev, res.config!]);
        setRevealedSecret(res.signing_secret || null);
        setShowCreateForm(false);
        setFormName('');
        setFormUrl('');
        setFormEvents([]);
        toast({
          title: 'Webhook creado',
          description: 'Guarda el secreto de firma. No se mostrará de nuevo.',
        });
      } else {
        toast({ title: res.error || 'Error al crear webhook', variant: 'destructive' });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (!isMountedRef.current) return;
      toast({ title: 'Error al crear webhook', variant: 'destructive' });
    } finally {
      if (isMountedRef.current) setCreating(false);
    }
  };

  const handleToggleActive = async (config: OutboundWebhookConfig) => {
    setTogglingId(config.id);
    try {
      const res = await outboundWebhookService.updateConfig(config.id, {
        is_active: !config.is_active,
      });
      if (!isMountedRef.current) return;
      if (res.success && res.config) {
        setConfigs(prev => prev.map(c => (c.id === config.id ? res.config! : c)));
        toast({
          title: res.config.is_active ? 'Webhook activado' : 'Webhook desactivado',
        });
      } else {
        toast({ title: res.error || 'Error al actualizar webhook', variant: 'destructive' });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (!isMountedRef.current) return;
      toast({ title: 'Error al actualizar webhook', variant: 'destructive' });
    } finally {
      if (isMountedRef.current) setTogglingId(null);
    }
  };

  const handleDelete = async (configId: string) => {
    try {
      const res = await outboundWebhookService.deleteConfig(configId);
      if (!isMountedRef.current) return;
      if (res.success) {
        setConfigs(prev => prev.filter(c => c.id !== configId));
        toast({ title: 'Webhook eliminado' });
      } else {
        toast({ title: res.error || 'Error al eliminar webhook', variant: 'destructive' });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (!isMountedRef.current) return;
      toast({ title: 'Error al eliminar webhook', variant: 'destructive' });
    } finally {
      if (isMountedRef.current) setConfirmDeleteId(null);
    }
  };

  const handleTest = async (configId: string) => {
    setTestingId(configId);
    try {
      const res = await outboundWebhookService.testWebhook(configId);
      if (!isMountedRef.current) return;
      toast({
        title: res.success ? 'Test exitoso' : 'Test fallido',
        description: res.message,
        variant: res.success ? 'default' : 'destructive',
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (!isMountedRef.current) return;
      toast({ title: 'Error al enviar test', variant: 'destructive' });
    } finally {
      if (isMountedRef.current) setTestingId(null);
    }
  };

  const handleRegenerateSecret = async (configId: string) => {
    try {
      const res = await outboundWebhookService.regenerateSecret(configId);
      if (!isMountedRef.current) return;
      if (res.success) {
        setRevealedSecret(res.signing_secret || null);
        toast({
          title: 'Secreto regenerado',
          description: 'Actualiza tu endpoint con el nuevo secreto.',
        });
      } else {
        toast({ title: res.error || 'Error al regenerar secreto', variant: 'destructive' });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (!isMountedRef.current) return;
      toast({ title: 'Error al regenerar secreto', variant: 'destructive' });
    } finally {
      if (isMountedRef.current) setConfirmRegenerateId(null);
    }
  };

  const handleCopySecret = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret);
      toast({ title: 'Secreto copiado al portapapeles' });
    } catch {
      toast({ title: 'No se pudo copiar. Selecciona y copia manualmente.', variant: 'destructive' });
    }
  };

  const handleSaveEdit = async () => {
    if (!editingConfig) return;
    setSaving(true);
    try {
      const res = await outboundWebhookService.updateConfig(editingConfig.id, {
        name: formName,
        url: formUrl,
        events: formEvents,
      });
      if (!isMountedRef.current) return;
      if (res.success && res.config) {
        setConfigs(prev => prev.map(c => (c.id === editingConfig.id ? res.config! : c)));
        setEditingConfig(null);
        setShowCreateForm(false);
        toast({ title: 'Webhook actualizado' });
      } else {
        toast({ title: res.error || 'Error al actualizar webhook', variant: 'destructive' });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (!isMountedRef.current) return;
      toast({ title: 'Error al actualizar webhook', variant: 'destructive' });
    } finally {
      if (isMountedRef.current) setSaving(false);
    }
  };

  const startEdit = (config: OutboundWebhookConfig) => {
    setFormName(config.name);
    setFormUrl(config.url);
    setFormEvents(config.events);
    setEditingConfig(config);
    setShowCreateForm(true);
  };

  const toggleEvent = (event: string) => {
    setFormEvents(prev =>
      prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event]
    );
  };

  // ================================================================
  // Event label helper
  // ================================================================
  const eventLabel = (event: string) => {
    const labels: Record<string, string> = {
      'order.status_changed': 'Cualquier cambio de estado',
      'order.confirmed': 'Confirmado',
      'order.in_preparation': 'En preparación',
      'order.ready_to_ship': 'Listo para enviar',
      'order.shipped': 'Enviado',
      'order.delivered': 'Entregado',
      'order.cancelled': 'Cancelado',
      'order.returned': 'Devuelto',
    };
    return labels[event] || event;
  };

  const eventBadgeColor = (event: string) => {
    if (event.includes('delivered')) return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
    if (event.includes('cancelled')) return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
    if (event.includes('shipped')) return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
    if (event.includes('confirmed')) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
    return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300';
  };

  // ================================================================
  // Render
  // ================================================================

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-500" />
              Webhooks de Salida
            </DialogTitle>
            <DialogDescription>
              Envía notificaciones automáticas a tus sistemas externos cuando cambia el estado de un pedido.
            </DialogDescription>
          </DialogHeader>

          {/* Secret reveal banner */}
          {revealedSecret && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-amber-600" />
                <span className="text-sm font-semibold text-amber-800 dark:text-amber-400">
                  Secreto de Firma (guárdalo ahora)
                </span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-white dark:bg-gray-900 px-3 py-2 rounded text-xs font-mono border break-all">
                  {revealedSecret}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopySecret(revealedSecret)}
                  aria-label="Copiar secreto"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-amber-700 dark:text-amber-500">
                Usa este secreto para verificar la firma HMAC-SHA256 en el header X-Webhook-Signature.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="text-amber-700"
                onClick={() => setRevealedSecret(null)}
              >
                Entendido, ya lo guardé
              </Button>
            </div>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="configs" className="gap-2">
                <Globe className="h-4 w-4" />
                Configuración
              </TabsTrigger>
              <TabsTrigger value="deliveries" className="gap-2">
                <Activity className="h-4 w-4" />
                Historial
              </TabsTrigger>
            </TabsList>

            {/* ============================================ */}
            {/* CONFIGS TAB */}
            {/* ============================================ */}
            <TabsContent value="configs" className="flex-1 overflow-hidden">
              <ScrollArea className="h-[50vh]">
                <div className="space-y-4 pr-4">
                  {loading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : showCreateForm ? (
                    /* ---- CREATE / EDIT FORM ---- */
                    <div className="space-y-4">
                      <div className="flex items-center gap-2 mb-4">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setShowCreateForm(false);
                            setEditingConfig(null);
                          }}
                        >
                          <ArrowLeft className="h-4 w-4 mr-1" />
                          Volver
                        </Button>
                        <h3 className="font-semibold">
                          {editingConfig ? 'Editar Webhook' : 'Nuevo Webhook'}
                        </h3>
                      </div>

                      <div className="space-y-2">
                        <Label>Nombre</Label>
                        <Input
                          placeholder="Ej: n8n Producción"
                          value={formName}
                          onChange={e => setFormName(e.target.value)}
                          maxLength={100}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>URL del Webhook *</Label>
                        <Input
                          placeholder="https://tu-n8n.com/webhook/..."
                          value={formUrl}
                          onChange={e => setFormUrl(e.target.value)}
                          type="url"
                        />
                        <p className="text-xs text-muted-foreground">
                          La URL donde se enviarán las notificaciones POST.
                        </p>
                      </div>

                      <div className="space-y-3">
                        <Label>Eventos *</Label>
                        <p className="text-xs text-muted-foreground">
                          Selecciona los eventos que dispararán este webhook.
                        </p>
                        <div className="grid grid-cols-1 gap-2">
                          {(availableEvents.length > 0
                            ? availableEvents
                            : [
                                { event: 'order.status_changed', description: 'Cualquier cambio de estado' },
                                { event: 'order.confirmed', description: 'Pedido confirmado' },
                                { event: 'order.in_preparation', description: 'En preparación' },
                                { event: 'order.ready_to_ship', description: 'Listo para enviar' },
                                { event: 'order.shipped', description: 'Enviado / en tránsito' },
                                { event: 'order.delivered', description: 'Pedido entregado' },
                                { event: 'order.cancelled', description: 'Cancelado o rechazado' },
                                { event: 'order.returned', description: 'Devuelto' },
                              ]
                          ).map(ev => (
                            <label
                              key={ev.event}
                              className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-accent/50 transition-colors"
                            >
                              <Checkbox
                                checked={formEvents.includes(ev.event)}
                                onCheckedChange={() => toggleEvent(ev.event)}
                              />
                              <div className="flex-1">
                                <span className="text-sm font-medium">{ev.description}</span>
                                <span className="text-xs text-muted-foreground ml-2">
                                  {ev.event}
                                </span>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="flex gap-2 pt-2">
                        <Button
                          onClick={editingConfig ? handleSaveEdit : handleCreate}
                          disabled={!formUrl || formEvents.length === 0 || creating || saving}
                          className="flex-1"
                        >
                          {(creating || saving) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          {editingConfig ? 'Guardar Cambios' : 'Crear Webhook'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* ---- CONFIGS LIST ---- */
                    <>
                      {configs.length === 0 ? (
                        <div className="text-center py-12 space-y-4">
                          <Zap className="h-12 w-12 mx-auto text-muted-foreground/40" />
                          <div>
                            <h3 className="font-semibold text-lg">Sin webhooks configurados</h3>
                            <p className="text-sm text-muted-foreground mt-1">
                              Crea tu primer webhook para recibir notificaciones automáticas en n8n, Zapier, o cualquier sistema.
                            </p>
                          </div>
                          <Button onClick={() => setShowCreateForm(true)}>
                            <Plus className="h-4 w-4 mr-2" />
                            Crear Webhook
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="flex justify-between items-center">
                            <p className="text-sm text-muted-foreground">
                              {configs.length}/5 webhooks configurados
                            </p>
                            {configs.length < 5 && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setEditingConfig(null);
                                  setFormName('');
                                  setFormUrl('');
                                  setFormEvents([]);
                                  setShowCreateForm(true);
                                }}
                              >
                                <Plus className="h-4 w-4 mr-1" />
                                Nuevo
                              </Button>
                            )}
                          </div>

                          {configs.map(config => (
                            <Card key={config.id} className="overflow-hidden">
                              <CardHeader className="pb-3">
                                <div className="flex items-start justify-between">
                                  <div className="flex-1 min-w-0">
                                    <CardTitle className="text-base flex items-center gap-2">
                                      {config.name}
                                      <Badge
                                        variant={config.is_active ? 'default' : 'secondary'}
                                        className="text-xs"
                                      >
                                        {config.is_active ? 'Activo' : 'Inactivo'}
                                      </Badge>
                                    </CardTitle>
                                    <CardDescription className="mt-1 truncate text-xs font-mono">
                                      {config.url}
                                    </CardDescription>
                                  </div>
                                  <Switch
                                    checked={config.is_active}
                                    onCheckedChange={() => handleToggleActive(config)}
                                    disabled={togglingId === config.id}
                                  />
                                </div>
                              </CardHeader>
                              <CardContent className="space-y-3">
                                {/* Events */}
                                <div className="flex flex-wrap gap-1.5">
                                  {config.events.map(event => (
                                    <span
                                      key={event}
                                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${eventBadgeColor(event)}`}
                                    >
                                      {eventLabel(event)}
                                    </span>
                                  ))}
                                </div>

                                {/* Stats */}
                                <div className="flex gap-4 text-xs text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                                    {config.total_deliveries} enviados
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <XCircle className="h-3 w-3 text-red-500" />
                                    {config.total_failures} fallidos
                                  </span>
                                  {config.last_triggered_at && (
                                    <span className="flex items-center gap-1">
                                      <Clock className="h-3 w-3" />
                                      {new Date(config.last_triggered_at).toLocaleDateString()}
                                    </span>
                                  )}
                                </div>

                                {/* Secret prefix */}
                                <div className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Key className="h-3 w-3" />
                                  Secreto: {config.signing_secret_prefix}
                                </div>

                                {/* Actions */}
                                <div className="flex gap-2 pt-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleTest(config.id)}
                                    disabled={testingId === config.id || !config.is_active}
                                  >
                                    {testingId === config.id ? (
                                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                    ) : (
                                      <Send className="h-3 w-3 mr-1" />
                                    )}
                                    Test
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => startEdit(config)}
                                  >
                                    Editar
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setConfirmRegenerateId(config.id)}
                                  >
                                    <RefreshCw className="h-3 w-3 mr-1" />
                                    Secreto
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-destructive hover:text-destructive ml-auto"
                                    onClick={() => setConfirmDeleteId(config.id)}
                                    aria-label="Eliminar webhook"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </>
                      )}
                    </>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* ============================================ */}
            {/* DELIVERIES TAB */}
            {/* ============================================ */}
            <TabsContent value="deliveries" className="flex-1 overflow-hidden">
              <ScrollArea className="h-[50vh]">
                <div className="space-y-2 pr-4">
                  {deliveriesLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : deliveries.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Activity className="h-8 w-8 mx-auto mb-3 opacity-40" />
                      <p className="text-sm">No hay entregas registradas aún.</p>
                      <p className="text-xs mt-1">Las entregas aparecerán aquí cuando se disparen webhooks.</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between items-center mb-2">
                        <p className="text-xs text-muted-foreground">{deliveriesTotal} entregas totales</p>
                        <Button variant="ghost" size="sm" onClick={loadDeliveries}>
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Actualizar
                        </Button>
                      </div>
                      {deliveries.map(delivery => (
                        <div
                          key={delivery.id}
                          className="flex items-center gap-3 p-3 border rounded-lg text-sm"
                        >
                          {delivery.status === 'success' ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                          ) : delivery.status === 'failed' ? (
                            <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                          ) : (
                            <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${eventBadgeColor(delivery.event)}`}>
                                {eventLabel(delivery.event)}
                              </span>
                              {delivery.response_status && (
                                <span className="text-xs text-muted-foreground">
                                  HTTP {delivery.response_status}
                                </span>
                              )}
                              {delivery.duration_ms && (
                                <span className="text-xs text-muted-foreground">
                                  {delivery.duration_ms}ms
                                </span>
                              )}
                            </div>
                            {delivery.error_message && (
                              <p className="text-xs text-red-500 mt-1 truncate">
                                {delivery.error_message}
                              </p>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(delivery.created_at).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>

          {/* Payload format hint */}
          <div className="border-t pt-3 mt-2">
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium hover:text-foreground transition-colors">
                Formato del payload y verificación HMAC
              </summary>
              <pre className="mt-2 bg-muted/50 p-3 rounded-lg overflow-x-auto text-[11px]">
{`// Header: X-Webhook-Signature: sha256=<hex>
// Header: X-Webhook-Event: order.delivered

{
  "event": "order.delivered",
  "timestamp": "2026-03-12T15:30:00.000Z",
  "store_id": "uuid",
  "data": {
    "order_id": "uuid",
    "order_number": "#1234",
    "previous_status": "shipped",
    "new_status": "delivered",
    "customer_name": "Juan Pérez",
    "customer_phone": "0981123456",
    "total_price": 150000,
    "payment_method": "cash_on_delivery",
    "carrier_name": "Mi Courier",
    "delivered_at": "2026-03-12T15:30:00.000Z",
    "line_items": [
      { "product_name": "...", "sku": "...", "quantity": 1, "unit_price": 150000 }
    ]
  }
}`}
              </pre>
            </details>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!confirmDeleteId} onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar Webhook</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará este webhook y todo su historial de entregas. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDeleteId && handleDelete(confirmDeleteId)}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Regenerate Secret Confirmation */}
      <AlertDialog open={!!confirmRegenerateId} onOpenChange={(open) => { if (!open) setConfirmRegenerateId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerar Secreto</AlertDialogTitle>
            <AlertDialogDescription>
              El secreto actual dejará de funcionar inmediatamente. Necesitarás actualizar tu endpoint con el nuevo secreto.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmRegenerateId && handleRegenerateSecret(confirmRegenerateId)}>
              Regenerar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
