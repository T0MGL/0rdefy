// ================================================================
// SHOPIFY APP BRIDGE PROVIDER
// ================================================================
// Initializes Shopify App Bridge 3.0 and generates session token
// Only runs when app is embedded in Shopify
// ================================================================

import { useEffect } from 'react';
import { useShopifyAppBridge } from '@/hooks/useShopifyAppBridge';

export function ShopifyAppBridgeProvider({ children }: { children: React.ReactNode }) {
  const { sessionToken, isLoading, error, app } = useShopifyAppBridge();

  useEffect(() => {
    if (sessionToken) {
      console.log('✅ [SHOPIFY-PROVIDER] Session token obtained successfully');
      console.log('🔑 [SHOPIFY-PROVIDER] Token length:', sessionToken.length);
      console.log('📦 [SHOPIFY-PROVIDER] App instance available:', !!app);
    }
  }, [sessionToken, app]);

  useEffect(() => {
    if (error) {
      console.error('❌ [SHOPIFY-PROVIDER] App Bridge initialization error:', error);
    }
  }, [error]);

  useEffect(() => {
    if (isLoading) {
      console.log('⏳ [SHOPIFY-PROVIDER] Initializing App Bridge...');
    } else {
      console.log('✅ [SHOPIFY-PROVIDER] App Bridge initialization complete');
    }
  }, [isLoading]);

  // Always render children - App Bridge is optional and only for embedded mode
  return <>{children}</>;
}
