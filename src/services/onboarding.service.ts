/**
 * Onboarding Service
 * Tracks user setup progress and provides checklist data
 *
 * IMPORTANT: This service now uses database-backed tracking for proper
 * multi-user support. LocalStorage is only used as a fallback/cache.
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
  visitedModules?: string[];
  userRole?: string;
}

// Storage keys (used as fallback cache only)
const STORAGE_KEYS = {
  DISMISSED: 'ordefy_onboarding_dismissed',
  FIRST_VISIT: 'ordefy_first_visit_modules',
  VISIT_COUNTS: 'ordefy_module_visit_counts',
  FIRST_ACTIONS: 'ordefy_module_first_actions',
  // Cache for DB-backed data
  PROGRESS_CACHE: 'ordefy_onboarding_progress_cache',
};

// Maximum visits before auto-hiding tips
const MAX_VISITS_BEFORE_HIDE = 3;

// Cache for progress data to avoid repeated API calls
let progressCache: OnboardingProgress | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30000; // 30 seconds

/**
 * Get onboarding progress from API
 * Now uses database-backed hasDismissed and visitedModules
 */
export async function getOnboardingProgress(): Promise<OnboardingProgress> {
  // Return cached data if fresh
  if (progressCache && Date.now() - cacheTimestamp < CACHE_TTL) {
    return progressCache;
  }

  try {
    const response = await apiClient.get('/onboarding/progress');
    const data = response.data;

    // Use database value for hasDismissed (not LocalStorage)
    progressCache = {
      ...data,
      // hasDismissed comes from database now, not LocalStorage
      hasDismissed: data.hasDismissed ?? false,
    };
    cacheTimestamp = Date.now();

    // Sync to local cache for offline fallback
    try {
      localStorage.setItem(STORAGE_KEYS.PROGRESS_CACHE, JSON.stringify(progressCache));
    } catch {
      // localStorage might be full or unavailable
    }

    return progressCache;
  } catch (error) {
    console.error('Error fetching onboarding progress:', error);

    // Try to use cached data from localStorage
    try {
      const cached = localStorage.getItem(STORAGE_KEYS.PROGRESS_CACHE);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // Ignore parse errors
    }

    // Return default progress if all else fails
    return getDefaultProgress();
  }
}

/**
 * Invalidate progress cache (call after mutations)
 */
export function invalidateProgressCache(): void {
  progressCache = null;
  cacheTimestamp = 0;
}

/**
 * Mark onboarding as dismissed (user chose to hide checklist)
 * Now persists to database, not just localStorage
 */
export async function dismissOnboarding(): Promise<void> {
  // Persist to server (primary source of truth)
  try {
    await apiClient.post('/onboarding/dismiss');
    invalidateProgressCache();
  } catch (error) {
    console.error('Error dismissing onboarding on server:', error);
    // Fallback to localStorage for offline scenarios
    localStorage.setItem(STORAGE_KEYS.DISMISSED, 'true');
  }
}

/**
 * Reset onboarding dismissal (show checklist again)
 */
export async function resetOnboardingDismissal(): Promise<void> {
  localStorage.removeItem(STORAGE_KEYS.DISMISSED);
  invalidateProgressCache();
  // Note: Would need a server endpoint to reset DB value
  try {
    await apiClient.post('/onboarding/reset');
  } catch {
    // Non-critical, just invalidate cache
  }
}

/**
 * Check if tip should be shown for a module
 * Uses database-backed tracking for proper multi-user support
 */
