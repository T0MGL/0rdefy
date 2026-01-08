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
import { useEffect, useState } from 'react';
import { useAuth, Role } from '@/contexts/AuthContext';

interface DemoTourProps {
  autoStart?: boolean;
}

export function DemoTour({ autoStart = true }: DemoTourProps) {
  const { isActive, hasCompletedTour, startTour } = useDemoTour();
  const { permissions, currentStore } = useAuth();
  const [hasTriggeredStart, setHasTriggeredStart] = useState(false);

  // Auto-start tour for new users
  useEffect(() => {
    if (!autoStart || hasTriggeredStart || hasCompletedTour || isActive) return;
    if (!currentStore) return;

    // Check if onboarding was just completed
    const onboardingCompleted = localStorage.getItem('onboarding_completed');
    const tourStarted = localStorage.getItem('ordefy_demo_tour_id');

    if (onboardingCompleted === 'true' && !tourStarted) {
      // Delay to let dashboard render
      const timer = setTimeout(() => {
        const tourId = permissions.currentRole === Role.OWNER ? 'owner-tour' : `${permissions.currentRole}-tour`;
        startTour(tourId, true); // true = auto-started after registration
        setHasTriggeredStart(true);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [autoStart, hasTriggeredStart, hasCompletedTour, isActive, currentStore, permissions.currentRole, startTour]);

  if (!isActive) return null;

  return (
    <>
      <DemoTourOverlay />
      <DemoTourProgress />
      <DemoTourTooltip />
    </>
  );
}
