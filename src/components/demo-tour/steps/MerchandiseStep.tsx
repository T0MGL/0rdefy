// MerchandiseStep - Step to show merchandise reception flow

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useDemoTour } from '../DemoTourProvider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  PackageOpen,
  Boxes,
  Check,
  ArrowRight,
  Sparkles,
  Truck,
  ClipboardList,
  Plus,
} from 'lucide-react';

interface MerchandiseStepProps {
  onComplete?: () => void;
}

export function MerchandiseStep({ onComplete }: MerchandiseStepProps) {
  const { nextStep, demoData } = useDemoTour();
  const [phase, setPhase] = useState<'intro' | 'received'>('intro');

  const handleSimulateReceive = () => {
    setPhase('received');
    setTimeout(() => {
      onComplete?.();
      nextStep();
    }, 1200);
  };

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('es-PY').format(price);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed z-[10002] w-[520px] max-w-[calc(100vw-32px)] max-h-[calc(100dvh-64px)]"
      style={{
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-y-auto max-h-[calc(100dvh-64px)]">
        {/* Header */}
        <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
              <PackageOpen className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-card-foreground">
                Recibir Mercadería
              </h2>
              <p className="text-sm text-muted-foreground">
                Registra envíos de proveedores para reabastecer stock
              </p>
            </div>
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
                Este módulo te permite rastrear mercadería que viene de proveedores y actualizar tu inventario al recibirla.
              </p>

              {/* Workflow steps */}
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
                  <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                    <ClipboardList className="w-4 h-4 text-blue-500" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">1. Crear Envío</p>
                    <p className="text-xs text-muted-foreground">
                      Registra proveedor, productos esperados y cantidades
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
                  <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center flex-shrink-0">
                    <Truck className="w-4 h-4 text-orange-500" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">2. En Tránsito</p>
                    <p className="text-xs text-muted-foreground">
                      Seguimiento del envío hasta que llegue
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
                  <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                    <Boxes className="w-4 h-4 text-green-500" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">3. Recibir</p>
                    <p className="text-xs text-muted-foreground">
                      Verifica cantidades y el stock se actualiza automáticamente
                    </p>
                  </div>
                </div>
              </div>

              {/* Example shipment */}
              <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs text-muted-foreground">Ejemplo de Envío</span>
                  <span className="font-mono text-xs font-medium">ISH-{new Date().toLocaleDateString('es-PY', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '')}-001</span>
                </div>

                <div className="flex items-center justify-between p-3 bg-card rounded-lg border">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                      <Boxes className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{demoData.product?.name || 'Camiseta Básica'}</p>
                      <p className="text-xs text-muted-foreground">Proveedor Demo S.A.</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold">+20</p>
                    <p className="text-xs text-muted-foreground">unidades</p>
                  </div>
                </div>
              </div>

              {/* Info box */}
              <div className="flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <Sparkles className="w-4 h-4 text-blue-500 mt-0.5" />
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  Al recibir, puedes marcar discrepancias (items dañados, faltantes) para control de calidad.
                </p>
              </div>
            </motion.div>
          )}

          {phase === 'received' && (
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
                <Check className="w-8 h-8 text-green-500" />
              </motion.div>
              <h3 className="text-lg font-bold mb-2">¡Mercadería Recibida!</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Stock actualizado automáticamente
              </p>

              <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-500/10 rounded-full">
                <Plus className="w-4 h-4 text-green-500" />
                <span className="text-sm font-medium text-green-600 dark:text-green-400">
                  +20 {demoData.product?.name?.split(' ')[0] || 'Camiseta'}
                </span>
              </div>
            </motion.div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          {phase === 'intro' && (
            <Button
              onClick={handleSimulateReceive}
              className="w-full gap-2 h-11"
            >
              Simular Recepción
              <ArrowRight className="w-4 h-4" />
            </Button>
          )}

          {phase === 'received' && (
            <Button
              onClick={() => {
                onComplete?.();
                nextStep();
              }}
              className="w-full gap-2 h-11 bg-green-600 hover:bg-green-700"
            >
              <Check className="w-4 h-4" />
              Continuar al Final
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}
