/**
 * Route guard for the courier portal.
 *
 * Three states:
 *   1. AuthContext still bootstrapping → render a small spinner.
 *   2. Not authenticated → redirect to /portal/login (preserve intent).
 *   3. Authenticated but not a courier → redirect to /, the admin home.
 *
 * The role check uses currentStore.role rather than user.email or any other
 * derived value, because the same user can be admin in store A and courier in
 * store B in theory; the store the SDK is talking to is the source of truth.
 */

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface PortalGuardProps {
  children: React.ReactNode;
}

function isCourierRole(role: string | undefined | null): boolean {
  return typeof role === 'string' && role.toLowerCase() === 'courier';
}

export function PortalGuard({ children }: PortalGuardProps) {
  const { user, currentStore, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Cargando portal...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Navigate
        to="/portal/login"
        state={{ from: location }}
        replace
      />
    );
  }

  // Courier role lives on user_stores, surfaced via currentStore.role.
  // If the active store doesn't say "courier", redirect them out of the portal.
  if (!isCourierRole(currentStore?.role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
