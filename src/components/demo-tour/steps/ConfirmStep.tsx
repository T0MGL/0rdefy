// ConfirmStep - Step to confirm the demo order

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useDemoTour } from '../DemoTourProvider';
import { useDemoData } from '../hooks/useDemoData';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  CheckCircle,
  Clock,
  Package,
  Truck,
  ArrowRight,
  Check,
  Loader2,
  Sparkles,
} from 'lucide-react';

interface ConfirmStepProps {
  onComplete?: () => void;
}

const orderStatuses = [
  { id: 'pending', label: 'Pendiente', icon: Clock, color: 'text-yellow-500' },
  { id: 'confirmed', label: 'Confirmado', icon: CheckCircle, color: 'text-blue-500' },
  { id: 'in_preparation', label: 'En Preparación', icon: Package, color: 'text-orange-500' },
  { id: 'ready_to_ship', label: 'Listo para Enviar', icon: Package, color: 'text-purple-500' },
  { id: 'shipped', label: 'Despachado', icon: Truck, color: 'text-indigo-500' },
  { id: 'delivered', label: 'Entregado', icon: CheckCircle, color: 'text-green-500' },
];

export function ConfirmStep({ onComplete }: ConfirmStepProps) {
  const { nextStep, demoData } = useDemoTour();
  const { confirmDemoOrder } = useDemoData();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(demoData.order?.status === 'confirmed');

  const handleConfirm = async () => {
    if (isConfirmed) {
      nextStep();
      return;
    }

    setIsConfirming(true);
    try {
      const success = await confirmDemoOrder();
      if (success) {
        setIsConfirmed(true);
        setTimeout(() => {
          onComplete?.();
          nextStep();
        }, 1000);
      }
    } finally {
      setIsConfirming(false);
    }
  };

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('es-PY').format(price);

  const currentStatusIndex = isConfirmed ? 1 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed z-[10002] w-[520px] max-w-[calc(100vw-32px)]"
      style={{
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-transparent p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-card-foreground">
                Confirmar Pedido
              </h2>
              <p className="text-sm text-muted-foreground">
                Valida el pedido para que pase a preparación
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Order summary */}
          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border/50">
            <div>
              <span className="text-xs text-muted-foreground">Pedido</span>
              <p className="font-mono font-semibold">
                #{demoData.order?.id?.slice(0, 8).toUpperCase() || 'DEMO-001'}
              </p>
            </div>
            <div className="text-right">
              <span className="text-xs text-muted-foreground">Total</span>
              <p className="font-bold text-primary">
                {formatPrice(demoData.order?.total_price || 325000)} Gs
              </p>
            </div>
          </div>

          {/* Status flow explanation */}
          <div className="space-y-3">
            <Label className="text-muted-foreground text-xs uppercase tracking-wide">
              Flujo de Estados
            </Label>
            <div className="flex items-center justify-between">
              {orderStatuses.slice(0, 4).map((status, index) => {
                const Icon = status.icon;
                const isActive = index === currentStatusIndex;
                const isPast = index < currentStatusIndex;
                const isFuture = index > currentStatusIndex;

                return (
                  <div key={status.id} className="flex items-center">
                    <motion.div
                      initial={false}
                      animate={{
                        scale: isActive ? 1.1 : 1,
                        opacity: isFuture ? 0.4 : 1,
                      }}
                      className="flex flex-col items-center gap-1"
                    >
                      <div
                        className={cn(
                          'w-10 h-10 rounded-full flex items-center justify-center',
                          isPast && 'bg-green-500/20',
                          isActive && 'bg-primary/20 ring-2 ring-primary ring-offset-2 ring-offset-card',
                          isFuture && 'bg-muted'
                        )}
                      >
                        <Icon
                          className={cn(
                            'w-5 h-5',
                            isPast && 'text-green-500',
                            isActive && 'text-primary',
                            isFuture && 'text-muted-foreground'
                          )}
                        />
                      </div>
                      <span
                        className={cn(
                          'text-[10px] font-medium text-center',
                          isActive ? 'text-primary' : 'text-muted-foreground'
                        )}
                      >
                        {status.label}
                      </span>
                    </motion.div>

                    {index < 3 && (
                      <div
                        className={cn(
                          'w-8 h-0.5 mx-1',
                          isPast ? 'bg-green-500' : 'bg-muted'
                        )}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* What happens next */}
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wide">
              Al confirmar
            </Label>
            <div className="space-y-2">
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 }}
                className="flex items-center gap-3 p-2 rounded-lg"
              >
                <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
                  <Check className="w-3 h-3 text-green-500" />
                </div>
                <span className="text-sm">El pedido pasa a estado "Confirmado"</span>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
                className="flex items-center gap-3 p-2 rounded-lg"
              >
                <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
                  <Check className="w-3 h-3 text-green-500" />
                </div>
                <span className="text-sm">Disponible para sesiones de picking</span>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
                className="flex items-center gap-3 p-2 rounded-lg"
              >
                <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
                  <Check className="w-3 h-3 text-green-500" />
                </div>
                <span className="text-sm">Se puede enviar confirmación por WhatsApp</span>
              </motion.div>
            </div>
          </div>

          {/* Info box */}
          <div className="flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <Sparkles className="w-4 h-4 text-blue-500 mt-0.5" />
            <p className="text-xs text-blue-600 dark:text-blue-400">
              En producción, podrías llamar al cliente antes de confirmar para verificar datos.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          <Button
            onClick={handleConfirm}
            disabled={isConfirming}
            className={cn(
              'w-full gap-2 h-11',
              isConfirmed && 'bg-green-600 hover:bg-green-700'
            )}
          >
            {isConfirming ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Confirmando...
              </>
            ) : isConfirmed ? (
              <>
                <Check className="w-4 h-4" />
                Pedido Confirmado
              </>
            ) : (
              <>
                Confirmar Pedido
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('text-sm font-medium', className)}>{children}</div>;
}
