// ================================================================
// SHOPIFY APP BRIDGE PROVIDER (Official NPM Implementation)
// ================================================================
import React, { useEffect, useState, useRef } from 'react';
import createApp from '@shopify/app-bridge';
import { getSessionToken } from '@shopify/app-bridge/utilities';
import type { ClientApplication } from '@shopify/app-bridge';
import { logger } from '@/utils/logger';

const API_KEY = 'e4ac05aaca557fdb387681f0f209335d';

// Extend Window interface for Shopify globals
declare global {
  interface Window {
    __SHOPIFY_EMBEDDED__?: boolean;
    shopify?: any;
  }
}

export function ShopifyAppBridgeProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const appRef = useRef<ClientApplication<any> | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    // Check if we're in an iframe (Shopify embedded context)
    const isInIframe = window.top !== window.self;

    if (!isInIframe) {
      logger.log('🏠 [SHOPIFY] Standalone mode - App Bridge disabled');
      setIsReady(true);
      return;
    }

    // Prevent multiple initializations
    if (initialized.current) return;
    initialized.current = true;

    const initializeAppBridge = async () => {
      try {
        logger.log('✅ [SHOPIFY] Initializing App Bridge with official NPM library');

        // Get host from URL params or sessionStorage
        const urlParams = new URLSearchParams(window.location.search);
        const shop = urlParams.get('shop');
        const host = urlParams.get('host');

        // Persist to sessionStorage
        if (shop) {
          sessionStorage.setItem('shopify_shop', shop);
          window.__SHOPIFY_EMBEDDED__ = true;
        }
        if (host) {
          sessionStorage.setItem('shopify_host', host);
        }

        // Get final values
        const savedHost = host || sessionStorage.getItem('shopify_host');

        if (!savedHost) {
          logger.error('❌ [SHOPIFY] No host parameter found');
          setIsReady(true);
          return;
        }

        const config = {
          apiKey: API_KEY,
          host: savedHost,
          forceRedirect: true,
        };

        logger.log('📦 [SHOPIFY] Config:', {
          apiKey: API_KEY.substring(0, 8) + '...',
          host: savedHost
        });

        // Create the app instance
        const app = createApp(config);
        appRef.current = app;

        // Set window.shopify for useAppBridge hook compatibility
        window.shopify = app;

        logger.log('✅ [SHOPIFY] App Bridge initialized successfully');

        // Generate session token
        await generateToken(app);

        setIsReady(true);
      } catch (error) {
        logger.error('❌ [SHOPIFY] Error initializing App Bridge:', error);
        setIsReady(true); // Still render the app even if initialization fails
      }
    };

    const generateToken = async (app: ClientApplication<any>) => {
      try {
        logger.log('🔑 [SHOPIFY] Generating session token...');
        const token = await getSessionToken(app);

        if (token) {
          logger.log('✅ [SHOPIFY] Token generated via NPM Provider');
          localStorage.setItem('shopify_session_token', token);
        } else {
          logger.warn('⚠️ [SHOPIFY] Token is empty');
        }
      } catch (error) {
        logger.error('❌ [SHOPIFY] Error generating token:', error);
      }
    };

    initializeAppBridge();

    // Setup token refresh interval (every 45 minutes, tokens expire after 1 hour)
    const refreshInterval = setInterval(() => {
      if (appRef.current) {
        logger.log('🔄 [SHOPIFY] Refreshing session token...');
        generateToken(appRef.current);
      }
    }, 45 * 60 * 1000);

    return () => {
      clearInterval(refreshInterval);
    };
  }, []);

  // Always render children, even if not ready (to avoid blocking the app)
  return <>{children}</>;
}
