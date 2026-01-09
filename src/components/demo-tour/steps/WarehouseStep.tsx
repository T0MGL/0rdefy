// WarehouseStep - Combined picking and packing demonstration

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDemoTour } from '../DemoTourProvider';
import { useDemoData } from '../hooks/useDemoData';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Warehouse,
  Package,
  Box,
  Check,
  Loader2,
  Sparkles,
  ArrowRight,
  ShoppingBasket,
  CheckCircle2,
} from 'lucide-react';

interface WarehouseStepProps {
  onComplete?: () => void;
}

type Phase = 'intro' | 'picking' | 'packing' | 'complete';

export function WarehouseStep({ onComplete }: WarehouseStepProps) {
  const { nextStep, demoData } = useDemoTour();
  const {
    createDemoPickingSession,
    completeDemoPicking,
    completeDemoPacking,
  } = useDemoData();

  const [phase, setPhase] = useState<Phase>(demoData.pickingSessionId ? 'packing' : 'intro');
  const [isProcessing, setIsProcessing] = useState(false);
  const [pickingComplete, setPickingComplete] = useState(false);
  const [packingComplete, setPackingComplete] = useState(false);

  const handleStartPicking = async () => {
    setIsProcessing(true);
    try {
      const sessionId = await createDemoPickingSession();
      if (sessionId) {
        setPhase('picking');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCompletePicking = async () => {
    setIsProcessing(true);
    try {
      const success = await completeDemoPicking();
      if (success) {
        setPickingComplete(true);
        setTimeout(() => {
          setPhase('packing');
        }, 800);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCompletePacking = async () => {
    setIsProcessing(true);
    try {
      const success = await completeDemoPacking();
      if (success) {
        setPackingComplete(true);
        setTimeout(() => {
          setPhase('complete');
          setTimeout(() => {
            onComplete?.();
            nextStep();
          }, 1200);
        }, 800);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('es-PY').format(price);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed z-[10002] w-[520px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-64px)]"
      style={{
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-y-auto max-h-[calc(100vh-64px)]">
        {/* Header */}
        <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
              <Warehouse className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-card-foreground">
                {phase === 'intro' && 'Preparación en Almacén'}
                {phase === 'picking' && 'Picking - Recolección'}
                {phase === 'packing' && 'Packing - Empaque'}
                {phase === 'complete' && '¡Preparación Completa!'}
              </h2>
              <p className="text-sm text-muted-foreground">
                {phase === 'intro' && 'Crea una sesión de picking para preparar el pedido'}
                {phase === 'picking' && 'Recolecta los productos del inventario'}
                {phase === 'packing' && 'Empaca los productos en cajas'}
                {phase === 'complete' && 'El pedido está listo para enviar'}
              </p>
            </div>
          </div>

          {/* Phase indicator */}
          <div className="flex items-center gap-2">
            {['intro', 'picking', 'packing', 'complete'].map((p, index) => (
              <div
                key={p}
                className={cn(
                  'h-1.5 flex-1 rounded-full transition-colors',
                  index <= ['intro', 'picking', 'packing', 'complete'].indexOf(phase)
                    ? 'bg-primary'
                    : 'bg-muted'
                )}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          <AnimatePresence mode="wait">
            {phase === 'intro' && (
              <motion.div
                key="intro"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                {/* Session explanation */}
                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
                    <ShoppingBasket className="w-5 h-5 text-orange-500 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Sesión de Picking</p>
                      <p className="text-xs text-muted-foreground">
                        Agrupa múltiples pedidos en una sesión para recolectar productos eficientemente
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
                    <Box className="w-5 h-5 text-purple-500 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm">Packing</p>
                      <p className="text-xs text-muted-foreground">
                        Empaca cada pedido individualmente. Al completar, el stock se descuenta automáticamente.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Order to prepare */}
                <div className="p-4 bg-primary/5 rounded-lg border border-primary/20">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground">Pedido a preparar</span>
                    <span className="font-mono text-xs">
                      #{demoData.order?.id?.slice(0, 8).toUpperCase() || 'DEMO-001'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Package className="w-5 h-5 text-muted-foreground" />
                    <div className="flex-1">
                      <p className="font-medium text-sm">{demoData.product?.name || 'Camiseta Básica (Demo)'}</p>
                      <p className="text-xs text-muted-foreground">x2 unidades</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <Sparkles className="w-4 h-4 text-blue-500 mt-0.5" />
                  <p className="text-xs text-blue-600 dark:text-blue-400">
                    La sesión genera un código único (ej: PREP-08012026-01) para seguimiento.
                  </p>
                </div>
              </motion.div>
            )}

            {phase === 'picking' && (
              <motion.div
                key="picking"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="p-4 bg-orange-500/10 rounded-lg border border-orange-500/20">
                  <div className="flex items-center gap-2 mb-3">
                    <ShoppingBasket className="w-5 h-5 text-orange-500" />
                    <span className="font-medium">Lista de Picking</span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-card rounded-lg border">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-muted rounded flex items-center justify-center">
                        <Package className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">{demoData.product?.name || 'Camiseta Básica'}</p>
                        <p className="text-xs text-muted-foreground">Ubicación: A-1-2</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        'font-bold',
                        pickingComplete ? 'text-green-500' : 'text-foreground'
                      )}>
                        {pickingComplete ? '2/2' : '0/2'}
                      </span>
                      {pickingComplete && <Check className="w-4 h-4 text-green-500" />}
                    </div>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground">
                  En la app real, irías a la ubicación indicada y marcarías cada unidad recolectada.
                </p>
              </motion.div>
            )}

            {phase === 'packing' && (
              <motion.div
                key="packing"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-4">
                  {/* Basket */}
                  <div className="p-4 bg-orange-500/10 rounded-lg border border-orange-500/20">
                    <div className="flex items-center gap-2 mb-3">
                      <ShoppingBasket className="w-4 h-4 text-orange-500" />
                      <span className="text-sm font-medium">Canasta</span>
                    </div>
                    <div className={cn(
                      'p-3 bg-card rounded border transition-all',
                      packingComplete && 'opacity-50'
                    )}>
                      <Package className="w-6 h-6 text-muted-foreground mx-auto mb-1" />
                      <p className="text-xs text-center">{demoData.product?.name?.split(' ')[0] || 'Camiseta'}</p>
                      <p className="text-[10px] text-center text-muted-foreground">x2</p>
                    </div>
                  </div>

                  {/* Box */}
                  <div className="p-4 bg-purple-500/10 rounded-lg border border-purple-500/20">
                    <div className="flex items-center gap-2 mb-3">
                      <Box className="w-4 h-4 text-purple-500" />
                      <span className="text-sm font-medium">Caja Pedido</span>
                    </div>
                    <div className={cn(
                      'p-3 bg-card rounded border transition-all min-h-[60px] flex items-center justify-center',
                      packingComplete ? 'border-green-500 bg-green-500/10' : 'border-dashed'
                    )}>
                      {packingComplete ? (
                        <div className="text-center">
                          <CheckCircle2 className="w-6 h-6 text-green-500 mx-auto mb-1" />
                          <p className="text-xs text-green-600">Empacado</p>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">Arrastra aquí</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                  <Sparkles className="w-4 h-4 text-amber-500 mt-0.5" />
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Al completar el packing, el stock se descuenta automáticamente del inventario.
                  </p>
                </div>
              </motion.div>
            )}

            {phase === 'complete' && (
              <motion.div
                key="complete"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-8"
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4"
                >
                  <CheckCircle2 className="w-8 h-8 text-green-500" />
                </motion.div>
                <h3 className="text-lg font-bold mb-2">¡Pedido Preparado!</h3>
                <p className="text-sm text-muted-foreground">
                  Estado actualizado a "Listo para Enviar"
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          {phase === 'intro' && (
            <Button
              onClick={handleStartPicking}
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
                  Iniciar Picking
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          )}

          {phase === 'picking' && (
            <Button
              onClick={handleCompletePicking}
              disabled={isProcessing}
              className={cn(
                'w-full gap-2 h-11',
                pickingComplete && 'bg-green-600 hover:bg-green-700'
              )}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Procesando...
                </>
              ) : pickingComplete ? (
                <>
                  <Check className="w-4 h-4" />
                  Picking Completo
                </>
              ) : (
                <>
                  Completar Picking
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          )}

          {phase === 'packing' && (
            <Button
              onClick={handleCompletePacking}
              disabled={isProcessing}
              className={cn(
                'w-full gap-2 h-11',
                packingComplete && 'bg-green-600 hover:bg-green-700'
              )}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Empacando...
                </>
              ) : packingComplete ? (
                <>
                  <Check className="w-4 h-4" />
                  Packing Completo
                </>
              ) : (
                <>
                  Completar Packing
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </Button>
          )}

          {phase === 'complete' && (
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
