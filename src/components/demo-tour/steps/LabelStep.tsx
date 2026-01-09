// LabelStep - Step to show shipping label preview

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useDemoTour } from '../DemoTourProvider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Printer,
  QrCode,
  MapPin,
  Phone,
  User,
  Package,
  Truck,
  Check,
  ArrowRight,
  Sparkles,
} from 'lucide-react';

interface LabelStepProps {
  onComplete?: () => void;
}

export function LabelStep({ onComplete }: LabelStepProps) {
  const { nextStep, demoData } = useDemoTour();
  const [isPrinted, setIsPrinted] = useState(false);

  const handlePrint = () => {
    setIsPrinted(true);
    setTimeout(() => {
      onComplete?.();
      nextStep();
    }, 1000);
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
              <Printer className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-card-foreground">
                Imprimir Etiqueta
              </h2>
              <p className="text-sm text-muted-foreground">
                Genera la etiqueta 4x6 para el courier
              </p>
            </div>
          </div>
        </div>

        {/* Label Preview */}
        <div className="p-6">
          <div className="bg-white dark:bg-zinc-100 rounded-lg border-2 border-dashed border-gray-300 p-4 mb-4">
            <div className="aspect-[4/6] max-h-[280px] mx-auto bg-white text-black rounded overflow-hidden shadow-sm">
              {/* Label content */}
              <div className="h-full flex flex-col p-3 text-xs">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-gray-200 pb-2 mb-2">
                  <div className="font-bold text-sm">ORDEFY</div>
                  <div className="text-[10px] text-gray-500">
                    #{demoData.order?.id?.slice(0, 8).toUpperCase() || 'DEMO-001'}
                  </div>
                </div>

                {/* QR Code placeholder */}
                <div className="flex justify-center mb-2">
                  <div className="w-16 h-16 bg-gray-100 rounded flex items-center justify-center">
                    <QrCode className="w-12 h-12 text-gray-400" />
                  </div>
                </div>

                {/* Recipient */}
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-1 font-semibold">
                    <User className="w-3 h-3" />
                    {demoData.order?.customer_name || 'Juan Pérez (Demo)'}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-gray-600">
                    <Phone className="w-2.5 h-2.5" />
                    {demoData.order?.customer_phone || '+595 981 555 1234'}
                  </div>
                  <div className="flex items-start gap-1 text-[10px] text-gray-600">
                    <MapPin className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" />
                    <span className="line-clamp-2">
                      {demoData.order?.shipping_address || 'Av. Mariscal López 1234, Asuncion'}
                    </span>
                  </div>
                </div>

                {/* Carrier */}
                <div className="border-t border-gray-200 pt-2 mt-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <Truck className="w-3 h-3" />
                      <span className="font-medium">{demoData.carrier?.name || 'Delivery Express'}</span>
                    </div>
                    <span className="font-bold">
                      {formatPrice(demoData.order?.total_price || 325000)} Gs
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Label info */}
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
              <QrCode className="w-5 h-5 text-primary mt-0.5" />
              <div>
                <p className="font-medium text-sm">Código QR</p>
                <p className="text-xs text-muted-foreground">
                  El cliente escanea para confirmar entrega y dar feedback
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg">
              <Package className="w-5 h-5 text-orange-500 mt-0.5" />
              <div>
                <p className="font-medium text-sm">Formato 4x6"</p>
                <p className="text-xs text-muted-foreground">
                  Compatible con Dymo, Zebra, Brother y otras impresoras térmicas
                </p>
              </div>
            </div>
          </div>

          {/* Info box */}
          <div className="flex items-start gap-3 p-3 mt-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <Sparkles className="w-4 h-4 text-blue-500 mt-0.5" />
            <p className="text-xs text-blue-600 dark:text-blue-400">
              En producción, la etiqueta se descarga/imprime directamente. Aquí solo simulamos.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          <Button
            onClick={handlePrint}
            className={cn(
              'w-full gap-2 h-11',
              isPrinted && 'bg-green-600 hover:bg-green-700'
            )}
          >
            {isPrinted ? (
              <>
                <Check className="w-4 h-4" />
                Etiqueta Lista
              </>
            ) : (
              <>
                Simular Impresión
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
