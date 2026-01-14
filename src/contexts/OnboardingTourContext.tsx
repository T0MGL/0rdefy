import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';

// Tour step definition
export interface TourStep {
  id: string;
  target: string; // CSS selector for the element to highlight
  title: string;
  description: string;
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  action?: {
    label: string;
    onClick: () => void;
  };
  spotlightPadding?: number;
  // Optional: navigate to a specific route before showing this step
  navigateTo?: string;
  // Optional: wait for element to be visible
  waitForElement?: boolean;
  // Optional: highlight multiple elements
  highlightElements?: string[];
}

// Tour definition
export interface Tour {
  id: string;
  name: string;
  steps: TourStep[];
}

// Context state
interface OnboardingTourState {
  isActive: boolean;
  currentTour: Tour | null;
  currentStepIndex: number;
  hasCompletedTour: boolean;
  isTransitioning: boolean;
  justFinished: 'completed' | 'skipped' | null; // Track how tour ended
}

// Context actions
interface OnboardingTourActions {
  startTour: (tour: Tour) => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTour: () => void;
  completeTour: () => void;
  goToStep: (index: number) => void;
  resetTour: () => void;
  clearJustFinished: () => void;
}

type OnboardingTourContextType = OnboardingTourState & OnboardingTourActions;

const OnboardingTourContext = createContext<OnboardingTourContextType | null>(null);

// Storage key for persisting tour completion
const TOUR_COMPLETED_KEY = 'ordefy_onboarding_tour_completed';
const TOUR_SKIPPED_KEY = 'ordefy_onboarding_tour_skipped';

interface OnboardingTourProviderProps {
  children: ReactNode;
}

export function OnboardingTourProvider({ children }: OnboardingTourProviderProps) {
  const [state, setState] = useState<OnboardingTourState>({
    isActive: false,
    currentTour: null,
    currentStepIndex: 0,
    hasCompletedTour: false,
    isTransitioning: false,
    justFinished: null,
  });

  // Track transition timeouts for cleanup on unmount
  const transitionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup transition timeout on unmount
  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, []);

  // Check if tour was already completed on mount
  useEffect(() => {
    const completed = localStorage.getItem(TOUR_COMPLETED_KEY);
    const skipped = localStorage.getItem(TOUR_SKIPPED_KEY);
    if (completed === 'true' || skipped === 'true') {
      setState(prev => ({ ...prev, hasCompletedTour: true }));
    }
  }, []);

  const startTour = useCallback((tour: Tour) => {
    setState(prev => ({
      ...prev,
      isActive: true,
      currentTour: tour,
      currentStepIndex: 0,
      isTransitioning: false,
    }));
  }, []);

  const nextStep = useCallback(() => {
    setState(prev => {
      if (!prev.currentTour) return prev;

      const nextIndex = prev.currentStepIndex + 1;

      // If we've completed all steps
      if (nextIndex >= prev.currentTour.steps.length) {
        localStorage.setItem(TOUR_COMPLETED_KEY, 'true');
        return {
          ...prev,
          isActive: false,
          currentTour: null,
          currentStepIndex: 0,
          hasCompletedTour: true,
          isTransitioning: false,
          justFinished: 'completed',
        };
      }

      return {
        ...prev,
        currentStepIndex: nextIndex,
        isTransitioning: true,
      };
    });

    // Clear previous timeout if exists
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
    }

    // Reset transitioning state after animation
    transitionTimeoutRef.current = setTimeout(() => {
      setState(prev => ({ ...prev, isTransitioning: false }));
      transitionTimeoutRef.current = null;
    }, 300);
  }, []);

  const prevStep = useCallback(() => {
    setState(prev => {
      if (!prev.currentTour || prev.currentStepIndex === 0) return prev;

      return {
        ...prev,
        currentStepIndex: prev.currentStepIndex - 1,
        isTransitioning: true,
      };
    });

    // Clear previous timeout if exists
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
    }

    // Reset transitioning state after animation
    transitionTimeoutRef.current = setTimeout(() => {
      setState(prev => ({ ...prev, isTransitioning: false }));
      transitionTimeoutRef.current = null;
    }, 300);
  }, []);

  const skipTour = useCallback(() => {
    localStorage.setItem(TOUR_SKIPPED_KEY, 'true');
    setState(prev => ({
      ...prev,
      isActive: false,
      currentTour: null,
      currentStepIndex: 0,
      hasCompletedTour: true,
      isTransitioning: false,
      justFinished: 'skipped',
    }));
  }, []);

  const completeTour = useCallback(() => {
    localStorage.setItem(TOUR_COMPLETED_KEY, 'true');
    setState(prev => ({
      ...prev,
      isActive: false,
      currentTour: null,
      currentStepIndex: 0,
      hasCompletedTour: true,
      isTransitioning: false,
      justFinished: 'completed',
    }));
  }, []);

  const clearJustFinished = useCallback(() => {
    setState(prev => ({ ...prev, justFinished: null }));
  }, []);

  const goToStep = useCallback((index: number) => {
    setState(prev => {
      if (!prev.currentTour || index < 0 || index >= prev.currentTour.steps.length) {
        return prev;
      }

      return {
        ...prev,
        currentStepIndex: index,
        isTransitioning: true,
      };
    });

    // Clear previous timeout if exists
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
    }

    // Reset transitioning state after animation
    transitionTimeoutRef.current = setTimeout(() => {
      setState(prev => ({ ...prev, isTransitioning: false }));
      transitionTimeoutRef.current = null;
    }, 300);
  }, []);

  const resetTour = useCallback(() => {
    localStorage.removeItem(TOUR_COMPLETED_KEY);
    localStorage.removeItem(TOUR_SKIPPED_KEY);
    localStorage.removeItem('ordefy_onboarding_tour_started');
    setState({
      isActive: false,
      currentTour: null,
      currentStepIndex: 0,
      hasCompletedTour: false,
      isTransitioning: false,
      justFinished: null,
    });
  }, []);

  const value: OnboardingTourContextType = {
    ...state,
    startTour,
    nextStep,
    prevStep,
    skipTour,
    completeTour,
    goToStep,
    resetTour,
    clearJustFinished,
  };

  return (
    <OnboardingTourContext.Provider value={value}>
      {children}
    </OnboardingTourContext.Provider>
  );
}

export function useOnboardingTour() {
  const context = useContext(OnboardingTourContext);
  if (!context) {
    throw new Error('useOnboardingTour must be used within an OnboardingTourProvider');
  }
  return context;
}

// Helper hook to get current step
export function useCurrentTourStep() {
  const { currentTour, currentStepIndex, isActive } = useOnboardingTour();

  if (!isActive || !currentTour) return null;

  return currentTour.steps[currentStepIndex];
}

// Helper hook to check if a specific element is highlighted
export function useIsHighlighted(selector: string) {
  const step = useCurrentTourStep();

  if (!step) return false;

  return step.target === selector || step.highlightElements?.includes(selector);
}
