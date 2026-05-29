import { getActiveStoreId } from '@/lib/activeStore';
/**
 * InvoicingSetupWizard (v2)
 *
 * Two flows, selected on the first step:
 *
 *   Flow A (new identity): identity -> activities -> representante legal
 *                          -> domicilio fiscal -> establecimiento+punto+timbrado
 *                          -> certificate
 *
 *   Flow B (existing identity): dropdown selector -> per-store fields + timbrado
 *                               (reuses the existing identity, its activities,
 *                               representante legal, domicilio, and certificate)
 *
 * Why split:
 *   One user (one tax contributor) can run multiple Ordefy stores all
 *   under the same RUC. Uploading the .p12 once, reusing it across stores,
 *   and only asking for timbrado + establecimiento per store is the
 *   correct model per SIFEN.
 *
 * The wizard writes through the new /api/fiscal/* endpoints. Legacy
 * /api/invoicing/config still works in parallel for read.
 */

import { useState, useRef, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import {
  fiscalService,
  FiscalIdentity,
  FiscalIdentityInput,
  FiscalActivityInput,
  FiscalStoreLinkInput,
} from '@/services/invoicing.service';
import {
  Loader2,
  CheckCircle2,
  Upload,
  Building2,
  FileDigit,
  MapPin,
  Shield,
  HelpCircle,
  FileKey2,
  X,
  Plus,
  Trash2,
  User,
} from 'lucide-react';

// ================================================================
// Modulo 11 DV Calculator (Paraguay RUC)
// ================================================================
function calcularDV(ruc: string): number | null {
  if (!ruc || !/^\d+$/.test(ruc)) return null;
  const baseMax = 11;
  let total = 0;
  let factor = 2;
  for (let i = ruc.length - 1; i >= 0; i--) {
    total += parseInt(ruc[i], 10) * factor;
    factor++;
    if (factor > baseMax) factor = 2;
  }
  const resto = total % 11;
  return resto > 1 ? 11 - resto : 0;
}

// ================================================================
// Emission point suggestion (multi-store reuse)
// ================================================================
// Two stores under the same RUC cannot share the same
// establecimiento + punto_expedicion (SIFEN numbering would collide,
// enforced by uniq_identity_estab_punto). When reusing an identity on a
// second store, suggest the next free punto over the chosen establecimiento.
function puntosEnUso(identity: FiscalIdentity | undefined, estab: string): string[] {
  return (identity?.stores ?? [])
    .filter((s) => s.establecimiento_codigo === estab)
    .map((s) => s.punto_expedicion);
}

function suggestNextPunto(identity: FiscalIdentity | undefined, estab: string): string {
  const used = puntosEnUso(identity, estab)
    .map((p) => parseInt(p, 10))
    .filter((n) => !Number.isNaN(n));
  if (used.length === 0) return '001';
  return String(Math.max(...used) + 1).padStart(3, '0');
}

// ================================================================
// Tiny UI helpers
// ================================================================
function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors ml-1"
          >
            <HelpCircle size={13} />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs leading-relaxed">{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function HintText({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{children}</p>;
}

// ================================================================
// Validation
// ================================================================
const identitySchema = z.object({
  ruc: z.string().regex(/^\d+$/, 'Solo numeros'),
  razon_social: z.string().min(1).max(255),
  nombre_fantasia: z.string().max(255).optional(),
  tipo_contribuyente: z.union([z.literal(1), z.literal(2)]),
  tipo_regimen: z.number().optional(),
  sifen_environment: z.enum(['demo', 'test', 'prod']),
});

const activityRowSchema = z.object({
  codigo: z.string().min(1).max(10),
  descripcion: z.string().min(1).max(255),
  is_principal: z.boolean().default(false),
});

const representanteSchema = z.object({
  nombre: z.string().min(1).max(255),
  documento_tipo: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(9),
  ]),
  documento_numero: z.string().min(1).max(50),
  cargo: z.string().max(100).optional(),
});

const domicilioSchema = z.object({
  direccion: z.string().max(500).optional(),
  numero_casa: z.string().max(20).optional(),
  departamento: z.number().int().optional(),
  distrito: z.number().int().optional(),
  ciudad: z.number().int().optional(),
});

