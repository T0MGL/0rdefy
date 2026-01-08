import { useEffect, useCallback } from 'react';
import { useOnboardingTour } from '@/contexts/OnboardingTourContext';

/**
 * Hook to control sidebar state during onboarding tour
 * Ensures sidebar is expanded and correct sections are open when tour targets sidebar elements
 */
export function useTourSidebarControl(
  sidebarCollapsed: boolean,
  setSidebarCollapsed: (collapsed: boolean) => void
) {
  const { isActive, currentTour, currentStepIndex } = useOnboardingTour();

  const currentStep = currentTour?.steps[currentStepIndex];

  useEffect(() => {
    if (!isActive || !currentStep) return;

    // Check if current step targets a sidebar element
    const isSidebarStep = currentStep.target.includes('sidebar-');

    if (isSidebarStep && sidebarCollapsed) {
      // Expand sidebar with a small delay for smooth animation
      setTimeout(() => {
        setSidebarCollapsed(false);
      }, 100);
    }

    // Expand the correct sidebar section
    if (isSidebarStep) {
      // Map step IDs to section labels
      const sectionMap: Record<string, string> = {
        'sidebar-dashboard': 'Dashboards',
        'sidebar-orders': 'Ventas',
        'sidebar-warehouse': 'Logística',
        'sidebar-products': 'Inventario',
        'sidebar-integrations': 'Gestión',
      };

      const sectionLabel = sectionMap[currentStep.id];

      if (sectionLabel) {
        // Dispatch custom event to expand section
        window.dispatchEvent(
          new CustomEvent('expandSidebarSection', {
            detail: { section: sectionLabel },
          })
        );
      }
    }
  }, [isActive, currentStep, sidebarCollapsed, setSidebarCollapsed]);

  return null;
}

/**
 * Event listener for sidebar section expansion
 * Add this to Sidebar component
 */
export function useSidebarSectionExpander(
  expandedSections: string[],
  setExpandedSections: (sections: string[]) => void
) {
  useEffect(() => {
    const handleExpandSection = (event: CustomEvent<{ section: string }>) => {
      const { section } = event.detail;

      if (!expandedSections.includes(section)) {
        setExpandedSections([...expandedSections, section]);
      }
    };

    window.addEventListener(
      'expandSidebarSection',
      handleExpandSection as EventListener
    );

    return () => {
      window.removeEventListener(
        'expandSidebarSection',
        handleExpandSection as EventListener
      );
    };
  }, [expandedSections, setExpandedSections]);
}
