/**
 * Smart Polling Hook
 *
 * Intelligently polls an API endpoint with these features:
 * - ONLY polls when page is visible (tab active)
 * - STOPS polling when user navigates away
 * - PAUSES when browser tab is inactive/minimized
 * - RESUMES immediately when user returns
 * - NO polling when component is unmounted
 * - Prevents memory leaks
 * - Saves API calls and costs
 *
 * @example
 * ```tsx
 * const { data, isPolling } = useSmartPolling({
 *   queryFn: async () => {
 *     const response = await fetch('/api/products');
 *     return response.json();
 *   },
 *   interval: 5000, // Poll every 5 seconds
 *   enabled: true,
 * });
 * ```
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { createNamespacedLogger } from '@/utils/logger';

const log = createNamespacedLogger('SmartPolling');

export interface UseSmartPollingOptions<T> {
  /**
   * Function that fetches data
   */
  queryFn: () => Promise<T>;

  /**
   * Polling interval in milliseconds
   * @default 5000 (5 seconds)
   */
  interval?: number;

  /**
   * Whether polling is enabled
   * @default true
   */
  enabled?: boolean;

  /**
   * Whether to fetch immediately on mount
   * @default true
   */
  fetchOnMount?: boolean;

  /**
   * Callback when data is successfully fetched
   */
  onSuccess?: (data: T) => void;

  /**
   * Callback when fetch fails
   */
  onError?: (error: Error) => void;

  /**
   * Callback when polling starts
   */
  onPollingStart?: () => void;

  /**
   * Callback when polling stops
   */
  onPollingStop?: () => void;
}

export interface UseSmartPollingResult<T> {
  /**
   * Fetched data
   */
  data: T | null;

  /**
   * Loading state
   */
  isLoading: boolean;

  /**
   * Error state
   */
  error: Error | null;

  /**
   * Whether polling is currently active
   */
  isPolling: boolean;

  /**
   * Whether page is currently visible
   */
  isPageVisible: boolean;

  /**
   * Whether browser window is currently focused
   */
  isWindowFocused: boolean;

  /**
   * Manually trigger a fetch
   */
  refetch: () => Promise<void>;

  /**
   * Manually start polling
   */
  startPolling: () => void;

  /**
   * Manually stop polling
   */
  stopPolling: () => void;
}