const establecimientoSchema = z.object({
  establecimiento_codigo: z.string().regex(/^\d{3}$/).default('001'),
  punto_expedicion: z.string().regex(/^\d{3}$/).default('001'),
  establecimiento_direccion: z.string().max(500).optional(),
  establecimiento_telefono: z.string().max(50).optional(),
  timbrado: z.string().regex(/^\d{8}$/, 'Timbrado debe tener 8 digitos'),
  timbrado_fecha_inicio: z.string().optional(),
  timbrado_fecha_fin: z.string().optional(),
});

// ================================================================
// Component
// ================================================================
type Flow = 'choose' | 'new' | 'existing';
type NewFlowStep = 'identity' | 'activities' | 'representante' | 'domicilio' | 'store' | 'cert';
type ExistingFlowStep = 'pick' | 'store' | 'cert';

interface Props {
  onComplete: () => void;
}

const stepVariants = {
  enter: { opacity: 0, x: 24 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
};

export function InvoicingSetupWizard({ onComplete }: Props) {
  const { toast } = useToast();
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [flow, setFlow] = useState<Flow>('choose');
  const [newStep, setNewStep] = useState<NewFlowStep>('identity');
  const [existingStep, setExistingStep] = useState<ExistingFlowStep>('pick');

  const [existingIdentities, setExistingIdentities] = useState<FiscalIdentity[]>([]);
  const [selectedIdentityId, setSelectedIdentityId] = useState<string | null>(null);
  const [loadingIdentities, setLoadingIdentities] = useState(false);
  // True until the mount-time identity load resolves, so we can decide the
  // default flow (reuse vs create) without flashing the "choose" screen.
  const [initializing, setInitializing] = useState(true);

  const [rucDV, setRucDV] = useState<number | null>(null);

  const [identityDraft, setIdentityDraft] = useState<FiscalIdentityInput | null>(null);
  const [activitiesDraft, setActivitiesDraft] = useState<FiscalActivityInput[]>([
    { codigo: '', descripcion: '', is_principal: true },
  ]);
  const [representanteDraft, setRepresentanteDraft] = useState<{
    nombre: string;
    documento_tipo: number;
    documento_numero: string;
    cargo: string;
  } | null>(null);
  const [domicilioDraft, setDomicilioDraft] = useState<z.infer<typeof domicilioSchema> | null>(null);

  const [createdIdentityId, setCreatedIdentityId] = useState<string | null>(null);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certPassword, setCertPassword] = useState('');
  const [saving, setSaving] = useState(false);

  // Forms
  const identityForm = useForm<z.infer<typeof identitySchema>>({
    resolver: zodResolver(identitySchema),
    defaultValues: {
      ruc: '',
      razon_social: '',
      nombre_fantasia: '',
      tipo_contribuyente: 2,
      sifen_environment: 'demo',
    },
  });

  const representanteForm = useForm<z.infer<typeof representanteSchema>>({
    resolver: zodResolver(representanteSchema),
    defaultValues: {
      nombre: '',
      documento_tipo: 1,
      documento_numero: '',
      cargo: '',
    },
  });

  const domicilioForm = useForm<z.infer<typeof domicilioSchema>>({
    resolver: zodResolver(domicilioSchema),
    defaultValues: {},
  });

  const establecimientoForm = useForm<z.infer<typeof establecimientoSchema>>({
    resolver: zodResolver(establecimientoSchema),
    defaultValues: {
      establecimiento_codigo: '001',
      punto_expedicion: '001',
      establecimiento_direccion: '',
      establecimiento_telefono: '',
      timbrado: '',
    },
  });

  // Pre-fill the per-store form when an identity is (re)used: carry over the
  // first linked store's timbrado and auto-suggest the next free punto so the
  // user does not hit uniq_identity_estab_punto.
  const applyIdentityDefaults = (identity: FiscalIdentity) => {
    const firstLink = identity.stores?.[0];
    const estab = firstLink?.establecimiento_codigo ?? '001';
    establecimientoForm.setValue('establecimiento_codigo', estab);
    establecimientoForm.setValue('punto_expedicion', suggestNextPunto(identity, estab));
    if (firstLink?.timbrado) establecimientoForm.setValue('timbrado', firstLink.timbrado);
  };

  const selectIdentity = (identity: FiscalIdentity) => {
    setSelectedIdentityId(identity.id);
    applyIdentityDefaults(identity);
  };

  // Load existing identities on mount. If the account already has at least one
  // fiscal identity, default to the reuse flow (Flow B): same company, new
  // brand/store is by far the common case once invoicing is set up once.
  // "Create new" stays available behind the "Atras" button.
  useEffect(() => {
    let cancelled = false;
    setLoadingIdentities(true);
    fiscalService
      .listIdentities()
      .then((list) => {
        if (cancelled || !isMountedRef.current) return;
        setExistingIdentities(list);
        if (list.length >= 1) {
          setFlow('existing');
          if (list.length === 1) selectIdentity(list[0]);
        }
      })
      .catch((err) => {
        if (cancelled || !isMountedRef.current) return;
        toast({
          title: 'Error',
          description: err.message ?? 'No se pudieron cargar las identidades fiscales',
          variant: 'destructive',
        });
      })
      .finally(() => {
        if (!cancelled && isMountedRef.current) {
          setLoadingIdentities(false);
          setInitializing(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ================================================================
  // Handlers - Flow A (new identity)
  // ================================================================
  const handleRucChange = (value: string) => {
    identityForm.setValue('ruc', value);
    if (/^\d+$/.test(value) && value.length >= 1) {
      setRucDV(calcularDV(value));
    } else {
      setRucDV(null);
    }
  };

  const submitIdentity = identityForm.handleSubmit((data) => {
    if (rucDV === null) {
      toast({ title: 'RUC invalido', description: 'Ingresa un RUC valido.', variant: 'destructive' });
      return;
    }
    setIdentityDraft({
      ruc: data.ruc,
      ruc_dv: rucDV,
      razon_social: data.razon_social,
      nombre_fantasia: data.nombre_fantasia || null,
      tipo_contribuyente: data.tipo_contribuyente,
      tipo_regimen: data.tipo_regimen ?? null,
      sifen_environment: data.sifen_environment,
    });
    setNewStep('activities');
  });

  const submitActivities = () => {
    const principal = activitiesDraft.filter((a) => a.is_principal);
    if (principal.length !== 1) {
      toast({
        title: 'Actividad principal requerida',
        description: 'Selecciona exactamente una actividad como principal.',
        variant: 'destructive',
      });
      return;
    }
    for (const a of activitiesDraft) {
      if (!a.codigo || !a.descripcion) {
        toast({
          title: 'Actividades incompletas',
          description: 'Completa codigo y descripcion en cada actividad.',
          variant: 'destructive',
        });
        return;
      }
    }
    setNewStep('representante');
  };

  const submitRepresentante = representanteForm.handleSubmit((data) => {
    setRepresentanteDraft({
      nombre: data.nombre,
      documento_tipo: data.documento_tipo,
      documento_numero: data.documento_numero,
      cargo: data.cargo ?? '',
    });
    setNewStep('domicilio');
  });

  const submitDomicilio = domicilioForm.handleSubmit((data) => {
    setDomicilioDraft(data);
    setNewStep('store');
  });

  const submitStore = establecimientoForm.handleSubmit(async (data) => {
    if (!identityDraft || !representanteDraft) return;
    setSaving(true);
    try {
      // 1. Create identity
      const identity = await fiscalService.createIdentity({
        ...identityDraft,
        representante_legal_nombre: representanteDraft.nombre,
        representante_legal_documento_tipo: representanteDraft.documento_tipo as any,
        representante_legal_documento_numero: representanteDraft.documento_numero,
        representante_legal_cargo: representanteDraft.cargo || null,
        domicilio_fiscal_direccion: domicilioDraft?.direccion ?? null,
        domicilio_fiscal_numero_casa: domicilioDraft?.numero_casa ?? null,
        domicilio_fiscal_departamento: domicilioDraft?.departamento ?? null,
        domicilio_fiscal_distrito: domicilioDraft?.distrito ?? null,
        domicilio_fiscal_ciudad: domicilioDraft?.ciudad ?? null,
      });

      // 2. Add activities
      for (const act of activitiesDraft) {
        await fiscalService.addActivity(identity.id, act);
      }

      // 3. Link to the current store
      const storeId = getActiveStoreId();
      if (!storeId) throw new Error('No hay tienda seleccionada');

      const linkInput: FiscalStoreLinkInput = {
        timbrado: data.timbrado,
        timbrado_fecha_inicio: data.timbrado_fecha_inicio || null,
        timbrado_fecha_fin: data.timbrado_fecha_fin || null,
        establecimiento_codigo: data.establecimiento_codigo,
        punto_expedicion: data.punto_expedicion,
        establecimiento_direccion: data.establecimiento_direccion || null,
        establecimiento_telefono: data.establecimiento_telefono || null,
      };
      await fiscalService.linkIdentityToStore(storeId, identity.id, linkInput);

      if (!isMountedRef.current) return;
      setCreatedIdentityId(identity.id);

      // If demo, we're done; else step to cert
      if (identityDraft.sifen_environment === 'demo') {
        toast({ title: 'Configuracion guardada', description: 'Facturacion lista en modo demo.' });
        onComplete();
      } else {
        setNewStep('cert');
      }
    } catch (err: any) {
      if (!isMountedRef.current) return;
      toast({ title: 'Error', description: err.message ?? 'Error al guardar', variant: 'destructive' });
    } finally {
      if (isMountedRef.current) setSaving(false);
    }
  });

  const submitCertificate = async () => {
    const identityId = createdIdentityId ?? selectedIdentityId;
    if (!identityId) return;
    if (!certFile || !certPassword) {
      toast({
        title: 'Certificado requerido',
        description: 'Selecciona el archivo .p12 y su contrasena.',
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    try {
      await fiscalService.uploadIdentityCertificate(identityId, certFile, certPassword);
      if (!isMountedRef.current) return;
      toast({ title: 'Certificado cargado', description: 'Facturacion lista.' });
      onComplete();
    } catch (err: any) {
      if (!isMountedRef.current) return;
      toast({ title: 'Error', description: err.message ?? 'Error cargando certificado', variant: 'destructive' });
    } finally {
      if (isMountedRef.current) setSaving(false);
    }
  };

  // ================================================================
  // Handlers - Flow B (existing identity)
  // ================================================================
  const submitLinkExisting = establecimientoForm.handleSubmit(async (data) => {
    if (!selectedIdentityId) {
      toast({
        title: 'Identidad requerida',
        description: 'Selecciona una identidad fiscal.',
        variant: 'destructive',
      });
      return;
    }
    setSaving(true);
    try {
      const storeId = getActiveStoreId();
      if (!storeId) throw new Error('No hay tienda seleccionada');

      const linkInput: FiscalStoreLinkInput = {
        timbrado: data.timbrado,
        timbrado_fecha_inicio: data.timbrado_fecha_inicio || null,
        timbrado_fecha_fin: data.timbrado_fecha_fin || null,
        establecimiento_codigo: data.establecimiento_codigo,
        punto_expedicion: data.punto_expedicion,
        establecimiento_direccion: data.establecimiento_direccion || null,
        establecimiento_telefono: data.establecimiento_telefono || null,
      };
      await fiscalService.linkIdentityToStore(storeId, selectedIdentityId, linkInput);

      if (!isMountedRef.current) return;

      const identity = existingIdentities.find((i) => i.id === selectedIdentityId);
      // If identity already has a certificate (or is demo), finish.
      if (identity?.has_certificate || identity?.sifen_environment === 'demo') {
        toast({ title: 'Tienda vinculada', description: 'Facturacion lista.' });
        onComplete();
      } else {
        setExistingStep('cert');
      }
    } catch (err: any) {
      if (!isMountedRef.current) return;
      toast({ title: 'Error', description: err.message ?? 'Error vinculando identidad', variant: 'destructive' });
    } finally {
      if (isMountedRef.current) setSaving(false);
    }
  });

  // ================================================================
  // Activities editor
  // ================================================================
  const addActivityRow = () => {
    setActivitiesDraft((rows) => [...rows, { codigo: '', descripcion: '', is_principal: false }]);
  };
  const removeActivityRow = (i: number) => {
    setActivitiesDraft((rows) => rows.filter((_, idx) => idx !== i));
  };
  const setPrincipalRow = (i: number) => {
    setActivitiesDraft((rows) => rows.map((r, idx) => ({ ...r, is_principal: idx === i })));
  };
  const updateRow = (i: number, patch: Partial<FiscalActivityInput>) => {
    setActivitiesDraft((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  // ================================================================
  // Render
  // ================================================================
  const selectedIdentity = useMemo(
    () => existingIdentities.find((i) => i.id === selectedIdentityId),
    [existingIdentities, selectedIdentityId],
  );
  // Live points-in-use for whatever establecimiento the user is typing, so the
  // hint stays accurate without fighting manual edits to the punto field.
  const watchedEstab = establecimientoForm.watch('establecimiento_codigo') || '001';
  const reusedPuntosEnUso = puntosEnUso(selectedIdentity, watchedEstab);

  if (initializing) {
    return (
      <div className="max-w-2xl mx-auto flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-muted-foreground" size={22} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <AnimatePresence mode="wait">
        {/* ─────────────── CHOOSE FLOW ─────────────── */}
        {flow === 'choose' && (
          <motion.div key="choose" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.2 }}>
            <Card>
              <CardHeader>
                <CardTitle>Facturacion electronica</CardTitle>
                <CardDescription>
                  Elegi como configurar la facturacion para esta tienda.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <button
                  type="button"
                  onClick={() => setFlow('new')}
                  className="w-full border rounded-lg p-4 text-left hover:border-primary transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Plus className="text-primary" />
                    <div>
                      <p className="font-medium">Crear identidad fiscal nueva</p>
                      <p className="text-sm text-muted-foreground">
                        Primer paso si aun no tenes una empresa cargada en Ordefy.
                      </p>
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setFlow('existing')}
                  className="w-full border rounded-lg p-4 text-left hover:border-primary transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Building2 className="text-primary" />
                    <div>
                      <p className="font-medium">Usar una identidad fiscal existente</p>
                      <p className="text-sm text-muted-foreground">
                        Reutiliza la misma empresa (RUC + certificado) para esta tienda.
                      </p>
                    </div>
                  </div>
                </button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* ─────────────── FLOW A: NEW ─────────────── */}
        {flow === 'new' && newStep === 'identity' && (
          <motion.div key="new-identity" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.2 }}>
            <Card>
              <CardHeader>
                <CardTitle>1. Identidad fiscal</CardTitle>
                <CardDescription>Datos del contribuyente tal como figuran en el SET.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={submitIdentity} className="space-y-5">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                      <Label>RUC<FieldHint>Número de RUC sin guion ni DV.</FieldHint></Label>
                      <Input
                        placeholder="80012345"
                        {...identityForm.register('ruc')}
                        onChange={(e) => handleRucChange(e.target.value.replace(/\D/g, ''))}
                      />
                    </div>
                    <div>
                      <Label>DV</Label>
                      <Input value={rucDV !== null ? String(rucDV) : ''} readOnly className="bg-muted text-center font-mono text-lg" />
                      <HintText>Auto-calculado</HintText>
                    </div>
                  </div>

                  <div>
                    <Label>Razon social</Label>
                    <Input placeholder="Mi Empresa S.A." {...identityForm.register('razon_social')} />
                  </div>

                  <div>
                    <Label>Nombre comercial (opcional)</Label>
                    <Input placeholder="MiMarca" {...identityForm.register('nombre_fantasia')} />
                  </div>

                  <div>
                    <Label>Tipo de contribuyente</Label>
                    <Select
                      value={String(identityForm.watch('tipo_contribuyente'))}
                      onValueChange={(v) => identityForm.setValue('tipo_contribuyente', Number(v) as 1 | 2)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Persona Fisica</SelectItem>
                        <SelectItem value="2">Persona Juridica (empresa)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label>Modo de facturacion</Label>
                    <Select
                      value={identityForm.watch('sifen_environment')}
                      onValueChange={(v) => identityForm.setValue('sifen_environment', v as any)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="demo">Demo (sin envio al SIFEN)</SelectItem>
                        <SelectItem value="test">Pruebas SET (requiere certificado)</SelectItem>
                        <SelectItem value="prod">Produccion (requiere certificado)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex justify-between">
                    <Button type="button" variant="outline" onClick={() => setFlow('choose')}>Atras</Button>
                    <Button type="submit">Siguiente</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {flow === 'new' && newStep === 'activities' && (
          <motion.div key="new-activities" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.2 }}>
            <Card>
              <CardHeader>
                <CardTitle>2. Actividades economicas</CardTitle>
                <CardDescription>
                  Agrega las actividades CIIU registradas en el SET. Marca una como principal.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {activitiesDraft.map((row, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-3">
                      {i === 0 && <Label>Código</Label>}
                      <Input
                        placeholder="47190"
                        value={row.codigo}
                        onChange={(e) => updateRow(i, { codigo: e.target.value })}
                      />
                    </div>
                    <div className="col-span-6">
                      {i === 0 && <Label>Descripcion</Label>}
                      <Input
                        placeholder="Venta al por menor"
                        value={row.descripcion}
                        onChange={(e) => updateRow(i, { descripcion: e.target.value })}
                      />
                    </div>
                    <div className="col-span-2">
                      {i === 0 && <Label>Principal</Label>}
                      <Button
                        type="button"
                        size="sm"
                        variant={row.is_principal ? 'default' : 'outline'}
                        className="w-full"
                        onClick={() => setPrincipalRow(i)}
                      >
                        {row.is_principal ? 'Si' : 'Marcar'}
                      </Button>
                    </div>
                    <div className="col-span-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => removeActivityRow(i)}
                        disabled={activitiesDraft.length === 1}
                        aria-label="Eliminar actividad economica"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                ))}

                <Button type="button" variant="outline" size="sm" onClick={addActivityRow}>
                  <Plus size={14} className="mr-1" /> Agregar actividad
                </Button>

                <div className="flex justify-between pt-2">
                  <Button type="button" variant="outline" onClick={() => setNewStep('identity')}>Atras</Button>
                  <Button type="button" onClick={submitActivities}>Siguiente</Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {flow === 'new' && newStep === 'representante' && (
          <motion.div key="new-representante" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.2 }}>
            <Card>
              <CardHeader>
                <CardTitle>3. Representante legal</CardTitle>
                <CardDescription>
                  Persona fisica responsable de la emision. Los datos aparecen en el XML del DTE.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={submitRepresentante} className="space-y-5">
                  <div>
                    <Label>Nombre completo</Label>
                    <Input placeholder="Juan Perez" {...representanteForm.register('nombre')} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Tipo de documento</Label>
                      <Select
                        value={String(representanteForm.watch('documento_tipo'))}
                        onValueChange={(v) => representanteForm.setValue('documento_tipo', Number(v) as any)}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Cedula de identidad</SelectItem>
                          <SelectItem value="2">Pasaporte</SelectItem>
                          <SelectItem value="3">Cedula extranjera</SelectItem>
                          <SelectItem value="4">Carnet migratorio</SelectItem>
                          <SelectItem value="5">Tarjeta diplomatica</SelectItem>
                          <SelectItem value="6">RUC</SelectItem>
                          <SelectItem value="9">Otro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Número de documento</Label>
                      <Input placeholder="5712264" {...representanteForm.register('documento_numero')} />
                    </div>
                  </div>
                  <div>
                    <Label>Cargo (opcional)</Label>
                    <Input placeholder="REPRESENTANTE LEGAL" {...representanteForm.register('cargo')} />
                  </div>

                  <div className="flex justify-between">
                    <Button type="button" variant="outline" onClick={() => setNewStep('activities')}>Atras</Button>
                    <Button type="submit">Siguiente</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {flow === 'new' && newStep === 'domicilio' && (
          <motion.div key="new-domicilio" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.2 }}>
            <Card>
              <CardHeader>
                <CardTitle>4. Domicilio fiscal</CardTitle>
                <CardDescription>
                  Direccion registrada ante DNIT. Es distinto del establecimiento (ese va en el siguiente paso).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={submitDomicilio} className="space-y-5">
                  <div>
                    <Label>Dirección</Label>
                    <Input placeholder="Av. España 1234" {...domicilioForm.register('direccion')} />
                  </div>
                  <div className="grid grid-cols-4 gap-4">
                    <div>
                      <Label>Nro casa</Label>
                      <Input placeholder="0" {...domicilioForm.register('numero_casa')} />
                    </div>
                    <div>
                      <Label>Departamento</Label>
                      <Input
                        type="number"
                        placeholder="1"
                        {...domicilioForm.register('departamento', { valueAsNumber: true })}
                      />
                    </div>
                    <div>
                      <Label>Distrito</Label>
                      <Input
                        type="number"
                        placeholder="1"
                        {...domicilioForm.register('distrito', { valueAsNumber: true })}
                      />
                    </div>
                    <div>
                      <Label>Ciudad</Label>
                      <Input
                        type="number"
                        placeholder="1"
                        {...domicilioForm.register('ciudad', { valueAsNumber: true })}
                      />
                    </div>
                  </div>
                  <HintText>
                    Codigos de departamento / distrito / ciudad segun el Anexo de SIFEN. 1/1/1 = Asuncion.
                  </HintText>

                  <div className="flex justify-between">
                    <Button type="button" variant="outline" onClick={() => setNewStep('representante')}>Atras</Button>
                    <Button type="submit">Siguiente</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {flow === 'new' && newStep === 'store' && (
          <motion.div key="new-store" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.2 }}>
            <Card>
              <CardHeader>
                <CardTitle>5. Establecimiento y timbrado</CardTitle>
                <CardDescription>
                  Datos de esta tienda: establecimiento, punto de expedicion y numero de timbrado.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={submitStore} className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Código de establecimiento</Label>
                      <Input placeholder="001" maxLength={3} {...establecimientoForm.register('establecimiento_codigo')} />
                    </div>
                    <div>
                      <Label>Punto de expedicion</Label>
                      <Input placeholder="001" maxLength={3} {...establecimientoForm.register('punto_expedicion')} />
                    </div>
                  </div>
                  <div>
                    <Label>Dirección del establecimiento</Label>
                    <Input placeholder="Av. España 1234, Asunción" {...establecimientoForm.register('establecimiento_direccion')} />
                  </div>
                  <div>
                    <Label>Teléfono</Label>
                    <Input placeholder="021-123456" {...establecimientoForm.register('establecimiento_telefono')} />
                  </div>
                  <div>
                    <Label>Número de timbrado (8 dígitos)</Label>
                    <Input placeholder="12345678" maxLength={8} {...establecimientoForm.register('timbrado')} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Vigencia desde</Label>
                      <DateInput
                        value={establecimientoForm.watch('timbrado_fecha_inicio') || ''}
                        onChange={(val) => establecimientoForm.setValue('timbrado_fecha_inicio', val)}
                      />
                    </div>
                    <div>
                      <Label>Vigencia hasta</Label>
                      <DateInput
                        value={establecimientoForm.watch('timbrado_fecha_fin') || ''}
                        onChange={(val) => establecimientoForm.setValue('timbrado_fecha_fin', val)}
                      />
                    </div>
                  </div>

                  <div className="flex justify-between">
                    <Button type="button" variant="outline" onClick={() => setNewStep('domicilio')}>Atras</Button>
                    <Button type="submit" disabled={saving}>
                      {saving && <Loader2 className="animate-spin mr-2" size={14} />}
                      {identityDraft?.sifen_environment === 'demo' ? 'Completar' : 'Siguiente'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {((flow === 'new' && newStep === 'cert') || (flow === 'existing' && existingStep === 'cert')) && (
          <motion.div key="cert" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.2 }}>
            <Card>
              <CardHeader>
                <CardTitle>{flow === 'new' ? '6. Certificado digital (.p12)' : '2. Certificado digital (.p12)'}</CardTitle>
                <CardDescription>
                  Requerido para emitir en SIFEN. Se comparte entre todas las tiendas vinculadas a la identidad.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-2.5 rounded-md border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-900/15 px-3 py-2.5">
                  <Shield size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed">
                    Tu .p12 nunca se almacena. Extraemos solo la clave privada encriptada (AES-256-GCM) y el certificado publico.
                  </p>
                </div>

                {certFile ? (
                  <div className="flex items-center gap-3 rounded-md border border-green-200 bg-green-50 px-3 py-2.5">
                    <CheckCircle2 size={15} className="text-green-600" />
                    <span className="text-sm font-medium flex-1 truncate">{certFile.name}</span>
                    <button type="button" onClick={() => { setCertFile(null); setCertPassword(''); }}>
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center gap-3 cursor-pointer rounded-md border border-dashed hover:border-primary/60 transition-colors px-4 py-3">
                    <Upload size={16} className="text-muted-foreground shrink-0" />
                    <span className="text-sm text-muted-foreground">Selecciona tu archivo .p12</span>
                    <input type="file" accept=".p12,.pfx" className="sr-only" onChange={(e) => setCertFile(e.target.files?.[0] || null)} />
                  </label>
                )}

                {certFile && (
                  <div>
                    <Label>Contrasena del certificado</Label>
                    <Input
                      type="password"
                      placeholder="Contrasena de apertura del .p12"
                      value={certPassword}
                      onChange={(e) => setCertPassword(e.target.value)}
                    />
                  </div>
                )}

                <div className="flex justify-end pt-2">
                  <Button onClick={submitCertificate} disabled={saving || !certFile || !certPassword}>
                    {saving && <Loader2 className="animate-spin mr-2" size={14} />}
                    Completar configuracion
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* ─────────────── FLOW B: EXISTING ─────────────── */}
        {flow === 'existing' && existingStep === 'pick' && (
          <motion.div key="existing-pick" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.2 }}>
            <Card>
              <CardHeader>
                <CardTitle>Usar identidad existente</CardTitle>
                <CardDescription>
                  Selecciona una identidad fiscal registrada. Se reusara para esta tienda.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {loadingIdentities ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="animate-spin" size={20} />
                  </div>
                ) : existingIdentities.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No tienes identidades fiscales registradas. Volve y elegi "Crear identidad fiscal nueva".
                  </p>
                ) : (
                  <div className="space-y-2">
                    {existingIdentities.map((id) => (
                      <button
                        key={id.id}
                        type="button"
                        onClick={() => selectIdentity(id)}
                        className={`w-full border rounded-lg p-3 text-left transition-colors ${
                          selectedIdentityId === id.id ? 'border-primary bg-primary/5' : 'hover:border-primary/50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{id.razon_social}</p>
                            <p className="text-xs text-muted-foreground">
                              RUC {id.ruc}-{id.ruc_dv} - {id.nombre_fantasia ?? 'Sin nombre fantasia'}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge variant="outline">{id.sifen_environment}</Badge>
                            {id.has_certificate && <Badge className="bg-green-100 text-green-800">Cert OK</Badge>}
                          </div>
                        </div>
                        {(id.stores?.length ?? 0) > 0 && (
                          <p className="text-xs text-muted-foreground mt-2">
                            En uso:{' '}
                            {id.stores!
                              .map(
                                (s) =>
                                  `${s.store_name ?? 'tienda'} (${s.establecimiento_codigo}/${s.punto_expedicion})`,
                              )
                              .join(', ')}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex justify-between pt-2">
                  <Button type="button" variant="outline" onClick={() => setFlow('choose')}>Atras</Button>
                  <Button
                    type="button"
                    disabled={!selectedIdentityId}
                    onClick={() => setExistingStep('store')}
                  >
                    Siguiente
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {flow === 'existing' && existingStep === 'store' && (
          <motion.div key="existing-store" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.2 }}>
            <Card>
              <CardHeader>
                <CardTitle>Establecimiento y timbrado</CardTitle>
                <CardDescription>Datos de esta tienda para la identidad seleccionada.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={submitLinkExisting} className="space-y-5">
                  {selectedIdentity && (
                    <div className="flex items-start gap-2.5 rounded-md border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-900/15 px-3 py-2.5">
                      <Building2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed">
                        Reusando <strong>{selectedIdentity.razon_social}</strong> (RUC{' '}
                        {selectedIdentity.ruc}-{selectedIdentity.ruc_dv}).
                        {selectedIdentity.has_certificate
                          ? ' Certificado y CSC ya cargados, se reusan en esta tienda.'
                          : ''}
                      </p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Código de establecimiento</Label>
                      <Input placeholder="001" maxLength={3} {...establecimientoForm.register('establecimiento_codigo')} />
                    </div>
                    <div>
                      <Label>Punto de expedicion</Label>
                      <Input placeholder="001" maxLength={3} {...establecimientoForm.register('punto_expedicion')} />
                      {reusedPuntosEnUso.length > 0 && (
                        <HintText>
                          Puntos en uso para el establecimiento {watchedEstab}:{' '}
                          {reusedPuntosEnUso.join(', ')}. Usa uno distinto (sugerido:{' '}
                          {suggestNextPunto(selectedIdentity, watchedEstab)}).
                        </HintText>
                      )}
                    </div>
                  </div>
                  <div>
                    <Label>Dirección del establecimiento</Label>
                    <Input placeholder="Av. España 1234, Asunción" {...establecimientoForm.register('establecimiento_direccion')} />
                  </div>
                  <div>
                    <Label>Teléfono</Label>
                    <Input placeholder="021-123456" {...establecimientoForm.register('establecimiento_telefono')} />
                  </div>
                  <div>
                    <Label>Número de timbrado (8 dígitos)</Label>
                    <Input placeholder="12345678" maxLength={8} {...establecimientoForm.register('timbrado')} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Vigencia desde</Label>
                      <DateInput
                        value={establecimientoForm.watch('timbrado_fecha_inicio') || ''}
                        onChange={(val) => establecimientoForm.setValue('timbrado_fecha_inicio', val)}
                      />
                    </div>
                    <div>
                      <Label>Vigencia hasta</Label>
                      <DateInput
                        value={establecimientoForm.watch('timbrado_fecha_fin') || ''}
                        onChange={(val) => establecimientoForm.setValue('timbrado_fecha_fin', val)}
                      />
                    </div>
                  </div>

                  <div className="flex justify-between">
                    <Button type="button" variant="outline" onClick={() => setExistingStep('pick')}>Atras</Button>
                    <Button type="submit" disabled={saving}>
                      {saving && <Loader2 className="animate-spin mr-2" size={14} />}
                      Completar
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
