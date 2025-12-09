import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { preserveShopifyParams } from '@/utils/shopifyNavigation';

interface PrivateRouteProps {
  children: React.ReactNode;
}

export function PrivateRoute({ children }: PrivateRouteProps) {
  const { user, loading } = useAuth();
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
    // Redirect to login but save the attempted location
    // Preserve Shopify query parameters (shop, host, embedded) for App Bridge
    const loginPath = preserveShopifyParams('/login');
    return <Navigate to={loginPath} state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
