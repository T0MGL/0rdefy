// Demo Tour System
// A complete interactive onboarding experience for Ordefy

export { DemoTourProvider, useDemoTour, useIsDemoStep } from './DemoTourProvider';
export type { DemoData, DemoTourStep, TourPath } from './DemoTourProvider';

export { DemoTourOverlay } from './DemoTourOverlay';
export { DemoTourProgress } from './DemoTourProgress';
export { DemoTourTooltip } from './DemoTourTooltip';

// Main DemoTour component that wraps all pieces
import { DemoTourOverlay } from './DemoTourOverlay';
import { DemoTourProgress } from './DemoTourProgress';
import { DemoTourTooltip } from './DemoTourTooltip';
import { useDemoTour } from './DemoTourProvider';
import { useEffect, useRef } from 'react';
import { useAuth, Role } from '@/contexts/AuthContext';
import { useLocation } from 'react-router-dom';
import { logger } from '@/utils/logger';

// Storage key for tracking if we need to start tour (set after onboarding/invitation)
const TOUR_PENDING_KEY = 'ordefy_demo_tour_pending';

interface DemoTourProps {
  autoStart?: boolean;
}

export function DemoTour({ autoStart = true }: DemoTourProps) {
  const { isActive, hasCompletedTour, startTour } = useDemoTour();
  const { permissions, currentStore, loading: authLoading } = useAuth();
  const location = useLocation();
  const hasTriggeredRef = useRef(false);

  // Auto-start tour for new users
  // Only triggers when:
  // 1. autoStart is enabled
  // 2. User hasn't already completed the tour
  // 3. Tour is not currently active
  // 4. Store is loaded
  // 5. Auth is not loading
  // 6. We're on a dashboard route (not during onboarding flow)
  // 7. There's a pending tour flag set after onboarding/invitation
  useEffect(() => {
    // Don't run while auth is still loading
    if (authLoading) {
      logger.log('[DemoTour] Skipping - auth still loading');
      return;
    }

    // Early returns for conditions that prevent starting
    if (!autoStart) {
      logger.log('[DemoTour] Skipping - autoStart disabled');
      return;
    }
    if (hasCompletedTour) {
      logger.log('[DemoTour] Skipping - tour already completed');
      return;
    }
    if (isActive) {
      logger.log('[DemoTour] Skipping - tour already active');
      return;
    }
    if (!currentStore) {
      logger.log('[DemoTour] Skipping - no store loaded');
      return;
    }
    if (hasTriggeredRef.current) {
      logger.log('[DemoTour] Skipping - already triggered in this session');
      return;
    }

    // Don't start tour during onboarding flow
    const onboardingPaths = ['/onboarding', '/onboarding/plan', '/login', '/signup'];
    if (onboardingPaths.some(path => location.pathname.startsWith(path))) {
      logger.log('[DemoTour] Skipping - on onboarding/auth path:', location.pathname);
      return;
    }

    // Check if there's a pending tour to start
    // This flag is set by:
    // 1. OnboardingPlan page after selecting free plan or skipping
    // 2. AcceptInvitation page after collaborator joins
    // 3. Billing page after returning from Stripe (for new users from onboarding)
    const tourPending = localStorage.getItem(TOUR_PENDING_KEY);

    if (tourPending !== 'true') {
      logger.log('[DemoTour] Skipping - no pending tour flag');
      return;
    }

    // Clear the pending flag immediately to prevent re-triggering
    logger.log('[DemoTour] Pending tour flag found, clearing and starting tour...');
    localStorage.removeItem(TOUR_PENDING_KEY);
    hasTriggeredRef.current = true;

    // Small delay to ensure dashboard is fully rendered
    const timer = setTimeout(() => {
      const tourId = permissions.currentRole === Role.OWNER || permissions.currentRole === Role.ADMIN
        ? 'owner-tour'
        : `${permissions.currentRole}-tour`;
      logger.log('[DemoTour] Starting tour:', tourId, 'for role:', permissions.currentRole);
      startTour(tourId, true);
    }, 500);

    return () => clearTimeout(timer);
  }, [autoStart, hasCompletedTour, isActive, currentStore, permissions.currentRole, startTour, location.pathname, authLoading]);

  if (!isActive) return null;

  return (
    <>
      <DemoTourOverlay />
      <DemoTourProgress />
      <DemoTourTooltip />
    </>
  );
}

// Export function to trigger tour pending state
// Call this from Onboarding page or AcceptInvitation page
export function setTourPending() {
  localStorage.setItem(TOUR_PENDING_KEY, 'true');
}
