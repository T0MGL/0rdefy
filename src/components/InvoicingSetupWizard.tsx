import { useState, useRef, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { invoicingService } from '@/services/invoicing.service';
import { Loader2, CheckCircle2, Upload, Building2, FileDigit, MapPin, Shield } from 'lucide-react';

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
  const dv = resto > 1 ? 11 - resto : 0;
  return dv;
}

// ================================================================
// Validation Schema
// ================================================================
const step1Schema = z.object({
  ruc: z.string().min(1, 'RUC requerido').regex(/^\d+$/, 'Solo números'),
  tipo_contribuyente: z.number().min(1).max(2),
});

const step2Schema = z.object({
  razon_social: z.string().min(1, 'Razón social requerida').max(255),
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
  establecimiento_email: z.string().email('Email inválido').max(255).optional().or(z.literal('')),
});

const step4Schema = z.object({
  timbrado: z.string().min(1, 'Timbrado requerido'),
  timbrado_fecha_inicio: z.string().optional(),
  timbrado_fecha_fin: z.string().optional(),
});

interface Props {
  onComplete: () => void;
}

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
    return () => { isMountedRef.current = false; };
  }, []);

  // Accumulated form data across steps
  const [formData, setFormData] = useState<Record<string, any>>({
    tipo_contribuyente: 2,
    establecimiento_codigo: '001',
    punto_expedicion: '001',
    sifen_environment: 'demo',
  });

  const form1 = useForm({ resolver: zodResolver(step1Schema), defaultValues: { ruc: '', tipo_contribuyente: 2 } });
  const form2 = useForm({ resolver: zodResolver(step2Schema), defaultValues: { razon_social: '', nombre_fantasia: '' } });
  const form3 = useForm({ resolver: zodResolver(step3Schema), defaultValues: { establecimiento_codigo: '001', punto_expedicion: '001' } });
  const form4 = useForm({ resolver: zodResolver(step4Schema), defaultValues: { timbrado: '' } });

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
      toast({ title: 'Error', description: 'Ingrese un RUC válido para calcular el DV', variant: 'destructive' });
      return;
    }
    setFormData(prev => ({ ...prev, ...data, ruc_dv: rucDV }));
    setStep(2);
  });

  const handleStep2 = form2.handleSubmit((data) => {
    setFormData(prev => ({ ...prev, ...data }));
    setStep(3);
  });

  const handleStep3 = form3.handleSubmit((data) => {
    setFormData(prev => ({ ...prev, ...data }));
    setStep(4);
  });

  const handleStep4 = form4.handleSubmit(async (data) => {
    setSaving(true);
    try {
      const fullData = { ...formData, ...data };
      await invoicingService.saveConfig(fullData);

      // Upload certificate if provided
      if (certFile && certPassword) {
        if (!isMountedRef.current) return;
        setUploadingCert(true);
        await invoicingService.uploadCertificate(certFile, certPassword);
      }

      if (!isMountedRef.current) return;
      toast({ title: 'Configuración guardada', description: 'Tu configuración fiscal fue guardada exitosamente.' });
      onComplete();
    } catch (err: any) {
      if (!isMountedRef.current) return;
      toast({ title: 'Error', description: err.message || 'Error al guardar configuración', variant: 'destructive' });
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

  return (
    <div className="max-w-2xl mx-auto">
      {/* Step indicator */}
      <div className="flex items-center justify-center gap-2 mb-8">
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={s.num} className="flex items-center gap-2">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                step === s.num ? 'bg-primary text-primary-foreground' :
                step > s.num ? 'bg-primary/20 text-primary' :
                'bg-muted text-muted-foreground'
              }`}>
                {step > s.num ? <CheckCircle2 size={14} /> : <Icon size={14} />}
                <span className="hidden sm:inline">{s.label}</span>
              </div>
              {i < steps.length - 1 && <div className={`w-8 h-0.5 ${step > s.num ? 'bg-primary' : 'bg-border'}`} />}
            </div>
          );
        })}
      </div>

      {/* Step 1: Tipo de Contribuyente */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Tipo de Contribuyente</CardTitle>
            <CardDescription>Ingresá tu RUC y tipo de contribuyente según el SET.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleStep1} className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <Label>RUC</Label>
                  <Input
                    placeholder="80012345"
                    {...form1.register('ruc')}
                    onChange={(e) => handleRucChange(e.target.value.replace(/\D/g, ''))}
                  />
                  {form1.formState.errors.ruc && (
                    <p className="text-sm text-destructive mt-1">{form1.formState.errors.ruc.message}</p>
                  )}
                </div>
                <div>
                  <Label>DV</Label>
                  <Input value={rucDV !== null ? String(rucDV) : ''} readOnly className="bg-muted text-center font-mono text-lg" />
                  <p className="text-xs text-muted-foreground mt-1">Auto-calculado</p>
                </div>
              </div>

              <div>
                <Label>Tipo de Contribuyente</Label>
                <Select
                  value={String(form1.watch('tipo_contribuyente'))}
                  onValueChange={(v) => form1.setValue('tipo_contribuyente', Number(v))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Persona Física</SelectItem>
                    <SelectItem value="2">Persona Jurídica</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-end">
                <Button type="submit">Siguiente</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Datos de la Empresa */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Datos de la Empresa</CardTitle>
            <CardDescription>Información legal de tu empresa para la facturación.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleStep2} className="space-y-4">
              <div>
                <Label>Razón Social *</Label>
                <Input placeholder="Mi Empresa S.A." {...form2.register('razon_social')} />
                {form2.formState.errors.razon_social && (
                  <p className="text-sm text-destructive mt-1">{form2.formState.errors.razon_social.message}</p>
                )}
              </div>

              <div>
                <Label>Nombre Fantasía</Label>
                <Input placeholder="MiMarca" {...form2.register('nombre_fantasia')} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Código Actividad Económica</Label>
                  <Input placeholder="47190" {...form2.register('actividad_economica_codigo')} />
                </div>
                <div>
                  <Label>Descripción</Label>
                  <Input placeholder="Venta al por menor" {...form2.register('actividad_economica_descripcion')} />
                </div>
              </div>

              <div>
                <Label>Régimen Tributario</Label>
                <Select
                  value={form2.watch('tipo_regimen') ? String(form2.watch('tipo_regimen')) : ''}
                  onValueChange={(v) => form2.setValue('tipo_regimen', v ? Number(v) : undefined)}
                >
                  <SelectTrigger><SelectValue placeholder="Seleccionar (opcional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Régimen Turístico</SelectItem>
                    <SelectItem value="8">Pequeño Contribuyente</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-between">
                <Button type="button" variant="outline" onClick={() => setStep(1)}>Atrás</Button>
                <Button type="submit">Siguiente</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Establecimiento */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Establecimiento</CardTitle>
            <CardDescription>Datos del punto de emisión de facturas.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleStep3} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Código Establecimiento</Label>
                  <Input placeholder="001" maxLength={3} {...form3.register('establecimiento_codigo')} />
                </div>
                <div>
                  <Label>Punto de Expedición</Label>
                  <Input placeholder="001" maxLength={3} {...form3.register('punto_expedicion')} />
                </div>
              </div>

              <div>
                <Label>Dirección</Label>
                <Input placeholder="Av. España 1234" {...form3.register('establecimiento_direccion')} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Teléfono</Label>
                  <Input placeholder="021-123456" {...form3.register('establecimiento_telefono')} />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input placeholder="facturacion@empresa.com" {...form3.register('establecimiento_email')} />
                  {form3.formState.errors.establecimiento_email && (
                    <p className="text-sm text-destructive mt-1">{form3.formState.errors.establecimiento_email.message}</p>
                  )}
                </div>
              </div>

              <div className="flex justify-between">
                <Button type="button" variant="outline" onClick={() => setStep(2)}>Atrás</Button>
                <Button type="submit">Siguiente</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Timbrado y Certificado */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>Timbrado y Ambiente</CardTitle>
            <CardDescription>Datos del timbrado vigente y ambiente de facturación.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleStep4} className="space-y-4">
              <div>
                <Label>Número de Timbrado *</Label>
                <Input placeholder="12345678" {...form4.register('timbrado')} />
                {form4.formState.errors.timbrado && (
                  <p className="text-sm text-destructive mt-1">{form4.formState.errors.timbrado.message}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Fecha Inicio</Label>
                  <Input type="date" {...form4.register('timbrado_fecha_inicio')} />
                </div>
                <div>
                  <Label>Fecha Fin</Label>
                  <Input type="date" {...form4.register('timbrado_fecha_fin')} />
                </div>
              </div>

              {/* Environment selector */}
              <div>
                <Label>Ambiente SIFEN</Label>
                <Select
                  value={formData.sifen_environment}
                  onValueChange={(v) => setFormData(prev => ({ ...prev, sifen_environment: v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="demo">Demo (sin envío a SIFEN)</SelectItem>
                    <SelectItem value="test">Test (ambiente de pruebas SET)</SelectItem>
                    <SelectItem value="prod">Producción</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Environment info banner */}
              {formData.sifen_environment === 'demo' && (
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400">Demo</Badge>
                    <span className="text-sm font-medium text-purple-800 dark:text-purple-300">Simulación completa</span>
                  </div>
                  <p className="text-xs text-purple-700 dark:text-purple-400">
                    Se generan facturas reales con XML y CDC válido, pero no se envían al SIFEN.
                    No necesitás certificado digital. Podés cambiar a Test o Producción cuando tengas tu firma.
                  </p>
                </div>
              )}

              {formData.sifen_environment !== 'demo' && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
                      {formData.sifen_environment === 'test' ? 'Test' : 'Producción'}
                    </Badge>
                    <span className="text-sm font-medium text-yellow-800 dark:text-yellow-300">Certificado requerido</span>
                  </div>
                  <p className="text-xs text-yellow-700 dark:text-yellow-400">
                    Para enviar facturas al SIFEN necesitás un certificado digital (.p12) de un PSC habilitado.
                  </p>
                </div>
              )}

              {/* Certificate upload - only show for test/prod, or collapsible for demo */}
              {formData.sifen_environment !== 'demo' && (
                <div className="border rounded-lg p-4 space-y-3">
                  <Label className="flex items-center gap-2">
                    <Upload size={16} />
                    Certificado Digital (.p12) *
                  </Label>
                  <Input
                    type="file"
                    accept=".p12,.pfx"
                    onChange={(e) => setCertFile(e.target.files?.[0] || null)}
                  />
                  {certFile && (
                    <div>
                      <Label>Contraseña del Certificado</Label>
                      <Input
                        type="password"
                        placeholder="Contraseña del .p12"
                        value={certPassword}
                        onChange={(e) => setCertPassword(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-between">
                <Button type="button" variant="outline" onClick={() => setStep(3)}>Atrás</Button>
                <Button type="submit" disabled={saving || (formData.sifen_environment !== 'demo' && !certFile)}>
                  {saving && <Loader2 className="animate-spin mr-2" size={16} />}
                  {uploadingCert ? 'Subiendo certificado...' : saving ? 'Guardando...' : 'Completar Configuración'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
