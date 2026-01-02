import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, Module } from '@/contexts/AuthContext';
import { preserveShopifyParams } from '@/utils/shopifyNavigation';

interface PermissionRouteProps {
  children: React.ReactNode;
  module: Module;
}

/**
 * PermissionRoute - Protects routes based on user permissions
 *
 * Extends PrivateRoute functionality by also checking if the user
 * has access to the specified module based on their role.
 *
 * If user doesn't have permission, redirects to dashboard.
 */
export function PermissionRoute({ children, module }: PermissionRouteProps) {
  const { user, loading, permissions } = useAuth();
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
    const loginPath = preserveShopifyParams('/login');
    return <Navigate to={loginPath} state={{ from: location }} replace />;
  }

  // Check module permission
  if (!permissions.canAccessModule(module)) {
    console.warn(`[PermissionRoute] Access denied to ${module} for role ${permissions.currentRole}`);
    // Redirect to dashboard - they don't have permission for this module
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
