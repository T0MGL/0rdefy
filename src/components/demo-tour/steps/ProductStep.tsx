// ProductStep - Interactive step to create a demo product

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useDemoTour } from '../DemoTourProvider';
import { useDemoData } from '../hooks/useDemoData';
import { demoProductTemplate } from '../utils/demoDataTemplates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  Package,
  DollarSign,
  Boxes,
  Check,
  Loader2,
  Sparkles,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';

interface ProductStepProps {
  onComplete?: () => void;
}

export function ProductStep({ onComplete }: ProductStepProps) {
  const { nextStep, demoData } = useDemoTour();
  const { createDemoProduct } = useDemoData();
  const [isCreating, setIsCreating] = useState(false);
  const [isCreated, setIsCreated] = useState(!!demoData.product);

  const handleCreate = async () => {
    if (isCreated) {
      nextStep();
      return;
    }

    setIsCreating(true);
    try {
      const product = await createDemoProduct();
      if (product) {
        setIsCreated(true);
        setTimeout(() => {
          onComplete?.();
          nextStep();
        }, 800);
      }
    } finally {
      setIsCreating(false);
    }
  };

  const formatPrice = (price: number) =>
    new Intl.NumberFormat('es-PY').format(price);

  const margin = demoProductTemplate.price - demoProductTemplate.cost;
  const marginPercent = Math.round((margin / demoProductTemplate.price) * 100);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed z-[10002] w-[500px] max-w-[calc(100vw-32px)]"
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
              <Package className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-card-foreground">
                Agregar Producto
              </h2>
              <p className="text-sm text-muted-foreground">
                Crea tu primer producto con precio, costo e inventario
              </p>
            </div>
          </div>
        </div>

        {/* Form preview */}
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-2">
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">
                Nombre del Producto
              </Label>
              <Input
                value={demoProductTemplate.name}
                readOnly
                className="bg-muted/50"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">
                SKU
              </Label>
              <Input
                value={demoProductTemplate.sku}
                readOnly
                className="bg-muted/50 font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground text-xs uppercase tracking-wide">
                Categoría
              </Label>
              <Input
                value={demoProductTemplate.category}
                readOnly
                className="bg-muted/50"
              />
            </div>
          </div>

          {/* Pricing */}
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wide flex items-center gap-2">
              <DollarSign className="w-3 h-3" />
              Precios
            </Label>
            <div className="grid grid-cols-3 gap-3">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="p-3 bg-muted/30 rounded-lg border border-border/50"
              >
                <span className="text-xs text-muted-foreground block mb-1">Precio</span>
                <span className="font-semibold text-primary">
                  {formatPrice(demoProductTemplate.price)} Gs
                </span>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="p-3 bg-muted/30 rounded-lg border border-border/50"
              >
                <span className="text-xs text-muted-foreground block mb-1">Costo</span>
                <span className="font-semibold">
                  {formatPrice(demoProductTemplate.cost)} Gs
                </span>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="p-3 bg-green-500/10 rounded-lg border border-green-500/20"
              >
                <span className="text-xs text-muted-foreground block mb-1 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" />
                  Margen
                </span>
                <span className="font-semibold text-green-600 dark:text-green-400">
                  {marginPercent}%
                </span>
              </motion.div>
            </div>
          </div>

          {/* Stock */}
          <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg border border-border/50">
            <Boxes className="w-5 h-5 text-muted-foreground" />
            <div className="flex-1">
              <span className="text-sm font-medium">Stock Inicial</span>
            </div>
            <span className="font-bold text-lg">{demoProductTemplate.stock}</span>
            <span className="text-muted-foreground text-sm">unidades</span>
          </div>

          {/* Info box */}
          <div className="flex items-start gap-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <Sparkles className="w-4 h-4 text-blue-500 mt-0.5" />
            <p className="text-xs text-blue-600 dark:text-blue-400">
              Este producto quedará guardado. El stock se actualizará automáticamente con los pedidos.
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
                Producto Creado
              </>
            ) : (
              <>
                Crear Producto
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
