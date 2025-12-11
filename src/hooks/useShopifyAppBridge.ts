import { useEffect, useState, useRef } from 'react';

// Extend Window interface to include Shopify App Bridge 3.0
declare global {
  interface Window {
    __SHOPIFY_EMBEDDED__?: boolean;
    shopify?: {
      environment?: {
        embedded?: boolean;
        mobile?: boolean;
        pos?: boolean;
      };
      // App Bridge 3.0 exposes createApp under window.shopify
      createApp?: (config: {
        apiKey: string;
        host: string;
        shop?: string;
        forceRedirect?: boolean;
      }) => {
        idToken: () => Promise<string>;
        dispatch: (action: any) => void;
        subscribe: (callback: (data: any) => void) => () => void;
      };
    };
  }
}

interface UseShopifyAppBridgeResult {
  sessionToken: string | null;
  isLoading: boolean;
  error: Error | null;
  app: any;
}

/**
 * Hook para inicializar Shopify App Bridge y obtener el token de sesión
 *
 * @returns {UseShopifyAppBridgeResult} Estado de la inicialización y el token de sesión
 */
export const useShopifyAppBridge = (): UseShopifyAppBridgeResult => {
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [app, setApp] = useState<any>(null);
  const retryCountRef = useRef(0);

  useEffect(() => {
    let intervalId: NodeJS.Timeout | undefined;
    const MAX_RETRIES = 20; // Máximo 20 reintentos = 2 segundos
    const RETRY_DELAY = 100; // 100ms entre reintentos

    // Reset retry count on mount
    retryCountRef.current = 0;

    const initializeAppBridge = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Check if App Bridge was loaded (set by index.html script)
        if (!window.__SHOPIFY_EMBEDDED__) {
          console.log('[Shopify] Not in embedded mode - App Bridge disabled');
          setIsLoading(false);
          return;
        }

        console.log('[Shopify] Embedded mode flag detected, initializing...');

        // Get parameters from URL
        const urlParams = new URLSearchParams(window.location.search);
        let host = urlParams.get('host');
        let embedded = urlParams.get('embedded');
        let shop = urlParams.get('shop');

        // CRITICAL: Try sessionStorage if parameters are missing from URL
        if (!host) {
          host = sessionStorage.getItem('shopify_host');
          console.log('[Shopify] Retrieved host from sessionStorage:', host);
        }
        if (!embedded) {
          embedded = sessionStorage.getItem('shopify_embedded');
        }
        if (!shop) {
          shop = sessionStorage.getItem('shopify_shop');
          console.log('[Shopify] Retrieved shop from sessionStorage:', shop);
        }

        // If still no parameters, we can't initialize (but we're in iframe, so warn)
        if (!host && embedded !== '1' && !shop) {
          console.warn('[Shopify] ⚠️  In iframe but missing Shopify parameters. App Bridge may not work.');
          // Don't return - try to initialize anyway
        }

        // Extraer shop domain desde host si no está en parámetros directos
        // El host es un base64 de shop/admin, podemos decodificarlo
        let shopDomain = shop;
        if (!shopDomain && host) {
          try {
            const decodedHost = atob(host);
            shopDomain = decodedHost.split('/')[0]; // Obtener shop.myshopify.com
            console.log('[Shopify] Decoded shop domain from host:', shopDomain);
          } catch (err) {
            console.warn('[Shopify] Could not decode host parameter:', err);
          }
        }

        // Esperar a que el script de App Bridge esté cargado
        // App Bridge 3.0 expone createApp bajo window.shopify
        if (!window.shopify?.createApp) {
          retryCountRef.current++;

          if (retryCountRef.current >= MAX_RETRIES) {
            console.error(`[Shopify] App Bridge failed to load after ${MAX_RETRIES} attempts (${MAX_RETRIES * RETRY_DELAY}ms). Running in standalone mode.`);
            setIsLoading(false);
            return;
          }

          if (retryCountRef.current <= 3) {
            console.warn(`[Shopify] App Bridge script not loaded yet. Retrying (${retryCountRef.current}/${MAX_RETRIES})...`);
          }

          // Reintentar después de un breve delay
          setTimeout(initializeAppBridge, RETRY_DELAY);
          return;
        }

        // Validar que tengamos al menos host o shopDomain
        if (!host && !shopDomain) {
          console.error('[Shopify] Could not determine shop or host from parameters');
          setError(new Error('Missing shop and host parameters'));
          setIsLoading(false);
          return;
        }

        console.log('[Shopify] Initializing App Bridge 3.0 CDN');
        console.log('[Shopify]   Host:', host || 'N/A');
        console.log('[Shopify]   Shop:', shopDomain || 'N/A');

        // Inicializar App Bridge 3.0 CDN con el client_id del shopify.app.toml
        const CLIENT_ID = 'e4ac05aaca557fdb387681f0f209335d';

        const appConfig: any = {
          apiKey: CLIENT_ID,
          forceRedirect: true, // Redirigir automáticamente cuando no esté embebido
        };

        // Add host if available (preferred for App Bridge CDN)
        if (host) {
          appConfig.host = host;
        }

        // Add shop if available
        if (shopDomain) {
          appConfig.shop = shopDomain;
        }

        console.log('[Shopify] Creating app with config:', { ...appConfig, apiKey: '***' });

        const shopifyApp = window.shopify.createApp(appConfig);

        setApp(shopifyApp);

        console.log('[Shopify] App Bridge 3.0 initialized successfully');

        // Función para obtener el token de sesión usando app.idToken()
        const fetchSessionToken = async () => {
          if (!shopifyApp.idToken) {
            throw new Error('idToken method not available on app instance');
          }

          console.log('[Shopify] Fetching session token...');
          const token = await shopifyApp.idToken();

          if (!token) {
            throw new Error('Failed to get session token from Shopify');
          }

          console.log('[Shopify] Session token obtained successfully');
          setSessionToken(token);

          // Guardar el token en localStorage para uso en API requests
          localStorage.setItem('shopify_session_token', token);

          return token;
        };

        // Obtener el token inicial
        await fetchSessionToken();

        // Renovar el token periódicamente (cada 50 segundos, los tokens de Shopify duran 60s)
        intervalId = setInterval(async () => {
          try {
            console.log('[Shopify] Refreshing session token...');
            await fetchSessionToken();
            console.log('[Shopify] Session token refreshed');
          } catch (err) {
            console.error('[Shopify] Failed to refresh session token:', err);
          }
        }, 50000); // 50 segundos
      } catch (err) {
        console.error('[Shopify] Error initializing App Bridge:', err);
        setError(err instanceof Error ? err : new Error('Unknown error'));
      } finally {
        setIsLoading(false);
      }
    };

    initializeAppBridge();

    // Limpiar el intervalo cuando el componente se desmonte
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, []);

  return { sessionToken, isLoading, error, app };
};
