// ================================================================
// SHOPIFY OAUTH CALLBACK PAGE (POPUP MODE)
// ================================================================
// This page is shown in the popup after successful Shopify OAuth
// It notifies the parent window and closes itself
// ================================================================

import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { logger } from '@/utils/logger';

export default function ShopifyOAuthCallback() {
  const [searchParams] = useSearchParams();
  const status = searchParams.get('status');
  const shop = searchParams.get('shop');
  const error = searchParams.get('error');
  const webhooksFailed = searchParams.get('webhooks_failed');
  const webhooksOk = searchParams.get('webhooks');

  useEffect(() => {
    logger.log('[SHOPIFY-CALLBACK] Popup callback loaded:', { status, shop, error, webhooksFailed, webhooksOk });

    // Wait a moment for user to see the success message
    const timer = setTimeout(() => {
      // Notify parent window (opener)
      if (window.opener) {
        logger.log('[SHOPIFY-CALLBACK] Notifying parent window via postMessage');

        window.opener.postMessage(
          {
            type: 'shopify-oauth-complete',
            status,
            shop,
            error,
            webhooksFailed: webhooksFailed ? parseInt(webhooksFailed) : 0,
            webhooksOk: webhooksOk === 'ok'
          },
          window.location.origin // Only send to same origin for security
        );

        // Close popup after notifying
        setTimeout(() => {
          logger.log('[SHOPIFY-CALLBACK] Closing popup');
          window.close();
        }, 1000);
      } else {
        logger.error('[SHOPIFY-CALLBACK] No window.opener found - cannot notify parent');
        // If no opener, just show message
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [status, shop, error, webhooksFailed, webhooksOk]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6">
          {status === 'success' ? (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
                  <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
                </div>
              </div>
              <div>
                <h2 className="text-xl font-semibold mb-2">
                  ✅ Conexión exitosa
                </h2>
                <p className="text-sm text-muted-foreground">
                  Tu tienda Shopify se conectó correctamente
                </p>
                {shop && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Tienda: {shop}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cerrando ventana...
              </div>
            </div>
          ) : (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <div className="h-16 w-16 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center">
                  <XCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
                </div>
              </div>
              <div>
                <h2 className="text-xl font-semibold mb-2">
                  ❌ Error en la conexión
                </h2>
                <p className="text-sm text-muted-foreground">
                  {error === 'callback_failed'
                    ? 'Hubo un error al procesar la autorización'
                    : 'Ocurrió un error inesperado'}
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cerrando ventana...
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
