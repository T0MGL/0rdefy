// DispatchStep - Step to create dispatch session and export CSV

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useDemoTour } from '../DemoTourProvider';
import { useDemoData } from '../hooks/useDemoData';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Truck,
  FileSpreadsheet,
  Download,
  Check,
  Loader2,
  ArrowRight,
  Sparkles,
  Package,
  MapPin,
} from 'lucide-react';

interface DispatchStepProps {
  onComplete?: () => void;
}

export function DispatchStep({ onComplete }: DispatchStepProps) {
  const { nextStep, demoData } = useDemoTour();
  const { createDemoDispatchSession } = useDemoData();
  const [phase, setPhase] = useState<'intro' | 'created' | 'exported'>('intro');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleCreateSession = async () => {
    setIsProcessing(true);
    try {
      const sessionId = await createDemoDispatchSession();
      if (sessionId) {
        setPhase('created');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportCSV = () => {
    setPhase('exported');
    setTimeout(() => {
      onComplete?.();
      nextStep();
    }, 1000);
  };

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('es-PY').format(price);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="fixed z-[10002] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] max-w-[calc(100vw-32px)]"
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
              <Truck className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-card-foreground">
                Despachar Pedido
              </h2>
              <p className="text-sm text-muted-foreground">
                Crea una sesión de despacho y exporta para el courier
              </p>
            </div>
          </div>

          {/* Phase indicator */}
          <div className="flex items-center gap-2">
            {['intro', 'created', 'exported'].map((p, index) => (
              <div
                key={p}
                className={cn(
                  'h-1.5 flex-1 rounded-full transition-colors',
                  index <= ['intro', 'created', 'exported'].indexOf(phase)
                    ? 'bg-primary'
                    : 'bg-muted'
                )}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {phase === 'intro' && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-4"
            >
              <p className="text-sm text-muted-foreground">
                Una sesión de despacho agrupa pedidos listos para entregar al courier.
              </p>

              {/* Order to dispatch */}
              <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-muted-foreground">Pedido a despachar</span>
                  <span className="font-mono text-xs font-medium">
                    #{demoData.order?.id?.slice(0, 8).toUpperCase() || 'DEMO-001'}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">{demoData.product?.name || 'Camiseta Básica (Demo)'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {demoData.order?.shipping_address?.split(',')[0] || 'Asuncion'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">{demoData.carrier?.name || 'Delivery Express'}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <Sparkles className="w-4 h-4 text-blue-500 mt-0.5" />
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  El código de sesión (ej: DISP-08012026-01) te permite rastrear este envío.
                </p>
              </div>
            </motion.div>
          )}

          {phase === 'created' && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-4"
            >
              <div className="p-4 bg-green-500/10 rounded-lg border border-green-500/20 text-center">
                <Check className="w-8 h-8 text-green-500 mx-auto mb-2" />
                <p className="font-semibold text-green-600 dark:text-green-400">
                  Sesión de Despacho Creada
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Código: DISP-{new Date().toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '')}-01
                </p>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium">Exportar para el Courier</p>
                <div className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
                  <FileSpreadsheet className="w-5 h-5 text-orange-500 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">Archivo CSV</p>
                    <p className="text-xs text-muted-foreground">
                      Compatible con Google Sheets y Excel. Incluye datos del cliente, dirección y monto a cobrar.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <Sparkles className="w-4 h-4 text-amber-500 mt-0.5" />
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Después de la entrega, importas los resultados del courier para conciliar.
                </p>
              </div>
            </motion.div>
          )}

          {phase === 'exported' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-6"
            >
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4"
              >
                <Download className="w-8 h-8 text-green-500" />
              </motion.div>
              <h3 className="text-lg font-bold mb-2">¡Pedido Despachado!</h3>
              <p className="text-sm text-muted-foreground">
                Estado actualizado a "En Tránsito"
              </p>
            </motion.div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          {phase === 'intro' && (
            <Button
              onClick={handleCreateSession}
              disabled={isProcessing}
              className="w-full gap-2 h-11"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creando sesión...
                </>
              ) : (
                <>
                  Crear Sesión de Despacho
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          )}

          {phase === 'created' && (
            <Button
              onClick={handleExportCSV}
              className="w-full gap-2 h-11"
            >
              <Download className="w-4 h-4" />
              Exportar CSV (Simulado)
            </Button>
          )}

          {phase === 'exported' && (
            <Button
              onClick={() => {
                onComplete?.();
                nextStep();
              }}
              className="w-full gap-2 h-11 bg-green-600 hover:bg-green-700"
            >
              <Check className="w-4 h-4" />
              Continuar
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
