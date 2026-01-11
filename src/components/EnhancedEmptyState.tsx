/**
 * Enhanced Empty State Component
 * Provides contextual guidance, tips, and multiple actions when lists are empty
 */

import { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  LucideIcon,
  Lightbulb,
  ArrowRight,
  ExternalLink,
  Sparkles,
  ShoppingCart,
  Plus,
  Package,
  Download,
  Users,
  UserPlus,
  Truck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface EnhancedEmptyStateAction {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  icon?: LucideIcon;
  primary?: boolean;
}

interface EnhancedEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actions?: EnhancedEmptyStateAction[];
  tips?: string[];
  videoUrl?: string;
  videoTitle?: string;
  className?: string;
  variant?: 'default' | 'highlight' | 'subtle';
  showOnboardingHint?: boolean;
  onboardingStep?: string;
}

export function EnhancedEmptyState({
  icon: Icon,
  title,
  description,
  actions = [],
  tips,
  videoUrl,
  videoTitle,
  className,
  variant = 'default',
  showOnboardingHint = false,
  onboardingStep,
}: EnhancedEmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className={cn(
        'p-8 md:p-12',
        variant === 'highlight' && 'border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-background',
        variant === 'subtle' && 'bg-muted/30',
        className
      )}>
        <div className="flex flex-col items-center justify-center text-center space-y-6 max-w-lg mx-auto">
          {/* Icon */}
          <motion.div
            initial={{ scale: 0.8 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
            className={cn(
              'w-20 h-20 rounded-full flex items-center justify-center',
              variant === 'highlight' ? 'bg-primary/10' : 'bg-muted'
            )}
          >
            <Icon className={cn(
              'w-10 h-10',
              variant === 'highlight' ? 'text-primary' : 'text-muted-foreground'
            )} />
          </motion.div>

          {/* Title & Description */}
          <div className="space-y-2">
            <h3 className="text-xl md:text-2xl font-semibold">{title}</h3>
            <p className="text-muted-foreground text-sm md:text-base">{description}</p>
          </div>

          {/* Onboarding Hint */}
          {showOnboardingHint && onboardingStep && (
            <div className="flex items-center gap-2 text-sm text-primary bg-primary/10 px-4 py-2 rounded-full">
              <Sparkles className="w-4 h-4" />
              <span>Paso de configuración: {onboardingStep}</span>
            </div>
          )}

          {/* Actions */}
          {actions.length > 0 && (
            <div className="flex flex-col sm:flex-row gap-3">
              {actions.map((action, index) => (
                <Button
                  key={index}
                  onClick={action.onClick}
                  variant={action.variant || (action.primary ? 'default' : 'outline')}
                  className={cn(
                    'gap-2',
                    action.primary && 'hover:scale-105 active:scale-95 transition-transform'
                  )}
                >
                  {action.icon && <action.icon className="w-4 h-4" />}
                  {action.label}
                </Button>
              ))}
            </div>
          )}

          {/* Tips Section */}
          {tips && tips.length > 0 && (
            <div className="w-full mt-4 p-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 mb-2">
                <Lightbulb className="w-4 h-4" />
                <span className="font-medium text-sm">Consejos</span>
              </div>
              <ul className="space-y-1 text-left">
                {tips.map((tip, index) => (
                  <li key={index} className="text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2">
                    <ArrowRight className="w-3 h-3 mt-1 flex-shrink-0" />
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Video Tutorial Link */}
          {videoUrl && (
            <Button
              variant="ghost"
              className="gap-2 text-muted-foreground hover:text-foreground"
              onClick={() => window.open(videoUrl, '_blank')}
            >
              <ExternalLink className="w-4 h-4" />
              {videoTitle || 'Ver tutorial'}
            </Button>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

/**
 * Pre-configured empty states for common scenarios
 */

export const OrdersEnhancedEmptyState = ({
  onCreateOrder,
  hasProducts,
  hasCustomers,
}: {
  onCreateOrder: () => void;
  hasProducts: boolean;
  hasCustomers: boolean;
}) => {
  const tips = [];
  if (!hasProducts) tips.push('Primero agrega productos a tu catálogo');
  if (!hasCustomers) tips.push('Necesitas clientes para crear pedidos');
  tips.push('El stock se actualiza automáticamente al preparar pedidos');
  tips.push('Puedes confirmar pedidos por WhatsApp');

  return (
    <EnhancedEmptyState
      icon={ShoppingCart}
      title="¡Crea tu primer pedido!"
      description="Los pedidos te ayudan a registrar ventas y controlar inventario automáticamente."
      variant="highlight"
      showOnboardingHint={!hasProducts || !hasCustomers}
      onboardingStep={!hasProducts ? 'Agregar productos' : !hasCustomers ? 'Agregar clientes' : undefined}
      actions={[
        {
          label: 'Crear Pedido',
          onClick: onCreateOrder,
          primary: true,
          icon: Plus,
        },
      ]}
      tips={tips}
    />
  );
};

export const ProductsEnhancedEmptyState = ({
  onCreateProduct,
  onImportShopify,
  hasShopifyIntegration,
}: {
  onCreateProduct: () => void;
  onImportShopify?: () => void;
  hasShopifyIntegration?: boolean;
}) => {
  const actions: EnhancedEmptyStateAction[] = [
    {
      label: 'Crear Producto',
      onClick: onCreateProduct,
      primary: true,
      icon: Plus,
    },
  ];

  if (hasShopifyIntegration && onImportShopify) {
    actions.push({
      label: 'Importar desde Shopify',
      onClick: onImportShopify,
      variant: 'outline',
      icon: Download,
    });
  }

  return (
    <EnhancedEmptyState
      icon={Package}
      title="Agrega tu primer producto"
      description="Los productos son la base de tu inventario y pedidos. Define precios, costos y stock."
      variant="highlight"
      showOnboardingHint
      onboardingStep="Configuración inicial"
      actions={actions}
      tips={[
        'Define el costo para calcular márgenes automáticamente',
        'El SKU te ayuda a identificar productos rápidamente',
        'Puedes sincronizar stock con Shopify',
      ]}
    />
  );
};

export const CustomersEnhancedEmptyState = ({
  onCreateCustomer,
  onImportShopify,
  hasShopifyIntegration,
}: {
  onCreateCustomer: () => void;
  onImportShopify?: () => void;
  hasShopifyIntegration?: boolean;
}) => {
  const actions: EnhancedEmptyStateAction[] = [
    {
      label: 'Agregar Cliente',
      onClick: onCreateCustomer,
      primary: true,
      icon: UserPlus,
    },
  ];

  if (hasShopifyIntegration && onImportShopify) {
    actions.push({
      label: 'Importar desde Shopify',
      onClick: onImportShopify,
      variant: 'outline',
      icon: Download,
    });
  }

  return (
    <EnhancedEmptyState
      icon={Users}
      title="Agrega tu primer cliente"
      description="Los clientes te permiten crear pedidos rápidamente y mantener un historial de compras."
      variant="highlight"
      showOnboardingHint
      onboardingStep="Configuración inicial"
      actions={actions}
      tips={[
        'Guarda dirección completa para envíos más rápidos',
        'El teléfono permite confirmaciones por WhatsApp',
        'El historial de compras te ayuda a entender a tus clientes',
      ]}
    />
  );
};

export const CarriersEnhancedEmptyState = ({
  onCreateCarrier,
}: {
  onCreateCarrier: () => void;
}) => {
  return (
    <EnhancedEmptyState
      icon={Truck}
      title="Configura tu primera transportadora"
      description="Las transportadoras te permiten asignar pedidos para envío y calcular costos de flete."
      variant="highlight"
      showOnboardingHint
      onboardingStep="Configuración inicial"
      actions={[
        {
          label: 'Agregar Transportadora',
          onClick: onCreateCarrier,
          primary: true,
          icon: Plus,
        },
      ]}
      tips={[
        'Puedes configurar zonas con diferentes tarifas',
        'Define tiempos de entrega estimados',
        'Asigna transportadoras automáticamente por zona',
      ]}
    />
  );
};

export default EnhancedEmptyState;
