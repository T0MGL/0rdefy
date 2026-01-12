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
  VISIT_COUNTS: 'ordefy_module_visit_counts',
  FIRST_ACTIONS: 'ordefy_module_first_actions',
};

// Maximum visits before auto-hiding tips
const MAX_VISITS_BEFORE_HIDE = 3;

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
 * Check if tip should be shown for a module
 * Combines 3 conditions:
 * A) Not manually dismissed
 * B) Less than 3 visits
 * C) No first action completed
 */
export function shouldShowTip(moduleId: string): boolean {
  // A) Check if manually dismissed
  const dismissed = getDismissedModules();
  if (dismissed.includes(moduleId)) {
    return false;
  }

  // B) Check visit count (max 3)
  const visitCount = getModuleVisitCount(moduleId);
  if (visitCount >= MAX_VISITS_BEFORE_HIDE) {
    return false;
  }

  // C) Check if first action completed
  const actionsCompleted = getCompletedActions();
  if (actionsCompleted.includes(moduleId)) {
    return false;
  }

  return true;
}

/**
 * Legacy function for backwards compatibility
 */
export function isFirstVisitToModule(moduleId: string): boolean {
  return shouldShowTip(moduleId);
}

/**
 * Increment visit count for a module
 */
export function incrementVisitCount(moduleId: string): number {
  const counts = getVisitCounts();
  counts[moduleId] = (counts[moduleId] || 0) + 1;
  localStorage.setItem(STORAGE_KEYS.VISIT_COUNTS, JSON.stringify(counts));
  return counts[moduleId];
}

/**
 * Get visit count for a specific module
 */
export function getModuleVisitCount(moduleId: string): number {
  const counts = getVisitCounts();
  return counts[moduleId] || 0;
}

/**
 * Get all visit counts
 */
function getVisitCounts(): Record<string, number> {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.VISIT_COUNTS);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

/**
 * Mark a module tip as manually dismissed (X button)
 */
export async function dismissModuleTip(moduleId: string): Promise<void> {
  const dismissed = getDismissedModules();
  if (!dismissed.includes(moduleId)) {
    dismissed.push(moduleId);
    localStorage.setItem(STORAGE_KEYS.FIRST_VISIT, JSON.stringify(dismissed));
    // Also persist to server
    try {
      await apiClient.post('/onboarding/visit-module', { moduleId });
    } catch (error) {
      console.error('Error dismissing module tip on server:', error);
    }
  }
}

/**
 * Legacy function - now dismisses the tip
 */
export async function markModuleVisited(moduleId: string): Promise<void> {
  await dismissModuleTip(moduleId);
}

/**
 * Get list of manually dismissed modules
 */
export function getDismissedModules(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.FIRST_VISIT);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Legacy function for backwards compatibility
 */
export function getVisitedModules(): string[] {
  return getDismissedModules();
}

/**
 * Mark first action completed for a module
 * Call this when user creates their first item (return session, dispatch, etc.)
 */
export function markFirstActionCompleted(moduleId: string): void {
  const actions = getCompletedActions();
  if (!actions.includes(moduleId)) {
    actions.push(moduleId);
    localStorage.setItem(STORAGE_KEYS.FIRST_ACTIONS, JSON.stringify(actions));
  }
}

/**
 * Get list of modules where first action was completed
 */
export function getCompletedActions(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.FIRST_ACTIONS);
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
  localStorage.removeItem(STORAGE_KEYS.VISIT_COUNTS);
  localStorage.removeItem(STORAGE_KEYS.FIRST_ACTIONS);
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
  // New combined logic
  shouldShowTip,
  incrementVisitCount,
  getModuleVisitCount,
  dismissModuleTip,
  markFirstActionCompleted,
  getCompletedActions,
  // Legacy functions (backwards compatible)
  isFirstVisit: isFirstVisitToModule,
  markVisited: markModuleVisited,
  getVisitedModules,
  resetFirstVisits,
};

export default onboardingService;
