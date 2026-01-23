/**
 * Onboarding Service
 * Tracks user setup progress and provides checklist data
 *
 * ARCHITECTURE: Database is the single source of truth
 * - All state is persisted to and read from the database
 * - localStorage is ONLY used as offline fallback cache
 * - In-memory cache is keyed by userId+storeId to prevent cross-user pollution
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
  moduleVisitCounts?: Record<string, number>;
  firstActionsCompleted?: string[];
  userRole?: string;
}

// Storage keys for offline fallback only
const STORAGE_KEYS = {
  PROGRESS_CACHE: 'ordefy_onboarding_progress_cache',
  OFFLINE_QUEUE: 'ordefy_onboarding_offline_queue',
};

// Maximum visits before auto-hiding tips
const MAX_VISITS_BEFORE_HIDE = 3;

// Cache configuration - keyed by userId:storeId to prevent cross-user pollution
interface CacheEntry {
  data: OnboardingProgress;
  timestamp: number;
}
const progressCache = new Map<string, CacheEntry>();
const CACHE_TTL = 30000; // 30 seconds

// Module tip state cache - prefetched from API for instant shouldShowTip() calls
interface TipStateCache {
  moduleStates: Map<string, boolean>; // moduleId -> shouldShow
  timestamp: number;
}
const tipStateCache = new Map<string, TipStateCache>(); // keyed by userId:storeId
const TIP_STATE_CACHE_TTL = 60000; // 60 seconds

/**
 * Get cache key for current user/store context
 */
function getCacheKey(): string {
  const userId = localStorage.getItem('user_id') || 'anonymous';
  const storeId = localStorage.getItem('current_store_id') || 'no-store';
  return `${userId}:${storeId}`;
}

/**
 * Get onboarding progress from API
 * Uses database as single source of truth
 */
