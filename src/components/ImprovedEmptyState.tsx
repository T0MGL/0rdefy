/**
 * Improved Empty State Component
 * Provides contextual guidance when lists are empty
 */

import { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Circle, PlayCircle, ExternalLink } from 'lucide-react';

interface ChecklistItem {
  done: boolean;
  label: string;
  action?: () => void;
}

interface Action {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'outline' | 'ghost';
  icon?: ReactNode;
  primary?: boolean;
}

interface ImprovedEmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  actions?: Action[];
  checklist?: ChecklistItem[];
  videoUrl?: string;
  videoTitle?: string;
  tips?: string[];
}

export function ImprovedEmptyState({
  icon,
  title,
  description,
  actions = [],
  checklist,
  videoUrl,
  videoTitle,
  tips
}: ImprovedEmptyStateProps) {
  return (
    <Card className="p-8 max-w-2xl mx-auto">
      {/* Icon */}
      <div className="flex justify-center mb-4">
        <div className="w-20 h-20 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-400 dark:text-gray-600">
          {icon}
        </div>
      </div>

      {/* Title & Description */}
      <div className="text-center mb-6">
        <h3 className="text-xl font-semibold mb-2">{title}</h3>
        <p className="text-gray-600 dark:text-gray-400">{description}</p>
      </div>

      {/* Checklist */}
      {checklist && checklist.length > 0 && (
        <div className="mb-6 bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
          <p className="text-sm font-medium mb-3 text-gray-700 dark:text-gray-300">
            Pasos para comenzar:
          </p>
          <div className="space-y-2">
            {checklist.map((item, index) => (
              <div
                key={index}
                className="flex items-center gap-3 text-sm"
              >
                {item.done ? (
                  <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                ) : (
                  <Circle className="w-5 h-5 text-gray-400 dark:text-gray-600 flex-shrink-0" />
                )}
                <span className={item.done ? 'line-through text-gray-500' : 'text-gray-700 dark:text-gray-300'}>
                  {item.label}
                </span>
                {item.action && !item.done && (
                  <Button
                    variant="link"
                    size="sm"
                    onClick={item.action}
                    className="ml-auto text-xs"
                  >
                    Hacer ahora →
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tips */}
      {tips && tips.length > 0 && (
        <div className="mb-6 space-y-2">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            💡 Consejos:
          </p>
          <ul className="space-y-1">
            {tips.map((tip, index) => (
              <li key={index} className="text-sm text-gray-600 dark:text-gray-400 flex items-start gap-2">
                <span className="text-gray-400">•</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      {actions.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-6">
          {actions.map((action, index) => (
            <Button
              key={index}
              onClick={action.onClick}
              variant={action.variant || (action.primary ? 'default' : 'outline')}
              className="gap-2"
            >
              {action.icon}
              {action.label}
            </Button>
          ))}
        </div>
      )}

      {/* Video Tutorial */}
      {videoUrl && (
        <div className="border-t pt-6 mt-6 dark:border-gray-800">
          <div className="flex items-center gap-2 justify-center text-sm text-gray-600 dark:text-gray-400 mb-3">
            <PlayCircle className="w-4 h-4" />
            <span>Tutorial en video (2 min)</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => window.open(videoUrl, '_blank')}
          >
            <ExternalLink className="w-4 h-4" />
            {videoTitle || 'Ver tutorial'}
          </Button>
        </div>
      )}
    </Card>
  );
}

/**
 * Predefined Empty States for Common Scenarios
 */

export const OrdersEmptyState = ({
  hasCustomers,
  hasProducts,
  onCreateOrder,
  onCreateCustomer,
  onCreateProduct
}: {
  hasCustomers: boolean;
  hasProducts: boolean;
  onCreateOrder: () => void;
  onCreateCustomer: () => void;
  onCreateProduct: () => void;
}) => (
  <ImprovedEmptyState
    icon={<svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" /></svg>}
    title="¡Crea tu primer pedido!"
    description="Los pedidos te ayudan a registrar ventas y controlar inventario automáticamente"
    checklist={[
      {
        done: hasCustomers,
        label: 'Crear al menos un cliente',
        action: !hasCustomers ? onCreateCustomer : undefined
      },
      {
        done: hasProducts,
        label: 'Tener productos en inventario',
        action: !hasProducts ? onCreateProduct : undefined
      },
      {
        done: false,
        label: 'Crear tu primer pedido'
      }
    ]}
    tips={[
      'El stock se descuenta automáticamente cuando el pedido llega a "Listo para Enviar"',
      'Puedes confirmar pedidos vía WhatsApp directamente desde la plataforma',
      'Imprime etiquetas 4x6 para couriers con un solo clic'
    ]}
    actions={[
      {
        label: 'Crear Pedido',
        onClick: onCreateOrder,
        primary: true,
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
      },
      {
        label: 'Ver Tutorial (2 min)',
        onClick: () => window.open('https://youtu.be/tutorial-orders', '_blank'),
        variant: 'outline'
      }
    ]}
  />
);

export const ProductsEmptyState = ({
  onCreateProduct,
  onImportFromShopify,
  hasShopifyIntegration
}: {
  onCreateProduct: () => void;
  onImportFromShopify?: () => void;
  hasShopifyIntegration?: boolean;
}) => (
  <ImprovedEmptyState
    icon={<svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>}
    title="Agrega tu primer producto"
    description="Los productos son la base de tu inventario y pedidos"
    tips={[
      'Define el costo para calcular tu margen de ganancia automáticamente',
      'El SKU te ayuda a identificar productos rápidamente',
      'Puedes importar productos desde Shopify en segundos'
    ]}
    actions={[
      {
        label: 'Crear Producto',
        onClick: onCreateProduct,
        primary: true,
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
      },
      ...(hasShopifyIntegration && onImportFromShopify ? [{
        label: 'Importar desde Shopify',
        onClick: onImportFromShopify,
        variant: 'outline' as const
      }] : [])
    ]}
  />
);

export const WarehouseEmptyState = ({
  hasConfirmedOrders,
  onGoToOrders
}: {
  hasConfirmedOrders: boolean;
  onGoToOrders: () => void;
}) => (
  <ImprovedEmptyState
    icon={<svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>}
    title={hasConfirmedOrders ? "Selecciona pedidos para preparar" : "No hay pedidos confirmados"}
    description={
      hasConfirmedOrders
        ? "Selecciona uno o más pedidos confirmados para crear una sesión de picking"
        : "Primero necesitas confirmar algunos pedidos antes de prepararlos en el almacén"
    }
    tips={[
      'Puedes procesar múltiples pedidos en una sola sesión',
      'El picking agrupa productos de todos los pedidos',
      'El empaque te guía pedido por pedido'
    ]}
    actions={[
      {
        label: 'Ver Pedidos',
        onClick: onGoToOrders,
        primary: true
      }
    ]}
  />
);

export const CustomersEmptyState = ({
  onCreateCustomer
}: {
  onCreateCustomer: () => void;
}) => (
  <ImprovedEmptyState
    icon={<svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>}
    title="Agrega tu primer cliente"
    description="Los clientes son necesarios para crear pedidos"
    tips={[
      'Guarda nombre, teléfono y dirección para crear pedidos rápidamente',
      'El teléfono es opcional pero útil para confirmaciones por WhatsApp',
      'Puedes editar la información del cliente en cualquier momento'
    ]}
    actions={[
      {
        label: 'Crear Cliente',
        onClick: onCreateCustomer,
        primary: true,
        icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
      }
    ]}
  />
);
