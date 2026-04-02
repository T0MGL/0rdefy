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
    status?: string;
    carrier_id?: string;
    search?: string;
    scheduled_filter?: 'all' | 'scheduled' | 'ready';
    timezone?: string;
  }): Promise<OrdersResponse> => {
    try {
      const queryParams = new URLSearchParams();
      if (params?.startDate) queryParams.append('startDate', params.startDate);
      if (params?.endDate) queryParams.append('endDate', params.endDate);
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      if (params?.offset) queryParams.append('offset', params.offset.toString());
      if (params?.status) queryParams.append('status', params.status);
      if (params?.carrier_id) queryParams.append('carrier_id', params.carrier_id);
      if (params?.search) queryParams.append('search', params.search);
      if (params?.scheduled_filter) queryParams.append('scheduled_filter', params.scheduled_filter);
      if (params?.timezone) queryParams.append('timezone', params.timezone);

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
      throw error instanceof Error ? error : new Error('Failed to load orders');
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

      const variantId = order.variant_id || null;
      const variantTitle = order.variant_title || null;
      const unitsPerPack = order.units_per_pack || 1;

      const upsellProductId = order.upsell_product_id || null;
      const upsellProductName = order.upsell_product_name || null;
      const upsellProductPrice = Number(order.upsell_product_price) || 0;
      const upsellQuantity = Number(order.upsell_quantity) || 1;

      // Calculate main product price (total minus upsell if present)
      const upsellTotal = upsellProductId ? upsellProductPrice * upsellQuantity : 0;
      const orderTotal = Number(order.total) || 0;
      const mainProductTotal = orderTotal - upsellTotal;
      const orderQuantity = Number(order.quantity) || 1;
      const mainProductPrice = orderQuantity > 0 ? mainProductTotal / orderQuantity : mainProductTotal;

      interface LineItemPayload {
        product_id?: string;
        variant_id: string | null;
        product_name: string;
        variant_title: string | null;
        sku?: string | null;
        quantity: number;
        price: number;
        units_per_pack?: number;
        is_upsell?: boolean;
        bundle_selections?: Array<{ variant_id: string; variant_name: string; quantity: number }> | null;
      }

      const lineItems: LineItemPayload[] = [{
        product_id: order.product_id,
        variant_id: variantId,
        product_name: order.product,
        variant_title: variantTitle,
        sku: order.product_sku || null,
        quantity: orderQuantity,
        price: mainProductPrice,
        units_per_pack: unitsPerPack,
        bundle_selections: order.bundle_selections || null,
      }];

      // Add upsell as second line item if present
      if (upsellProductId && upsellProductName) {
        lineItems.push({
          product_id: upsellProductId,
          product_name: upsellProductName,
          variant_title: 'Upsell',
          quantity: upsellQuantity,
          price: upsellProductPrice,
          is_upsell: true,
        });
        logger.log('📦 [ORDERS SERVICE] Added upsell line item:', upsellProductName, 'x', upsellQuantity);
      }

      const backendOrder: Record<string, unknown> = {
        customer_first_name: firstName || 'Cliente',
        customer_last_name: lastName || '',
        customer_phone: order.phone,
        customer_email: '',
        customer_address: order.address || '',
        line_items: lineItems,
        total_price: orderTotal,
        subtotal_price: orderTotal,
        total_tax: 0,
        total_shipping: order.shipping_cost || 0,
        shipping_cost: order.shipping_cost || 0,
        currency: 'PYG',
        financial_status: order.paymentMethod === 'paid' ? 'paid' : 'pending',
        payment_status: order.paymentMethod === 'paid' ? 'collected' : 'pending',
        payment_method: order.paymentMethod === 'cod' ? 'cash_on_delivery' : 'online',
        cod_amount: order.paymentMethod === 'cod' ? orderTotal : 0,
        courier_id: order.is_pickup ? null : order.carrier,
        google_maps_link: order.google_maps_link || null,
        shipping_city: order.shipping_city || null,
        shipping_city_normalized: order.shipping_city_normalized || null,
        delivery_zone: order.delivery_zone || null,
        is_pickup: order.is_pickup || false,
        internal_notes: order.internal_notes || null,
        upsell_added: !!upsellProductId,
        delivery_preferences: order.delivery_preferences || null,
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

      // Transform backend response to frontend format, including line_items
      // so ProductThumbnails renders images immediately (no text fallback)
      const mappedLineItems = lineItems.map((item, index) => ({
        id: `${result.data.id}-li-${index}`,
        product_id: item.product_id,
        variant_id: item.variant_id,
        product_name: item.product_name,
        variant_title: item.variant_title,
        sku: item.sku,
        quantity: item.quantity,
        unit_price: item.price,
        total_price: item.price * item.quantity,
        units_per_pack: item.units_per_pack,
        is_upsell: item.is_upsell || false,
      }));

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
        carrier_id: order.is_pickup ? undefined : order.carrier,
        google_maps_link: order.google_maps_link,
        shipping_city: order.shipping_city,
        shipping_cost: order.shipping_cost,
        is_pickup: order.is_pickup,
        delivery_preferences: order.delivery_preferences,
        internal_notes: order.internal_notes,
        has_internal_notes: !!order.internal_notes,
        customer_ruc: order.customer_ruc,
        customer_ruc_dv: order.customer_ruc_dv,
        payment_method: order.paymentMethod === 'cod' ? 'cash_on_delivery' : 'online',
        financial_status: order.paymentMethod === 'paid' ? 'paid' : 'pending',
        cod_amount: order.paymentMethod === 'cod' ? orderTotal : 0,
        order_line_items: mappedLineItems,
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

      const backendData: Record<string, unknown> = {};

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
          variant_id: data.variant_id || null,
          quantity: data.quantity || 1,
          price: data.total && data.quantity ? data.total / data.quantity : 0,
        }];
        backendData.line_items = lineItems;
        if (data.total) {
          backendData.total_price = data.total;
          backendData.subtotal_price = data.total;
        }
      }

      if (data.carrier) {
        backendData.courier_id = data.carrier;
      }

      if (data.paymentMethod) {
        backendData.payment_method = data.paymentMethod === 'cod' ? 'cash_on_delivery' : 'online';
        backendData.payment_status = data.paymentMethod === 'cod' ? 'pending' : 'collected';
      }

      if (data.shipping_city !== undefined) backendData.shipping_city = data.shipping_city;
      if (data.shipping_city_normalized !== undefined) backendData.shipping_city_normalized = data.shipping_city_normalized;
      if (data.is_pickup !== undefined) backendData.is_pickup = data.is_pickup;
      if (data.google_maps_link !== undefined) backendData.google_maps_link = data.google_maps_link;

      if (data.delivery_preferences !== undefined) {
        backendData.delivery_preferences = data.delivery_preferences;
      }

      if (data.internal_notes !== undefined) {
        backendData.internal_notes = data.internal_notes;
      }

      if (data.customer_ruc !== undefined) {
        backendData.customer_ruc = data.customer_ruc;
        backendData.customer_ruc_dv = data.customer_ruc_dv;
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

      const upsellProductId = data.upsell_product_id;
      const upsellQuantity = data.upsell_quantity;

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
            if (upsellResult.data) {
              updatedOrder.total_price = upsellResult.data.total_price;
              updatedOrder.total = upsellResult.data.total_price;
              updatedOrder.upsell_added = upsellResult.data.upsell_added;
            }
            // Add upsell to local line items so UI reflects the change
            if (upsellResult.upsell_total && data.upsell_product_name) {
              const upsellLineItem = {
                product_id: upsellProductId,
                product_name: data.upsell_product_name,
                quantity: upsellQuantity || 1,
                unit_price: data.upsell_product_price || 0,
                total_price: upsellResult.upsell_total,
                is_upsell: true,
              };
              const existing = updatedOrder.order_line_items || updatedOrder.line_items || [];
              const withoutUpsell = Array.isArray(existing) ? existing.filter((i: any) => !i.is_upsell) : [];
              updatedOrder.order_line_items = [...withoutUpsell, upsellLineItem];
              updatedOrder.line_items = [...withoutUpsell, upsellLineItem];
            }
          } else {
            const errBody = await upsellResponse.json().catch(() => ({}));
            logger.error('Upsell PATCH failed:', upsellResponse.status, errBody.message || errBody.error);
            throw new Error(errBody.message || 'Error al agregar upsell al pedido');
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
            if (upsellResult.data) {
              updatedOrder.total_price = upsellResult.data.total_price;
              updatedOrder.total = upsellResult.data.total_price;
              updatedOrder.upsell_added = upsellResult.data.upsell_added;
            }
            // Remove upsell from local line items
            const existing = updatedOrder.order_line_items || updatedOrder.line_items || [];
            const withoutUpsell = Array.isArray(existing) ? existing.filter((i: any) => !i.is_upsell) : [];
            updatedOrder.order_line_items = withoutUpsell;
            updatedOrder.line_items = withoutUpsell;
          } else {
            const errBody = await upsellResponse.json().catch(() => ({}));
            logger.error('Upsell remove PATCH failed:', upsellResponse.status, errBody.message || errBody.error);
            throw new Error(errBody.message || 'Error al remover upsell del pedido');
          }
        }
      }

      return updatedOrder;
    } catch (error) {
      logger.error('Error updating order:', error);
      throw error;
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

  // Mark order as contacted (WhatsApp message sent, waiting for customer response)
  contact: async (id: string): Promise<Order | undefined> => {
    try {
      const response = await fetch(`${API_BASE_URL}/orders/${id}/status`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({
          sleeves_status: 'contacted',
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
        status: 'contacted',
        carrier: data.shipping_address?.company || 'Sin transportadora',
        date: data.created_at,
        phone: data.customer_phone || '',
        confirmedByWhatsApp: false,
        delivery_link_token: data.delivery_link_token,
        latitude: data.latitude,
        longitude: data.longitude,
      };
    } catch (error) {
      logger.error('Error marking order as contacted:', error);
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

      const statusError = new Error(errorData.message || `Error HTTP: ${response.status}`) as Error & {
        response: { status: number; data: Record<string, unknown> };
      };
      statusError.response = {
        status: response.status,
        data: errorData
      };

      logger.error('Error updating order status:', statusError, errorData);
      throw statusError;
    }

    const result = await response.json();

    // Transform backend response to frontend format
    const data = result.data;
    const lineItems = data.line_items || data.order_line_items || [];
    const firstItem = Array.isArray(lineItems) && lineItems.length > 0 ? lineItems[0] : null;
    interface RawLineItem {
      id?: string;
      product_id?: string;
      variant_id?: string;
      product_name?: string;
      title?: string;
      variant_title?: string;
      sku?: string;
      quantity?: number;
      unit_price?: number;
      price?: number;
      total_price?: number;
      units_per_pack?: number;
      shopify_product_id?: string;
      shopify_variant_id?: string;
      products?: { id: string; name: string; image_url?: string };
    }

    const mappedLineItems = Array.isArray(lineItems)
      ? lineItems.map((item: RawLineItem, index: number) => {
          const unitPrice = Number(item.unit_price ?? item.price ?? 0);
          const quantity = Number(item.quantity ?? 1);
          return {
            id: item.id || `${data.id}-li-${index}`,
            product_id: item.product_id,
            variant_id: item.variant_id,
            product_name: item.product_name || item.title || 'Producto',
            variant_title: item.variant_title,
            sku: item.sku,
            quantity,
            unit_price: unitPrice,
            total_price: Number(item.total_price ?? unitPrice * quantity),
            units_per_pack: item.units_per_pack,
            shopify_product_id: item.shopify_product_id,
            shopify_variant_id: item.shopify_variant_id,
            products: item.products
              ? {
                  id: item.products.id,
                  name: item.products.name,
                  image_url: item.products.image_url,
                }
              : undefined,
          };
        })
      : undefined;

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
      order_line_items: mappedLineItems,
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

      const bulkError = new Error(errorData.message || `Error HTTP: ${response.status}`) as Error & {
        response: { status: number; data: Record<string, unknown> };
      };
      bulkError.response = {
        status: response.status,
        data: errorData
      };
      throw bulkError;
    }

    const result = await response.json();
    return {
      success: result.success,
      data: result.data
    };
  },

  getCountsByStatus: async (params?: {
    startDate?: string;
    endDate?: string;
  }): Promise<{ data: Record<string, number>; total: number }> => {
    try {
      const queryParams = new URLSearchParams();
      if (params?.startDate) queryParams.append('startDate', params.startDate);
      if (params?.endDate) queryParams.append('endDate', params.endDate);

      const url = `${API_BASE_URL}/orders/stats/counts-by-status${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      const response = await fetch(url, {
        headers: getHeaders(),
      });
      if (!response.ok) {
        throw new Error(`Error HTTP: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      logger.error('Error fetching order counts:', error);
      return { data: {}, total: 0 };
    }
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

  /**
   * Update internal notes for an order
   * Notes are for admin observations - not visible to customers or couriers
   * Max 5000 characters
   */
  updateInternalNotes: async (id: string, notes: string | null): Promise<{ success: boolean; data?: { internal_notes: string | null } }> => {
    try {
      const response = await fetch(`${API_BASE_URL}/orders/${id}/internal-notes`, {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ internal_notes: notes }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Error HTTP: ${response.status}`);
      }

      const result = await response.json();
      return { success: true, data: result.data };
    } catch (error) {
      logger.error('Error updating internal notes:', error);
      throw error;
    }
  },
};
