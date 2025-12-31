/**
 * Billing Service
 *
 * Frontend service for billing, subscriptions, and referrals
 */

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
}

export const billingService = {
  /**
   * Get current subscription and usage
   */
  async getSubscription(): Promise<{
    subscription: Subscription;
    usage: Usage;
    allPlans: Plan[];
  }> {
    const response = await apiClient.get('/api/billing/subscription');
    return response.data;
  },

  /**
   * Get all available plans
   */
  async getPlans(): Promise<Plan[]> {
    const response = await apiClient.get('/api/billing/plans');
    return response.data;
  },

  /**
   * Create a checkout session
   */
  async createCheckout(params: CheckoutParams): Promise<{ sessionId: string; url: string }> {
    const response = await apiClient.post('/api/billing/checkout', params);
    return response.data;
  },

  /**
   * Create a billing portal session
   */
  async createPortal(): Promise<{ url: string }> {
    const response = await apiClient.post('/api/billing/portal');
    return response.data;
  },

  /**
   * Cancel subscription
   */
  async cancelSubscription(reason?: string): Promise<{ success: boolean }> {
    const response = await apiClient.post('/api/billing/cancel', { reason });
    return response.data;
  },

  /**
   * Reactivate a canceled subscription
   */
  async reactivateSubscription(): Promise<{ success: boolean }> {
    const response = await apiClient.post('/api/billing/reactivate');
    return response.data;
  },

  /**
   * Change subscription plan
   */
  async changePlan(plan: string, billingCycle: 'monthly' | 'annual'): Promise<{ success: boolean }> {
    const response = await apiClient.post('/api/billing/change-plan', { plan, billingCycle });
    return response.data;
  },

  /**
   * Check feature access
   */
  async hasFeatureAccess(feature: string): Promise<boolean> {
    const response = await apiClient.get(`/api/billing/feature/${feature}`);
    return response.data.hasAccess;
  },

  /**
   * Get referral stats
   */
  async getReferralStats(): Promise<ReferralStats> {
    const response = await apiClient.get('/api/billing/referrals');
    return response.data;
  },

  /**
   * Generate referral code
   */
  async generateReferralCode(): Promise<{ code: string; link: string }> {
    const response = await apiClient.post('/api/billing/referrals/generate');
    return response.data;
  },

  /**
   * Validate discount code
   */
  async validateDiscountCode(
    code: string,
    plan: string
  ): Promise<{
    valid: boolean;
    discount?: { type: string; value: number; description: string };
    error?: string;
  }> {
    const response = await apiClient.post('/api/billing/discount/validate', { code, plan });
    return response.data;
  },

  /**
   * Validate referral code
   */
  async validateReferralCode(code: string): Promise<{
    valid: boolean;
    referrerName?: string;
    discount?: string;
    error?: string;
  }> {
    const response = await apiClient.get(`/api/billing/referral/${code}/validate`);
    return response.data;
  },
};

export default billingService;
