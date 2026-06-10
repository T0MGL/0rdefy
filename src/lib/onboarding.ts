/**
 * Pure onboarding-completion logic. Kept free of React/router/storage deps so
 * it is the single, testable source of truth shared by AuthContext (session
 * restore + login) and OnboardingGuard.
 *
 * The store-setup onboarding is an OWNER flow. The backend computes the verdict
 * at login (api/routes/auth.ts: `stores.length > 0 && name`) and returns it as
 * `onboardingCompleted`. We persist that verdict on the durable user object so
 * it survives cold starts (reload, new tab, PWA relaunch) instead of depending
 * on a fragile standalone localStorage flag that may be absent.
 */

export interface OnboardingStoreRef {
  role: string;
}

export interface OnboardingUserState {
  name?: string;
  stores?: OnboardingStoreRef[];
  onboardingCompleted?: boolean;
}

/**
 * True when every store membership is the courier role. Couriers have no store
 * to configure and live in the embedded portal, so they are never subject to
 * store-setup onboarding.
 */
export function isCourierOnly(stores: OnboardingStoreRef[] | undefined): boolean {
  if (!stores || stores.length === 0) return false;
  return stores.every((s) => s.role?.toLowerCase() === 'courier');
}

/**
 * Resolve whether the user has completed store-setup onboarding.
 *
 * Order of precedence:
 *   1. Couriers are always exempt (treated as completed).
 *   2. The durable backend-provided flag when present (boolean).
 *   3. Legacy fallback for sessions cached before the flag was persisted on the
 *      user object: the same rule the backend uses (has a name and a store).
 */
export function deriveOnboardingCompleted(user: OnboardingUserState | null): boolean {
  if (!user) return false;
  if (isCourierOnly(user.stores)) return true;
  if (typeof user.onboardingCompleted === 'boolean') return user.onboardingCompleted;
  return !!user.name && !!user.stores && user.stores.length > 0;
}