export async function getOnboardingProgress(): Promise<OnboardingProgress> {
  const cacheKey = getCacheKey();
  const cached = progressCache.get(cacheKey);

  // Return cached data if fresh
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await apiClient.get('/onboarding/progress');
    const data: OnboardingProgress = response.data;

    // Store in memory cache with user-specific key
    progressCache.set(cacheKey, {
      data,
      timestamp: Date.now(),
    });

    // Also store in localStorage for offline fallback
    try {
      localStorage.setItem(
        `${STORAGE_KEYS.PROGRESS_CACHE}_${cacheKey}`,
        JSON.stringify(data)
      );
    } catch {
      // localStorage might be full or unavailable
    }

    // Prefetch tip states for common modules
    prefetchTipStates(['orders', 'products', 'customers', 'warehouse']);

    return data;
  } catch (error) {
    console.error('Error fetching onboarding progress:', error);

    // Try to use cached data from localStorage
    try {
      const cached = localStorage.getItem(`${STORAGE_KEYS.PROGRESS_CACHE}_${cacheKey}`);
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
  const cacheKey = getCacheKey();
  progressCache.delete(cacheKey);
  tipStateCache.delete(cacheKey);
}

/**
 * Mark onboarding as dismissed (user chose to hide checklist)
 * Persists to database, updates local cache optimistically
 */
export async function dismissOnboarding(): Promise<void> {
  const cacheKey = getCacheKey();

  // Optimistic update - update local cache immediately
  const cached = progressCache.get(cacheKey);
  if (cached) {
    cached.data.hasDismissed = true;
    cached.timestamp = Date.now();
  }

  try {
    await apiClient.post('/onboarding/dismiss');
    // Cache already updated optimistically
  } catch (error) {
    console.error('Error dismissing onboarding on server:', error);
    // Revert optimistic update on error
    if (cached) {
      cached.data.hasDismissed = false;
    }
    // Queue for retry when online
    queueOfflineAction({ type: 'dismiss' });
    throw error;
  }
}

/**
 * Reset onboarding dismissal (show checklist again)
 */
export async function resetOnboardingDismissal(): Promise<void> {
  invalidateProgressCache();
  try {
    await apiClient.post('/onboarding/reset');
  } catch {
    // Non-critical
  }
}

/**
 * Prefetch tip states for multiple modules in one API call
 * Uses optimized batch endpoint (single DB query)
 * This enables instant synchronous shouldShowTip() calls
 */
async function prefetchTipStates(moduleIds: string[]): Promise<void> {
  const cacheKey = getCacheKey();

  try {
    // Use batch endpoint for efficiency (1 API call, 1 DB query)
    const response = await apiClient.post('/onboarding/batch-tip-states', { moduleIds });
    const states: Record<string, boolean> = response.data;

    // Update tip state cache
    const moduleStates = new Map<string, boolean>();
    for (const [moduleId, shouldShow] of Object.entries(states)) {
      moduleStates.set(moduleId, shouldShow);
    }

    tipStateCache.set(cacheKey, {
      moduleStates,
      timestamp: Date.now(),
    });
  } catch {
    // Fallback to individual fetches if batch endpoint fails
    try {
      const results = await Promise.all(
        moduleIds.map(async (moduleId) => {
          try {
            const response = await apiClient.get(`/onboarding/should-show-tip/${moduleId}`);
            return { moduleId, shouldShow: response.data.shouldShow };
          } catch {
            return { moduleId, shouldShow: true };
          }
        })
      );

      const moduleStates = new Map<string, boolean>();
      for (const { moduleId, shouldShow } of results) {
        moduleStates.set(moduleId, shouldShow);
      }

      tipStateCache.set(cacheKey, {
        moduleStates,
        timestamp: Date.now(),
      });
    } catch {
      // Non-critical, tips will be fetched individually on demand
    }
  }
}

/**
 * Check if tip should be shown for a module
 * Uses cached API response for instant synchronous calls
 * Falls back to API call if cache miss
 */
export function shouldShowTip(moduleId: string): boolean {
  const cacheKey = getCacheKey();
  const cached = tipStateCache.get(cacheKey);

  // Check prefetched cache first
  if (cached && Date.now() - cached.timestamp < TIP_STATE_CACHE_TTL) {
    const cachedState = cached.moduleStates.get(moduleId);
    if (cachedState !== undefined) {
      return cachedState;
    }
  }

  // Check progress cache for visited modules
  const progressCached = progressCache.get(cacheKey);
  if (progressCached) {
    const progress = progressCached.data;

    // Check if manually dismissed
    if (progress.visitedModules?.includes(moduleId)) {
      return false;
    }

    // Check visit count from DB data
    const visitCount = progress.moduleVisitCounts?.[moduleId] || 0;
    if (visitCount >= MAX_VISITS_BEFORE_HIDE) {
      return false;
    }

    // Check if first action completed
    if (progress.firstActionsCompleted?.includes(moduleId)) {
      return false;
    }
  }

  // Default to showing tip (will be fetched from API async)
  // Trigger async fetch to update cache for next call
  fetchTipStateAsync(moduleId);

  return true;
}

/**
 * Async fetch of tip state to update cache
 */
async function fetchTipStateAsync(moduleId: string): Promise<void> {
  const cacheKey = getCacheKey();

  try {
    const response = await apiClient.get(`/onboarding/should-show-tip/${moduleId}`);
    const shouldShow = response.data.shouldShow;

    // Update cache
    let cached = tipStateCache.get(cacheKey);
    if (!cached) {
      cached = { moduleStates: new Map(), timestamp: Date.now() };
      tipStateCache.set(cacheKey, cached);
    }
    cached.moduleStates.set(moduleId, shouldShow);
    cached.timestamp = Date.now();
  } catch {
    // Non-critical
  }
}

/**
 * Check if should show tip - async version for initial render
 * Use this when you need accurate state (e.g., initial component mount)
 */
export async function shouldShowTipAsync(moduleId: string): Promise<boolean> {
  try {
    const response = await apiClient.get(`/onboarding/should-show-tip/${moduleId}`);
    const shouldShow = response.data.shouldShow;

    // Update cache
    const cacheKey = getCacheKey();
    let cached = tipStateCache.get(cacheKey);
    if (!cached) {
      cached = { moduleStates: new Map(), timestamp: Date.now() };
      tipStateCache.set(cacheKey, cached);
    }
    cached.moduleStates.set(moduleId, shouldShow);

    return shouldShow;
  } catch {
    // On error, use sync version as fallback
    return shouldShowTip(moduleId);
  }
}

/**
 * Legacy function for backwards compatibility
 */
export function isFirstVisitToModule(moduleId: string): boolean {
  return shouldShowTip(moduleId);
}

/**
 * Increment visit count for a module
 * Persists to database, returns the new count from DB (not localStorage)
 */
export async function incrementVisitCount(moduleId: string): Promise<number> {
  try {
    const response = await apiClient.post('/onboarding/increment-visit', { moduleId });
    const newCount = response.data.count;

    // Update local cache with DB value
    const cacheKey = getCacheKey();
    const cached = progressCache.get(cacheKey);
    if (cached) {
      if (!cached.data.moduleVisitCounts) {
        cached.data.moduleVisitCounts = {};
      }
      cached.data.moduleVisitCounts[moduleId] = newCount;
    }

    // Update tip state cache if count exceeds threshold
    if (newCount >= MAX_VISITS_BEFORE_HIDE) {
      const tipCached = tipStateCache.get(cacheKey);
      if (tipCached) {
        tipCached.moduleStates.set(moduleId, false);
      }
    }

    return newCount;
  } catch (error) {
    console.error('Error incrementing visit count:', error);
    // Queue for retry when online
    queueOfflineAction({ type: 'increment-visit', moduleId });
    return 1;
  }
}

/**
 * Get visit count for a specific module
 */
export function getModuleVisitCount(moduleId: string): number {
  const cacheKey = getCacheKey();
  const cached = progressCache.get(cacheKey);
  return cached?.data.moduleVisitCounts?.[moduleId] || 0;
}

/**
 * Mark a module tip as manually dismissed (X button)
 * Persists to database
 */
export async function dismissModuleTip(moduleId: string): Promise<void> {
  const cacheKey = getCacheKey();

  // Optimistic update
  const cached = progressCache.get(cacheKey);
  if (cached) {
    if (!cached.data.visitedModules) {
      cached.data.visitedModules = [];
    }
    if (!cached.data.visitedModules.includes(moduleId)) {
      cached.data.visitedModules.push(moduleId);
    }
  }

  // Update tip state cache
  const tipCached = tipStateCache.get(cacheKey);
  if (tipCached) {
    tipCached.moduleStates.set(moduleId, false);
  }

  try {
    await apiClient.post('/onboarding/visit-module', { moduleId });
    invalidateProgressCache();
  } catch (error) {
    console.error('Error dismissing module tip on server:', error);
    // Queue for retry when online
    queueOfflineAction({ type: 'dismiss-tip', moduleId });
  }
}

/**
 * Legacy function - now dismisses the tip
 */
export async function markModuleVisited(moduleId: string): Promise<void> {
  await dismissModuleTip(moduleId);
}

/**
 * Get dismissed modules (from cached progress)
 */
export function getDismissedModules(): string[] {
  const cacheKey = getCacheKey();
  const cached = progressCache.get(cacheKey);
  return cached?.data.visitedModules || [];
}

/**
 * Legacy function for backwards compatibility
 */
export function getVisitedModules(): string[] {
  return getDismissedModules();
}

/**
 * Mark first action completed for a module
 * Persists to database
 */
export async function markFirstActionCompleted(moduleId: string): Promise<void> {
  const cacheKey = getCacheKey();

  // Optimistic update
  const cached = progressCache.get(cacheKey);
  if (cached) {
    if (!cached.data.firstActionsCompleted) {
      cached.data.firstActionsCompleted = [];
    }
    if (!cached.data.firstActionsCompleted.includes(moduleId)) {
      cached.data.firstActionsCompleted.push(moduleId);
    }
  }

  // Update tip state cache
  const tipCached = tipStateCache.get(cacheKey);
  if (tipCached) {
    tipCached.moduleStates.set(moduleId, false);
  }

  try {
    await apiClient.post('/onboarding/first-action', { moduleId });
  } catch (error) {
    console.error('Error marking first action:', error);
    // Queue for retry when online
    queueOfflineAction({ type: 'first-action', moduleId });
  }
}

/**
 * Get completed actions (from cached progress)
 */
export function getCompletedActions(): string[] {
  const cacheKey = getCacheKey();
  const cached = progressCache.get(cacheKey);
  return cached?.data.firstActionsCompleted || [];
}

/**
 * Reset first-visit tracking (for testing)
 */
export async function resetFirstVisits(): Promise<void> {
  invalidateProgressCache();

  // Clear all localStorage keys for this user
  const cacheKey = getCacheKey();
  localStorage.removeItem(`${STORAGE_KEYS.PROGRESS_CACHE}_${cacheKey}`);
  localStorage.removeItem(STORAGE_KEYS.OFFLINE_QUEUE);

  try {
    await apiClient.post('/onboarding/reset');
  } catch {
    // Non-critical
  }
}

/**
 * Queue an action for retry when back online
 */
interface OfflineAction {
  type: 'dismiss' | 'dismiss-tip' | 'first-action' | 'increment-visit';
  moduleId?: string;
  timestamp?: number;
}

function queueOfflineAction(action: OfflineAction): void {
  try {
    const queueStr = localStorage.getItem(STORAGE_KEYS.OFFLINE_QUEUE) || '[]';
    const queue: OfflineAction[] = JSON.parse(queueStr);
    queue.push({ ...action, timestamp: Date.now() });
    localStorage.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(queue));
  } catch {
    // localStorage might be unavailable
  }
}

