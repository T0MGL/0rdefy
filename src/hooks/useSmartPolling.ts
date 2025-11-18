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

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);
  const isPollingRef = useRef(false);

  // Fetch data function
  const fetchData = useCallback(async () => {
    // Don't fetch if component is unmounted
    if (!isMountedRef.current) {
      console.log('[SmartPolling] Skipped fetch: component unmounted');
      return;
    }

    // Don't fetch if page is not visible
    if (!document.hidden && !isPageVisible) {
      console.log('[SmartPolling] Skipped fetch: page not visible');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const result = await queryFn();

      // Check again after async operation
      if (!isMountedRef.current) {
        console.log('[SmartPolling] Discarding result: component unmounted during fetch');
        return;
      }

      setData(result);

      if (onSuccess) {
        onSuccess(result);
      }

      console.log('[SmartPolling] ✅ Data fetched successfully');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      if (isMountedRef.current) {
        setError(error);

        if (onError) {
          onError(error);
        }

        console.error('[SmartPolling] ❌ Fetch failed:', error.message);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [queryFn, onSuccess, onError, isPageVisible]);

  // Start polling
  const startPolling = useCallback(() => {
    if (isPollingRef.current) {
      console.log('[SmartPolling] Already polling, skipping start');
      return;
    }

    console.log('[SmartPolling] 🚀 Starting polling (interval: ${interval}ms)');
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
      if (isMountedRef.current && !document.hidden) {
        fetchData();
      }
    }, interval);

    // Fetch immediately
    fetchData();
  }, [interval, fetchData, onPollingStart]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (!isPollingRef.current) {
      console.log('[SmartPolling] Not polling, skipping stop');
      return;
    }

    console.log('[SmartPolling] ⏸️  Stopping polling');
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

  // Handle visibility change (tab active/inactive, window minimized)
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isVisible = !document.hidden;
      setIsPageVisible(isVisible);

      if (isVisible) {
        console.log('[SmartPolling] 👀 Page visible - resuming polling');
        if (enabled && isPollingRef.current) {
          // Fetch immediately on becoming visible
          fetchData();
        }
      } else {
        console.log('[SmartPolling] 😴 Page hidden - pausing polling');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, fetchData]);

  // Handle enabled state change
  useEffect(() => {
    if (enabled) {
      startPolling();
    } else {
      stopPolling();
    }
  }, [enabled, startPolling, stopPolling]);

  // Fetch on mount if requested
  useEffect(() => {
    if (fetchOnMount && enabled) {
      fetchData();
    }
  }, [fetchOnMount, enabled]); // Only run on mount

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log('[SmartPolling] 🧹 Component unmounting - cleaning up');
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
  }, []);

  return result;
}
