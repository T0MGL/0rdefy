import { usePlanLimitHandler } from '@/hooks/usePlanLimitHandler';

/**
 * Component that handles plan limit events globally.
 * Must be rendered inside SubscriptionProvider and BrowserRouter.
 *
 * Usage: Add this component inside SubscriptionProvider in App.tsx
 */
export function PlanLimitHandler() {
  usePlanLimitHandler();
  return null; // This component doesn't render anything
}
