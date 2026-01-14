import { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Hook to handle URL-based highlighting of items
 * Usage: const { highlightId, clearHighlight } = useHighlight();
 *
 * In URL: /orders?highlight=order-id-123
 * Returns: highlightId = "order-id-123"
 */
export function useHighlight() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  // Track mounted state to prevent setState after unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Memoize clearHighlight to use in setTimeout without stale closure
  const clearHighlight = useCallback(() => {
    if (!isMountedRef.current) {
      return; // Prevent setState after unmount
    }
    setHighlightId(null);
    // Remove highlight param from URL
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('highlight');
    setSearchParams(newParams, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const id = searchParams.get('highlight');
    if (id) {
      setHighlightId(id);

      // Auto-scroll to highlighted element after a short delay
      const scrollTimer = setTimeout(() => {
        const element = document.getElementById(`item-${id}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 300);

      // Auto-clear highlight after 5 seconds
      const clearTimer = setTimeout(() => {
        clearHighlight();
      }, 5000);

      // Cleanup both timers on unmount or dependency change
      return () => {
        clearTimeout(scrollTimer);
        clearTimeout(clearTimer);
      };
    }
  }, [searchParams, clearHighlight]); // Now includes clearHighlight in dependencies

  const isHighlighted = (id: string) => highlightId === id;

  return {
    highlightId,
    isHighlighted,
    clearHighlight,
  };
}
