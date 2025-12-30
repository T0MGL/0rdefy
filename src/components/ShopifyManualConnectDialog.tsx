import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Store, AlertCircle, ExternalLink, CheckCircle2, ArrowLeft } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ShopifyManualConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  onBack?: () => void; // Allow going back to connection method selector
}

interface FormData {
  shop_domain: string;
  access_token: string;
  api_key: string;
  api_secret_key: string;
}

export function ShopifyManualConnectDialog({ open, onOpenChange, onSuccess, onBack }: ShopifyManualConnectDialogProps) {
  const { toast } = useToast();
  const [isConnecting, setIsConnecting] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    shop_domain: '',
    access_token: '',
    api_key: '',
    api_secret_key: '',
  });
  const [errors, setErrors] = useState<Partial<FormData>>({});

  const validateForm = (): boolean => {
    const newErrors: Partial<FormData> = {};

    if (!formData.shop_domain) {
      newErrors.shop_domain = 'Requerido';
    } else if (!formData.shop_domain.includes('.myshopify.com')) {
      newErrors.shop_domain = 'Debe ser un dominio de Shopify válido (ej: tienda.myshopify.com)';
    }

    if (!formData.access_token) {
      newErrors.access_token = 'Requerido';
    } else if (!formData.access_token.startsWith('shpat_')) {
      newErrors.access_token = 'El token debe comenzar con "shpat_"';
    }

    if (!formData.api_key) {
      newErrors.api_key = 'Requerido';
    }

    if (!formData.api_secret_key) {
      newErrors.api_secret_key = 'Requerido';
    } else if (!formData.api_secret_key.startsWith('shpss_')) {
      newErrors.api_secret_key = 'El API secret debe comenzar con "shpss_"';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleConnect = async () => {
    if (!validateForm()) {
      toast({
        title: 'Formulario incompleto',
        description: 'Por favor completa todos los campos correctamente',
        variant: 'destructive',
      });
      return;
    }

    setIsConnecting(true);

    try {
      const token = localStorage.getItem('auth_token');
      const storeId = localStorage.getItem('current_store_id');

      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/shopify/configure`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Store-ID': storeId || '',
        },
        body: JSON.stringify({
          shop_domain: formData.shop_domain,
          access_token: formData.access_token,
          api_key: formData.api_key,
          api_secret_key: formData.api_secret_key,
          webhook_signature: formData.api_secret_key, // Same as api_secret_key
          import_products: false, // Manual import from dashboard
          import_customers: false, // Manual import from dashboard
          import_orders: false, // Never import historical orders
          import_historical_orders: false,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Error al conectar con Shopify');
      }

      // Success!
      toast({
        title: '✅ Shopify conectado exitosamente',
        description: `Tu tienda ${formData.shop_domain} se ha conectado. ${data.webhooks?.registered?.length || 0} webhooks configurados. Ahora puedes importar productos y clientes desde el dashboard.`,
        duration: 8000,
      });

      onSuccess?.();
      onOpenChange(false);

      // Reset form
      setFormData({
        shop_domain: '',
        access_token: '',
        api_key: '',
        api_secret_key: '',
      });
      setErrors({});
      setShowInstructions(false);

    } catch (error: any) {
      console.error('Error connecting to Shopify:', error);
      toast({
        title: 'Error al conectar',
        description: error.message || 'No se pudo conectar con Shopify. Verifica tus credenciales.',
        variant: 'destructive',
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const handleInputChange = (field: keyof FormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3">
            {onBack && (
              <Button
                variant="ghost"
                size="icon"
                className="mt-1"
                onClick={onBack}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Store className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-xl">Conectar Shopify (Custom App)</DialogTitle>
              <DialogDescription>
                Conecta tu tienda usando credenciales de Custom App
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          {/* Instructions Toggle */}
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={() => setShowInstructions(!showInstructions)}
          >
            <ExternalLink size={16} />
            {showInstructions ? 'Ocultar' : 'Ver'} instrucciones para obtener credenciales
          </Button>

          {/* Collapsible Instructions */}
          {showInstructions && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="space-y-3 mt-2">
                <div>
                  <p className="font-semibold mb-2">Pasos para crear Custom App:</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Ve a tu Admin de Shopify → <strong>Settings → Apps and sales channels</strong></li>
                    <li>Click en <strong>Develop apps → Create an app</strong></li>
                    <li>Nombre: "Ordefy Integration"</li>
                    <li>Click <strong>Configure Admin API scopes</strong> y selecciona:
                      <ul className="list-disc list-inside ml-4 mt-1">
                        <li>read_products, write_products</li>
                        <li>read_orders, write_orders</li>
                        <li>read_customers, write_customers</li>
                        <li>read_inventory, write_inventory</li>
                        <li>read_locations</li>
                      </ul>
                    </li>
                    <li>Click <strong>Install app</strong></li>
                    <li>Copia el <strong>Admin API access token</strong> (solo se muestra una vez)</li>
                    <li>Copia el <strong>API key</strong> y <strong>API secret key</strong></li>
                  </ol>
                </div>
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    📖 Para instrucciones detalladas, consulta el archivo <code>SHOPIFY_CUSTOM_APP_SETUP.md</code> en el repositorio
                  </p>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Connection Form */}
          <div className="space-y-4">
            {/* Shop Domain */}
            <div className="space-y-2">
              <Label htmlFor="shop_domain">
                Dominio de la tienda <span className="text-destructive">*</span>
              </Label>
              <Input
                id="shop_domain"
                placeholder="tu-tienda.myshopify.com"
                value={formData.shop_domain}
                onChange={(e) => handleInputChange('shop_domain', e.target.value)}
                className={errors.shop_domain ? 'border-destructive' : ''}
              />
              {errors.shop_domain && (
                <p className="text-sm text-destructive">{errors.shop_domain}</p>
              )}
            </div>

            {/* Access Token */}
            <div className="space-y-2">
              <Label htmlFor="access_token">
                Admin API Access Token <span className="text-destructive">*</span>
              </Label>
              <Input
                id="access_token"
                type="password"
                placeholder="shpat_xxxxxxxxxxxxxxxxxxxxx"
                value={formData.access_token}
                onChange={(e) => handleInputChange('access_token', e.target.value)}
                className={errors.access_token ? 'border-destructive' : ''}
              />
              {errors.access_token && (
                <p className="text-sm text-destructive">{errors.access_token}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Se muestra una sola vez al instalar la Custom App
              </p>
            </div>

            {/* API Key */}
            <div className="space-y-2">
              <Label htmlFor="api_key">
                API Key <span className="text-destructive">*</span>
              </Label>
              <Input
                id="api_key"
                placeholder="xxxxxxxxxxxxxxxx"
                value={formData.api_key}
                onChange={(e) => handleInputChange('api_key', e.target.value)}
                className={errors.api_key ? 'border-destructive' : ''}
              />
              {errors.api_key && (
                <p className="text-sm text-destructive">{errors.api_key}</p>
              )}
            </div>

            {/* API Secret Key */}
            <div className="space-y-2">
              <Label htmlFor="api_secret_key">
                API Secret Key <span className="text-destructive">*</span>
              </Label>
              <Input
                id="api_secret_key"
                type="password"
                placeholder="shpss_xxxxxxxxxxxxxxxx"
                value={formData.api_secret_key}
                onChange={(e) => handleInputChange('api_secret_key', e.target.value)}
                className={errors.api_secret_key ? 'border-destructive' : ''}
              />
              {errors.api_secret_key && (
                <p className="text-sm text-destructive">{errors.api_secret_key}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Se usa para verificar webhooks. Debe coincidir con SHOPIFY_API_SECRET en el servidor.
              </p>
            </div>
          </div>

          {/* Info Alert */}
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <strong>¿Qué sucederá después de conectar?</strong>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>✅ Webhooks configurados (pedidos nuevos se importarán automáticamente)</li>
                <li>📦 Podrás importar productos manualmente desde el dashboard</li>
                <li>👥 Podrás importar clientes manualmente desde el dashboard</li>
                <li>❌ Pedidos históricos NO se importan (para mantener analíticas precisas)</li>
              </ul>
            </AlertDescription>
          </Alert>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={isConnecting}
            >
              Cancelar
            </Button>
            <Button
              className="flex-1 gap-2"
              onClick={handleConnect}
              disabled={isConnecting}
            >
              {isConnecting ? (
                <>
                  <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Conectando...
                </>
              ) : (
                <>
                  <Store size={16} />
                  Conectar tienda
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
