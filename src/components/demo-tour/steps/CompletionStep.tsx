// CompletionStep - Final step showing summary and cleanup

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useDemoTour } from '../DemoTourProvider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  PartyPopper,
  Check,
  Loader2,
  Truck,
  Package,
  ShoppingBag,
  Warehouse,
  BarChart3,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface CompletionStepProps {
  onComplete?: () => void;
}

// Items for owner/admin tours (full workflow)
const ownerLearnedItems = [
  { icon: Truck, label: 'Crear transportadoras con zonas', color: 'text-blue-500' },
  { icon: Package, label: 'Agregar productos con precios', color: 'text-purple-500' },
  { icon: ShoppingBag, label: 'Gestionar pedidos completos', color: 'text-orange-500' },
  { icon: Warehouse, label: 'Picking y packing en almacén', color: 'text-green-500' },
  { icon: BarChart3, label: 'Despacho y seguimiento', color: 'text-pink-500' },
];

// Items for collaborator tours (role-specific)
const collaboratorLearnedItems = [
  { icon: Warehouse, label: 'Navegar por tu área de trabajo', color: 'text-blue-500' },
  { icon: ShoppingBag, label: 'Gestionar tus tareas asignadas', color: 'text-purple-500' },
  { icon: BarChart3, label: 'Consultar información relevante', color: 'text-green-500' },
];

export function CompletionStep({ onComplete }: CompletionStepProps) {
  const { completeTour, path, isAutoStarted } = useDemoTour();

  // Select learned items based on path (collaborator vs owner)
  const learnedItems = path === 'collaborator' ? collaboratorLearnedItems : ownerLearnedItems;
  const [isCompleting, setIsCompleting] = useState(false);

  // Trigger confetti on mount - only if auto-started (after registration)
  useEffect(() => {
    if (!isAutoStarted) return; // Skip confetti if manually started from settings

    const timer = setTimeout(() => {
      triggerCelebration();
    }, 500);

    return () => clearTimeout(timer);
  }, [isAutoStarted]);

  const triggerCelebration = () => {
    // Big center burst
    confetti({
      particleCount: 200,
      spread: 120,
      origin: { x: 0.5, y: 0.5 },
      colors: ['#C1E94E', '#84cc16', '#22c55e', '#10b981', '#06b6d4', '#8b5cf6'],
      ticks: 350,
      gravity: 0.7,
      scalar: 1.3,
      drift: 0,
    });

    // Left side burst
    setTimeout(() => {
      confetti({
        particleCount: 100,
        angle: 60,
        spread: 100,
        origin: { x: 0, y: 0.5 },
        colors: ['#C1E94E', '#84cc16', '#22c55e'],
        ticks: 300,
        gravity: 0.8,
        scalar: 1.2,
      });
    }, 150);

    // Right side burst
    setTimeout(() => {
      confetti({
        particleCount: 100,
        angle: 120,
        spread: 100,
        origin: { x: 1, y: 0.5 },
        colors: ['#22c55e', '#10b981', '#06b6d4'],
        ticks: 300,
        gravity: 0.8,
        scalar: 1.2,
      });
    }, 150);

    // Top left burst
    setTimeout(() => {
      confetti({
        particleCount: 60,
        angle: 45,
        spread: 80,
        origin: { x: 0.1, y: 0.1 },
        colors: ['#C1E94E', '#84cc16', '#8b5cf6'],
        ticks: 250,
        gravity: 1,
        scalar: 1.1,
      });
    }, 300);

    // Top right burst
    setTimeout(() => {
      confetti({
        particleCount: 60,
        angle: 135,
        spread: 80,
        origin: { x: 0.9, y: 0.1 },
        colors: ['#22c55e', '#10b981', '#06b6d4'],
        ticks: 250,
        gravity: 1,
        scalar: 1.1,
      });
    }, 350);

    // Final celebration burst from center-top
    setTimeout(() => {
      confetti({
        particleCount: 150,
        spread: 180,
        origin: { x: 0.5, y: 0.3 },
        colors: ['#C1E94E', '#84cc16', '#22c55e', '#10b981', '#8b5cf6'],
        ticks: 300,
        gravity: 0.9,
        scalar: 1.4,
      });
    }, 500);
  };

  const handleComplete = async () => {
    setIsCompleting(true);
    try {
      await completeTour();
      onComplete?.();
    } finally {
      setIsCompleting(false);
    }
  };

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
        {/* Header with celebration */}
        <div className="bg-gradient-to-br from-primary/20 via-primary/10 to-transparent p-8 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.2 }}
            className="w-20 h-20 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4"
          >
            <PartyPopper className="w-10 h-10 text-primary" />
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="text-2xl font-bold text-card-foreground mb-2"
          >
            ¡Tour Completado!
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="text-muted-foreground"
          >
            {path === 'shopify'
              ? 'Tu tienda Shopify está conectada y lista'
              : path === 'collaborator'
              ? 'Ya conoces las herramientas de tu rol'
              : 'Ya conoces el flujo completo de operaciones'
            }
          </motion.p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* What you learned */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Lo que aprendiste
            </h3>
            <div className="space-y-2">
              {learnedItems.map((item, index) => {
                const Icon = item.icon;
                return (
                  <motion.div
                    key={item.label}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.5 + index * 0.1 }}
                    className="flex items-center gap-3 p-2"
                  >
                    <div className={cn(
                      'w-8 h-8 rounded-lg flex items-center justify-center',
                      'bg-muted/50'
                    )}>
                      <Icon className={cn('w-4 h-4', item.color)} />
                    </div>
                    <span className="text-sm">{item.label}</span>
                    <Check className="w-4 h-4 text-green-500 ml-auto" />
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Next steps - different for collaborators vs owners */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Próximos pasos
            </h3>
            <div className={cn('grid gap-3', path === 'collaborator' ? 'grid-cols-1' : 'grid-cols-2')}>
              {/* Only show Integrations for owners/admins */}
              {path !== 'collaborator' && (
                <motion.a
                  href="/integrations"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1 }}
                  className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors group"
                >
                  <Sparkles className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium flex-1">Integraciones</span>
                  <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-foreground" />
                </motion.a>
              )}

              <motion.a
                href="/support"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 1.1 }}
                className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors group"
              >
                <span className="text-sm font-medium flex-1">Soporte</span>
                <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-foreground" />
              </motion.a>
            </div>
          </div>

          {/* Cleanup notice - only for owners/admins who created demo data */}
          {path !== 'collaborator' && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.2 }}
              className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg"
            >
              <Sparkles className="w-4 h-4 text-amber-500 mt-0.5" />
              <p className="text-xs text-amber-600 dark:text-amber-400">
                El pedido de demostración se eliminará automáticamente. Tus productos y transportadora quedarán disponibles.
              </p>
            </motion.div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          <Button
            onClick={handleComplete}
            disabled={isCompleting}
            className="w-full gap-2 h-12 text-base bg-primary hover:bg-primary/90"
          >
            {isCompleting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Finalizando...
              </>
            ) : (
              <>
                Empezar a trabajar
                <PartyPopper className="w-5 h-5" />
              </>
            )}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
