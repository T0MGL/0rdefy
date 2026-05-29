/**
 * Active store resolution (per-tab).
 *
 * The active store must be scoped per browser tab, not per browser. Two tabs
 * open on two different stores must not overwrite each other.
 *
 * - sessionStorage holds the active store of THIS tab (source of truth).
 * - localStorage holds the "last used store" and seeds brand-new tabs that
 *   have no sessionStorage value yet (e.g. opened via Ctrl+T).
 *
 * Reads fall back to localStorage so the very first request of a fresh tab,
 * fired before AuthContext seeds sessionStorage, still carries a store id.
 */

const KEY = 'current_store_id';

/** Resolve the active store id for the current tab. */
export function getActiveStoreId(): string | null {
  try {
    return sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY);
  } catch {
    // Private mode / storage disabled: degrade to localStorage only.
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  }
}

/** Set the active store for this tab and update the new-tab default. */
export function setActiveStoreId(storeId: string): void {
  try {
    sessionStorage.setItem(KEY, storeId);
  } catch {
    // ignore: storage may be unavailable in private mode
  }
  try {
    localStorage.setItem(KEY, storeId);
  } catch {
    // ignore
  }
}

/** Clear the active store from this tab and the new-tab default (logout). */
export function clearActiveStore(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
