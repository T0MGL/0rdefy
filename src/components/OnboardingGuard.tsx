import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { preserveShopifyParams } from '@/utils/shopifyNavigation';
import { logger } from '@/utils/logger';

export function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading, onboardingCompleted, currentStore } = useAuth();

  useEffect(() => {
    // Don't do anything while auth is loading
    if (loading) {
      return;
    }

    // Allow access to public pages without restrictions.
    // The store-setup onboarding is an owner-only flow: couriers have no store
    // to configure, and the embedded courier portal has its own login + guard.
    // Gating /portal/* here would bounce authenticated couriers into the
    // store-setup form. Keep this exempt list in sync with the role-based
    // redirect in AuthContext (isPublicSafe / isPortalRoute).
    const path = location.pathname;
    const isExempt =
      path === '/login' ||
      path === '/signup' ||
      path.startsWith('/forgot-password') ||
      path.startsWith('/reset-password') ||
      path === '/portal' ||
      path.startsWith('/portal/') ||
      path.startsWith('/i/') ||
      path.startsWith('/accept-invite/') ||
      path.startsWith('/delivery/') ||
      path.startsWith('/r/') ||
      path.startsWith('/wrapped/') ||
      path === '/shopify-oauth-callback';
    if (isExempt) {
      return;
    }

    // If user is not authenticated, don't check onboarding
    // Let PrivateRoute handle the redirect to login
    if (!user) {
      return;
    }

    // Couriers never run store-setup onboarding: they have no store to configure
    // and AuthContext routes them to /portal/*. Belt-and-suspenders with the
    // exempt list above so a courier briefly landing on an admin route before the
    // role redirect fires is never bounced into the store-setup form.
    if (currentStore?.role?.toLowerCase() === 'courier') {
      return;
    }

    // Source of truth is the AuthContext-derived flag (backend verdict + role),
    // NOT a fragile standalone localStorage key. This survives cold starts.
    const onboardingPaths = ['/onboarding', '/onboarding/plan'];

    // If authenticated but not completed onboarding and not on onboarding pages
    if (!onboardingCompleted && !onboardingPaths.includes(location.pathname)) {
      logger.log('🔄 [OnboardingGuard] User authenticated but onboarding not completed, redirecting to /onboarding');
      const pathWithShopifyParams = preserveShopifyParams('/onboarding');
      navigate(pathWithShopifyParams, { replace: true });
    }

    // If completed and on onboarding page (but not plan selection), redirect to dashboard
    if (onboardingCompleted && location.pathname === '/onboarding') {
      logger.log('✅ [OnboardingGuard] Onboarding already completed, redirecting to dashboard');
      const pathWithShopifyParams = preserveShopifyParams('/');
      navigate(pathWithShopifyParams, { replace: true });
    }
  }, [navigate, location.pathname, user, loading, onboardingCompleted, currentStore?.role]);

  return <>{children}</>;
}
