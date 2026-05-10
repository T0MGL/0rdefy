/**
 * InvoicingSettingsEditor
 *
 * Pre-populated editor for the fiscal identity + per-store link attached
 * to the current store. Lets the operator complete missing data (most
 * importantly the representante legal, which SIFEN requires) without
 * going through the full setup wizard again.
 *
 * Sections:
 *   1. Identity        (razon social, nombre fantasia, tipo contribuyente)
 *   2. Representante   (nombre + tipo doc + numero + cargo) <- SIFEN required
 *   3. Domicilio       (direccion, departamento, distrito, ciudad)
 *   4. Establecimiento (codigo, punto, direccion, telefono, timbrado + vigencia)
 *   5. Ambiente        (demo / test / prod) <- prod gated by certificate
 *   6. Certificado     (.p12 upload with password)
 *
 * Only patches fields that actually changed (uses react-hook-form
 * dirtyFields) so the backend receives minimal payloads and unchanged
 * validators do not fire.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { motion } from 'framer-motion';
import {
  Loader2,
  Shield,
  CheckCircle2,
  Upload,
  X,
  FileKey2,
  AlertTriangle,
  KeyRound,
  ChevronDown,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import {
  fiscalService,
  FiscalContext,
  FiscalIdentityInput,
  FiscalStoreLinkInput,
} from '@/services/invoicing.service';

// ================================================================
// Validation
// ================================================================

const identitySchema = z.object({
  razon_social: z.string().min(1, 'Requerido').max(255),
  nombre_fantasia: z.string().max(255).optional().default(''),
  tipo_contribuyente: z.union([z.literal(1), z.literal(2)]),
  sifen_environment: z.enum(['demo', 'test', 'prod']),

  representante_legal_nombre: z.string().min(1, 'Requerido').max(255),
  representante_legal_documento_tipo: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(9),
  ]),
  representante_legal_documento_numero: z.string().min(1, 'Requerido').max(50),
  representante_legal_cargo: z.string().max(100).optional().default(''),

  domicilio_fiscal_direccion: z.string().max(500).optional().default(''),
  domicilio_fiscal_numero_casa: z.string().max(20).optional().default(''),
  domicilio_fiscal_departamento: z.coerce.number().int().nonnegative().optional(),
  domicilio_fiscal_distrito: z.coerce.number().int().nonnegative().optional(),
  domicilio_fiscal_ciudad: z.coerce.number().int().nonnegative().optional(),
});

const storeSchema = z.object({
  timbrado: z.string().regex(/^\d{8}$/, 'Debe tener 8 digitos'),
  timbrado_fecha_inicio: z.string().optional().default(''),
  timbrado_fecha_fin: z.string().optional().default(''),
  establecimiento_codigo: z.string().regex(/^\d{3}$/, '3 digitos').default('001'),
  punto_expedicion: z.string().regex(/^\d{3}$/, '3 digitos').default('001'),
  establecimiento_direccion: z.string().max(500).optional().default(''),
  establecimiento_telefono: z.string().max(50).optional().default(''),
  establecimiento_email: z
    .string()
    .email('Email invalido')
    .optional()
    .or(z.literal('')),
});

type IdentityForm = z.infer<typeof identitySchema>;
type StoreForm = z.infer<typeof storeSchema>;

// ================================================================
// Component
// ================================================================

interface Props {
  onSaved: () => void;
  onCancel: () => void;
}

export function InvoicingSettingsEditor({ onSaved, onCancel }: Props) {
  const { toast } = useToast();
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingCert, setUploadingCert] = useState(false);
  const [ctx, setCtx] = useState<FiscalContext | null>(null);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certPassword, setCertPassword] = useState('');
  const [hasCertificate, setHasCertificate] = useState(false);

  // CSC state. idCSC is a short numeric identifier DNIT assigns
  // (e.g. "0001") and is safe to display. The CSC itself is a 32-hex
  // secret and is write-only; we never round-trip it through the API,
  // only confirm whether one is stored via ctx.identity.csc_id.
  const [cscIdInput, setCscIdInput] = useState('');
  const [cscInput, setCscInput] = useState('');
  const [savingCsc, setSavingCsc] = useState(false);
  const [hasCsc, setHasCsc] = useState(false);

  const [guideOpen, setGuideOpen] = useState(false);

  const identityForm = useForm<IdentityForm>({
    resolver: zodResolver(identitySchema),
    defaultValues: {
      razon_social: '',
      nombre_fantasia: '',
      tipo_contribuyente: 2,
      sifen_environment: 'demo',
      representante_legal_nombre: '',
      representante_legal_documento_tipo: 1,
      representante_legal_documento_numero: '',
      representante_legal_cargo: '',
      domicilio_fiscal_direccion: '',
      domicilio_fiscal_numero_casa: '',
      domicilio_fiscal_departamento: undefined,
      domicilio_fiscal_distrito: undefined,
      domicilio_fiscal_ciudad: undefined,
    },
  });

  const storeForm = useForm<StoreForm>({
    resolver: zodResolver(storeSchema),
    defaultValues: {
      timbrado: '',
      timbrado_fecha_inicio: '',
      timbrado_fecha_fin: '',
      establecimiento_codigo: '001',
      punto_expedicion: '001',
      establecimiento_direccion: '',
      establecimiento_telefono: '',
      establecimiento_email: '',
    },
  });

  // Load current context and hydrate both forms.
  const hydrate = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fiscalService.getContext();
      if (!isMountedRef.current) return;
      if (!data) {
        toast({
          title: 'Sin configuracion',
          description: 'No hay una identidad fiscal vinculada a esta tienda.',
          variant: 'destructive',
        });
        setLoading(false);
        return;
      }
      setCtx(data);
      setHasCertificate(Boolean((data.identity as any).has_certificate));
      setHasCsc(Boolean(data.identity.csc_id));
      setCscIdInput(data.identity.csc_id ?? '');
      setCscInput('');

      identityForm.reset({
        razon_social: data.identity.razon_social ?? '',
        nombre_fantasia: data.identity.nombre_fantasia ?? '',
        tipo_contribuyente: (data.identity.tipo_contribuyente ?? 2) as 1 | 2,
        sifen_environment: data.identity.sifen_environment,
        representante_legal_nombre: data.identity.representante_legal_nombre ?? '',
        representante_legal_documento_tipo: (data.identity.representante_legal_documento_tipo ?? 1) as any,
        representante_legal_documento_numero: data.identity.representante_legal_documento_numero ?? '',
        representante_legal_cargo: data.identity.representante_legal_cargo ?? '',
        domicilio_fiscal_direccion: data.identity.domicilio_fiscal_direccion ?? '',
        domicilio_fiscal_numero_casa: data.identity.domicilio_fiscal_numero_casa ?? '',
        domicilio_fiscal_departamento: data.identity.domicilio_fiscal_departamento ?? undefined,
        domicilio_fiscal_distrito: data.identity.domicilio_fiscal_distrito ?? undefined,
        domicilio_fiscal_ciudad: data.identity.domicilio_fiscal_ciudad ?? undefined,
      });

      // SIFEN requires representante_legal_{nombre, documento_tipo, documento_numero}
      // and tipo_contribuyente to be non-null. When any of them is NULL in the DB
      // the form above hydrates with a visible default, but react-hook-form does
      // not mark those fields dirty, so a plain "Guardar" skips them and the DB
      // stays NULL, leaving the fiscal readiness badge stuck on "incompleta".
      // Force-dirty the defaults so the next save persists them without requiring
      // the user to manually touch the control.
      if (data.identity.tipo_contribuyente == null) {
        identityForm.setValue('tipo_contribuyente', 2, { shouldDirty: true });
      }
      if (data.identity.representante_legal_documento_tipo == null) {
        identityForm.setValue('representante_legal_documento_tipo', 1, { shouldDirty: true });
      }

      storeForm.reset({
        timbrado: data.link.timbrado ?? '',
        timbrado_fecha_inicio: data.link.timbrado_fecha_inicio ?? '',
        timbrado_fecha_fin: data.link.timbrado_fecha_fin ?? '',
        establecimiento_codigo: data.link.establecimiento_codigo ?? '001',
        punto_expedicion: data.link.punto_expedicion ?? '001',
        establecimiento_direccion: data.link.establecimiento_direccion ?? '',
        establecimiento_telefono: data.link.establecimiento_telefono ?? '',
        establecimiento_email: data.link.establecimiento_email ?? '',
      });
    } catch (err: any) {
      if (!isMountedRef.current) return;
      toast({
        title: 'Error',
        description: err.message ?? 'No se pudo cargar la configuracion fiscal.',
        variant: 'destructive',
      });
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [identityForm, storeForm, toast]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Only send the fields the user actually changed. Prevents overwriting
  // sibling stores' state and keeps the backend validators focused.
  const buildIdentityPatch = (): Partial<FiscalIdentityInput> => {
    const dirty = identityForm.formState.dirtyFields as Record<string, boolean>;
    const values = identityForm.getValues();
    const patch: Partial<FiscalIdentityInput> = {};
    const keys: (keyof IdentityForm)[] = [
      'razon_social',
      'nombre_fantasia',
      'tipo_contribuyente',
      'sifen_environment',
      'representante_legal_nombre',
      'representante_legal_documento_tipo',
      'representante_legal_documento_numero',
      'representante_legal_cargo',
      'domicilio_fiscal_direccion',
      'domicilio_fiscal_numero_casa',
      'domicilio_fiscal_departamento',
      'domicilio_fiscal_distrito',
      'domicilio_fiscal_ciudad',
    ];
    for (const k of keys) {
      if (!dirty[k]) continue;
      const raw = values[k];
      // Normalize empty string to null for nullable fields.
      if (raw === '' || raw === undefined) {
        (patch as any)[k] = null;
      } else {
        (patch as any)[k] = raw;
      }
    }
    return patch;
  };

  const buildStorePatch = (): Partial<FiscalStoreLinkInput> => {
    const dirty = storeForm.formState.dirtyFields as Record<string, boolean>;
    const values = storeForm.getValues();
    const patch: Partial<FiscalStoreLinkInput> = {};
    const keys: (keyof StoreForm)[] = [
      'timbrado',
      'timbrado_fecha_inicio',
      'timbrado_fecha_fin',
      'establecimiento_codigo',
      'punto_expedicion',
      'establecimiento_direccion',
      'establecimiento_telefono',
      'establecimiento_email',
    ];
    for (const k of keys) {
      if (!dirty[k]) continue;
      const raw = values[k];
      if (raw === '' || raw === undefined) {
        (patch as any)[k] = null;
      } else {
        (patch as any)[k] = raw;
      }
    }
    return patch;
  };

  const handleSave = async () => {
    if (!ctx) return;

    // Validate both forms before hitting the API.
    const identityOk = await identityForm.trigger();
    const storeOk = await storeForm.trigger();
    if (!identityOk || !storeOk) {
      toast({
        title: 'Revisa los campos',
        description: 'Hay datos obligatorios incompletos o con formato invalido.',
        variant: 'destructive',
      });
      return;
    }

    const identityPatch = buildIdentityPatch();
    const storePatch = buildStorePatch();
    if (Object.keys(identityPatch).length === 0 && Object.keys(storePatch).length === 0) {
      toast({ title: 'Sin cambios', description: 'No modificaste ningun dato.' });
      return;
    }

    setSaving(true);
    try {
      if (Object.keys(identityPatch).length > 0) {
        await fiscalService.updateIdentity(ctx.identity.id, identityPatch);
      }
      if (Object.keys(storePatch).length > 0) {
        const storeId = localStorage.getItem('current_store_id');
        if (!storeId) throw new Error('No hay tienda seleccionada.');
        await fiscalService.updateStoreFields(storeId, storePatch);
      }
      if (!isMountedRef.current) return;
      toast({
        title: 'Datos guardados',
        description: 'La configuracion fiscal se actualizo correctamente.',
      });
      onSaved();
    } catch (err: any) {
      if (!isMountedRef.current) return;
      toast({
        title: 'Error al guardar',
        description: err.message ?? 'No se pudieron guardar los cambios.',
        variant: 'destructive',
      });
    } finally {
      if (isMountedRef.current) setSaving(false);
    }
  };

  const handleUploadCert = async () => {
    if (!ctx || !certFile || !certPassword) return;
    setUploadingCert(true);
    try {
      await fiscalService.uploadIdentityCertificate(ctx.identity.id, certFile, certPassword);
      if (!isMountedRef.current) return;
      toast({
        title: 'Certificado cargado',
        description: 'El .p12 quedo asociado a la identidad fiscal.',
      });
      setCertFile(null);
      setCertPassword('');
      setHasCertificate(true);
      await hydrate();
    } catch (err: any) {
      if (!isMountedRef.current) return;
      toast({
        title: 'Error cargando certificado',
        description: err.message ?? 'No se pudo procesar el archivo .p12.',
        variant: 'destructive',
      });
    } finally {
      if (isMountedRef.current) setUploadingCert(false);
    }
  };

  const handleSaveCsc = async () => {
    if (!ctx) return;
    const cscIdTrimmed = cscIdInput.trim();
    const cscTrimmed = cscInput.trim();
    if (!/^[0-9]{1,4}$/.test(cscIdTrimmed)) {
      toast({
        title: 'idCSC invalido',
        description: 'Debe ser numerico de 1 a 4 digitos (como aparece en Marangatu).',
        variant: 'destructive',
      });
      return;
    }
    if (!/^[a-fA-F0-9]{32}$/.test(cscTrimmed)) {
      toast({
        title: 'CSC invalido',
        description: 'Debe ser una cadena hex de 32 caracteres. Copialo exactamente como lo recibiste.',
        variant: 'destructive',
      });
      return;
    }

    setSavingCsc(true);
    try {
      await fiscalService.setIdentityCsc(ctx.identity.id, cscIdTrimmed, cscTrimmed);
      if (!isMountedRef.current) return;
      toast({
        title: 'CSC guardado',
        description: 'El codigo quedo encriptado en el servidor.',
      });
      setCscInput('');
      setHasCsc(true);
      await hydrate();
    } catch (err: any) {
      if (!isMountedRef.current) return;
      toast({
        title: 'Error guardando CSC',
        description: err.message ?? 'No se pudo guardar el CSC.',
        variant: 'destructive',
      });
    } finally {
      if (isMountedRef.current) setSavingCsc(false);
    }
  };

  const selectedEnv = identityForm.watch('sifen_environment');
  const envRequiresCert = selectedEnv === 'test' || selectedEnv === 'prod';
  const envBlocked = envRequiresCert && !hasCertificate;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin" size={22} />
      </div>
    );
  }

  if (!ctx) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No hay una identidad fiscal configurada para esta tienda.
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        className="space-y-8 pt-2"
      >
        {/* RUC (read-only, for context) */}
        <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <div className="flex-1">
            <p className="text-xs text-muted-foreground">RUC</p>
            <p className="font-mono font-medium">
              {ctx.identity.ruc}-{ctx.identity.ruc_dv}
            </p>
          </div>
          {hasCertificate ? (
            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
              Certificado cargado
            </Badge>
          ) : (
            <Badge variant="outline">Sin certificado</Badge>
          )}
        </div>

        {/* Section 1: Identity */}
        <section className="space-y-4">
          <header>
            <h3 className="text-sm font-semibold">Identidad fiscal</h3>
            <p className="text-xs text-muted-foreground">
              Datos del contribuyente tal como figuran en el SET.
            </p>
          </header>

          <div>
            <Label>Razon social</Label>
            <Input {...identityForm.register('razon_social')} />
            {identityForm.formState.errors.razon_social && (
              <p className="text-xs text-destructive mt-1">
                {identityForm.formState.errors.razon_social.message}
              </p>
            )}
          </div>

          <div>
            <Label>Nombre comercial (opcional)</Label>
            <Input {...identityForm.register('nombre_fantasia')} />
          </div>

          <div>
            <Label>Tipo de contribuyente</Label>
            <Select
              value={String(identityForm.watch('tipo_contribuyente'))}
              onValueChange={(v) =>
                identityForm.setValue('tipo_contribuyente', Number(v) as 1 | 2, {
                  shouldDirty: true,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Persona Fisica</SelectItem>
                <SelectItem value="2">Persona Juridica (empresa)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        <Separator />

        {/* Section 2: Representante legal */}
        <section className="space-y-4">
          <header className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Representante legal</h3>
              <p className="text-xs text-muted-foreground">
                Persona fisica responsable de la emision. SIFEN lo exige en el XML.
              </p>
            </div>
            {(!ctx.identity.representante_legal_nombre ||
              !ctx.identity.representante_legal_documento_tipo ||
              !ctx.identity.representante_legal_documento_numero) && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle size={12} /> Incompleto
              </Badge>
            )}
          </header>

          <div>
            <Label>Nombre completo</Label>
            <Input
              placeholder="Juan Perez"
              {...identityForm.register('representante_legal_nombre')}
            />
            {identityForm.formState.errors.representante_legal_nombre && (
              <p className="text-xs text-destructive mt-1">
                {identityForm.formState.errors.representante_legal_nombre.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Tipo de documento</Label>
              <Select
                value={String(identityForm.watch('representante_legal_documento_tipo'))}
                onValueChange={(v) =>
                  identityForm.setValue(
                    'representante_legal_documento_tipo',
                    Number(v) as 1 | 2 | 3 | 4 | 5 | 6 | 9,
                    { shouldDirty: true },
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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
              <Input
                placeholder="5712264"
                {...identityForm.register('representante_legal_documento_numero')}
              />
              {identityForm.formState.errors.representante_legal_documento_numero && (
                <p className="text-xs text-destructive mt-1">
                  {identityForm.formState.errors.representante_legal_documento_numero.message}
                </p>
              )}
            </div>
          </div>

          <div>
            <Label>Cargo (opcional)</Label>
            <Input
              placeholder="REPRESENTANTE LEGAL"
              {...identityForm.register('representante_legal_cargo')}
            />
          </div>
        </section>

        <Separator />

        {/* Section 3: Domicilio */}
        <section className="space-y-4">
          <header>
            <h3 className="text-sm font-semibold">Domicilio fiscal</h3>
            <p className="text-xs text-muted-foreground">
              Direccion registrada ante DNIT. Distinto del establecimiento.
            </p>
          </header>

          <div>
            <Label>Dirección</Label>
            <Input
              placeholder="Av. Espana 1234"
              {...identityForm.register('domicilio_fiscal_direccion')}
            />
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div>
              <Label>Nro casa</Label>
              <Input {...identityForm.register('domicilio_fiscal_numero_casa')} />
            </div>
            <div>
              <Label>Depto</Label>
              <Input
                type="number"
                {...identityForm.register('domicilio_fiscal_departamento', { valueAsNumber: true })}
              />
            </div>
            <div>
              <Label>Distrito</Label>
              <Input
                type="number"
                {...identityForm.register('domicilio_fiscal_distrito', { valueAsNumber: true })}
              />
            </div>
            <div>
              <Label>Ciudad</Label>
              <Input
                type="number"
                {...identityForm.register('domicilio_fiscal_ciudad', { valueAsNumber: true })}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Codigos segun el Anexo de SIFEN. 1 / 1 / 1 = Asuncion.
          </p>
        </section>

        <Separator />

        {/* Section 4: Establecimiento */}
        <section className="space-y-4">
          <header>
            <h3 className="text-sm font-semibold">Establecimiento y timbrado</h3>
            <p className="text-xs text-muted-foreground">
              Datos de esta tienda para la identidad fiscal vinculada.
            </p>
          </header>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Código establecimiento</Label>
              <Input maxLength={3} {...storeForm.register('establecimiento_codigo')} />
              {storeForm.formState.errors.establecimiento_codigo && (
                <p className="text-xs text-destructive mt-1">
                  {storeForm.formState.errors.establecimiento_codigo.message}
                </p>
              )}
            </div>
            <div>
              <Label>Punto de expedicion</Label>
              <Input maxLength={3} {...storeForm.register('punto_expedicion')} />
              {storeForm.formState.errors.punto_expedicion && (
                <p className="text-xs text-destructive mt-1">
                  {storeForm.formState.errors.punto_expedicion.message}
                </p>
              )}
            </div>
          </div>

          <div>
            <Label>Dirección del establecimiento</Label>
            <Input {...storeForm.register('establecimiento_direccion')} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Teléfono</Label>
              <Input {...storeForm.register('establecimiento_telefono')} />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" {...storeForm.register('establecimiento_email')} />
              {storeForm.formState.errors.establecimiento_email && (
                <p className="text-xs text-destructive mt-1">
                  {storeForm.formState.errors.establecimiento_email.message}
                </p>
              )}
            </div>
          </div>

          <div>
            <Label>Número de timbrado (8 dígitos)</Label>
            <Input maxLength={8} {...storeForm.register('timbrado')} />
            {storeForm.formState.errors.timbrado && (
              <p className="text-xs text-destructive mt-1">
                {storeForm.formState.errors.timbrado.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Vigencia desde</Label>
              <DateInput
                value={storeForm.watch('timbrado_fecha_inicio') || ''}
                onChange={(val) =>
                  storeForm.setValue('timbrado_fecha_inicio', val, { shouldDirty: true })
                }
              />
            </div>
            <div>
              <Label>Vigencia hasta</Label>
              <DateInput
                value={storeForm.watch('timbrado_fecha_fin') || ''}
                onChange={(val) =>
                  storeForm.setValue('timbrado_fecha_fin', val, { shouldDirty: true })
                }
              />
            </div>
          </div>
        </section>

        <Separator />

        {/* Section 5: Ambiente */}
        <section className="space-y-4">
          <header>
            <h3 className="text-sm font-semibold">Ambiente SIFEN</h3>
            <p className="text-xs text-muted-foreground">
              Demo no envia al SIFEN. Test y produccion requieren certificado .p12.
            </p>
          </header>

          <Select
            value={identityForm.watch('sifen_environment')}
            onValueChange={(v) =>
              identityForm.setValue('sifen_environment', v as 'demo' | 'test' | 'prod', {
                shouldDirty: true,
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="demo">Demo (sin envio al SIFEN)</SelectItem>
              <SelectItem value="test" disabled={!hasCertificate}>
                Pruebas SET {hasCertificate ? '' : '(requiere certificado)'}
              </SelectItem>
              <SelectItem value="prod" disabled={!hasCertificate}>
                Produccion {hasCertificate ? '' : '(requiere certificado)'}
              </SelectItem>
            </SelectContent>
          </Select>

          {envBlocked && (
            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5" />
              Para activar este ambiente primero subi el certificado digital abajo.
            </p>
          )}
        </section>

        <Separator />

        {/* Section 6: Certificate */}
        <section className="space-y-4">
          <header className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Certificado digital (.p12)</h3>
              <p className="text-xs text-muted-foreground">
                Se comparte entre todas las tiendas vinculadas a esta identidad.
              </p>
            </div>
            {hasCertificate && (
              <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 gap-1">
                <CheckCircle2 size={12} /> Cargado
              </Badge>
            )}
          </header>

          <div className="flex items-start gap-2.5 rounded-md border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-900/15 px-3 py-2.5">
            <Shield size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed">
              El .p12 nunca se almacena. Extraemos solo la clave privada encriptada
              (AES-256-GCM) y el certificado publico.
            </p>
          </div>

          {certFile ? (
            <div className="flex items-center gap-3 rounded-md border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-900/10 px-3 py-2.5">
              <FileKey2 size={15} className="text-emerald-600 dark:text-emerald-400" />
              <span className="text-sm font-medium flex-1 truncate">{certFile.name}</span>
              <button
                type="button"
                onClick={() => {
                  setCertFile(null);
                  setCertPassword('');
                }}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Quitar archivo"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <label className="flex items-center gap-3 cursor-pointer rounded-md border border-dashed hover:border-primary/60 transition-colors px-4 py-3">
              <Upload size={16} className="text-muted-foreground shrink-0" />
              <span className="text-sm text-muted-foreground">
                {hasCertificate
                  ? 'Reemplazar certificado (.p12)'
                  : 'Selecciona tu archivo .p12'}
              </span>
              <input
                type="file"
                accept=".p12,.pfx"
                className="sr-only"
                onChange={(e) => setCertFile(e.target.files?.[0] ?? null)}
              />
            </label>
          )}

          {certFile && (
            <div className="space-y-3">
              <div>
                <Label>Contrasena del certificado</Label>
                <Input
                  type="password"
                  placeholder="Contrasena de apertura del .p12"
                  value={certPassword}
                  onChange={(e) => setCertPassword(e.target.value)}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={handleUploadCert}
                  disabled={uploadingCert || !certFile || !certPassword}
                >
                  {uploadingCert && <Loader2 className="animate-spin mr-2" size={14} />}
                  Subir certificado
                </Button>
              </div>
            </div>
          )}
        </section>

        <Separator />

        {/* Section 7: CSC (Codigo de Seguridad del Contribuyente) */}
        <section className="space-y-4">
          <header className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <KeyRound size={14} className="text-muted-foreground" />
                Codigo de Seguridad del Contribuyente (CSC)
              </h3>
              <p className="text-xs text-muted-foreground">
                Par idCSC + CSC que emite DNIT en Marangatu. Requerido para produccion.
              </p>
            </div>
            {hasCsc ? (
              <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 gap-1">
                <CheckCircle2 size={12} /> Cargado
              </Badge>
            ) : selectedEnv === 'prod' ? (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle size={12} /> Requerido
              </Badge>
            ) : (
              <Badge variant="outline">Opcional en test</Badge>
            )}
          </header>

          <div className="flex items-start gap-2.5 rounded-md border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-900/15 px-3 py-2.5">
            <Shield size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed">
              El CSC se guarda encriptado (AES-256-GCM) y nunca se devuelve al navegador.
              Si lo perdes, tenes que generar uno nuevo en Marangatu y cargarlo aca.
            </p>
          </div>

          <div className="grid grid-cols-[120px_1fr] gap-4">
            <div>
              <Label>idCSC</Label>
              <Input
                placeholder="0001"
                maxLength={4}
                value={cscIdInput}
                onChange={(e) => setCscIdInput(e.target.value.replace(/[^0-9]/g, ''))}
              />
            </div>
            <div>
              <Label>CSC (32 caracteres hex)</Label>
              <Input
                type="password"
                placeholder={hasCsc ? '•••••••• (ya cargado, reemplaza si es necesario)' : 'ej: 10EC2a7DCB4075ef3a19470f42B80e16'}
                value={cscInput}
                onChange={(e) => setCscInput(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleSaveCsc}
              disabled={savingCsc || !cscIdInput.trim() || !cscInput.trim()}
            >
              {savingCsc && <Loader2 className="animate-spin mr-2" size={14} />}
              {hasCsc ? 'Reemplazar CSC' : 'Guardar CSC'}
            </Button>
          </div>
        </section>

        <Separator />

        {/* Guia expandible: proceso DNIT */}
        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setGuideOpen((v) => !v)}
            className="w-full flex items-center justify-between text-left group"
            aria-expanded={guideOpen}
          >
            <div>
              <h3 className="text-sm font-semibold">
                Como habilitarme como Facturador Electronico en DNIT
              </h3>
              <p className="text-xs text-muted-foreground">
                Proceso paso a paso para Paraguay. Abrir para ver.
              </p>
            </div>
            <ChevronDown
              size={16}
              className={`text-muted-foreground transition-transform ${guideOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {guideOpen && (
            <div className="rounded-md border bg-muted/30 p-4 text-sm space-y-4 leading-relaxed">
              <ol className="list-decimal pl-5 space-y-3">
                <li>
                  <strong>Certificado digital.</strong> Comprar un .p12 a un prestador
                  habilitado (Confirma, DocuSign PY, etc.). Costo ~USD 60 por 1-2 anios.
                  Subilo arriba en "Certificado digital".
                </li>
                <li>
                  <strong>Solicitud de habilitacion.</strong> En{' '}
                  <a
                    href="https://marangatu.set.gov.py"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline inline-flex items-center gap-0.5"
                  >
                    Marangatu <ExternalLink size={10} />
                  </a>
                  , entrar a "Solicitudes {'>'} Facturador Electronico" y enviar el
                  Formulario 364 declarando sistema, actividad economica y domicilio.
                  El resultado inicial es "Aceptado" = habilitado para ambiente de
                  Test (no produccion todavia).
                </li>
                <li>
                  <strong>Timbrado electronico.</strong> Una vez aceptado, en Marangatu
                  "Solicitud Documento Electronico" registras los tipos (Factura,
                  Nota de Credito, Nota de Debito) por establecimiento. DNIT emite un
                  timbrado nuevo de 8 digitos especifico para DE. Cargalo arriba
                  en "Numero de timbrado".
                </li>
                <li>
                  <strong>CSC.</strong> En Marangatu generas un idCSC (numerico corto)
                  + CSC (32 hex). Te lo muestran una sola vez, guardalo. Cargalo en
                  la seccion CSC de arriba. Sin esto, SIFEN rechaza las facturas en
                  produccion con codigo 1264.
                </li>
                <li>
                  <strong>Set de pruebas.</strong> Poner el ambiente en "Pruebas SET",
                  emitir los casos obligatorios (factura, NC, auto-facturacion,
                  remision, etc.) desde Ordefy. SIFEN-test les da CDC y los aprueba.
                </li>
                <li>
                  <strong>Declaracion de cumplimiento.</strong> Firmar en Marangatu
                  la declaracion de que completaste el set. Tu RUC pasa de "Pruebas"
                  a "Habilitado Produccion".
                </li>
                <li>
                  <strong>Cambiar ambiente a Produccion.</strong> Volver aqui, cambiar
                  a "Produccion". A partir de ese momento, toda factura sale al SIFEN
                  real con validez fiscal.
                </li>
              </ol>

              <div className="flex items-start gap-2 rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/10 px-3 py-2">
                <AlertTriangle size={13} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Los codigos CSC no tienen recuperacion. DNIT te los muestra una sola
                  vez. Si los perdes, generas otro par en Marangatu (idCSC cambia).
                </p>
              </div>

              <p className="text-xs text-muted-foreground">
                Referencias oficiales:{' '}
                <a
                  href="https://ekuatia.set.gov.py"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline inline-flex items-center gap-0.5"
                >
                  ekuatia.set.gov.py <ExternalLink size={10} />
                </a>
                {' · '}
                <a
                  href="https://marangatu.set.gov.py"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline inline-flex items-center gap-0.5"
                >
                  Marangatu <ExternalLink size={10} />
                </a>
              </p>
            </div>
          )}
        </section>

        <Separator />

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Cancelar
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button type="button" onClick={handleSave} disabled={saving || envBlocked}>
                  {saving && <Loader2 className="animate-spin mr-2" size={14} />}
                  Guardar cambios
                </Button>
              </span>
            </TooltipTrigger>
            {envBlocked && (
              <TooltipContent>
                Subi el certificado .p12 antes de cambiar a {selectedEnv}.
              </TooltipContent>
            )}
          </Tooltip>
        </div>
      </motion.div>
    </TooltipProvider>
  );
}
