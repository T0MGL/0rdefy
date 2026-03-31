import apiClient from './api.client';

export interface Plan {
  plan: string;
  max_users: number;
  max_orders_per_month: number;
  max_products: number;
  max_stores: number;
  max_integrations: number;
  has_warehouse: boolean;
  has_returns: boolean;
  has_merchandise: boolean;
  has_shipping_labels: boolean;
  has_auto_inventory: boolean;
  has_shopify_import: boolean;
  has_shopify_bidirectional: boolean;
  has_team_management: boolean;
  has_advanced_team: boolean;
  has_custom_roles: boolean;
  has_smart_alerts: boolean;
  has_campaign_tracking: boolean;
  has_api_read: boolean;
  has_api_write: boolean;
  has_custom_webhooks: boolean;
  analytics_history_days: number;
  has_pdf_excel_reports: boolean;
  has_trial: boolean;
  trial_days: number;
  priceMonthly: number;
  priceAnnual: number;
  annualSavings?: number;
}

export interface Subscription {
  plan: string;
  status: string;
  billingCycle: 'monthly' | 'annual' | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: string | null;
  planDetails?: Plan;
}

export interface Usage {
  orders: { used: number; limit: number; percentage: number };
  products: { used: number; limit: number; percentage: number };
  users: { used: number; limit: number; percentage: number };
}

export interface ReferralStats {
  code: string;
  totalSignups: number;
  totalConversions: number;
  totalCreditsEarned: number;
  availableCredits: number;
  referrals: Array<{
    id: string;
    referred: { name: string; email: string };
    signed_up_at: string;
    first_payment_at: string | null;
  }>;
}

export interface CheckoutParams {
  plan: string;
  billingCycle: 'monthly' | 'annual';
  discountCode?: string;
  referralCode?: string;
  fromOnboarding?: boolean; // Flag to indicate checkout is from onboarding flow
}

export const billingService = {
  async getSubscription(): Promise<{
    subscription: Subscription;
    usage: Usage;
    allPlans: Plan[];
  }> {
    const response = await apiClient.get('/billing/subscription');
    return response.data;
  },

  /**
   * Accessible to ALL authenticated users. Used by SubscriptionContext for feature gating.
   */
  async getStorePlan(): Promise<{
    subscription: Subscription;
    usage: Usage;
    allPlans: Plan[];
  }> {
    const response = await apiClient.get('/billing/store-plan');
    return response.data;
  },

  async getPlans(): Promise<Plan[]> {
    const response = await apiClient.get('/billing/plans');
    return response.data;
  },

  async createCheckout(params: CheckoutParams): Promise<{ sessionId: string; url: string }> {
    const response = await apiClient.post('/billing/checkout', params);
    return response.data;
  },

  async createPortal(): Promise<{ url: string }> {
    const response = await apiClient.post('/billing/portal');
    return response.data;
  },

  async cancelSubscription(reason?: string): Promise<{ success: boolean }> {
    const response = await apiClient.post('/billing/cancel', { reason });
    return response.data;
  },

  async reactivateSubscription(): Promise<{ success: boolean }> {
    const response = await apiClient.post('/billing/reactivate');
    return response.data;
  },

  async changePlan(plan: string, billingCycle: 'monthly' | 'annual'): Promise<{ success: boolean }> {
    const response = await apiClient.post('/billing/change-plan', { plan, billingCycle });
    return response.data;
  },

  async hasFeatureAccess(feature: string): Promise<boolean> {
    const response = await apiClient.get(`/billing/feature/${feature}`);
    return response.data.hasAccess;
  },

  async getReferralStats(): Promise<ReferralStats> {
    const response = await apiClient.get('/billing/referrals');
    return response.data;
  },

  async generateReferralCode(): Promise<{ code: string; link: string }> {
    const response = await apiClient.post('/billing/referrals/generate');
    return response.data;
  },

  async validateDiscountCode(
    code: string,
    plan: string
  ): Promise<{
    valid: boolean;
    discount?: { type: string; value: number; description: string };
    error?: string;
  }> {
    const response = await apiClient.post('/billing/discount/validate', { code, plan });
    return response.data;
  },

  async validateReferralCode(code: string): Promise<{
    valid: boolean;
    referrerName?: string;
    discount?: string;
    error?: string;
  }> {
    const response = await apiClient.get(`/billing/referral/${code}/validate`);
    return response.data;
  },
};

