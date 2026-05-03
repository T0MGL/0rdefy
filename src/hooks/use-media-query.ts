import * as React from 'react';

/**
 * Reactive media-query hook. SSR-safe (returns false until mount).
 *
 * Examples:
 *   const isLgUp = useMediaQuery('(min-width: 1024px)');
 *   const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
 */
export function useMediaQuery(query: string): boolean {
  const getMatch = React.useCallback(
    () => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false),
    [query],
  );

  const [matches, setMatches] = React.useState<boolean>(getMatch);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);

    // Initial sync (in case query changed between render and effect)
    setMatches(mql.matches);

    // Modern browsers
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }

    // Legacy fallback (Safari < 14)
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, [query]);

  return matches;
}