/**
 * Process offline queue when back online
 */
export async function processOfflineQueue(): Promise<void> {
  try {
    const queueStr = localStorage.getItem(STORAGE_KEYS.OFFLINE_QUEUE) || '[]';
    const queue: OfflineAction[] = JSON.parse(queueStr);

    if (queue.length === 0) return;

    for (const action of queue) {
      try {
        switch (action.type) {
          case 'dismiss':
            await apiClient.post('/onboarding/dismiss');
            break;
          case 'dismiss-tip':
            if (action.moduleId) {
              await apiClient.post('/onboarding/visit-module', { moduleId: action.moduleId });
            }
            break;
          case 'first-action':
            if (action.moduleId) {
              await apiClient.post('/onboarding/first-action', { moduleId: action.moduleId });
            }
            break;
          case 'increment-visit':
            if (action.moduleId) {
              await apiClient.post('/onboarding/increment-visit', { moduleId: action.moduleId });
            }
            break;
        }
      } catch {
        // Individual action failed, will be retried next time
      }
    }

    // Clear queue after processing
    localStorage.removeItem(STORAGE_KEYS.OFFLINE_QUEUE);
    invalidateProgressCache();
  } catch {
    // Queue processing failed
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
    moduleVisitCounts: {},
    firstActionsCompleted: [],
  };
}

// Process offline queue when module loads (if online)
if (typeof window !== 'undefined' && navigator.onLine) {
  processOfflineQueue();
}

// Listen for online event to process queue
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    processOfflineQueue();
  });
}

export const onboardingService = {
  getProgress: getOnboardingProgress,
  dismiss: dismissOnboarding,
  resetDismissal: resetOnboardingDismissal,
  invalidateCache: invalidateProgressCache,
  // New combined logic
  shouldShowTip,
  shouldShowTipAsync,
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
  // Offline support
  processOfflineQueue,
};

export default onboardingService;
