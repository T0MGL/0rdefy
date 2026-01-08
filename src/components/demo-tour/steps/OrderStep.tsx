// OrderStep - Interactive step to create a demo order

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useDemoTour } from '../DemoTourProvider';
import { useDemoData } from '../hooks/useDemoData';
import { demoOrderTemplate, demoCarrierTemplate } from '../utils/demoDataTemplates';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  ShoppingBag,
  User,
  Phone,
  MapPin,
  Check,
  Loader2,
  Sparkles,
  ArrowRight,
  Truck,
  Package,
} from 'lucide-react';

interface OrderStepProps {
  onComplete?: () => void;
}

export function OrderStep({ onComplete }: OrderStepProps) {
  const { nextStep, demoData } = useDemoTour();
  const { createDemoOrder } = useDemoData();
  const [isCreating, setIsCreating] = useState(false);
  const [isCreated, setIsCreated] = useState(!!demoData.order);

  const handleCreate = async () => {
    if (isCreated) {
      nextStep();
      return;
    }

    setIsCreating(true);
    try {
      const order = await createDemoOrder();
      if (order) {
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

  // Calculate totals
  const product = demoData.product;
  const quantity = demoOrderTemplate.quantity;
  const subtotal = product ? product.price * quantity : 150000 * quantity;
  const shippingCost = demoCarrierTemplate.zones[0].price; // Asuncion zone
  const total = subtotal + shippingCost;

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
              <ShoppingBag className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-card-foreground">
                Crear Pedido
              </h2>
              <p className="text-sm text-muted-foreground">
                Veamos cómo se ve el flujo completo de un pedido
              </p>
            </div>
          </div>
        </div>

        {/* Form preview */}
        <div className="p-6 space-y-4">
          {/* Customer info */}
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wide flex items-center gap-2">
              <User className="w-3 h-3" />
              Cliente
            </Label>
            <div className="grid grid-cols-2 gap-3">
              <Input
                value={demoOrderTemplate.customer_name}
                readOnly
                className="bg-muted/50"
                placeholder="Nombre"
              />
              <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md border">
                <Phone className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">{demoOrderTemplate.customer_phone}</span>
              </div>
            </div>
          </div>

          {/* Shipping */}
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wide flex items-center gap-2">
              <MapPin className="w-3 h-3" />
              Envío
            </Label>
            <Input
              value={demoOrderTemplate.shipping_address}
              readOnly
              className="bg-muted/50"
            />
            <div className="flex items-center gap-2 mt-2">
              <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-md border flex-1">
                <Truck className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm">{demoData.carrier?.name || demoCarrierTemplate.name}</span>
              </div>
              <div className="px-3 py-2 bg-primary/10 rounded-md border border-primary/20">
                <span className="text-sm font-medium text-primary">{demoOrderTemplate.shipping_zone}</span>
              </div>
            </div>
          </div>

          {/* Products */}
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs uppercase tracking-wide flex items-center gap-2">
              <Package className="w-3 h-3" />
              Productos
            </Label>
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border border-border/50"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center">
                  <Package className="w-5 h-5 text-muted-foreground" />
                </div>
                <div>
                  <span className="font-medium text-sm block">
                    {product?.name || 'Camiseta Básica (Demo)'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    x{quantity} unidades
                  </span>
                </div>
              </div>
              <span className="font-semibold">
                {formatPrice(subtotal)} Gs
              </span>
            </motion.div>
          </div>

          {/* Totals */}
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatPrice(subtotal)} Gs</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Envío ({demoOrderTemplate.shipping_zone})</span>
              <span>{formatPrice(shippingCost)} Gs</span>
            </div>
            <div className="flex items-center justify-between font-bold">
              <span>Total</span>
              <span className="text-primary text-lg">{formatPrice(total)} Gs</span>
            </div>
          </div>

          {/* Info box */}
          <div className="flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <Sparkles className="w-4 h-4 text-amber-500 mt-0.5" />
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Este pedido es de demostración y se eliminará automáticamente al terminar el tour.
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
                Creando pedido...
              </>
            ) : isCreated ? (
              <>
                <Check className="w-4 h-4" />
                Pedido Creado
              </>
            ) : (
              <>
                Crear Pedido
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
