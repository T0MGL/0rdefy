import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Store, Zap, Key, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface ShopifyConnectionMethodDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectOAuth: () => void;
  onSelectManual: () => void;
}

export function ShopifyConnectionMethodDialog({
  open,
  onOpenChange,
  onSelectOAuth,
  onSelectManual
}: ShopifyConnectionMethodDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Store className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-xl">Conectar Shopify</DialogTitle>
              <DialogDescription>
                Elige cómo deseas conectar tu tienda de Shopify
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
          {/* OAuth Connection (Recommended) */}
          <Card className="relative hover:shadow-lg transition-all duration-300 hover:border-primary/50 cursor-pointer" onClick={onSelectOAuth}>
            <div className="absolute top-3 right-3">
              <Badge variant="default" className="gap-1">
                <CheckCircle2 size={12} />
                Recomendado
              </Badge>
            </div>
            <CardHeader className="pb-3">
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-lg">Conexión Automática (OAuth)</CardTitle>
              <CardDescription>
                Configuración rápida en un click
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                  <span>Conexión en <strong>1 click</strong> (30 segundos)</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                  <span>Webhooks configurados automáticamente</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                  <span>Sincronización instantánea</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                  <span>Sin necesidad de copiar credenciales</span>
                </li>
              </ul>

              <Button className="w-full gap-2" size="lg">
                <Zap size={16} />
                Conectar con OAuth
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                Serás redirigido a Shopify para autorizar la conexión
              </p>
            </CardContent>
          </Card>

          {/* Manual Connection (Custom App) */}
          <Card className="hover:shadow-lg transition-all duration-300 hover:border-primary/50 cursor-pointer" onClick={onSelectManual}>
            <CardHeader className="pb-3">
              <div className="h-12 w-12 rounded-lg bg-orange-500/10 flex items-center justify-center mb-3">
                <Key className="h-6 w-6 text-orange-600 dark:text-orange-400" />
              </div>
              <CardTitle className="text-lg">Conexión Manual (Custom App)</CardTitle>
              <CardDescription>
                Para uso temporal mientras se aprueba la app
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                  <span>Funciona sin aprobación de Shopify</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                  <span>Funcionalidad completa e idéntica</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="h-4 w-4 flex items-center justify-center mt-0.5 flex-shrink-0">
                    <div className="h-2 w-2 rounded-full bg-amber-500" />
                  </div>
                  <span>Requiere crear Custom App en Shopify (5 min)</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="h-4 w-4 flex items-center justify-center mt-0.5 flex-shrink-0">
                    <div className="h-2 w-2 rounded-full bg-amber-500" />
                  </div>
                  <span>Configurar webhooks manualmente</span>
                </li>
              </ul>

              <Button variant="outline" className="w-full gap-2" size="lg">
                <Key size={16} />
                Conectar con Custom App
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                Necesitarás copiar credenciales desde Shopify
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="border-t pt-4">
          <p className="text-xs text-muted-foreground text-center">
            ℹ️ Ambos métodos ofrecen la misma funcionalidad. Cuando la app sea aprobada por Shopify, la conexión manual será descontinuada.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
