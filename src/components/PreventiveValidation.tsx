/**
 * Preventive Validation Components
 * Validates user input in real-time and prevents errors before they happen
 */

import { ReactNode, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { AlertCircle, CheckCircle2, AlertTriangle, Info } from 'lucide-react';

/**
 * Validated Button
 * Disables button and shows tooltip when validation fails
 */

interface ValidationRule {
  check: boolean;
  message: string;
  severity?: 'error' | 'warning' | 'info';
}

interface ValidatedButtonProps {
  children: ReactNode;
  onClick: () => void;
  validations: ValidationRule[];
  variant?: 'default' | 'outline' | 'ghost' | 'destructive';
  className?: string;
  showWarnings?: boolean; // If true, warnings don't disable button
}

export function ValidatedButton({
  children,
  onClick,
  validations,
  variant = 'default',
  className = '',
  showWarnings = true
}: ValidatedButtonProps) {
  const errors = validations.filter(v => !v.check && (!v.severity || v.severity === 'error'));
  const warnings = validations.filter(v => !v.check && v.severity === 'warning');
  const isDisabled = errors.length > 0;

  if (isDisabled || (showWarnings && warnings.length > 0)) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-block">
              <Button
                onClick={onClick}
                disabled={isDisabled}
                variant={variant}
                className={className}
              >
                {children}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <div className="space-y-1">
              {errors.map((validation, index) => (
                <div key={`error-${index}`} className="flex items-start gap-2 text-sm">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <span>{validation.message}</span>
                </div>
              ))}
              {warnings.map((validation, index) => (
                <div key={`warning-${index}`} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                  <span>{validation.message}</span>
                </div>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Button onClick={onClick} variant={variant} className={className}>
      {children}
    </Button>
  );
}

/**
 * Inline Validation Alerts
 * Shows validation messages inline as user fills form
 */

interface InlineValidationProps {
  validations: ValidationRule[];
  showSuccess?: boolean;
}

export function InlineValidation({
  validations,
  showSuccess = false
}: InlineValidationProps) {
  const errors = validations.filter(v => !v.check && (!v.severity || v.severity === 'error'));
  const warnings = validations.filter(v => !v.check && v.severity === 'warning');
  const infos = validations.filter(v => !v.check && v.severity === 'info');
  const allValid = errors.length === 0 && warnings.length === 0;

  if (allValid && !showSuccess) return null;

  return (
    <div className="space-y-2">
      {errors.map((validation, index) => (
        <Alert key={`error-${index}`} variant="destructive" className="py-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-sm">
            {validation.message}
          </AlertDescription>
        </Alert>
      ))}

      {warnings.map((validation, index) => (
        <Alert key={`warning-${index}`} className="py-2 border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <AlertDescription className="text-sm text-yellow-700 dark:text-yellow-400">
            {validation.message}
          </AlertDescription>
        </Alert>
      ))}

      {infos.map((validation, index) => (
        <Alert key={`info-${index}`} className="py-2 border-blue-500 bg-blue-50 dark:bg-blue-950/20">
          <Info className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-sm text-blue-700 dark:text-blue-400">
            {validation.message}
          </AlertDescription>
        </Alert>
      ))}

      {allValid && showSuccess && (
        <Alert className="py-2 border-green-500 bg-green-50 dark:bg-green-950/20">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-sm text-green-700 dark:text-green-400">
            Todo listo para continuar
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/**
 * Real-time Stock Validator
 * Checks product stock availability as user adds products
 */

interface StockValidatorProps {
  productId: string;
  productName: string;
  requestedQuantity: number;
  availableStock: number;
  onValidChange?: (isValid: boolean) => void;
}

export function StockValidator({
  productId,
  productName,
  requestedQuantity,
  availableStock,
  onValidChange
}: StockValidatorProps) {
  const [isValid, setIsValid] = useState(true);

  useEffect(() => {
    const valid = requestedQuantity <= availableStock && requestedQuantity > 0;
    setIsValid(valid);
    onValidChange?.(valid);
  }, [requestedQuantity, availableStock, onValidChange]);

  if (requestedQuantity <= 0) {
    return null;
  }

  const stockPercentage = (availableStock / requestedQuantity) * 100;
  const isCritical = requestedQuantity > availableStock;
  const isLow = availableStock > 0 && stockPercentage < 150 && !isCritical;

  return (
    <div className="flex items-center gap-2 text-sm">
      {isCritical && (
        <Badge variant="destructive" className="gap-1">
          <AlertCircle className="w-3 h-3" />
          Stock insuficiente
        </Badge>
      )}

      {isLow && (
        <Badge variant="outline" className="gap-1 border-yellow-500 text-yellow-700">
          <AlertTriangle className="w-3 h-3" />
          Stock bajo
        </Badge>
      )}

      {!isCritical && !isLow && (
        <Badge variant="outline" className="gap-1 border-green-500 text-green-700">
          <CheckCircle2 className="w-3 h-3" />
          Stock disponible
        </Badge>
      )}

      <span className={
        isCritical
          ? 'text-red-600 font-medium'
          : isLow
          ? 'text-yellow-600'
          : 'text-gray-600 dark:text-gray-400'
      }>
        {availableStock} disponibles
      </span>

      {isCritical && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="w-4 h-4 text-gray-400 cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-sm">
                No puedes vender más de lo que tienes en stock.
                Ve a <strong>Mercadería</strong> para recibir más unidades de "{productName}".
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}

/**
 * Form Progress Indicator
 * Shows which steps are completed in multi-step forms
 */

interface FormStep {
  id: string;
  label: string;
  completed: boolean;
  required?: boolean;
}

interface FormProgressProps {
  steps: FormStep[];
  currentStep?: string;
}

export function FormProgress({ steps, currentStep }: FormProgressProps) {
  const completedCount = steps.filter(s => s.completed).length;
  const requiredCount = steps.filter(s => s.required !== false).length;
  const progress = (completedCount / steps.length) * 100;

  return (
    <div className="space-y-3">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">
          {completedCount}/{steps.length}
        </span>
      </div>

      {/* Steps list */}
      <div className="space-y-1.5">
        {steps.map((step) => (
          <div
            key={step.id}
            className={`flex items-center gap-2 text-sm ${
              currentStep === step.id
                ? 'font-medium text-blue-600 dark:text-blue-400'
                : step.completed
                ? 'text-gray-600 dark:text-gray-400'
                : 'text-gray-500 dark:text-gray-500'
            }`}
          >
            {step.completed ? (
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            ) : currentStep === step.id ? (
              <div className="w-4 h-4 rounded-full border-2 border-blue-500" />
            ) : (
              <div className="w-4 h-4 rounded-full border-2 border-gray-300 dark:border-gray-700" />
            )}
            <span>{step.label}</span>
            {step.required === false && (
              <Badge variant="outline" className="text-xs">
                Opcional
              </Badge>
            )}
          </div>
        ))}
      </div>

      {/* Validation message */}
      {completedCount < requiredCount && (
        <p className="text-xs text-gray-500 dark:text-gray-500">
          Completa {requiredCount - completedCount} pasos más para continuar
        </p>
      )}
    </div>
  );
}

/**
 * Example Usage in Order Form
 */
export function OrderFormValidationExample({
  selectedCustomer,
  products,
  onSubmit,
  onSelectCustomer
}: {
  selectedCustomer: any;
  products: any[];
  onSubmit: () => void;
  onSelectCustomer: () => void;
}) {
  const validations: ValidationRule[] = [
    {
      check: !!selectedCustomer,
      message: 'Selecciona un cliente primero',
      severity: 'error'
    },
    {
      check: products.length > 0,
      message: 'Agrega al menos un producto al pedido',
      severity: 'error'
    },
    {
      check: products.every(p => p.quantity <= p.stock),
      message: 'Algunos productos tienen stock insuficiente',
      severity: 'error'
    },
    {
      check: selectedCustomer?.phone,
      message: 'El cliente no tiene teléfono (no podrás enviar confirmación por WhatsApp)',
      severity: 'warning'
    }
  ];

  return (
    <div className="space-y-4">
      {/* Inline validation messages */}
      <InlineValidation validations={validations} />

      {/* Form fields here */}
      <div>
        {!selectedCustomer && (
          <Button onClick={onSelectCustomer} variant="outline">
            Seleccionar Cliente
          </Button>
        )}
      </div>

      {/* Validated submit button */}
      <ValidatedButton
        onClick={onSubmit}
        validations={validations}
        className="w-full"
      >
        Crear Pedido
      </ValidatedButton>
    </div>
  );
}
