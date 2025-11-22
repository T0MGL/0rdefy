import { useEffect, useState } from 'react';

// Extend Window interface to include Shopify App Bridge
declare global {
  interface Window {
    shopify?: {
      environment?: {
        embedded?: boolean;
        mobile?: boolean;
        pos?: boolean;
      };
    };
    // App Bridge 3.0 exposes createApp globally
    createApp?: (config: {
      apiKey: string;
      host: string;
      forceRedirect?: boolean;
    }) => any;
    getSessionToken?: (app: any) => Promise<string>;
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

  useEffect(() => {
    let intervalId: NodeJS.Timeout | undefined;

    const initializeAppBridge = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Verificar si estamos en un iframe de Shopify
        const urlParams = new URLSearchParams(window.location.search);
        const host = urlParams.get('host');
        const embedded = urlParams.get('embedded');

        // Si no hay parámetro 'host' o 'embedded', no estamos en Shopify
        if (!host || embedded !== '1') {
          console.log('[Shopify] Not running in Shopify embedded app context');
          setIsLoading(false);
          return;
        }

        // Esperar a que el script de App Bridge esté cargado
        // App Bridge 3.0 expone createApp y getSessionToken globalmente
        if (!window.createApp) {
          console.warn('[Shopify] App Bridge script not loaded yet. Retrying...');
          // Reintentar después de un breve delay
          setTimeout(initializeAppBridge, 100);
          return;
        }

        console.log('[Shopify] Initializing App Bridge 3.0...');

        // Inicializar App Bridge 3.0 con el client_id
        const CLIENT_ID = 'e4ac05aaca557fdb387681f0f209335d';
        const shopifyApp = window.createApp({
          apiKey: CLIENT_ID,
          host: host,
          forceRedirect: false, // No forzar redirección
        });

        setApp(shopifyApp);

        console.log('[Shopify] App Bridge 3.0 initialized successfully');

        // Función para obtener el token de sesión
        const fetchSessionToken = async () => {
          if (!window.getSessionToken) {
            throw new Error('getSessionToken not available');
          }

          console.log('[Shopify] Fetching session token...');
          const token = await window.getSessionToken(shopifyApp);

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