export function shouldShowTip(moduleId: string): boolean {
  // A) Check if manually dismissed (from cached progress)
  if (progressCache?.visitedModules?.includes(moduleId)) {
    return false;
  }

  // Fallback to localStorage for dismissed modules
  const dismissed = getDismissedModulesLocal();
  if (dismissed.includes(moduleId)) {
    return false;
  }

  // B) Check visit count (max 3)
  const visitCount = getModuleVisitCountLocal(moduleId);
  if (visitCount >= MAX_VISITS_BEFORE_HIDE) {
    return false;
  }

  // C) Check if first action completed
  const actionsCompleted = getCompletedActionsLocal();
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
 * Persists to both localStorage (immediate) and server (durable)
 */
export async function incrementVisitCount(moduleId: string): Promise<number> {
  // Update localStorage immediately for responsive UI
  const counts = getVisitCountsLocal();
  counts[moduleId] = (counts[moduleId] || 0) + 1;
  localStorage.setItem(STORAGE_KEYS.VISIT_COUNTS, JSON.stringify(counts));

  // Also persist to server (fire-and-forget)
  try {
    await apiClient.post('/onboarding/increment-visit', { moduleId });
  } catch {
    // Non-critical, localStorage is the fallback
  }

  return counts[moduleId];
}

/**
 * Get visit count for a specific module (from localStorage cache)
 */
export function getModuleVisitCount(moduleId: string): number {
  return getModuleVisitCountLocal(moduleId);
}

/**
 * Get visit count from localStorage
 */
function getModuleVisitCountLocal(moduleId: string): number {
  const counts = getVisitCountsLocal();
  return counts[moduleId] || 0;
}

/**
 * Get all visit counts from localStorage
 */
function getVisitCountsLocal(): Record<string, number> {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.VISIT_COUNTS);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

/**
 * Mark a module tip as manually dismissed (X button)
 * Persists to both localStorage and server
 */
export async function dismissModuleTip(moduleId: string): Promise<void> {
  // Update localStorage immediately
  const dismissed = getDismissedModulesLocal();
  if (!dismissed.includes(moduleId)) {
    dismissed.push(moduleId);
    localStorage.setItem(STORAGE_KEYS.FIRST_VISIT, JSON.stringify(dismissed));
  }

  // Persist to server
  try {
    await apiClient.post('/onboarding/visit-module', { moduleId });
    invalidateProgressCache();
  } catch (error) {
    console.error('Error dismissing module tip on server:', error);
  }
}

/**
 * Legacy function - now dismisses the tip
 */
export async function markModuleVisited(moduleId: string): Promise<void> {
  await dismissModuleTip(moduleId);
}

/**
 * Get list of manually dismissed modules from localStorage
 */
function getDismissedModulesLocal(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.FIRST_VISIT);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Get dismissed modules (combines DB + localStorage)
 */
export function getDismissedModules(): string[] {
  const local = getDismissedModulesLocal();
  const fromProgress = progressCache?.visitedModules || [];
  // Merge and dedupe
  return [...new Set([...local, ...fromProgress])];
}

/**
 * Legacy function for backwards compatibility
 */
export function getVisitedModules(): string[] {
  return getDismissedModules();
}

/**
 * Mark first action completed for a module
 * Persists to both localStorage and server
 */
export async function markFirstActionCompleted(moduleId: string): Promise<void> {
  // Update localStorage immediately
  const actions = getCompletedActionsLocal();
  if (!actions.includes(moduleId)) {
    actions.push(moduleId);
    localStorage.setItem(STORAGE_KEYS.FIRST_ACTIONS, JSON.stringify(actions));
  }

  // Persist to server (fire-and-forget)
  try {
    await apiClient.post('/onboarding/first-action', { moduleId });
  } catch {
    // Non-critical
  }
}

/**
 * Get list of modules where first action was completed (from localStorage)
 */
function getCompletedActionsLocal(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.FIRST_ACTIONS);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Get completed actions
 */
export function getCompletedActions(): string[] {
  return getCompletedActionsLocal();
}

/**
 * Reset first-visit tracking (for testing)
 */
export async function resetFirstVisits(): Promise<void> {
  localStorage.removeItem(STORAGE_KEYS.FIRST_VISIT);
  localStorage.removeItem(STORAGE_KEYS.VISIT_COUNTS);
  localStorage.removeItem(STORAGE_KEYS.FIRST_ACTIONS);
  localStorage.removeItem(STORAGE_KEYS.PROGRESS_CACHE);
  invalidateProgressCache();

  try {
    await apiClient.post('/onboarding/reset');
  } catch {
    // Non-critical
  }
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
    hasDismissed: false,
    visitedModules: [],
  };
}

export const onboardingService = {
  getProgress: getOnboardingProgress,
  dismiss: dismissOnboarding,
  resetDismissal: resetOnboardingDismissal,
  invalidateCache: invalidateProgressCache,
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
