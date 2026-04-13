import { useState, useRef, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { invoicingService } from '@/services/invoicing.service';
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
// Hint component — inline contextual help
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
        <TooltipContent className="max-w-xs text-xs leading-relaxed">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function HintText({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{children}</p>
  );
}

// ================================================================
// Validation Schemas
// ================================================================
const step1Schema = z.object({
  ruc: z.string().min(1, 'El RUC es requerido').regex(/^\d+$/, 'Solo números, sin guiones'),
  tipo_contribuyente: z.number().min(1).max(2),
});

const step2Schema = z.object({
  razon_social: z.string().min(1, 'La razón social es requerida').max(255),
  nombre_fantasia: z.string().max(255).optional(),
  actividad_economica_codigo: z.string().max(10).optional(),
  actividad_economica_descripcion: z.string().max(255).optional(),
  tipo_regimen: z.number().optional(),
});

const step3Schema = z.object({
  establecimiento_codigo: z.string().min(1).max(3).default('001'),
  punto_expedicion: z.string().min(1).max(3).default('001'),
  establecimiento_direccion: z.string().max(500).optional(),
  establecimiento_telefono: z.string().max(20).optional(),
});

const step4Schema = z.object({
  timbrado: z.string().min(1, 'El número de timbrado es requerido'),
  timbrado_fecha_inicio: z.string().optional(),
  timbrado_fecha_fin: z.string().optional(),
});

interface Props {
  onComplete: () => void;
}

const stepVariants = {
  enter: { opacity: 0, x: 24 },
  center: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
};

export function InvoicingSetupWizard({ onComplete }: Props) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [rucDV, setRucDV] = useState<number | null>(null);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [certPassword, setCertPassword] = useState('');
  const [uploadingCert, setUploadingCert] = useState(false);
  const isMountedRef = useRef(true);
  const { toast } = useToast();

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const [formData, setFormData] = useState<Record<string, unknown>>({
    tipo_contribuyente: 2,
    establecimiento_codigo: '001',
    punto_expedicion: '001',
    sifen_environment: 'demo',
  });

  const form1 = useForm({
    resolver: zodResolver(step1Schema),
    defaultValues: { ruc: '', tipo_contribuyente: 2 as 1 | 2 },
  });
  const form2 = useForm({
    resolver: zodResolver(step2Schema),
    defaultValues: {
      razon_social: '',
      nombre_fantasia: '',
      actividad_economica_codigo: '',
      actividad_economica_descripcion: '',
      tipo_regimen: undefined as number | undefined,
    },
  });
  const form3 = useForm({
    resolver: zodResolver(step3Schema),
    defaultValues: {
      establecimiento_codigo: '001',
      punto_expedicion: '001',
      establecimiento_direccion: '',
      establecimiento_telefono: '',
    },
  });
  const form4 = useForm({
    resolver: zodResolver(step4Schema),
    defaultValues: { timbrado: '', timbrado_fecha_inicio: '', timbrado_fecha_fin: '' },
  });

  const handleRucChange = (value: string) => {
    form1.setValue('ruc', value);
    if (/^\d+$/.test(value) && value.length >= 1) {
      setRucDV(calcularDV(value));
    } else {
      setRucDV(null);
    }
  };

  const handleStep1 = form1.handleSubmit((data) => {
    if (rucDV === null) {
      toast({
        title: 'RUC inválido',
        description: 'Ingresá un RUC válido para continuar.',
        variant: 'destructive',
      });
      return;
    }
    setFormData((prev) => ({ ...prev, ...data, ruc_dv: rucDV }));
    setStep(2);
  });

  const handleStep2 = form2.handleSubmit((data) => {
    setFormData((prev) => ({ ...prev, ...data }));
    setStep(3);
  });

  const handleStep3 = form3.handleSubmit((data) => {
    setFormData((prev) => ({ ...prev, ...data }));
    setStep(4);
  });

  const handleStep4 = form4.handleSubmit(async (data) => {
    const env = formData.sifen_environment as string;
    const requiresCert = env !== 'demo';

    if (requiresCert && !certFile) {
      toast({
        title: 'Certificado requerido',
        description: 'Para el ambiente de pruebas o producción necesitás subir tu certificado .p12.',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);
    try {
      const fullData = { ...formData, ...data };
      await invoicingService.saveConfig(fullData);

      if (certFile && certPassword) {
        if (!isMountedRef.current) return;
        setUploadingCert(true);
        await invoicingService.uploadCertificate(certFile, certPassword);
      }

      if (!isMountedRef.current) return;
      toast({
        title: 'Configuración guardada',
        description: 'Tu facturación electrónica está lista.',
      });
      onComplete();
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      const message = err instanceof Error ? err.message : 'Error al guardar configuración';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      if (isMountedRef.current) {
        setSaving(false);
        setUploadingCert(false);
      }
    }
  });

  const steps = [
    { num: 1, label: 'Contribuyente', icon: Building2 },
    { num: 2, label: 'Empresa', icon: FileDigit },
    { num: 3, label: 'Establecimiento', icon: MapPin },
    { num: 4, label: 'Timbrado', icon: Shield },
  ];

  const currentEnv = formData.sifen_environment as string;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={s.num} className="flex items-center gap-2">
              <div
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                  step === s.num
                    ? 'bg-primary text-primary-foreground'
                    : step > s.num
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {step > s.num ? <CheckCircle2 size={14} /> : <Icon size={14} />}
                <span className="hidden sm:inline">{s.label}</span>
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`w-8 h-0.5 transition-colors duration-300 ${step > s.num ? 'bg-primary' : 'bg-border'}`}
                />
              )}
            </div>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {/* ── Step 1: Contribuyente ── */}
        {step === 1 && (
          <motion.div key="step1" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.2 }}>
            <Card>
              <CardHeader>
                <CardTitle>Identificación fiscal</CardTitle>
                <CardDescription>
                  Ingresá el RUC de tu empresa tal como figura en el Marangatú o en tu cédula tributaria del SET.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleStep1} className="space-y-5">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2">
                      <Label>
                        RUC
                        <FieldHint>
                          Número de RUC sin guiones ni dígito verificador. Lo encontrás en tu
                          Constancia de RUC del SET (Marangatú) o en cualquier factura de tu empresa.
                        </FieldHint>
                      </Label>
                      <Input
                        placeholder="80012345"
                        {...form1.register('ruc')}
                        onChange={(e) => handleRucChange(e.target.value.replace(/\D/g, ''))}
                      />
                      {form1.formState.errors.ruc && (
                        <p className="text-sm text-destructive mt-1">
                          {form1.formState.errors.ruc.message}
                        </p>
                      )}
                    </div>
                    <div>
                      <Label>
                        DV
                        <FieldHint>
                          Dígito Verificador. Se calcula automáticamente a partir de tu RUC.
                          Aparece después del guion en tu RUC completo (ej: 80012345-6).
                        </FieldHint>
                      </Label>
                      <Input
                        value={rucDV !== null ? String(rucDV) : ''}
                        readOnly
                        className="bg-muted text-center font-mono text-lg"
                      />
                      <HintText>Auto-calculado</HintText>
                    </div>
                  </div>

                  <div>
                    <Label>
                      Tipo de contribuyente
                      <FieldHint>
                        Persona Física: RUC asociado a una cédula de identidad.
                        Persona Jurídica: empresa, SRL, SA, asociación, etc.
                      </FieldHint>
                    </Label>
                    <Select
                      value={String(form1.watch('tipo_contribuyente'))}
                      onValueChange={(v) =>
                        form1.setValue('tipo_contribuyente', Number(v) as 1 | 2)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Persona Física</SelectItem>
                        <SelectItem value="2">Persona Jurídica (empresa)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex justify-end">
                    <Button type="submit">Siguiente</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* ── Step 2: Datos de la empresa ── */}
        {step === 2 && (
          <motion.div key="step2" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.2 }}>
            <Card>
              <CardHeader>
                <CardTitle>Datos de la empresa</CardTitle>
                <CardDescription>
                  Información legal de tu empresa. Debe coincidir exactamente con lo registrado en el SET.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleStep2} className="space-y-5">
                  <div>
                    <Label>
                      Razón social
                      <FieldHint>
                        Nombre legal completo de tu empresa tal como está inscripto en el SET.
                        Lo encontrás en tu Constancia de RUC o en el Marangatú.
                      </FieldHint>
                    </Label>
                    <Input
                      placeholder="Mi Empresa S.A."
                      {...form2.register('razon_social')}
                    />
                    {form2.formState.errors.razon_social && (
                      <p className="text-sm text-destructive mt-1">
                        {form2.formState.errors.razon_social.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <Label>
                      Nombre comercial{' '}
                      <span className="text-muted-foreground font-normal">(opcional)</span>
                      <FieldHint>
                        El nombre con el que tu negocio se presenta al público. Puede ser diferente a la razón social.
                        Si no tenés, dejalo en blanco.
                      </FieldHint>
                    </Label>
                    <Input
                      placeholder="MiMarca"
                      {...form2.register('nombre_fantasia')}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>
                        Código de actividad económica{' '}
                        <span className="text-muted-foreground font-normal">(opcional)</span>
                        <FieldHint>
                          Código CIIU de tu actividad principal. Lo encontrás en tu Constancia de RUC del SET.
                          Ejemplo: 47190 para venta al por menor.
                        </FieldHint>
                      </Label>
                      <Input
                        placeholder="47190"
                        {...form2.register('actividad_economica_codigo')}
                      />
                    </div>
                    <div>
                      <Label>
                        Descripción de actividad{' '}
                        <span className="text-muted-foreground font-normal">(opcional)</span>
                      </Label>
                      <Input
                        placeholder="Venta al por menor"
                        {...form2.register('actividad_economica_descripcion')}
                      />
                    </div>
                  </div>

                  <div>
                    <Label>
                      Régimen tributario{' '}
                      <span className="text-muted-foreground font-normal">(opcional)</span>
                      <FieldHint>
                        Solo completá este campo si tu empresa está bajo un régimen especial.
                        La mayoría de las empresas no necesita seleccionar nada aquí.
                      </FieldHint>
                    </Label>
                    <Select
                      value={form2.watch('tipo_regimen') ? String(form2.watch('tipo_regimen')) : ''}
                      onValueChange={(v) =>
                        form2.setValue('tipo_regimen', v ? Number(v) : undefined)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Régimen general (por defecto)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Régimen Turístico</SelectItem>
                        <SelectItem value="8">Pequeño Contribuyente</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex justify-between">
                    <Button type="button" variant="outline" onClick={() => setStep(1)}>
                      Atrás
                    </Button>
                    <Button type="submit">Siguiente</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* ── Step 3: Establecimiento ── */}
        {step === 3 && (
          <motion.div key="step3" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.2 }}>
            <Card>
              <CardHeader>
                <CardTitle>Punto de emisión</CardTitle>
                <CardDescription>
                  Datos del local o punto desde donde emitís tus facturas. Si tenés un solo local, dejá los códigos en 001.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleStep3} className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>
                        Número de establecimiento
                        <FieldHint>
                          Número de 3 dígitos que identifica tu local ante el SET.
                          Lo encontrás en tu Timbrado (en la parte superior del documento impreso).
                          Si tenés un solo local, es 001.
                        </FieldHint>
                      </Label>
                      <Input
                        placeholder="001"
                        maxLength={3}
                        {...form3.register('establecimiento_codigo')}
                      />
                      <HintText>
                        Generalmente 001 para el primer o único local.
                      </HintText>
                    </div>
                    <div>
                      <Label>
                        Número de punto de expedición
                        <FieldHint>
                          Número de 3 dígitos que identifica la caja o terminal desde donde emitís facturas dentro del establecimiento.
                          También figura en tu Timbrado. Si tenés una sola caja, es 001.
                        </FieldHint>
                      </Label>
                      <Input
                        placeholder="001"
                        maxLength={3}
                        {...form3.register('punto_expedicion')}
                      />
                      <HintText>
                        Generalmente 001 para la primera o única terminal.
                      </HintText>
                    </div>
                  </div>

                  <div className="rounded-lg bg-muted/50 border px-4 py-3 text-xs text-muted-foreground leading-relaxed">
                    <strong className="text-foreground">¿Dónde lo encontrás?</strong> En el Timbrado emitido por el SET, estos números aparecen en el encabezado junto a tu RUC. Si no los tenés a mano, usá 001 para ambos y tu contador puede confirmarlo luego.
                  </div>

                  <div>
                    <Label>Dirección del establecimiento</Label>
                    <Input
                      placeholder="Av. España 1234, Asunción"
                      {...form3.register('establecimiento_direccion')}
                    />
                  </div>

                  <div>
                    <Label>Teléfono</Label>
                    <Input
                      placeholder="021-123456"
                      {...form3.register('establecimiento_telefono')}
                    />
                  </div>

                  <div className="flex justify-between">
                    <Button type="button" variant="outline" onClick={() => setStep(2)}>
                      Atrás
                    </Button>
                    <Button type="submit">Siguiente</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* ── Step 4: Timbrado + Certificado ── */}
        {step === 4 && (
          <motion.div key="step4" variants={stepVariants} initial="enter" animate="center" exit="exit" transition={{ duration: 0.2 }}>
            <Card>
              <CardHeader>
                <CardTitle>Timbrado y firma digital</CardTitle>
                <CardDescription>
                  El timbrado autoriza tu rango de documentos. La firma digital es el certificado que el SET usa para validar que sos vos quien emite.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleStep4} className="space-y-5">
                  <div>
                    <Label>
                      Número de timbrado
                      <FieldHint>
                        Número de 8 dígitos que el SET te asigna para autorizar la emisión de documentos electrónicos.
                        Lo encontrás en la resolución de timbrado que recibiste del SET.
                      </FieldHint>
                    </Label>
                    <Input
                      placeholder="12345678"
                      {...form4.register('timbrado')}
                    />
                    {form4.formState.errors.timbrado && (
                      <p className="text-sm text-destructive mt-1">
                        {form4.formState.errors.timbrado.message}
                      </p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>
                        Vigencia desde
                        <FieldHint>Fecha de inicio de validez del timbrado, indicada en la resolución del SET.</FieldHint>
                      </Label>
                      <DateInput
                        value={form4.watch('timbrado_fecha_inicio') || ''}
                        onChange={(val) => form4.setValue('timbrado_fecha_inicio', val)}
                      />
                    </div>
                    <div>
                      <Label>
                        Vigencia hasta
                        <FieldHint>Fecha de vencimiento del timbrado. Si no tiene fecha de fin, dejalo en blanco.</FieldHint>
                      </Label>
                      <DateInput
                        value={form4.watch('timbrado_fecha_fin') || ''}
                        onChange={(val) => form4.setValue('timbrado_fecha_fin', val)}
                      />
                    </div>
                  </div>

                  {/* Environment selector */}
                  <div>
                    <Label>
                      Modo de facturación
                      <FieldHint>
                        Demo: genera facturas completas con XML válido pero sin enviarlas al SIFEN. Ideal para probar.
                        Pruebas SET: envía al ambiente de pruebas oficial del SET. Requiere certificado digital.
                        Producción: facturación real. Requiere certificado digital vigente.
                      </FieldHint>
                    </Label>
                    <Select
                      value={currentEnv}
                      onValueChange={(v) =>
                        setFormData((prev) => ({ ...prev, sifen_environment: v }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="demo">Demo (sin envío al SIFEN)</SelectItem>
                        <SelectItem value="test">Pruebas SET (requiere certificado)</SelectItem>
                        <SelectItem value="prod">Producción (requiere certificado)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Demo info */}
                  {currentEnv === 'demo' && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 p-4"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400">
                          Demo
                        </Badge>
                        <span className="text-sm font-medium text-purple-800 dark:text-purple-300">
                          Simulación sin envío
                        </span>
                      </div>
                      <p className="text-xs text-purple-700 dark:text-purple-400 leading-relaxed">
                        Se generan facturas reales con XML y CDC válido, pero no se envían al SIFEN.
                        No necesitás certificado digital todavía. Podés cambiar al modo Pruebas o Producción cuando tengas tu firma.
                      </p>
                    </motion.div>
                  )}

                  {/* Certificate section — shown for test/prod, optional hint for demo */}
                  <div className="border rounded-lg overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3 bg-muted/40 border-b">
                      <FileKey2 size={16} className="text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium leading-none">
                          Certificado digital (.p12)
                          {currentEnv !== 'demo' && (
                            <span className="text-destructive ml-1">*</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {currentEnv === 'demo'
                            ? 'Opcional en modo Demo. Podés subirlo ahora o después desde Configuración.'
                            : 'Requerido para enviar facturas al SIFEN.'}
                        </p>
                      </div>
                    </div>

                    <div className="p-4 space-y-4">
                      <div className="rounded-md bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
                        <strong className="text-foreground">¿Qué es el certificado .p12?</strong>{' '}
                        Es tu firma digital tributaria, emitida por un Prestador de Servicios de Certificación (PSC) habilitado por el MITIC.
                        Lo tramitás junto a tu RUC electrónico en el SET. Si ya lo tenés, es el archivo .p12 que te entregaron
                        junto con una contraseña de apertura.
                      </div>

                      <div className="flex items-start gap-2.5 rounded-md border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-900/15 px-3 py-2.5">
                        <Shield size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-emerald-800 dark:text-emerald-300 leading-relaxed">
                          Tu certificado .p12 nunca se almacena en nuestros servidores. Al momento de configurarlo, extraemos
                          únicamente la información necesaria para firmar tus facturas y el archivo original se descarta de inmediato.
                        </p>
                      </div>

                      {certFile ? (
                        <div className="flex items-center gap-3 rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-3 py-2.5">
                          <CheckCircle2 size={15} className="text-green-600 dark:text-green-400 shrink-0" />
                          <span className="text-sm font-medium text-green-800 dark:text-green-300 flex-1 truncate">
                            {certFile.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setCertFile(null);
                              setCertPassword('');
                            }}
                            className="text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <label className="flex items-center gap-3 cursor-pointer rounded-md border border-dashed hover:border-primary/60 transition-colors px-4 py-3">
                          <Upload size={16} className="text-muted-foreground shrink-0" />
                          <span className="text-sm text-muted-foreground">
                            Hacé clic para seleccionar tu archivo .p12
                          </span>
                          <input
                            type="file"
                            accept=".p12,.pfx"
                            className="sr-only"
                            onChange={(e) => setCertFile(e.target.files?.[0] || null)}
                          />
                        </label>
                      )}

                      {certFile && (
                        <motion.div
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                        >
                          <Label>
                            Contraseña del certificado
                            <FieldHint>
                              La contraseña que te entregaron junto al archivo .p12.
                              No es la contraseña del Marangatú, sino la específica del certificado.
                            </FieldHint>
                          </Label>
                          <Input
                            type="password"
                            placeholder="Contraseña de apertura del .p12"
                            value={certPassword}
                            onChange={(e) => setCertPassword(e.target.value)}
                            className="mt-1.5"
                          />
                          <HintText>
                            Te la entregó el PSC cuando te emitió el certificado. No es tu contraseña de Marangatú.
                          </HintText>
                        </motion.div>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between">
                    <Button type="button" variant="outline" onClick={() => setStep(3)}>
                      Atrás
                    </Button>
                    <Button
                      type="submit"
                      disabled={
                        saving ||
                        (currentEnv !== 'demo' && !certFile) ||
                        (certFile !== null && certPassword.length === 0)
                      }
                    >
                      {saving && <Loader2 className="animate-spin mr-2" size={16} />}
                      {uploadingCert
                        ? 'Subiendo certificado...'
                        : saving
                          ? 'Guardando...'
                          : 'Completar configuración'}
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
