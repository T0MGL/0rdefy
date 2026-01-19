import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { Store, AlertCircle, ExternalLink, CheckCircle2 } from 'lucide-react';
import { safeJsonParse } from '@/lib/utils';

interface ShopifyOAuthConnectProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShopifyOAuthConnect({ open, onOpenChange }: ShopifyOAuthConnectProps) {
  const { toast } = useToast();
  const [shopDomain, setShopDomain] = useState('');
  const [error, setError] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  const handleDomainChange = (value: string) => {
    setShopDomain(value.toLowerCase().trim());
    if (error) setError('');
  };

  const validateDomain = (domain: string): { isValid: boolean; cleanDomain: string; error?: string } => {
    let cleanDomain = domain.trim().toLowerCase();

    // Remove https:// or http://
    cleanDomain = cleanDomain.replace(/^https?:\/\//, '');

    // Remove trailing slashes
    cleanDomain = cleanDomain.replace(/\/$/, '');

    // If user only entered the shop name (e.g., "mi-tienda"), add .myshopify.com
    if (!cleanDomain.includes('.')) {
      cleanDomain = `${cleanDomain}.myshopify.com`;
    }

    // Validate format: must be *.myshopify.com
    const shopRegex = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

    if (!shopRegex.test(cleanDomain)) {
      return {
        isValid: false,
        cleanDomain,
        error: 'Formato inválido. Ingresa tu dominio de Shopify (ej: mi-tienda.myshopify.com o solo mi-tienda)'
      };
    }

    return { isValid: true, cleanDomain };
  };

  const handleConnect = () => {
    const validation = validateDomain(shopDomain);

    if (!validation.isValid) {
      setError(validation.error || 'Dominio inválido');
      return;
    }

    setIsConnecting(true);

    try {
      // Get user and store IDs from localStorage
      const storeId = localStorage.getItem('current_store_id');
      const userId = safeJsonParse<{ id?: string }>(localStorage.getItem('user'), {})?.id;

      // Build OAuth installation URL
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      const installUrl = new URL(`${apiUrl}/api/shopify-oauth/install`);

      installUrl.searchParams.append('shop', validation.cleanDomain);
      if (storeId) installUrl.searchParams.append('store_id', storeId);
      if (userId) installUrl.searchParams.append('user_id', userId);

      logger.log('🔗 [SHOPIFY-OAUTH] Redirecting to:', installUrl.toString());

      // Redirect to Shopify OAuth flow
      window.location.href = installUrl.toString();
    } catch (err: any) {
      logger.error('❌ [SHOPIFY-OAUTH] Error:', err);
      setIsConnecting(false);
      toast({
        title: 'Error al conectar',
        description: err.message || 'No se pudo iniciar el flujo de OAuth',
        variant: 'destructive'
      });
    }
  };

  const handleCancel = () => {
    onOpenChange(false);
    setTimeout(() => {
      setShopDomain('');
      setError('');
      setIsConnecting(false);
    }, 300);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-green-100 dark:bg-green-950 flex items-center justify-center">
              <Store className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <DialogTitle className="text-xl">Conectar Shopify</DialogTitle>
              <DialogDescription>
                Conecta tu tienda Shopify en segundos
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Alert className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
            <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <AlertDescription className="text-sm text-blue-900 dark:text-blue-300">
              <strong>Conexión segura con OAuth</strong><br />
              Solo necesitas ingresar tu dominio de Shopify. Te redirigiremos a Shopify para autorizar la conexión de forma segura.
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="shop-domain" className="flex items-center gap-2">
              Dominio de tu tienda Shopify
              <span className="text-destructive">*</span>
            </Label>
            <Input
              id="shop-domain"
              value={shopDomain}
              onChange={(e) => handleDomainChange(e.target.value)}
              placeholder="mi-tienda.myshopify.com"
              className={error ? 'border-destructive' : ''}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && shopDomain) {
                  handleConnect();
                }
              }}
            />
            {error && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle size={14} />
                {error}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Puedes ingresar solo el nombre (ej: "mi-tienda") o el dominio completo (ej: "mi-tienda.myshopify.com")
            </p>
          </div>

          <div className="space-y-2 pt-2">
            <p className="text-sm font-medium">¿Qué pasará después?</p>
            <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
              <li>Te redirigiremos a Shopify para iniciar sesión</li>
              <li>Shopify te pedirá autorizar los permisos necesarios</li>
              <li>Una vez autorizado, volverás a Ordefy automáticamente</li>
              <li>¡Listo! Tu tienda estará conectada y sincronizada</li>
            </ol>
          </div>
        </div>

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isConnecting}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleConnect}
            disabled={isConnecting || !shopDomain}
            className="gap-2"
          >
            {isConnecting ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Conectando...
              </>
            ) : (
              <>
                <ExternalLink size={16} />
                Conectar con Shopify
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
