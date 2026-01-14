import { createContext, useContext, useEffect, useState, ReactNode, useMemo, useCallback } from 'react';
import { useAuth, Role } from './AuthContext';
import { billingService, Plan, Subscription, Usage } from '@/services/billing.service';

// ================================================================
// Feature Definitions - Maps modules to plan features
// ================================================================

// Features that can be checked against the plan
export type PlanFeature =
  | 'warehouse'
  | 'returns'
  | 'merchandise'
  | 'shipping_labels'
  | 'auto_inventory'
  | 'shopify_import'
  | 'shopify_bidirectional'
  | 'team_management'
  | 'advanced_team'
  | 'custom_roles'
  | 'smart_alerts'
  | 'campaign_tracking'
  | 'api_read'
  | 'api_write'
  | 'custom_webhooks'
  | 'pdf_excel_reports';

// Map sidebar paths to required features
export const PATH_TO_FEATURE: Record<string, PlanFeature> = {
  '/warehouse': 'warehouse',
  '/shipping': 'warehouse',
  '/returns': 'returns',
  '/merchandise': 'merchandise',
  '/dashboard-logistics': 'warehouse',
  '/ads': 'campaign_tracking',
  '/integrations': 'shopify_import',
  '/settlements': 'warehouse',
};

// Features available in each plan
const PLAN_FEATURES: Record<string, PlanFeature[]> = {
  free: [],
  starter: [
    'warehouse',
    'returns',
    'merchandise',
    'shipping_labels',
    'auto_inventory',
    'shopify_import',
    'team_management',
  ],
  growth: [
    'warehouse',
    'returns',
    'merchandise',
    'shipping_labels',
    'auto_inventory',
    'shopify_import',
    'shopify_bidirectional',
    'team_management',
    'advanced_team',
    'smart_alerts',
    'campaign_tracking',
    'pdf_excel_reports',
  ],
  professional: [
    'warehouse',
    'returns',
    'merchandise',
    'shipping_labels',
    'auto_inventory',
    'shopify_import',
    'shopify_bidirectional',
    'team_management',
    'advanced_team',
    'custom_roles',
    'smart_alerts',
    'campaign_tracking',
    'api_read',
    'api_write',
    'custom_webhooks',
    'pdf_excel_reports',
  ],
};

// Minimum plan required for each feature
export const FEATURE_MIN_PLAN: Record<PlanFeature, string> = {
  warehouse: 'starter',
  returns: 'starter',
  merchandise: 'starter',
  shipping_labels: 'starter',
  auto_inventory: 'starter',
  shopify_import: 'starter',
  shopify_bidirectional: 'growth',
  team_management: 'starter',
  advanced_team: 'growth',
  custom_roles: 'professional',
  smart_alerts: 'growth',
  campaign_tracking: 'growth',
  api_read: 'professional',
  api_write: 'professional',
  custom_webhooks: 'professional',
  pdf_excel_reports: 'growth',
};

// Human-readable feature names
export const FEATURE_NAMES: Record<PlanFeature, string> = {
  warehouse: 'Almacén y Picking',
  returns: 'Devoluciones',
  merchandise: 'Mercadería',
  shipping_labels: 'Etiquetas de Envío',
  auto_inventory: 'Inventario Automático',
  shopify_import: 'Importar desde Shopify',
  shopify_bidirectional: 'Sincronización Bidireccional Shopify',
  team_management: 'Gestión de Equipo',
  advanced_team: 'Equipo Avanzado',
  custom_roles: 'Roles Personalizados',
  smart_alerts: 'Alertas Inteligentes',
  campaign_tracking: 'Seguimiento de Campañas',
  api_read: 'API de Lectura',
  api_write: 'API de Escritura',
  custom_webhooks: 'Webhooks Personalizados',
  pdf_excel_reports: 'Reportes PDF/Excel',
};

// ================================================================
// Context Types
// ================================================================

interface SubscriptionContextType {
  // Subscription data
  subscription: Subscription | null;
  usage: Usage | null;
  allPlans: Plan[] | null;
  loading: boolean;
  error: string | null;

  // Feature checking
  hasFeature: (feature: PlanFeature) => boolean;
  hasFeatureByPath: (path: string) => boolean;
  getMinPlanForFeature: (feature: PlanFeature) => string;
  getMinPlanForPath: (path: string) => string | null;

  // Role-based visibility
  canUpgrade: boolean; // Only owners can upgrade
  shouldShowLockedFeatures: boolean; // Owners see locked features, collaborators don't

  // Usage limits
  isNearLimit: (type: 'orders' | 'products' | 'users') => boolean;
  isAtLimit: (type: 'orders' | 'products' | 'users') => boolean;

  // Creation limits - for blocking new entity creation
  canCreateOrder: boolean;
  canCreateProduct: boolean;
  canCreateUser: boolean;
  getRemainingOrders: () => number;
  getRemainingProducts: () => number;

