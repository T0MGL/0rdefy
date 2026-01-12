import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Store, AlertCircle, ExternalLink, CheckCircle2, ArrowLeft, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ShopifyManualConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  onBack?: () => void;
}

interface FormData {
  shop_domain: string;
  client_id: string;
  client_secret: string;
}

export function ShopifyManualConnectDialog({ open, onOpenChange, onSuccess, onBack }: ShopifyManualConnectDialogProps) {
  const { toast } = useToast();
  const [isConnecting, setIsConnecting] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  const [formData, setFormData] = useState<FormData>({
    shop_domain: '',
    client_id: '',
    client_secret: '',
  });
  const [errors, setErrors] = useState<Partial<FormData>>({});

  const validateForm = (): boolean => {
    const newErrors: Partial<FormData> = {};

    if (!formData.shop_domain) {
      newErrors.shop_domain = 'Requerido';
    } else if (!formData.shop_domain.includes('.myshopify.com') && !formData.shop_domain.match(/^[a-zA-Z0-9-]+$/)) {
      newErrors.shop_domain = 'Usa el formato: tu-tienda.myshopify.com o solo tu-tienda';
    }

    if (!formData.client_id) {
      newErrors.client_id = 'Requerido';
    }

    if (!formData.client_secret) {
      newErrors.client_secret = 'Requerido';
    } else if (!formData.client_secret.startsWith('shpss_')) {
      newErrors.client_secret = 'El Client Secret debe comenzar con "shpss_"';
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

      // Normalize shop domain
      let shopDomain = formData.shop_domain.trim().toLowerCase();
      if (!shopDomain.includes('.myshopify.com')) {
        shopDomain = `${shopDomain}.myshopify.com`;
      }

      // Start OAuth flow
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/shopify/manual-oauth/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Store-ID': storeId || '',
        },
        body: JSON.stringify({
          shop_domain: shopDomain,
          client_id: formData.client_id,
          client_secret: formData.client_secret,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Error al iniciar conexion');
      }

      // Redirect to Shopify OAuth
      toast({
        title: 'Redirigiendo a Shopify...',
        description: 'Autoriza la aplicacion en Shopify para completar la conexion.',
        duration: 3000,
      });

      // Small delay to show toast, then redirect
      setTimeout(() => {
        window.location.href = data.oauth_url;
      }, 500);

    } catch (error: any) {
      console.error('Error starting OAuth:', error);
      toast({
        title: 'Error al conectar',
        description: error.message || 'No se pudo iniciar la conexion.',
        variant: 'destructive',
      });
      setIsConnecting(false);
    }
  };

  const resetForm = () => {
    setFormData({ shop_domain: '', client_id: '', client_secret: '' });
    setErrors({});
    setShowInstructions(false);
  };

  return (
    <Dialog open={open} onOpenChange={(open) => {
      if (!open) resetForm();
      onOpenChange(open);
    }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3">
            {onBack && (
              <Button variant="ghost" size="icon" className="mt-1" onClick={onBack}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Store className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <DialogTitle className="text-xl">Conectar Shopify (Custom App)</DialogTitle>
              <DialogDescription>
                Conecta tu tienda usando credenciales de tu Custom App en Dev Dashboard
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          <Alert className="bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
            <AlertCircle className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-sm text-blue-800 dark:text-blue-200">
              Al hacer click en "Conectar", seras redirigido a Shopify para autorizar la conexion.
              El token se genera automaticamente y no expira.
            </AlertDescription>
          </Alert>

          {/* Instructions Toggle */}
          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={() => setShowInstructions(!showInstructions)}
          >
            <ExternalLink size={16} />
            {showInstructions ? 'Ocultar' : 'Ver'} instrucciones para crear Custom App
          </Button>

          {showInstructions && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="space-y-3 mt-2">
                <div>
                  <p className="font-semibold mb-2">Paso 1: Crear app en Dev Dashboard</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Ve a <strong>dev.shopify.com</strong> e inicia sesion</li>
                    <li>Click <strong>Apps</strong> en el menu izquierdo</li>
                    <li>Click <strong>Create app</strong> → <strong>Start from Dev Dashboard</strong></li>
                    <li>Nombre: "Ordefy Integration" → Click <strong>Create</strong></li>
                  </ol>
                </div>
                <div className="pt-2 border-t">
                  <p className="font-semibold mb-2">Paso 2: Configurar URLs</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Ve a la pestana <strong>Configuration</strong></li>
                    <li>En <strong>App URL</strong>, usa: <code className="text-xs bg-muted px-1 rounded">https://ordefy.io</code></li>
                    <li>En <strong>Allowed redirection URLs</strong>, agrega:<br/>
                      <code className="text-xs bg-muted px-1 rounded">https://api.ordefy.io/api/shopify/manual-oauth/callback</code>
                    </li>
                    <li>Click <strong>Save</strong></li>
                  </ol>
                </div>
                <div className="pt-2 border-t">
                  <p className="font-semibold mb-2">Paso 3: Configurar permisos (scopes)</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Ve a la pestana <strong>API access</strong></li>
                    <li>Selecciona los scopes:
                      <ul className="list-disc list-inside ml-4 mt-1 text-xs">
                        <li>read_products, write_products</li>
                        <li>read_orders, write_orders</li>
                        <li>read_customers, write_customers</li>
                        <li>read_inventory, write_inventory</li>
                        <li>read_locations</li>
                      </ul>
                    </li>
                    <li>Click <strong>Save</strong></li>
                  </ol>
                </div>
                <div className="pt-2 border-t">
                  <p className="font-semibold mb-2">Paso 4: Crear release e instalar</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Ve a <strong>Release</strong> → Click <strong>Create release</strong></li>
                    <li>Selecciona la version y click <strong>Create</strong></li>
                    <li>Click <strong>Install</strong> para vincular la app a tu tienda</li>
                  </ol>
                </div>
                <div className="pt-2 border-t">
                  <p className="font-semibold mb-2">Paso 5: Obtener credenciales</p>
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Ve a <strong>Client credentials</strong> en el menu</li>
                    <li>Copia el <strong>Client ID</strong></li>
                    <li>Copia el <strong>Client secret</strong> (comienza con shpss_)</li>
                  </ol>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Form Fields */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="shop_domain">
                Dominio de la tienda <span className="text-destructive">*</span>
              </Label>
              <Input
                id="shop_domain"
                placeholder="tu-tienda.myshopify.com"
                value={formData.shop_domain}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, shop_domain: e.target.value }));
                  if (errors.shop_domain) {
                    setErrors(prev => ({ ...prev, shop_domain: undefined }));
                  }
                }}
                className={errors.shop_domain ? 'border-destructive' : ''}
              />
              {errors.shop_domain && (
                <p className="text-sm text-destructive">{errors.shop_domain}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="client_id">
                Client ID <span className="text-destructive">*</span>
              </Label>
              <Input
                id="client_id"
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={formData.client_id}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, client_id: e.target.value }));
                  if (errors.client_id) {
                    setErrors(prev => ({ ...prev, client_id: undefined }));
                  }
                }}
                className={errors.client_id ? 'border-destructive' : ''}
              />
              {errors.client_id && (
                <p className="text-sm text-destructive">{errors.client_id}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Lo encontras en Dev Dashboard → Client credentials
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="client_secret">
                Client Secret <span className="text-destructive">*</span>
              </Label>
              <Input
                id="client_secret"
                type="password"
                placeholder="shpss_xxxxxxxxxxxxxxxx"
                value={formData.client_secret}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, client_secret: e.target.value }));
                  if (errors.client_secret) {
                    setErrors(prev => ({ ...prev, client_secret: undefined }));
                  }
                }}
                className={errors.client_secret ? 'border-destructive' : ''}
              />
              {errors.client_secret && (
                <p className="text-sm text-destructive">{errors.client_secret}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Comienza con "shpss_" - Lo encontras junto al Client ID
              </p>
            </div>
          </div>

          {/* Info Alert */}
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <strong>Despues de conectar:</strong>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Webhooks configurados automaticamente (pedidos nuevos se importan)</li>
                <li>Podras importar productos y clientes desde el dashboard</li>
                <li>Sincronizacion bidireccional de inventario disponible</li>
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
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Redirigiendo...
                </>
              ) : (
                <>
                  <Store size={16} />
                  Conectar via OAuth
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
