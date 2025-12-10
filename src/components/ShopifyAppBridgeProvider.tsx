// ================================================================
// SHOPIFY APP BRIDGE PROVIDER
// ================================================================
// Initializes Shopify App Bridge 3.0 and generates session token
// Clean promise-based pattern - no noisy retry logs
// ================================================================

import { useEffect, useState, useRef } from 'react';
import { waitForAppBridge, isShopifyEmbedded } from '@/utils/waitForAppBridge';

export function ShopifyAppBridgeProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const appRef = useRef<any>(null);
  const tokenIntervalRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    // Only initialize if in embedded mode
    if (!isShopifyEmbedded()) {
      return;
    }

    const initializeAppBridge = async () => {
      try {
        // Wait for App Bridge to load (silent, no retry logs)
        await waitForAppBridge({ timeout: 15000 });

        // Get parameters from URL and sessionStorage
        const urlParams = new URLSearchParams(window.location.search);
        const host = urlParams.get('host') || sessionStorage.getItem('shopify_host');
        const shop = urlParams.get('shop') || sessionStorage.getItem('shopify_shop');

        // Validate we have at least host or shop
        if (!host && !shop) {
          console.error('❌ [SHOPIFY] Missing host and shop parameters');
          return;
        }

        // Create App Bridge instance
        const config: any = {
          apiKey: '75123c29296179fbd8f253db4196c83b',
          forceRedirect: true,
        };

        if (host) config.host = host;
        if (shop) config.shop = shop;

        const app = window.shopify!.createApp(config);
        appRef.current = app;

        // Generate initial session token
        const token = await app.idToken();
        if (token) {
          localStorage.setItem('shopify_session_token', token);
          console.log('✅ [SHOPIFY] App Bridge Ready - Token Generated');
          setIsReady(true);

          // Refresh token every 50 seconds (tokens expire after 60s)
          tokenIntervalRef.current = setInterval(async () => {
            try {
              const newToken = await app.idToken();
              if (newToken) {
                localStorage.setItem('shopify_session_token', newToken);
              }
            } catch (err) {
              console.error('❌ [SHOPIFY] Token refresh failed:', err);
            }
          }, 50000);
        }
      } catch (error) {
        console.error('❌ [SHOPIFY] Timeout - App Bridge failed to load:', error);
      }
    };

    initializeAppBridge();

    // Cleanup
    return () => {
      if (tokenIntervalRef.current) {
        clearInterval(tokenIntervalRef.current);
      }
    };
  }, []);

  // Always render children - App Bridge is optional
  return <>{children}</>;
}
