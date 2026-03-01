import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, FileText, CheckCircle2, XCircle, Clock, FlaskConical, Settings2 } from 'lucide-react';
import { invoicingService, InvoiceStats, FiscalConfig } from '@/services/invoicing.service';
import { InvoicingSetupWizard } from '@/components/InvoicingSetupWizard';
import { InvoiceHistoryTable } from '@/components/InvoiceHistoryTable';
import { formatCurrency } from '@/utils/currency';
import { useToast } from '@/hooks/use-toast';

const ENV_LABELS: Record<string, { label: string; color: string }> = {
  demo: { label: 'Demo', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' },
  test: { label: 'Test', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' },
  prod: { label: 'Producción', color: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' },
};

export default function Invoicing() {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<FiscalConfig | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [stats, setStats] = useState<InvoiceStats | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const { toast } = useToast();

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const configResult = await invoicingService.getConfig();
      if (!isMountedRef.current) return;
      if (configResult.setup_required) {
        setSetupRequired(true);
        // Keep config data if partially set up (for re-editing)
        setConfig(configResult.data as FiscalConfig || null);
      } else if (!configResult.data) {
        setSetupRequired(true);
        setConfig(null);
      } else {
        setConfig(configResult.data as FiscalConfig);
        setSetupRequired(false);

        // Load stats
        const statsResult = await invoicingService.getStats();
        if (!isMountedRef.current) return;
        setStats(statsResult);
      }
    } catch (err: any) {
      if (!isMountedRef.current) return;
      // If 403 (country not supported), show a message
      if (err.message?.includes('solo disponible')) {
        setSetupRequired(false);
        setConfig(null);
      } else {
        // Network/server error: show error, don't show setup wizard
        setLoadError(err.message || 'Error al cargar configuración');
        toast({ title: 'Error', description: err.message || 'Error al cargar configuración', variant: 'destructive' });
      }
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  // Show error state if loading failed (don't masquerade as setup required)
  if (loadError && !setupRequired) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Facturación Electrónica</h1>
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

  // Show setup wizard if config not completed
  if (setupRequired || showSetup) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Facturación Electrónica</h1>
            <p className="text-muted-foreground">Configurá tu facturación electrónica para SIFEN</p>
          </div>
          {!setupRequired && (
            <Button variant="outline" onClick={() => setShowSetup(false)}>Volver</Button>
          )}
        </div>
        <InvoicingSetupWizard onComplete={() => { setShowSetup(false); loadData(); }} />
      </div>
    );
  }

  const envInfo = ENV_LABELS[config?.sifen_environment || 'demo'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">Facturación Electrónica</h1>
          <Badge className={envInfo.color}>{envInfo.label}</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowSetup(true)}>
          <Settings2 size={14} className="mr-2" />
          Configuración
        </Button>
      </div>

      {/* Config summary */}
      {config && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-6">
                <span><strong>RUC:</strong> {config.ruc}-{config.ruc_dv}</span>
                <span><strong>Razón Social:</strong> {config.razon_social}</span>
                <span><strong>Timbrado:</strong> {config.timbrado}</span>
              </div>
              <span className="text-muted-foreground">
                Est. {config.establecimiento_codigo}-{config.punto_expedicion}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

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
                <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                  <CheckCircle2 size={18} className="text-green-600 dark:text-green-400" />
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
                <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                  <FileText size={18} className="text-emerald-600 dark:text-emerald-400" />
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
          <InvoiceHistoryTable />
        </CardContent>
      </Card>
    </div>
  );
}
