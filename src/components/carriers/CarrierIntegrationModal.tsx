import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Truck, CheckCircle2, AlertCircle, Eye, EyeOff, PlugZap } from 'lucide-react';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogBody,
} from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { confirm } from '@/components/ui/confirm';
import {
  carrierIntegrationsService,
  type CarrierIntegration,
  type CarrierTriggerOption,
} from '@/services/carrier-integrations.service';

const PROVIDER_KEY = 'punto_a_punto' as const;
const PROVIDER_LABEL = 'Punto a Punto';

// Backend is the source of truth for valid trigger statuses (GET returns them).
// These are the labels we show until the live list arrives; both stay in sync.
const FALLBACK_TRIGGER_OPTIONS: CarrierTriggerOption[] = [
  { value: 'confirmed', label: 'Confirmado' },
  { value: 'in_preparation', label: 'En preparación' },
  { value: 'ready_to_ship', label: 'Listo para enviar' },
  { value: 'shipped', label: 'Enviado' },
];

type TestState = 'idle' | 'testing' | 'ok' | 'error';

interface CarrierIntegrationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

const fieldMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
} as const;

export function CarrierIntegrationModal({
  open,
  onOpenChange,
  onConnected,
  onDisconnected,
}: CarrierIntegrationModalProps) {
  const { toast } = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [integration, setIntegration] = useState<CarrierIntegration | null>(null);
  const [triggerOptions, setTriggerOptions] = useState<CarrierTriggerOption[]>(
    FALLBACK_TRIGGER_OPTIONS,
  );

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [autoPush, setAutoPush] = useState(true);
  const [triggerStatus, setTriggerStatus] = useState('ready_to_ship');

  const [testState, setTestState] = useState<TestState>('idle');
  const [testError, setTestError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const isConnected = integration?.status === 'connected';
  const credentialsComplete =
    username.trim().length > 0 && password.length > 0 && tenantId.trim().length > 0;

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setTestState('idle');
    setTestError(null);

    carrierIntegrationsService
      .getState()
      .then((res) => {
        if (controller.signal.aborted) return;
        if (res.ok && res.data) {
          const { integration: current, triggerOptions: options } = res.data;
          if (options.length > 0) setTriggerOptions(options);
          if (current) {
            setIntegration(current);
            setAutoPush(current.autoPush);
            setTriggerStatus(current.triggerStatus);
          }
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [open]);

  const triggerLabel = useMemo(
    () => triggerOptions.find((o) => o.value === triggerStatus)?.label ?? triggerStatus,
    [triggerOptions, triggerStatus],
  );

  // Re-validates the stored credentials against the carrier. Only meaningful
  // once connected: the backend reads the persisted blob and takes no body.
  const handleTest = async () => {
    if (!isConnected) return;
    setTestState('testing');
    setTestError(null);

    const res = await carrierIntegrationsService.test(PROVIDER_KEY);

    if (res.ok) {
      setTestState('ok');
      toast({
        title: 'Conexión válida',
        description: `Revalidamos tus credenciales de ${PROVIDER_LABEL}.`,
      });
    } else {
      setTestState('error');
      setTestError(res.error ?? 'No se pudo validar la conexión');
      toast({
        title: 'No se pudo validar',
        description: res.error ?? 'Revisá tus credenciales y volvé a conectar.',
        variant: 'destructive',
      });
    }
  };

  const handleConnect = async () => {
    if (!credentialsComplete) return;
    setIsSaving(true);

    const res = await carrierIntegrationsService.connect(PROVIDER_KEY, {
      username: username.trim(),
      password,
      tenantId: tenantId.trim(),
      triggerStatus,
    });

    if (!res.ok || !res.data) {
      setIsSaving(false);
      toast({
        title: 'No se pudo conectar',
        description: res.error ?? 'Revisá usuario, contraseña y TenantId.',
        variant: 'destructive',
      });
      return;
    }

    let connected = res.data;

    // Connect always persists auto_push = true. If the merchant turned it off
    // before connecting, sync the stored state so the toggle reflects reality.
    if (!autoPush) {
      const patched = await carrierIntegrationsService.updateSettings(PROVIDER_KEY, {
        autoPush: false,
      });
      if (patched.ok && patched.data) connected = patched.data;
    }

    setIsSaving(false);
    setIntegration(connected);
    setAutoPush(connected.autoPush);
    setTriggerStatus(connected.triggerStatus);
    setPassword('');
    setTestState('idle');
    toast({
      title: 'Transportadora conectada',
      description: `${PROVIDER_LABEL} quedó lista para recibir tus envíos.`,
    });
    onConnected?.();
  };

  const persistSettings = async (next: { autoPush?: boolean; triggerStatus?: string }) => {
    if (!isConnected) return;
    const res = await carrierIntegrationsService.updateSettings(PROVIDER_KEY, next);
    if (res.ok && res.data) {
      setIntegration(res.data);
    } else {
      toast({
        title: 'No se pudo guardar',
        description: res.error ?? 'Intentá de nuevo en unos segundos.',
        variant: 'destructive',
      });
      if (next.autoPush !== undefined) setAutoPush(!next.autoPush);
      if (next.triggerStatus !== undefined && integration) {
        setTriggerStatus(integration.triggerStatus);
      }
    }
  };

  const handleAutoPushToggle = (value: boolean) => {
    setAutoPush(value);
    void persistSettings({ autoPush: value });
  };

  const handleTriggerChange = (value: string) => {
    setTriggerStatus(value);
    if (isConnected) void persistSettings({ triggerStatus: value });
  };

  const handleDisconnect = async () => {
    const confirmed = await confirm({
      title: `Desconectar ${PROVIDER_LABEL}?`,
      description:
        'Dejamos de enviar pedidos automáticamente a la transportadora. Los envíos ya generados no se cancelan.',
      confirmText: 'Desconectar',
      cancelText: 'Volver',
      variant: 'destructive',
    });
    if (!confirmed) return;

    setIsSaving(true);
    const res = await carrierIntegrationsService.disconnect(PROVIDER_KEY);
    setIsSaving(false);

    if (res.ok) {
      setIntegration(null);
      setUsername('');
      setPassword('');
      setTenantId('');
      setAutoPush(true);
      setTriggerStatus('ready_to_ship');
      setTestState('idle');
      toast({ title: 'Transportadora desconectada' });
      onDisconnected?.();
    } else {
      toast({
        title: 'No se pudo desconectar',
        description: res.error ?? 'Intentá de nuevo en unos segundos.',
        variant: 'destructive',
      });
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent desktopMaxWidth="max-w-lg">
        <ResponsiveDialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Truck className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <ResponsiveDialogTitle className="text-xl">
                Conectá {PROVIDER_LABEL}
              </ResponsiveDialogTitle>
              <ResponsiveDialogDescription>
                Empujá tus pedidos a la transportadora automáticamente
              </ResponsiveDialogDescription>
            </div>
            {isConnected && (
              <Badge variant="outline" className="gap-1 ml-auto shrink-0">
                <CheckCircle2 size={14} className="text-primary" />
                Conectada
              </Badge>
            )}
          </div>
        </ResponsiveDialogHeader>

        <ResponsiveDialogBody className="space-y-6 py-4">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
              <div className="grid grid-cols-2 gap-3">
                <Skeleton className="h-10 w-full rounded-md" />
                <Skeleton className="h-10 w-full rounded-md" />
              </div>
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          ) : (
            <>
              <AnimatePresence mode="wait" initial={false}>
                {isConnected ? (
                  <motion.div key="connected" {...fieldMotion} className="space-y-3">
                    <div className="p-4 bg-muted/30 rounded-lg flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{PROVIDER_LABEL}</p>
                        <p className="text-sm text-muted-foreground">
                          Credenciales guardadas y validadas
                        </p>
                      </div>
                      {integration?.lastValidatedAt && (
                        <p className="text-xs text-muted-foreground shrink-0">
                          Validada{' '}
                          {new Date(integration.lastValidatedAt).toLocaleDateString('es-PY')}
                        </p>
                      )}
                    </div>

                    <div>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full gap-2"
                        disabled={testState === 'testing'}
                        onClick={handleTest}
                      >
                        {testState === 'testing' ? (
                          <>
                            <PlugZap size={16} className="animate-pulse" />
                            Revalidando...
                          </>
                        ) : (
                          <>
                            <PlugZap size={16} />
                            Revalidar conexión
                          </>
                        )}
                      </Button>

                      <AnimatePresence initial={false}>
                        {testState === 'ok' && (
                          <motion.p
                            {...fieldMotion}
                            className="mt-2 flex items-center gap-1.5 text-sm text-primary"
                          >
                            <CheckCircle2 size={14} />
                            Credenciales válidas.
                          </motion.p>
                        )}
                        {testState === 'error' && (
                          <motion.p
                            {...fieldMotion}
                            className="mt-2 flex items-start gap-1.5 text-sm text-destructive"
                          >
                            <AlertCircle size={14} className="mt-0.5 shrink-0" />
                            {testError}
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="form" {...fieldMotion} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="carrier-username">Usuario</Label>
                      <Input
                        id="carrier-username"
                        autoComplete="off"
                        value={username}
                        onChange={(e) => {
                          setUsername(e.target.value);
                          setTestState('idle');
                        }}
                        placeholder="usuario de Punto a Punto"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="carrier-password">Contraseña</Label>
                      <div className="relative">
                        <Input
                          id="carrier-password"
                          type={showPassword ? 'text' : 'password'}
                          autoComplete="new-password"
                          value={password}
                          onChange={(e) => {
                            setPassword(e.target.value);
                            setTestState('idle');
                          }}
                          placeholder="••••••••"
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                          aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="carrier-tenant">TenantId</Label>
                      <Input
                        id="carrier-tenant"
                        inputMode="numeric"
                        value={tenantId}
                        onChange={(e) => {
                          setTenantId(e.target.value);
                          setTestState('idle');
                        }}
                        placeholder="2"
                      />
                    </div>

                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <AlertCircle size={14} className="mt-0.5 shrink-0" />
                      Validamos tus credenciales contra {PROVIDER_LABEL} al conectar.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="space-y-4 pt-2 border-t">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Envío automático</p>
                    <p className="text-xs text-muted-foreground">
                      Empujamos el pedido a {PROVIDER_LABEL} sin que tengas que hacer nada.
                    </p>
                  </div>
                  <Switch
                    checked={autoPush}
                    onCheckedChange={handleAutoPushToggle}
                    aria-label="Envío automático"
                  />
                </div>

                <AnimatePresence initial={false}>
                  {autoPush && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="space-y-2 overflow-hidden"
                    >
                      <Label htmlFor="carrier-trigger">
                        Enviar a {PROVIDER_LABEL} cuando el pedido pase a...
                      </Label>
                      <Select value={triggerStatus} onValueChange={handleTriggerChange}>
                        <SelectTrigger id="carrier-trigger">
                          <SelectValue>{triggerLabel}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {triggerOptions.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {isConnected ? (
                <div className="pt-2 border-t space-y-3">
                  <Button
                    variant="outline"
                    className="w-full border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    onClick={handleDisconnect}
                    disabled={isSaving}
                  >
                    Desconectar {PROVIDER_LABEL}
                  </Button>
                </div>
              ) : (
                <Button
                  className="w-full gap-2"
                  disabled={!credentialsComplete || isSaving}
                  onClick={handleConnect}
                >
                  {isSaving ? 'Conectando...' : `Conectar ${PROVIDER_LABEL}`}
                </Button>
              )}
            </>
          )}
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
