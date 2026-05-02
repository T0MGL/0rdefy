/**
 * useScrollToError
 *
 * Watches a react-hook-form `errors` object (or any record of error keys) and
 * scrolls the first errored field into the center of the viewport. Useful
 * after a failed submit on long mobile forms where the offending field would
 * otherwise sit off-screen.
 *
 * Usage with react-hook-form:
 *   const { formState: { errors }, register } = useForm();
 *   useScrollToError(errors);
 *
 * The hook expects the field name to match either:
 *   - an element with `name="<fieldName>"`
 *   - an element with `id="<fieldName>"`
 *   - an element with `data-field="<fieldName>"`
 */
import { useEffect, useRef } from 'react';

type ErrorMap = Record<string, unknown>;

function findFieldElement(name: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const escaped = (typeof CSS !== 'undefined' && 'escape' in CSS)
    ? CSS.escape(name)
    : name.replace(/"/g, '\\"');
  return (
    (document.querySelector(`[name="${escaped}"]`) as HTMLElement | null) ||
    (document.getElementById(name) as HTMLElement | null) ||
    (document.querySelector(`[data-field="${escaped}"]`) as HTMLElement | null)
  );
}

export function useScrollToError(errors: ErrorMap | undefined): void {
  // Track the first errored field across renders to avoid jitter when multiple
  // errors clear in sequence.
  const lastScrolledRef = useRef<string | null>(null);

  useEffect(() => {
    if (!errors) return;
    const keys = Object.keys(errors).filter((k) => errors[k]);
    if (keys.length === 0) {
      lastScrolledRef.current = null;
      return;
    }

    const first = keys[0];
    if (lastScrolledRef.current === first) return;

    const el = findFieldElement(first);
    if (!el) return;

    lastScrolledRef.current = first;
    // Defer one frame so any newly-rendered error message is included in the
    // bounding rect when scrolling into view.
    requestAnimationFrame(() => {
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Move focus for screen readers / keyboard users.
        if (typeof (el as HTMLInputElement).focus === 'function') {
          (el as HTMLInputElement).focus({ preventScroll: true });
        }
      } catch {
        // Ignore scroll failures (e.g. element detached during async).
      }
    });
  }, [errors]);
}
