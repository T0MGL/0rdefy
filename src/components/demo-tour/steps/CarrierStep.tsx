// CarrierStep - Interactive step to create a demo carrier

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useDemoTour } from '../DemoTourProvider';
import { useDemoData } from '../hooks/useDemoData';
import { demoCarrierTemplate } from '../utils/demoDataTemplates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  Truck,
  MapPin,
  Check,
  Loader2,
  Sparkles,
  ArrowRight,
} from 'lucide-react';

interface CarrierStepProps {
  onComplete?: () => void;
}

export function CarrierStep({ onComplete }: CarrierStepProps) {
  const { nextStep, demoData } = useDemoTour();
  const { createDemoCarrier } = useDemoData();
  const [isCreating, setIsCreating] = useState(false);
  const [isCreated, setIsCreated] = useState(!!demoData.carrier);

  const handleCreate = async () => {
    if (isCreated) {
      nextStep();
      return;
    }

    setIsCreating(true);
    try {
      const carrier = await createDemoCarrier();
      if (carrier) {
        setIsCreated(true);
        // Small delay to show success state
        setTimeout(() => {
          onComplete?.();
          nextStep();
        }, 800);
      }
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed z-[10002] w-[500px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-64px)]"
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
              <Truck className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-card-foreground">
                Crear Transportadora
              </h2>
              <p className="text-sm text-muted-foreground">
                Configura tu primera transportadora con zonas de cobertura
              </p>
            </div>
          </div>
        </div>

        {/* Form preview */}
        <div className="p-6 space-y-4">
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wide">
              Nombre
            </Label>
            <Input
              value={demoCarrierTemplate.name}
              readOnly
              className="bg-muted/50"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wide flex items-center gap-2">
              <MapPin className="w-3 h-3" />
              Zonas de Cobertura
            </Label>
            <div className="space-y-2">
              {demoCarrierTemplate.zones.map((zone, index) => (
                <motion.div
                  key={zone.zone_name}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/50"
                >
                  <span className="font-medium text-sm">{zone.zone_name}</span>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">{zone.delivery_time}</span>
                    <span className="font-semibold text-primary">
                      {new Intl.NumberFormat('es-PY').format(zone.price)} Gs
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Info box */}
          <div className="flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <Sparkles className="w-4 h-4 text-blue-500 mt-0.5" />
            <p className="text-xs text-blue-600 dark:text-blue-400">
              Esta transportadora quedará guardada en tu cuenta. Podrás editarla o crear más después.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          <Button
            onClick={handleCreate}
            disabled={isCreating}
            className={cn(
              'w-full gap-2 h-11',
              isCreated && 'bg-green-600 hover:bg-green-700'
            )}
          >
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creando...
              </>
            ) : isCreated ? (
              <>
                <Check className="w-4 h-4" />
                Transportadora Creada
              </>
            ) : (
              <>
                Crear Transportadora
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
