import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Loader2,
  FileText,
  CheckCircle2,
  XCircle,
  Settings2,
  Plus,
  AlertTriangle,
} from 'lucide-react';
import {
  invoicingService,
  InvoiceStats,
  FiscalConfig,
  FiscalReadiness,
} from '@/services/invoicing.service';
import { InvoicingSetupWizard } from '@/components/InvoicingSetupWizard';
import { InvoicingSettingsEditor } from '@/components/InvoicingSettingsEditor';
import { InvoiceHistoryTable } from '@/components/InvoiceHistoryTable';
import { ManualInvoiceModal } from '@/components/ManualInvoiceModal';
import { formatCurrency } from '@/utils/currency';
import { useToast } from '@/hooks/use-toast';
import { useInvoicingAvailability } from '@/hooks/useInvoicingAvailability';
import { ComingSoonPlaceholder } from '@/components/ComingSoonPlaceholder';

const ENV_LABELS: Record<string, { label: string; color: string }> = {
  demo: { label: 'Demo', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' },
  test: { label: 'Test', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' },
  prod: { label: 'Produccion', color: 'bg-primary/10 text-primary dark:bg-primary/30 dark:text-primary' },
};

export default function Invoicing() {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<FiscalConfig | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [readiness, setReadiness] = useState<FiscalReadiness | null>(null);
  const [stats, setStats] = useState<InvoiceStats | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [showSettingsEditor, setShowSettingsEditor] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invoiceTableKey, setInvoiceTableKey] = useState(0);
  const isMountedRef = useRef(true);
  const { toast } = useToast();
  const availability = useInvoicingAvailability();

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const configResult = await invoicingService.getConfig();
      if (!isMountedRef.current) return;
      if (!configResult.data) {
        // No identity at all: fresh store, needs the full wizard.
        setConfig(null);
        setSetupRequired(true);
        setReadiness(configResult.readiness ?? null);
        return;
      }
      setConfig(configResult.data as FiscalConfig);
      setSetupRequired(Boolean(configResult.setup_required));
      setReadiness(configResult.readiness ?? null);

      // Stats still make sense even if setup is incomplete (invoices may
      // exist from prior attempts).
      const statsResult = await invoicingService.getStats().catch(() => null);
      if (!isMountedRef.current) return;
      if (statsResult) setStats(statsResult);
    } catch (err: any) {
      if (!isMountedRef.current) return;
      if (err.message?.includes('solo disponible')) {
        setSetupRequired(false);
        setConfig(null);
      } else {
        setLoadError(err.message || 'Error al cargar configuracion');
        toast({
          title: 'Error',
          description: err.message || 'Error al cargar configuracion',
          variant: 'destructive',
        });
      }
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (!availability.available) {
    return (
      <ComingSoonPlaceholder
        title="Facturacion electronica"
        message={
          availability.status === 'coming_soon'
            ? `Disponible hoy solo para Paraguay. Tu tienda esta en ${availability.country ?? 'otra region'}.`
            : 'Selecciona una tienda para ver esta seccion.'
        }
        hint={
          availability.status === 'coming_soon'
            ? 'Estamos trabajando para soportar mas paises. Te avisaremos cuando este listo.'
            : undefined
        }
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Facturacion Electronica</h1>
        <Card>
          <CardContent className="py-8 text-center">
            <XCircle className="mx-auto text-red-500 mb-3" size={32} />
            <p className="text-muted-foreground mb-4">{loadError}</p>
            <Button onClick={() => loadData()} variant="outline">
              Reintentar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Fresh store, no identity at all: full wizard.
  if (!config || showWizard) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Facturacion Electronica</h1>
            <p className="text-muted-foreground">Configura tu facturacion electronica para SIFEN</p>
          </div>
          {config && (
            <Button variant="outline" onClick={() => setShowWizard(false)}>
              Volver
            </Button>
          )}
        </div>
        <InvoicingSetupWizard
          onComplete={() => {
            setShowWizard(false);
            loadData();
          }}
        />
      </div>
    );
  }

  const envInfo = ENV_LABELS[config.sifen_environment || 'demo'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Facturacion Electronica</h1>
          <Badge className={envInfo.color}>{envInfo.label}</Badge>
          {setupRequired && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle size={12} /> Configuracion incompleta
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setShowManualModal(true)}
            disabled={setupRequired}
            title={setupRequired ? 'Completa la configuracion para emitir' : undefined}
          >
            <Plus size={14} className="mr-2" />
            Nueva Factura
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowSettingsEditor(true)}>
            <Settings2 size={14} className="mr-2" />
            Configuracion
          </Button>
        </div>
      </div>

      {/* Incomplete-setup banner */}
      {setupRequired && (
        <Card className="border-amber-300 dark:border-amber-800/60 bg-amber-50/70 dark:bg-amber-900/15">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle
                size={18}
                className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
              />
              <div className="flex-1 space-y-1.5">
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  Completa la configuracion fiscal antes de emitir
                </p>
                {readiness && readiness.missing.length > 0 ? (
                  <ul className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed space-y-0.5 list-disc pl-4">
                    {readiness.missing.includes('representante_legal') && (
                      <li>Datos del representante legal (nombre, tipo y numero de documento).</li>
                    )}
                    {readiness.missing.includes('actividad_principal') && (
                      <li>Actividad economica principal.</li>
                    )}
                    {readiness.missing.includes('certificado') && (
                      <li>Certificado digital (.p12) requerido para el ambiente actual.</li>
                    )}
                    {readiness.missing.includes('setup_completed') &&
                      !readiness.missing.includes('certificado') && (
                        <li>Confirmacion final del vinculo con la tienda.</li>
                      )}
                  </ul>
                ) : (
                  <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                    Faltan datos obligatorios para habilitar la emision a SIFEN.
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowSettingsEditor(true)}
                className="border-amber-400 text-amber-900 hover:bg-amber-100 dark:text-amber-200 dark:border-amber-700 dark:hover:bg-amber-900/40"
              >
                Completar configuracion
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <ManualInvoiceModal
        open={showManualModal}
        onOpenChange={setShowManualModal}
        onSuccess={() => {
          setInvoiceTableKey((k) => k + 1);
          loadData();
        }}
      />

      {/* Settings editor dialog */}
      <Dialog open={showSettingsEditor} onOpenChange={setShowSettingsEditor}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configuracion fiscal</DialogTitle>
            <DialogDescription>
              Edita los datos de la identidad fiscal, el establecimiento, el ambiente SIFEN
              y el certificado digital asociados a esta tienda.
            </DialogDescription>
          </DialogHeader>
          {showSettingsEditor && (
            <InvoicingSettingsEditor
              onSaved={() => {
                setShowSettingsEditor(false);
                loadData();
              }}
              onCancel={() => setShowSettingsEditor(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Config summary */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-6">
              <span>
                <strong>RUC:</strong> {config.ruc}-{config.ruc_dv}
              </span>
              <span>
                <strong>Razon Social:</strong> {config.razon_social}
              </span>
              <span>
                <strong>Timbrado:</strong> {config.timbrado}
              </span>
            </div>
            <span className="text-muted-foreground">
              Est. {config.establecimiento_codigo}-{config.punto_expedicion}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                  <FileText size={18} className="text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">Total Facturas</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 dark:bg-primary/30">
                  <CheckCircle2 size={18} className="text-primary dark:text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.approved + stats.demo}</p>
                  <p className="text-xs text-muted-foreground">Aprobadas</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                  <XCircle size={18} className="text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.rejected}</p>
                  <p className="text-xs text-muted-foreground">Rechazadas</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10 dark:bg-primary/30">
                  <FileText size={18} className="text-primary dark:text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{formatCurrency(stats.total_facturado, 'PYG')}</p>
                  <p className="text-xs text-muted-foreground">Total Facturado</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Invoice history table */}
      <Card>
        <CardHeader>
          <CardTitle>Historial de Facturas</CardTitle>
        </CardHeader>
        <CardContent>
          <InvoiceHistoryTable key={invoiceTableKey} />
        </CardContent>
      </Card>
    </div>
  );
}
