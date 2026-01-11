/**
 * Onboarding Service
 * Tracks user setup progress and provides checklist data
 */

import apiClient from './api.client';

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  route?: string;
  priority: number;
  category: 'setup' | 'integration' | 'operation';
}

export interface OnboardingProgress {
  steps: OnboardingStep[];
  completedCount: number;
  totalCount: number;
  percentage: number;
  isComplete: boolean;
  hasShopify: boolean;
  hasDismissed: boolean;
}

// Storage keys
const STORAGE_KEYS = {
  DISMISSED: 'ordefy_onboarding_dismissed',
  FIRST_VISIT: 'ordefy_first_visit_modules',
};

/**
 * Get onboarding progress from API
 */
export async function getOnboardingProgress(): Promise<OnboardingProgress> {
  try {
    const response = await apiClient.get('/onboarding/progress');
    const data = response.data;

    return {
      ...data,
      hasDismissed: localStorage.getItem(STORAGE_KEYS.DISMISSED) === 'true',
    };
  } catch (error) {
    console.error('Error fetching onboarding progress:', error);
    // Return default progress if API fails
    return getDefaultProgress();
  }
}

/**
 * Mark onboarding as dismissed (user chose to hide checklist)
 */
export async function dismissOnboarding(): Promise<void> {
  localStorage.setItem(STORAGE_KEYS.DISMISSED, 'true');
  // Also persist to server
  try {
    await apiClient.post('/onboarding/dismiss');
  } catch (error) {
    console.error('Error dismissing onboarding on server:', error);
  }
}

/**
 * Reset onboarding dismissal (show checklist again)
 */
export function resetOnboardingDismissal(): void {
  localStorage.removeItem(STORAGE_KEYS.DISMISSED);
}

/**
 * Check if this is the first visit to a specific module
 */
export function isFirstVisitToModule(moduleId: string): boolean {
  const visited = getVisitedModules();
  return !visited.includes(moduleId);
}

/**
 * Mark a module as visited
 */
export async function markModuleVisited(moduleId: string): Promise<void> {
  const visited = getVisitedModules();
  if (!visited.includes(moduleId)) {
    visited.push(moduleId);
    localStorage.setItem(STORAGE_KEYS.FIRST_VISIT, JSON.stringify(visited));
    // Also persist to server
    try {
      await apiClient.post('/onboarding/visit-module', { moduleId });
    } catch (error) {
      console.error('Error marking module visited on server:', error);
    }
  }
}

/**
 * Get list of visited modules
 */
export function getVisitedModules(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.FIRST_VISIT);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Reset first-visit tracking (for testing)
 */
export function resetFirstVisits(): void {
  localStorage.removeItem(STORAGE_KEYS.FIRST_VISIT);
}

/**
 * Default progress when API is unavailable
 */
function getDefaultProgress(): OnboardingProgress {
  return {
    steps: [],
    completedCount: 0,
    totalCount: 0,
    percentage: 0,
    isComplete: false,
    hasShopify: false,
    hasDismissed: localStorage.getItem(STORAGE_KEYS.DISMISSED) === 'true',
  };
}

export const onboardingService = {
  getProgress: getOnboardingProgress,
  dismiss: dismissOnboarding,
  resetDismissal: resetOnboardingDismissal,
  isFirstVisit: isFirstVisitToModule,
  markVisited: markModuleVisited,
  getVisitedModules,
  resetFirstVisits,
};

export default onboardingService;