export function useSmartPolling<T>({
  queryFn,
  interval = 5000,
  enabled = true,
  fetchOnMount = true,
  onSuccess,
  onError,
  onPollingStart,
  onPollingStop,
}: UseSmartPollingOptions<T>): UseSmartPollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [isWindowFocused, setIsWindowFocused] = useState(() => {
    if (typeof document === 'undefined') return true;
    return document.hasFocus();
  });

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  const isPollingRef = useRef(false);
  const isPageVisibleRef = useRef(isPageVisible);
  const isWindowFocusedRef = useRef(isWindowFocused);

  // Keep ref in sync with state
  useEffect(() => {
    isPageVisibleRef.current = isPageVisible;
  }, [isPageVisible]);

  // Keep focus ref in sync with state
  useEffect(() => {
    isWindowFocusedRef.current = isWindowFocused;
  }, [isWindowFocused]);

  // Fetch data function - using ref for isPageVisible to prevent effect dependencies cascade
  const fetchData = useCallback(async () => {
    // Don't fetch if component is unmounted
    if (!isMountedRef.current) {
      log.debug('Skipped fetch: component unmounted');
      return;
    }

    // Don't fetch when tab/window is not actively visible to the user
    if (document.hidden || !isPageVisibleRef.current || !isWindowFocusedRef.current) {
      log.debug('Skipped fetch: page hidden or window unfocused');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const result = await queryFn();

      // Check again after async operation
      if (!isMountedRef.current) {
        log.debug('Discarding result: component unmounted during fetch');
        return;
      }

      setData(result);

      if (onSuccess) {
        onSuccess(result);
      }

      log.debug('Data fetched successfully');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      if (isMountedRef.current) {
        setError(error);

        if (onError) {
          onError(error);
        }

        log.error('Fetch failed', error);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [queryFn, onSuccess, onError]); // Removed isPageVisible from dependencies

  // Start polling
  const startPolling = useCallback(() => {
    if (isPollingRef.current) {
      log.debug('Already polling, skipping start');
      return;
    }

    log.debug(`Starting polling (interval: ${interval}ms)`);
    isPollingRef.current = true;
    setIsPolling(true);

    if (onPollingStart) {
      onPollingStart();
    }

    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    // Set up new interval
    intervalRef.current = setInterval(() => {
      if (isMountedRef.current && !document.hidden && isWindowFocusedRef.current) {
        fetchData();
      }
    }, interval);

    // Fetch immediately
    fetchData();
  }, [interval, fetchData, onPollingStart]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (!isPollingRef.current) {
      log.debug('Not polling, skipping stop');
      return;
    }

    log.debug('Stopping polling');
    isPollingRef.current = false;
    setIsPolling(false);

    if (onPollingStop) {
      onPollingStop();
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, [onPollingStop]);

  // Store enabled in ref to avoid effect dependencies
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // Handle visibility change (tab active/inactive, window minimized)
  // Using refs to prevent effect re-runs and listener churn
  // Store fetchData in ref to avoid memory leak from dependency changes
  const fetchDataRef = useRef(fetchData);
  useEffect(() => {
    fetchDataRef.current = fetchData;
  }, [fetchData]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      const isVisible = !document.hidden;
      setIsPageVisible(isVisible);

      if (isVisible) {
        log.debug('Page visible - resuming polling');
        if (enabledRef.current && isPollingRef.current) {
          // Fetch immediately on becoming visible (use ref to prevent stale closure)
          fetchDataRef.current();
        }
      } else {
        log.debug('Page hidden - pausing polling');
      }
    };

    // Add listener once, never remove until unmount
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []); // ✅ Empty dependencies - listener added only once, cleaned up on unmount

  // Handle browser window focus/blur
  useEffect(() => {
    const handleWindowFocus = () => {
      setIsWindowFocused(true);

      // Fetch immediately when user returns to the window
      if (enabledRef.current && isPollingRef.current && !document.hidden) {
        fetchDataRef.current();
      }
    };

    const handleWindowBlur = () => {
      setIsWindowFocused(false);
    };

    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, []); // ✅ Empty dependencies - listeners added only once

  // Handle enabled state change - use ref to avoid infinite loop
  const startPollingRef = useRef(startPolling);
  const stopPollingRef = useRef(stopPolling);
  useEffect(() => {
    startPollingRef.current = startPolling;
    stopPollingRef.current = stopPolling;
  }, [startPolling, stopPolling]);

  useEffect(() => {
    if (enabled) {
      startPollingRef.current();
    } else {
      stopPollingRef.current();
    }
  }, [enabled]); // Only re-run when enabled changes, not when functions change

  // Fetch on mount if requested
  useEffect(() => {
    // Avoid duplicate initial fetch when polling already performed an immediate fetch
    if (fetchOnMount && enabled && !isPollingRef.current) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchOnMount, enabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      log.debug('Component unmounting - cleaning up');
      isMountedRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  // Manual refetch
  const refetch = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  return {
    data,
    isLoading,
    error,
    isPolling,
    isPageVisible,
    isWindowFocused,
    refetch,
    startPolling,
    stopPolling,
  };
}

/**
 * Hook for polling with automatic cleanup on navigation
 * This variant automatically stops polling when the user navigates away
 *
 * @example
 * ```tsx
 * const { data } = useAutoStopPolling({
 *   queryFn: fetchProducts,
 *   interval: 5000,
 * });
 * ```
 */
export function useAutoStopPolling<T>(
  options: UseSmartPollingOptions<T>
): UseSmartPollingResult<T> {
  const result = useSmartPolling(options);

  // Stop polling on component unmount (navigation away)
  useEffect(() => {
    return () => {
      result.stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return result;
}
