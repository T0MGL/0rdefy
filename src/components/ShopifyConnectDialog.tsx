// ================================================================
// SHOPIFY CONNECT DIALOG
// ================================================================
// Dialog for connecting Shopify store via OAuth
// ================================================================

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { shopifyService } from '@/services/shopify.service';

interface ShopifyConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShopifyConnectDialog({ open, onOpenChange }: ShopifyConnectDialogProps) {
  const { user, currentStore } = useAuth();
  const [shopDomain, setShopDomain] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleConnect = () => {
    setError('');

    // Validate shop domain
    if (!shopDomain.trim()) {
      setError('Por favor ingresa el dominio de tu tienda');
      return;
    }

    let cleanDomain = shopDomain.trim().toLowerCase();

    // Remove https:// or http:// if present
    cleanDomain = cleanDomain.replace(/^https?:\/\//, '');

    // Remove trailing slash if present
    cleanDomain = cleanDomain.replace(/\/$/, '');

    // Add .myshopify.com if not present
    if (!cleanDomain.includes('.myshopify.com')) {
      // If user entered just the store name
      cleanDomain = `${cleanDomain}.myshopify.com`;
    }

    // Validate format: *.myshopify.com
    const shopRegex = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/;
    if (!shopRegex.test(cleanDomain)) {
      setError('Formato inválido. Usa: mi-tienda.myshopify.com');
      return;
    }

    console.log('🚀 [SHOPIFY-CONNECT] Starting OAuth for shop:', cleanDomain);

    setIsLoading(true);

    // Start OAuth flow (will redirect to Shopify)
    try {
      shopifyService.startOAuth(
        cleanDomain,
        user?.id,
        currentStore?.id
      );
    } catch (err: any) {
      console.error('❌ [SHOPIFY-CONNECT] Error:', err);
      setError('Error al iniciar conexión. Intenta nuevamente.');
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConnect();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img
              src="https://cdn.shopify.com/shopifycloud/brochure/assets/brand-assets/shopify-logo-primary-logo-456baa801ee66a0a435671082365958316831c9960c480451dd0330bcdae304f.svg"
              alt="Shopify"
              className="h-6"
            />
            Conectar con Shopify
          </DialogTitle>
          <DialogDescription>
            Ingresa el dominio de tu tienda Shopify para conectar y sincronizar productos, pedidos y clientes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="shop-domain">
              Dominio de tu tienda
            </Label>
            <Input
              id="shop-domain"
              placeholder="mi-tienda.myshopify.com"
              value={shopDomain}
              onChange={(e) => {
                setShopDomain(e.target.value);
                setError('');
              }}
              onKeyPress={handleKeyPress}
              disabled={isLoading}
              className={error ? 'border-red-500 dark:border-red-500' : ''}
            />
            {error && (
              <p className="text-sm text-red-500 dark:text-red-400">
                {error}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Puedes ingresar solo el nombre (ej: "mi-tienda") o el dominio completo
            </p>
          </div>

          <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
            <p className="text-sm text-blue-900 dark:text-blue-100">
              <strong>¿Qué sucederá?</strong>
            </p>
            <ol className="text-xs text-blue-800 dark:text-blue-200 mt-2 space-y-1 list-decimal list-inside">
              <li>Serás redirigido a Shopify para autorizar la conexión</li>
              <li>Deberás iniciar sesión en tu tienda Shopify</li>
              <li>Autoriza los permisos solicitados</li>
              <li>Volverás automáticamente a Ordefy</li>
            </ol>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
            className="flex-1"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleConnect}
            disabled={isLoading || !shopDomain.trim()}
            className="flex-1"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Conectando...
              </>
            ) : (
              'Conectar con Shopify'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
