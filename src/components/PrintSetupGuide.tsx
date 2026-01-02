/**
 * PrintSetupGuide Component
 * Visual guide for proper thermal label printing configuration
 */

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { HelpCircle, Printer, CheckCircle, XCircle, Settings, AlertTriangle } from 'lucide-react';

interface PrintSetupGuideProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function PrintSetupGuide({ open: controlledOpen, onOpenChange }: PrintSetupGuideProps) {
  const [internalOpen, setInternalOpen] = useState(false);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? onOpenChange : setInternalOpen;

  return (
    <>
      {!isControlled && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen?.(true)}
          className="gap-2"
        >
          <HelpCircle className="h-4 w-4" />
          Ayuda de Impresión
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-5 w-5" />
              Configuración de Impresión - Etiquetas 4x6
            </DialogTitle>
            <DialogDescription>
              Sigue estas instrucciones para imprimir correctamente tus etiquetas térmicas
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* CRITICAL SETTINGS */}
            <div className="space-y-3">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <Settings className="h-5 w-5 text-primary" />
                Configuración Crítica
              </h3>

              <div className="space-y-2">
                <div className="flex items-start gap-3 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-sm">Tamaño de Papel</p>
                    <p className="text-sm text-muted-foreground">4 x 6 inches (101.6 x 152.4 mm)</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-sm">Escala</p>
                    <p className="text-sm text-muted-foreground">100% (sin ajustar a página)</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-sm">Márgenes</p>
                    <p className="text-sm text-muted-foreground">0mm en todos los lados</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-sm">Gráficos de Fondo</p>
                    <p className="text-sm text-muted-foreground">Activado (para imprimir QR y bordes)</p>
                  </div>
                </div>
              </div>
            </div>

            {/* COMMON ERRORS */}
            <div className="space-y-3">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                Errores Comunes
              </h3>

              <div className="space-y-2">
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    <strong>Etiqueta muy pequeña o muy grande:</strong> Verificar que escala sea 100% y que "Ajustar a página" esté desactivado
                  </AlertDescription>
                </Alert>

                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    <strong>Páginas en blanco adicionales:</strong> Asegurar que márgenes sean 0mm y que solo se imprima página 1
                  </AlertDescription>
                </Alert>

                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    <strong>QR no escanea:</strong> Activar "Gráficos de fondo" y configurar densidad de impresión al 100%
                  </AlertDescription>
                </Alert>
              </div>
            </div>

            {/* STEP BY STEP CHROME */}
            <div className="space-y-3">
              <h3 className="font-semibold text-lg">Chrome / Edge</h3>
              <ol className="space-y-2 list-decimal list-inside text-sm">
                <li>Clic en "Imprimir (4x6)"</li>
                <li>
                  <strong>Destino:</strong> Seleccionar impresora térmica
                </li>
                <li>
                  <strong>Tamaño de papel:</strong> 4 x 6 inches
                </li>
                <li>
                  <strong>Márgenes:</strong> Ninguno
                </li>
                <li>
                  <strong>Más configuraciones → Escala:</strong> 100%
                </li>
                <li>
                  <strong>Opciones:</strong> ✅ Gráficos de fondo
                </li>
              </ol>
            </div>

            {/* PRINTER SETTINGS */}
            <div className="space-y-3">
              <h3 className="font-semibold text-lg">Configuración de Impresora</h3>
              <div className="bg-muted p-4 rounded-lg space-y-2 text-sm">
                <p><strong>Windows:</strong> Panel de Control → Dispositivos e impresoras → Preferencias de impresión</p>
                <p><strong>macOS:</strong> Preferencias del Sistema → Impresoras → Administrar tamaños personalizados</p>
                <p className="text-muted-foreground mt-3">
                  Crear tamaño de papel personalizado "Etiqueta 4x6" si no existe en la lista
                </p>
              </div>
            </div>

            {/* COMPATIBLE PRINTERS */}
            <div className="space-y-3">
              <h3 className="font-semibold text-lg">Impresoras Compatibles</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <span>Zebra ZD420/ZD620</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <span>Dymo LabelWriter 4XL</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <span>Brother QL-1110NWB</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <span>Primera LX500</span>
                </div>
              </div>
            </div>

            {/* DOCUMENTATION LINK */}
            <Alert>
              <HelpCircle className="h-4 w-4" />
              <AlertDescription>
                Para instrucciones detalladas, consulta{' '}
                <a
                  href="/INSTRUCCIONES_IMPRESION_ETIQUETAS.md"
                  target="_blank"
                  className="underline font-medium hover:text-primary"
                >
                  la documentación completa
                </a>
              </AlertDescription>
            </Alert>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen?.(false)}>
              Cerrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
