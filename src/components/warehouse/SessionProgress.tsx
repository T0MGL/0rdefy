/**
 * SessionProgress Component
 * Shows the current step in the warehouse workflow with a visual progress indicator
 */

import { Check, Package, PackageCheck, ClipboardCheck, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkflowStep } from '@/contexts/WarehouseContext';

interface SessionProgressProps {
  currentStep: WorkflowStep;
  sessionCode?: string;
  orderCount?: number;
}

const steps: { key: WorkflowStep; label: string; shortLabel: string; icon: typeof Package }[] = [
  { key: 'selection', label: 'Seleccionar Pedidos', shortLabel: 'Seleccionar', icon: ClipboardCheck },
  { key: 'picking', label: 'Recolectar Productos', shortLabel: 'Recolectar', icon: Package },
  { key: 'packing', label: 'Empacar Pedidos', shortLabel: 'Empacar', icon: PackageCheck },
  { key: 'verification', label: 'Verificar y Completar', shortLabel: 'Completar', icon: Truck },
];

export function SessionProgress({ currentStep, sessionCode, orderCount }: SessionProgressProps) {
  const currentIndex = steps.findIndex(s => s.key === currentStep);

  return (
    <div className="bg-card border-b px-4 py-3 shadow-sm">
      {/* Session Info */}
      {sessionCode && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Sesión:</span>
            <span className="font-mono font-bold text-primary">{sessionCode}</span>
          </div>
          {orderCount !== undefined && (
            <span className="text-sm text-muted-foreground">
              {orderCount} pedido{orderCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {/* Progress Steps */}
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isCompleted = index < currentIndex;
          const isCurrent = index === currentIndex;
          const Icon = step.icon;

          return (
            <div key={step.key} className="flex items-center flex-1">
              {/* Step Circle */}
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center transition-all',
                    isCompleted && 'bg-primary text-primary-foreground',
                    isCurrent && 'bg-primary text-primary-foreground ring-4 ring-primary/20',
                    !isCompleted && !isCurrent && 'bg-muted text-muted-foreground'
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-5 w-5" />
                  ) : (
                    <Icon className="h-5 w-5" />
                  )}
                </div>
                <span
                  className={cn(
                    'text-xs mt-1 font-medium text-center',
                    isCurrent && 'text-primary',
                    !isCurrent && 'text-muted-foreground'
                  )}
                >
                  <span className="hidden sm:inline">{step.label}</span>
                  <span className="sm:hidden">{step.shortLabel}</span>
                </span>
              </div>

              {/* Connector Line */}
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    'flex-1 h-1 mx-2 rounded-full transition-all',
                    index < currentIndex ? 'bg-primary' : 'bg-muted'
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
