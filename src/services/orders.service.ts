import { Order, CreateOrderInput, UpdateOrderInput } from '@/types';
import { logger } from '@/utils/logger';

let cleanBaseURL = import.meta.env.VITE_API_URL || 'https://api.ordefy.io';
cleanBaseURL = cleanBaseURL.trim();
cleanBaseURL = cleanBaseURL.replace(/(\/api\/?)+$/i, '');
cleanBaseURL = cleanBaseURL.replace(/\/+$/, '');
const API_BASE_URL = `${cleanBaseURL}/api`;

const getHeaders = () => {
  const token = localStorage.getItem('auth_token');
  const storeId = localStorage.getItem('current_store_id');
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (storeId) {
    headers['X-Store-ID'] = storeId;
  }
  return headers;
};

export interface OrdersResponse {
  data: Order[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export const ordersService = {
  getAll: async (params?: {
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<OrdersResponse> => {
    try {
      const queryParams = new URLSearchParams();
      if (params?.startDate) queryParams.append('startDate', params.startDate);
      if (params?.endDate) queryParams.append('endDate', params.endDate);
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.offset) queryParams.append('offset', params.offset.toString());

      const url = `${API_BASE_URL}/orders${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      const response = await fetch(url, {
        headers: getHeaders(),
      });
      if (!response.ok) {
        throw new Error(`Error HTTP: ${response.status}`);
      }
      const result = await response.json();
      return {
        data: result.data || [],
        pagination: result.pagination || { total: 0, limit: 50, offset: 0, hasMore: false }
      };
    } catch (error) {
      logger.error('Error loading orders:', error);
      return { data: [], pagination: { total: 0, limit: 50, offset: 0, hasMore: false } };
    }
  },

  getById: async (id: string): Promise<Order | undefined> => {
    try {
      const response = await fetch(`${API_BASE_URL}/orders/${id}`, {
        headers: getHeaders(),
      });
      if (!response.ok) {
        if (response.status === 404) return undefined;
        throw new Error(`Error HTTP: ${response.status}`);
      }
      const data = await response.json();
      return data;
    } catch (error) {
      logger.error('Error loading order:', error);
      return undefined;
    }
  },

  create: async (order: CreateOrderInput): Promise<Order> => {
    try {
      logger.log('📤 [ORDERS SERVICE] Creating order:', order);

      // Transform frontend format to backend format
      const [firstName, ...lastNameParts] = (order.customer || '').split(' ');
      const lastName = lastNameParts.join(' ');

      const backendOrder: any = {
        customer_first_name: firstName || 'Cliente',
        customer_last_name: lastName || '',
        customer_phone: order.phone,
        customer_email: '',
        customer_address: order.address || '',
        line_items: [{
          product_id: order.product_id,
          product_name: order.product,
          quantity: order.quantity || 1,
          price: order.quantity > 0 ? order.total / order.quantity : order.total,
        }],
        total_price: order.total,
        subtotal_price: order.total,
        total_tax: 0,
        total_shipping: (order as any).shipping_cost || 0,
        shipping_cost: (order as any).shipping_cost || 0,
        currency: 'PYG',
        financial_status: 'pending',
        payment_status: order.paymentMethod === 'paid' ? 'collected' : 'pending',
        payment_method: order.paymentMethod === 'cod' ? 'cash' : 'online',
        courier_id: (order as any).is_pickup ? null : order.carrier,
        // New shipping fields
        google_maps_link: (order as any).google_maps_link || null,
        shipping_city: (order as any).shipping_city || null,
        shipping_city_normalized: (order as any).shipping_city_normalized || null,
        delivery_zone: (order as any).delivery_zone || null,
        is_pickup: (order as any).is_pickup || false,
      };

      logger.log('📤 [ORDERS SERVICE] Sending to backend:', backendOrder);

      const response = await fetch(`${API_BASE_URL}/orders`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(backendOrder),
      });

      if (!response.ok) {
        const errorData = await response.json();
        logger.error('❌ [ORDERS SERVICE] Backend error:', errorData);
        throw new Error(errorData.message || `Error HTTP: ${response.status}`);
      }

      const result = await response.json();
      logger.log('✅ [ORDERS SERVICE] Order created:', result.data);

      // Transform backend response to frontend format
      return {
        id: result.data.id,
        customer: order.customer,
        product: order.product,
        quantity: order.quantity,
        total: order.total,
        status: order.status,
        carrier: order.carrier,
        date: result.data.created_at,
        phone: order.phone,
        confirmedByWhatsApp: false,
      };
    } catch (error) {
      logger.error('❌ [ORDERS SERVICE] Error creating order:', error);
      throw error;
    }
  },

  update: async (id: string, data: UpdateOrderInput): Promise<Order | undefined> => {
    try {
      // Transform frontend format to backend format
      const [firstName, ...lastNameParts] = (data.customer || '').split(' ');
      const lastName = lastNameParts.join(' ');

      const backendData: any = {};

      if (data.customer) {
        backendData.customer_first_name = firstName || 'Cliente';
        backendData.customer_last_name = lastName || '';
      }

      if (data.phone) backendData.customer_phone = data.phone;
      if (data.address) backendData.customer_address = data.address;

      if (data.product || data.quantity || data.total) {
        const lineItems = [{
          product_id: data.product_id,
          product_name: data.product,
          quantity: data.quantity || 1,
          price: data.total && data.quantity ? data.total / data.quantity : 0,
        }];
        backendData.line_items = lineItems;
        if (data.total) {
          backendData.total_price = data.total;
          backendData.subtotal_price = data.total;
        }
      }

      // Send courier_id as UUID (not shipping_address.company)
      if (data.carrier) {
        backendData.courier_id = data.carrier;
      }

      // Send payment_method: 'cod' → 'cash', 'paid' → 'online'
      if ((data as any).paymentMethod) {
        backendData.payment_method = (data as any).paymentMethod === 'cod' ? 'cash' : 'online';
        // Update payment_status to match: COD = pending, paid = collected
        backendData.payment_status = (data as any).paymentMethod === 'cod' ? 'pending' : 'collected';
      }

      // Shipping info
      if ((data as any).shipping_city !== undefined) backendData.shipping_city = (data as any).shipping_city;
      if ((data as any).shipping_city_normalized !== undefined) backendData.shipping_city_normalized = (data as any).shipping_city_normalized;
      if ((data as any).is_pickup !== undefined) backendData.is_pickup = (data as any).is_pickup;
      if ((data as any).google_maps_link !== undefined) backendData.google_maps_link = (data as any).google_maps_link;

      // Delivery preferences
      if ((data as any).delivery_preferences !== undefined) {
        backendData.delivery_preferences = (data as any).delivery_preferences;
      }

      // Update main order data
      const response = await fetch(`${API_BASE_URL}/orders/${id}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(backendData),
      });

      if (!response.ok) {
        if (response.status === 404) return undefined;
        const errorData = await response.json();
        throw new Error(errorData.message || `Error HTTP: ${response.status}`);
      }

      let updatedOrder = await response.json();

      // Handle upsell separately using dedicated endpoint
      const upsellProductId = (data as any).upsell_product_id;
      const upsellQuantity = (data as any).upsell_quantity;

      if (upsellProductId !== undefined) {
        if (upsellProductId) {
          // Add or update upsell
          const upsellResponse = await fetch(`${API_BASE_URL}/orders/${id}/upsell`, {
            method: 'PATCH',
            headers: getHeaders(),
            body: JSON.stringify({
              upsell_product_id: upsellProductId,
              upsell_quantity: upsellQuantity || 1,
            }),
          });

          if (upsellResponse.ok) {
            const upsellResult = await upsellResponse.json();
            // Update total price from upsell result
            if (upsellResult.data) {
              updatedOrder.total_price = upsellResult.data.total_price;
              updatedOrder.upsell_added = upsellResult.data.upsell_added;
            }
          }
        } else {
          // Remove upsell (upsellProductId is explicitly null/empty)
          const upsellResponse = await fetch(`${API_BASE_URL}/orders/${id}/upsell`, {
            method: 'PATCH',
            headers: getHeaders(),
            body: JSON.stringify({ remove: true }),
          });

          if (upsellResponse.ok) {
            const upsellResult = await upsellResponse.json();
            // Update total price from upsell result
            if (upsellResult.data) {
              updatedOrder.total_price = upsellResult.data.total_price;
              updatedOrder.upsell_added = upsellResult.data.upsell_added;
            }
          }
        }
      }

      return updatedOrder;
    } catch (error) {
      logger.error('Error updating order:', error);
      return undefined;
    }
  },

  delete: async (id: string, permanent: boolean = false): Promise<boolean> => {
    try {
      const url = permanent
        ? `${API_BASE_URL}/orders/${id}?permanent=true`
        : `${API_BASE_URL}/orders/${id}`;
      const response = await fetch(url, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      if (!response.ok) {
        if (response.status === 404) return false;
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Error HTTP: ${response.status}`);
      }
      return true;
    } catch (error) {
      logger.error('Error deleting order:', error);
      throw error; // Re-throw to show error message in UI
    }
  },

  restore: async (id: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/orders/${id}/restore`, {
        method: 'POST',
        headers: getHeaders(),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Error HTTP: ${response.status}`);
      }
      return true;
    } catch (error) {
      logger.error('Error restoring order:', error);
      throw error;
    }
  },

  markAsTest: async (id: string, isTest: boolean): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/orders/${id}/test`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ is_test: isTest }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Error HTTP: ${response.status}`);
      }
      return true;
    } catch (error) {
      logger.error('Error updating test status:', error);
      throw error;
    }
  },

  confirm: async (id: string): Promise<Order | undefined> => {
    try {
      const response = await fetch(`${API_BASE_URL}/orders/${id}/status`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({
          sleeves_status: 'confirmed',
          confirmed_by: 'manual',
          confirmation_method: 'whatsapp',
        }),
      });

      if (!response.ok) {
        throw new Error(`Error HTTP: ${response.status}`);
      }

      const result = await response.json();

      // Transform backend response to frontend format
      const data = result.data;
      const lineItems = data.line_items || [];
      const firstItem = Array.isArray(lineItems) && lineItems.length > 0 ? lineItems[0] : null;

      return {
        id: data.id,
        customer: `${data.customer_first_name || ''} ${data.customer_last_name || ''}`.trim() || 'Cliente',
        address: data.customer_address || '',
        product: firstItem?.product_name || firstItem?.title || 'Producto',
        quantity: firstItem?.quantity || 1,
        total: data.total_price || 0,
        status: 'confirmed',
        carrier: data.shipping_address?.company || 'Sin transportadora',
        date: data.created_at,
        phone: data.customer_phone || '',
        confirmedByWhatsApp: true,
        confirmationTimestamp: data.confirmed_at,
        confirmationMethod: data.confirmation_method || 'manual',
        delivery_link_token: data.delivery_link_token,
        latitude: data.latitude,
        longitude: data.longitude,
      };
    } catch (error) {
      logger.error('Error confirming order:', error);
      return undefined;
    }
  },

  reject: async (id: string, reason?: string): Promise<Order | undefined> => {
    try {
      const response = await fetch(`${API_BASE_URL}/orders/${id}/status`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({
          sleeves_status: 'rejected',
          rejection_reason: reason || 'Rechazado manualmente',
        }),
      });

      if (!response.ok) {
        throw new Error(`Error HTTP: ${response.status}`);
      }

      const result = await response.json();

      // Transform backend response to frontend format
      const data = result.data;
      const lineItems = data.line_items || [];
      const firstItem = Array.isArray(lineItems) && lineItems.length > 0 ? lineItems[0] : null;

      return {
        id: data.id,
        customer: `${data.customer_first_name || ''} ${data.customer_last_name || ''}`.trim() || 'Cliente',
        address: data.customer_address || '',
        product: firstItem?.product_name || firstItem?.title || 'Producto',
        quantity: firstItem?.quantity || 1,
        total: data.total_price || 0,
        status: 'cancelled',
        carrier: data.shipping_address?.company || 'Sin transportadora',
        date: data.created_at,
        phone: data.customer_phone || '',
        confirmedByWhatsApp: false,
        rejectionReason: data.rejection_reason,
        delivery_link_token: data.delivery_link_token,
        latitude: data.latitude,
        longitude: data.longitude,
      };
    } catch (error) {
      logger.error('Error rejecting order:', error);
      return undefined;
    }
  },

  updateStatus: async (id: string, status: Order['status']): Promise<Order | undefined> => {
    const response = await fetch(`${API_BASE_URL}/orders/${id}/status`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({
        sleeves_status: status,
      }),
    });

    if (!response.ok) {
      // Parse the error response to get detailed error message
      const errorData = await response.json().catch(() => ({
        error: 'Unknown error',
        message: 'Error desconocido al actualizar el estado'
      }));

      // Create an error object that includes the response data
      const error: any = new Error(errorData.message || `Error HTTP: ${response.status}`);
      error.response = {
        status: response.status,
        data: errorData
      };

      logger.error('Error updating order status:', error, errorData);
      throw error;
    }

    const result = await response.json();

    // Transform backend response to frontend format
    const data = result.data;
    const lineItems = data.line_items || data.order_line_items || [];
    const firstItem = Array.isArray(lineItems) && lineItems.length > 0 ? lineItems[0] : null;

    return {
      id: data.id,
      customer: `${data.customer_first_name || ''} ${data.customer_last_name || ''}`.trim() || 'Cliente',
      address: data.customer_address || '',
      product: firstItem?.product_name || firstItem?.title || 'Producto',
      quantity: firstItem?.quantity || 1,
      total: data.total_price || 0,
      status: data.sleeves_status,
      payment_status: data.payment_status,
      carrier: data.carriers?.name || data.shipping_address?.company || 'Sin transportadora',
      carrier_id: data.carrier_id,
      date: data.created_at,
      phone: data.customer_phone || '',
      confirmedByWhatsApp: data.sleeves_status === 'confirmed',
      confirmationTimestamp: data.confirmed_at,
      inTransitTimestamp: data.in_transit_at,
      deliveredTimestamp: data.delivered_at,
      cancelledTimestamp: data.cancelled_at,
    };
  },

  markAsPrinted: async (id: string): Promise<Order | undefined> => {
    try {
      const response = await fetch(`${API_BASE_URL}/orders/${id}/mark-printed`, {
        method: 'POST',
        headers: getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Error HTTP: ${response.status}`);
      }

      const result = await response.json();
      return result.data;
    } catch (error) {
      logger.error('Error marking order as printed:', error);
      return undefined;
    }
  },

  markAsPrintedBulk: async (orderIds: string[]): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/orders/mark-printed-bulk`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ order_ids: orderIds }),
      });

      if (!response.ok) {
        throw new Error(`Error HTTP: ${response.status}`);
      }

      return true;
    } catch (error) {
      logger.error('Error bulk marking orders as printed:', error);
      return false;
    }
  },

  /**
   * NEW: Atomic bulk print and dispatch operation
   * Returns detailed success/failure per order
   * Safer than individual markAsPrinted + updateStatus calls
   */
  bulkPrintAndDispatch: async (orderIds: string[]): Promise<{
    success: boolean;
    data: {
      total: number;
      succeeded: number;
      failed: number;
      successes: Array<{ order_id: string; order_number: string }>;
      failures: Array<{ order_id: string; order_number: string; error: string }>;
    };
  }> => {
    const response = await fetch(`${API_BASE_URL}/orders/bulk-print-and-dispatch`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ order_ids: orderIds }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        error: 'Unknown error',
        message: 'Error desconocido al procesar pedidos'
      }));

      // For 207 Multi-Status, we have partial results - return them
      if (response.status === 207 && errorData.data) {
        return {
          success: false,
          data: errorData.data
        };
      }

      // For other errors (400, 500), throw with error data
      const error: any = new Error(errorData.message || `Error HTTP: ${response.status}`);
      error.response = {
        status: response.status,
        data: errorData
      };
      throw error;
    }

    const result = await response.json();
    return {
      success: result.success,
      data: result.data
    };
  },

  reconcile: async (ids: string[]): Promise<boolean> => {
    try {
      // NOTE: If backend has a bulk endpoint, use it. For now, we loop.
      const reconciledAt = new Date().toISOString();

      const promises = ids.map(async (id) => {
        const response = await fetch(`${API_BASE_URL}/orders/${id}`, {
          method: 'PUT',
          headers: getHeaders(),
          body: JSON.stringify({ reconciled_at: reconciledAt })
        });
        // Validate response - fetch only rejects on network errors, not HTTP errors
        if (!response.ok) {
          throw new Error(`Error al conciliar pedido ${id}: HTTP ${response.status}`);
        }
        return response;
      });

      await Promise.all(promises);
      return true;
    } catch (error) {
      logger.error('Error reconciling orders:', error);
      return false;
    }
  },
};
