// ================================================================
// SHOPIFY SERVICE
// ================================================================
// Handles Shopify OAuth integration API calls
// ================================================================

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('auth_token');
  const storeId = localStorage.getItem('current_store_id');
  return {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
    ...(storeId && { 'X-Store-ID': storeId }),
  };
};

// ================================================================
// GET SHOPIFY INTEGRATION (by store_id from auth token)
// ================================================================
// Check if user has Shopify connected using authenticated store
// ================================================================
export const getShopifyIntegration = async (): Promise<{
  success: boolean;
  integration?: any;
  message?: string;
}> => {
  try {
    const response = await fetch(
      `${API_BASE}/api/shopify/integration`,
      {
        headers: getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to check Shopify integration status');
    }

    return response.json();
  } catch (error: any) {
    console.error('[SHOPIFY-SERVICE] Error getting integration:', error);
    throw error;
  }
};

// ================================================================
// GET SHOPIFY INTEGRATION BY SHOP (legacy)
// ================================================================
// Check if specific shop has Shopify connected
// ================================================================
export const getShopifyIntegrationByShop = async (shop: string): Promise<{
  connected: boolean;
  shop?: string;
  scope?: string;
  installed_at?: string;
  last_sync_at?: string;
  status?: string;
}> => {
  try {
    const response = await fetch(
      `${API_BASE}/api/shopify-oauth/status?shop=${shop}`,
      {
        headers: getAuthHeaders(),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to check Shopify integration status');
    }

    return response.json();
  } catch (error: any) {
    console.error('[SHOPIFY-SERVICE] Error getting integration by shop:', error);
    throw error;
  }
};

// ================================================================
// DISCONNECT SHOPIFY
// ================================================================
// Disconnect Shopify integration
// ================================================================
export const disconnectShopify = async (shop: string): Promise<void> => {
  try {
    const response = await fetch(
      `${API_BASE}/api/shopify-oauth/disconnect?shop=${shop}`,
      {
        method: 'DELETE',
        headers: getAuthHeaders(),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to disconnect Shopify');
    }
  } catch (error: any) {
    console.error('[SHOPIFY-SERVICE] Error disconnecting:', error);
    throw error;
  }
};

// ================================================================
// START OAUTH FLOW
// ================================================================
// Redirects to Shopify OAuth auth endpoint
// ================================================================
export const startShopifyOAuth = (shop: string, userId?: string, storeId?: string): void => {
  const params = new URLSearchParams({ shop });
  if (userId) params.append('user_id', userId);
  if (storeId) params.append('store_id', storeId);

  const authUrl = `${API_BASE}/api/shopify-oauth/auth?${params.toString()}`;
  console.log('[SHOPIFY-SERVICE] Redirecting to OAuth:', authUrl);

  // Redirect to OAuth flow
  window.location.href = authUrl;
};

// ================================================================
// EXPORT SERVICE
// ================================================================
export const shopifyService = {
  getIntegration: getShopifyIntegration,
  disconnect: disconnectShopify,
  startOAuth: startShopifyOAuth,
};
