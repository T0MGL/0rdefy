import { useEffect, useState } from 'react';
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

  useEffect(() => {
    const id = searchParams.get('highlight');
    if (id) {
      setHighlightId(id);

      // Auto-scroll to highlighted element after a short delay
      setTimeout(() => {
        const element = document.getElementById(`item-${id}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 300);

      // Auto-clear highlight after 5 seconds
      const timer = setTimeout(() => {
        clearHighlight();
      }, 5000);

      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const clearHighlight = () => {
    setHighlightId(null);
    // Remove highlight param from URL
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('highlight');
    setSearchParams(newParams, { replace: true });
  };

  const isHighlighted = (id: string) => highlightId === id;

  return {
    highlightId,
    isHighlighted,
    clearHighlight,
  };
}
