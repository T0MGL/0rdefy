import * as Sentry from '@sentry/react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { isShopifyEmbedded, preserveShopifyParams } from '@/utils/shopifyNavigation';
import { ShopifyConnectingScreen } from '@/components/ShopifyConnectingScreen';

interface PrivateRouteProps {
  children: React.ReactNode;
}

export function PrivateRoute({ children }: PrivateRouteProps) {
  const { user, loading, shopifyAuthInProgress } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
          <p className="text-muted-foreground">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    const embedded = isShopifyEmbedded();
    const shop = new URLSearchParams(location.search).get('shop');

    Sentry.addBreadcrumb({
      category: 'shopify',
      message: 'PrivateRoute.unauthenticated',
      level: 'info',
      data: {
        embedded,
        shopifyAuthInProgress,
        shop,
        path: location.pathname,
      },
    });

    if (embedded) {
      // Inside the Shopify iframe we never bounce to /login: the
      // App Store reviewer would see the vanilla form and trip 2.1.1.
      // While the Token Exchange handshake is running, show the
      // connecting screen; if it already finished without producing a
      // user, surface the auth_failed fallback so the reviewer can
      // retry or break out to a top-level tab.
      if (shopifyAuthInProgress) {
        return <ShopifyConnectingScreen />;
      }
      return <ShopifyConnectingScreen error="auth_failed" />;
    }

    // Standalone: original behaviour. Preserve Shopify query parameters
    // (shop, host, embedded) so /login can still surface a connecting
    // screen if the iframe context is detected late.
    const loginPath = preserveShopifyParams('/login');
    return <Navigate to={loginPath} state={{ from: location }} replace />;
  }

  Sentry.addBreadcrumb({
    category: 'shopify',
    message: 'PrivateRoute.authenticated',
    level: 'info',
    data: {
      embedded: isShopifyEmbedded(),
      path: location.pathname,
    },
  });

  return <>{children}</>;
}
