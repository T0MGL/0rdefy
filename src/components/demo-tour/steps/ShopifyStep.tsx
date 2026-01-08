// ShopifyStep - Interactive step to connect Shopify

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useDemoTour } from '../DemoTourProvider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Store,
  ArrowRight,
  Check,
  Sparkles,
  ExternalLink,
  Package,
  Users,
  ShoppingCart,
} from 'lucide-react';

interface ShopifyStepProps {
  onComplete?: () => void;
}

export function ShopifyStep({ onComplete }: ShopifyStepProps) {
  const { nextStep, skipTour } = useDemoTour();
  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = () => {
    setIsConnecting(true);
    // Close the tour modal and let user interact with the actual Shopify integration
    // We'll skip the tour for now since Shopify connection is a separate flow
    setTimeout(() => {
      skipTour();
      // Open the Shopify connection by clicking the button programmatically
      const shopifyButton = document.querySelector('[data-integration="shopify"]') as HTMLButtonElement;
      if (shopifyButton) {
        shopifyButton.click();
      } else {
        // Fallback: navigate to integrations page
        window.location.href = '/integrations';
      }
    }, 500);
  };

  const handleSkipShopify = () => {
    // User wants to continue without connecting Shopify now
    onComplete?.();
    nextStep();
  };

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
        <div className="bg-gradient-to-br from-green-500/15 via-green-500/5 to-transparent p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
              <Store className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-card-foreground">
                Conectar Shopify
              </h2>
              <p className="text-sm text-muted-foreground">
                Importa tu tienda con un clic
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Benefits */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">
              Al conectar Shopify, importarás automáticamente:
            </p>
            <div className="grid gap-2">
              {[
                { icon: Package, label: 'Todos tus productos con precios y stock', color: 'text-blue-500' },
                { icon: Users, label: 'Tu base de clientes', color: 'text-purple-500' },
                { icon: ShoppingCart, label: 'Pedidos pendientes y recientes', color: 'text-orange-500' },
              ].map((item, index) => (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="flex items-center gap-3 p-2"
                >
                  <div className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center">
                    <item.icon className={cn('w-4 h-4', item.color)} />
                  </div>
                  <span className="text-sm">{item.label}</span>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Info box */}
          <div className="flex items-start gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
            <Sparkles className="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5" />
            <p className="text-xs text-green-700 dark:text-green-300">
              La sincronización es bidireccional. Los cambios en Ordefy se reflejan en Shopify automáticamente.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 space-y-3">
          <Button
            onClick={handleConnect}
            disabled={isConnecting}
            className="w-full gap-2 h-11 bg-green-600 hover:bg-green-700 text-white"
          >
            {isConnecting ? (
              <>Abriendo conexión...</>
            ) : (
              <>
                Conectar mi tienda Shopify
                <ExternalLink className="w-4 h-4" />
              </>
            )}
          </Button>

          <Button
            variant="ghost"
            onClick={handleSkipShopify}
            className="w-full text-sm text-muted-foreground"
          >
            Conectar después, continuar el tour
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