  // Refresh
  refreshSubscription: () => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

// ================================================================
// Provider
// ================================================================

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { currentStore, permissions } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [allPlans, setAllPlans] = useState<Plan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch subscription data with AbortController to prevent setState after unmount
  const fetchSubscription = useCallback(async (signal?: AbortSignal) => {
    if (!currentStore) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      // Use getStorePlan which is accessible to ALL users (not just billing module)
      const data = await billingService.getStorePlan();

      // Check if request was aborted before setting state
      if (signal?.aborted) {
        console.log('[SubscriptionContext] Request aborted, skipping state update');
        return;
      }

      setSubscription(data.subscription);
      setUsage(data.usage);
      setAllPlans(data.allPlans);
    } catch (err: any) {
      // Don't set error if request was aborted
      if (signal?.aborted) {
        console.log('[SubscriptionContext] Request aborted during error handling');
        return;
      }

      console.error('Failed to fetch subscription:', err);
      setError(err.message || 'Error al cargar suscripción');
      // Set default free plan on error
      setSubscription({
        plan: 'free',
        status: 'active',
        billingCycle: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        trialEndsAt: null,
      });
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [currentStore]);

  useEffect(() => {
    const abortController = new AbortController();

    fetchSubscription(abortController.signal);

    return () => {
      // Abort in-flight request on unmount or currentStore change
      abortController.abort();
    };
  }, [fetchSubscription]);

  // ================================================================
  // Feature Checking
  // ================================================================

  const currentPlan = useMemo(() => {
    return subscription?.plan?.toLowerCase() || 'free';
  }, [subscription?.plan]);

  const hasFeature = useCallback((feature: PlanFeature): boolean => {
    const planFeatures = PLAN_FEATURES[currentPlan] || [];
    return planFeatures.includes(feature);
  }, [currentPlan]);

  const hasFeatureByPath = useCallback((path: string): boolean => {
    const feature = PATH_TO_FEATURE[path];
    if (!feature) return true; // If no feature mapping, allow access
    return hasFeature(feature);
  }, [hasFeature]);

  const getMinPlanForFeature = useCallback((feature: PlanFeature): string => {
    return FEATURE_MIN_PLAN[feature] || 'starter';
  }, []);

  const getMinPlanForPath = useCallback((path: string): string | null => {
    const feature = PATH_TO_FEATURE[path];
    if (!feature) return null;
    return getMinPlanForFeature(feature);
  }, [getMinPlanForFeature]);

  // ================================================================
  // Role-based visibility
  // ================================================================

  const canUpgrade = useMemo(() => {
    // Only owners can upgrade
    return permissions.currentRole === Role.OWNER;
  }, [permissions.currentRole]);

  const shouldShowLockedFeatures = useMemo(() => {
    // Only show locked features to users who can upgrade (owners)
    // Collaborators shouldn't see features they can't access
    return canUpgrade;
  }, [canUpgrade]);

  // ================================================================
  // Usage limits
  // ================================================================

  const isNearLimit = useCallback((type: 'orders' | 'products' | 'users'): boolean => {
    if (!usage) return false;
    const data = usage[type];
    if (!data || data.limit === -1) return false; // -1 = unlimited
    return data.percentage >= 80;
  }, [usage]);

  const isAtLimit = useCallback((type: 'orders' | 'products' | 'users'): boolean => {
    if (!usage) return false;
    const data = usage[type];
    if (!data || data.limit === -1) return false; // -1 = unlimited
    return data.percentage >= 100;
  }, [usage]);

  // ================================================================
  // Creation limits
  // ================================================================

  const canCreateOrder = useMemo(() => {
    if (!usage) return true; // Allow by default when loading
    const { orders } = usage;
    if (orders.limit === -1) return true; // Unlimited
    return orders.used < orders.limit;
  }, [usage]);

  const canCreateProduct = useMemo(() => {
    if (!usage) return true; // Allow by default when loading
    const { products } = usage;
    if (products.limit === -1) return true; // Unlimited
    return products.used < products.limit;
  }, [usage]);

  const canCreateUser = useMemo(() => {
    if (!usage) return true; // Allow by default when loading
    const { users } = usage;
    if (users.limit === -1) return true; // Unlimited
    return users.used < users.limit;
  }, [usage]);

  const getRemainingOrders = useCallback((): number => {
    if (!usage) return 0;
    const { orders } = usage;
    if (orders.limit === -1) return Infinity;
    return Math.max(0, orders.limit - orders.used);
  }, [usage]);

  const getRemainingProducts = useCallback((): number => {
    if (!usage) return 0;
    const { products } = usage;
    if (products.limit === -1) return Infinity;
    return Math.max(0, products.limit - products.used);
  }, [usage]);

  // ================================================================
  // Context value
  // ================================================================

  const value = useMemo((): SubscriptionContextType => ({
    subscription,
    usage,
    allPlans,
    loading,
    error,
    hasFeature,
    hasFeatureByPath,
    getMinPlanForFeature,
    getMinPlanForPath,
    canUpgrade,
    shouldShowLockedFeatures,
    isNearLimit,
    isAtLimit,
    canCreateOrder,
    canCreateProduct,
    canCreateUser,
    getRemainingOrders,
    getRemainingProducts,
    refreshSubscription: fetchSubscription,
  }), [
    subscription,
    usage,
    allPlans,
    loading,
    error,
    hasFeature,
    hasFeatureByPath,
    getMinPlanForFeature,
    getMinPlanForPath,
    canUpgrade,
    shouldShowLockedFeatures,
    isNearLimit,
    isAtLimit,
    canCreateOrder,
    canCreateProduct,
    canCreateUser,
    getRemainingOrders,
    getRemainingProducts,
    fetchSubscription,
  ]);

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

// ================================================================
// Hook
// ================================================================

export function useSubscription() {
  const context = useContext(SubscriptionContext);
  if (context === undefined) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return context;
}
