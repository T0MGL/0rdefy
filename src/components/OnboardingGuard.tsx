import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { preserveShopifyParams } from '@/utils/shopifyNavigation';

export function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading } = useAuth();

  useEffect(() => {
    // Don't do anything while auth is loading
    if (loading) {
      return;
    }

    // Allow access to public pages without restrictions
    const publicPaths = ['/login', '/signup'];
    if (publicPaths.includes(location.pathname)) {
      return;
    }

    // If user is not authenticated, don't check onboarding
    // Let PrivateRoute handle the redirect to login
    if (!user) {
      return;
    }

    // Check if onboarding is completed
    const isOnboardingCompleted = localStorage.getItem('onboarding_completed');

    // If authenticated but not completed onboarding and not on onboarding page
    if (!isOnboardingCompleted && location.pathname !== '/onboarding') {
      console.log('🔄 [OnboardingGuard] User authenticated but onboarding not completed, redirecting to /onboarding');
      const pathWithShopifyParams = preserveShopifyParams('/onboarding');
      navigate(pathWithShopifyParams, { replace: true });
    }

    // If completed and on onboarding page, redirect to dashboard
    if (isOnboardingCompleted && location.pathname === '/onboarding') {
      console.log('✅ [OnboardingGuard] Onboarding already completed, redirecting to dashboard');
      const pathWithShopifyParams = preserveShopifyParams('/');
      navigate(pathWithShopifyParams, { replace: true });
    }
  }, [navigate, location.pathname, user, loading]);

  return <>{children}</>;
}
