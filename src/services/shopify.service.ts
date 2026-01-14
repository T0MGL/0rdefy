// ================================================================
// SHOPIFY SERVICE
// ================================================================
// Handles Shopify OAuth integration API calls
// ================================================================

import { ShopifyIntegration } from '@/types';

let cleanBaseURL = import.meta.env.VITE_API_URL || 'https://api.ordefy.io';
cleanBaseURL = cleanBaseURL.replace(/\/+$/, '');
while (cleanBaseURL.endsWith('/api')) {
  cleanBaseURL = cleanBaseURL.slice(0, -4);
  cleanBaseURL = cleanBaseURL.replace(/\/+$/, '');
}
const API_BASE = cleanBaseURL;

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
  integration?: ShopifyIntegration;
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
      throw new Error('Error al verificar estado de integración con Shopify');
    }

    return response.json();
  } catch (error: unknown) {
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
      throw new Error('Error al verificar estado de integración con Shopify');
    }

    return response.json();
  } catch (error: unknown) {
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
      throw new Error(error.message || 'Error al desconectar Shopify');
    }
  } catch (error: unknown) {
    console.error('[SHOPIFY-SERVICE] Error disconnecting:', error);
    throw error;
  }
};

// ================================================================
// START OAUTH FLOW
// ================================================================
// Starts OAuth flow - uses popup if in iframe (Shopify embedded mode)
// otherwise redirects normally
// ================================================================
export const startShopifyOAuth = (shop: string, userId?: string, storeId?: string): void => {
  const params = new URLSearchParams({ shop });
  if (userId) params.append('user_id', userId);
  if (storeId) params.append('store_id', storeId);

  // Detect if we're in an iframe (Shopify embedded mode)
  const isInIframe = window.top !== window.self;

  if (isInIframe) {
    // Add popup=true flag to signal backend to use popup callback page
    params.append('popup', 'true');
  }

  const authUrl = `${API_BASE}/api/shopify-oauth/auth?${params.toString()}`;
  console.log('[SHOPIFY-SERVICE] Starting OAuth:', authUrl);
  console.log('[SHOPIFY-SERVICE] Embedded mode (iframe):', isInIframe);

  if (isInIframe) {
    // Open OAuth in popup window (Shopify embedded mode)
    const width = 600;
    const height = 700;
    const left = (window.screen.width - width) / 2;
    const top = (window.screen.height - height) / 2;

    const popup = window.open(
      authUrl,
      'shopify-oauth',
      `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`
    );

    if (!popup) {
      console.error('[SHOPIFY-SERVICE] ❌ Popup blocked! User must allow popups.');
      alert('Por favor permite las ventanas emergentes para conectar con Shopify.');
      return;
    }

    console.log('[SHOPIFY-SERVICE] ✅ OAuth popup opened');
  } else {
    // Normal redirect (standalone mode)
    console.log('[SHOPIFY-SERVICE] Redirecting to OAuth (standalone mode)');
    window.location.href = authUrl;
  }
};

// ================================================================
// SYNC ORDERS FROM SHOPIFY
// ================================================================
// Manually trigger order synchronization from Shopify
// ================================================================
export const syncOrdersFromShopify = async (): Promise<{
  success: boolean;
  job_ids?: string[];
  integration_id?: string;
  message?: string;
  error?: string;
}> => {
  try {
    const response = await fetch(
      `${API_BASE}/api/shopify/sync-orders`,
      {
        method: 'POST',
        headers: getAuthHeaders(),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Error al sincronizar pedidos desde Shopify');
    }

    return response.json();
  } catch (error: unknown) {
    console.error('[SHOPIFY-SERVICE] Error syncing orders:', error);
    throw error;
  }
};

// ================================================================
// EXPORT SERVICE
// ================================================================
export const shopifyService = {
  getIntegration: getShopifyIntegration,
  disconnect: disconnectShopify,
  startOAuth: startShopifyOAuth,
  syncOrders: syncOrdersFromShopify,
};
