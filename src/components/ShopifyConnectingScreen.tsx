// ================================================================
// SHOPIFY CONNECTING SCREEN
// ----------------------------------------------------------------
// Rendered inside the Shopify iframe while the Token Exchange
// handshake is in flight, or when it has failed. Replaces the
// previous behaviour of redirecting to /login (which surfaced the
// vanilla form to App Store reviewers and produced the 2.1.1
// install loop rejection).
// ================================================================
import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type ShopifyConnectingError = 'auth_failed' | 'timeout';

interface ShopifyConnectingScreenProps {
  error?: ShopifyConnectingError;
  // Seconds before the default loading state escalates to a timeout
  // state on its own. Defaults to 10s to match the plan SLA. Set to 0
  // to disable.
  timeoutSeconds?: number;
}

const STANDALONE_LOGIN_URL = 'https://app.ordefy.io/login';

function openTopLevelLogin() {
  // App Bridge Redirect.Action.REMOTE is the official top-level escape
  // hatch for iframed apps. We resolve it lazily because the App Bridge
  // singleton lives on window.shopify only after ShopifyAppBridgeProvider
  // has initialised. If App Bridge is missing for any reason, fall back
  // to setting window.top.location, which still escapes the iframe.
  try {
    const app = (window as any).shopify;
    if (app && typeof app === 'object') {
      // App Bridge 3.x uses createRedirect dispatch; the modern App
      // Bridge 4.x global exposes `redirect.dispatch` directly. We
      // try the modern API first because the rest of the codebase
      // depends on the official NPM library that exposes both.
      if (typeof app.redirect?.dispatch === 'function') {
        app.redirect.dispatch('REMOTE', STANDALONE_LOGIN_URL);
        return;
      }
    }

    // Fallback: top-level navigation. This works inside the iframe
    // because the URL is same-origin to the parent.
    if (window.top) {
      window.top.location.href = STANDALONE_LOGIN_URL;
      return;
    }
  } catch {
    // ignore and use last-resort
  }

  window.location.href = STANDALONE_LOGIN_URL;
}

export function ShopifyConnectingScreen({
  error,
  timeoutSeconds = 10,
}: ShopifyConnectingScreenProps) {
  const [autoTimedOut, setAutoTimedOut] = useState(false);
  const effectiveError: ShopifyConnectingError | undefined = error ?? (autoTimedOut ? 'timeout' : undefined);

  useEffect(() => {
    if (error) return;
    if (!timeoutSeconds || timeoutSeconds <= 0) return;
    const id = window.setTimeout(() => setAutoTimedOut(true), timeoutSeconds * 1000);
    return () => window.clearTimeout(id);
  }, [error, timeoutSeconds]);

  const handleRetry = useCallback(() => {
    window.location.reload();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              {effectiveError ? (
                <AlertTriangle className="h-6 w-6 text-amber-500" aria-hidden />
              ) : (
                <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
              )}
            </div>
            <CardTitle>
              {effectiveError === 'auth_failed'
                ? 'No pudimos completar la conexión'
                : effectiveError === 'timeout'
                  ? 'La conexión está tardando más de lo esperado'
                  : 'Conectando con Shopify'}
            </CardTitle>
            <CardDescription>
              {effectiveError === 'auth_failed'
                ? 'No logramos verificar tu sesión de Shopify. Probá recargar o abrí Ordefy en una pestaña nueva.'
                : effectiveError === 'timeout'
                  ? 'Esto puede pasar si la conexión es lenta. Esperá unos segundos más, recargá o abrí Ordefy en otra pestaña.'
                  : 'Estamos vinculando tu tienda con Ordefy. Esto suele tomar menos de cinco segundos.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!effectiveError && (
              <div
                role="progressbar"
                aria-busy="true"
                aria-label="Conectando con Shopify"
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              >
                <motion.div
                  className="h-full w-1/3 rounded-full bg-primary"
                  animate={{ x: ['-100%', '300%'] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
                />
              </div>
            )}

            {effectiveError && (
              <div className="flex flex-col gap-2">
                <Button onClick={handleRetry} className="w-full" variant="default">
                  <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
                  Reintentar
                </Button>
                <Button onClick={openTopLevelLogin} className="w-full" variant="outline">
                  <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
                  Abrir Ordefy en una pestaña nueva
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

export default ShopifyConnectingScreen;
