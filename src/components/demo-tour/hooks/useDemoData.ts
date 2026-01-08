// Hook for creating and managing demo data during the tour

import { useCallback } from 'react';
import { useDemoTour } from '../DemoTourProvider';
import {
  demoCarrierTemplate,
  demoProductTemplate,
  demoCustomerTemplate,
  demoOrderTemplate,
} from '../utils/demoDataTemplates';
import type { Carrier } from '@/services/carriers.service';
import type { Product, Order, Customer } from '@/types';

const API_BASE = '/api';

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('auth_token');
  const storeId = localStorage.getItem('current_store_id');

  return {
    'Authorization': `Bearer ${token}`,
    'X-Store-ID': storeId || '',
    'Content-Type': 'application/json',
  };
}

export function useDemoData() {
  const { updateDemoData, demoData } = useDemoTour();

  // Create demo carrier with zones
  const createDemoCarrier = useCallback(async (): Promise<Carrier | null> => {
    try {
      // First create the carrier
      const carrierResponse = await fetch(`${API_BASE}/carriers`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: demoCarrierTemplate.name,
          code: demoCarrierTemplate.code,
          phone: demoCarrierTemplate.phone,
          email: demoCarrierTemplate.email,
        }),
      });

      if (!carrierResponse.ok) {
        throw new Error('Failed to create demo carrier');
      }

      const carrier = await carrierResponse.json();

      // Then create zones for the carrier
      for (const zone of demoCarrierTemplate.zones) {
        await fetch(`${API_BASE}/carriers/${carrier.id}/zones`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            zone_name: zone.zone_name,
            price: zone.price,
            delivery_time: zone.delivery_time,
          }),
        });
      }

      // Update demo data context
      updateDemoData({ carrier });

      console.log('[DemoData] Created demo carrier:', carrier.id);
      return carrier;
    } catch (error) {
      console.error('[DemoData] Error creating demo carrier:', error);
      return null;
    }
  }, [updateDemoData]);

  // Create demo product
  const createDemoProduct = useCallback(async (): Promise<Product | null> => {
    try {
      const response = await fetch(`${API_BASE}/products`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: demoProductTemplate.name,
          sku: demoProductTemplate.sku,
          price: demoProductTemplate.price,
          cost: demoProductTemplate.cost,
          stock: demoProductTemplate.stock,
          category: demoProductTemplate.category,
          description: demoProductTemplate.description,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create demo product');
      }

      const product = await response.json();
      updateDemoData({ product });

      console.log('[DemoData] Created demo product:', product.id);
      return product;
    } catch (error) {
      console.error('[DemoData] Error creating demo product:', error);
      return null;
    }
  }, [updateDemoData]);

  // Create demo customer
  const createDemoCustomer = useCallback(async (): Promise<Customer | null> => {
    try {
      const response = await fetch(`${API_BASE}/customers`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name: demoCustomerTemplate.name,
          email: demoCustomerTemplate.email,
          phone: demoCustomerTemplate.phone,
          address: demoCustomerTemplate.address,
          city: demoCustomerTemplate.city,
          notes: demoCustomerTemplate.notes,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create demo customer');
      }

      const customer = await response.json();
      updateDemoData({ customer });

      console.log('[DemoData] Created demo customer:', customer.id);
      return customer;
    } catch (error) {
      console.error('[DemoData] Error creating demo customer:', error);
      return null;
    }
  }, [updateDemoData]);

  // Create demo order
  const createDemoOrder = useCallback(async (): Promise<Order | null> => {
    const { carrier, product, customer } = demoData;

    if (!carrier || !product) {
      console.error('[DemoData] Cannot create order: missing carrier or product');
      return null;
    }

    try {
      // Find the Asuncion zone for shipping
      const zonesResponse = await fetch(`${API_BASE}/carriers/${carrier.id}/zones`, {
        headers: getAuthHeaders(),
      });

      let shippingCost = 25000;
      if (zonesResponse.ok) {
        const zones = await zonesResponse.json();
        const asuncionZone = zones.find((z: any) => z.zone_name === 'Asuncion');
        if (asuncionZone) {
          shippingCost = asuncionZone.price;
        }
      }

      // Calculate totals
      const quantity = demoOrderTemplate.quantity;
      const subtotal = product.price * quantity;
      const totalPrice = subtotal + shippingCost;

      const response = await fetch(`${API_BASE}/orders`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          customer_name: customer?.name || demoOrderTemplate.customer_name,
          customer_email: customer?.email || demoOrderTemplate.customer_email,
          customer_phone: customer?.phone || demoOrderTemplate.customer_phone,
          customer_id: customer?.id,
          shipping_address: demoOrderTemplate.shipping_address,
          carrier_id: carrier.id,
          shipping_zone: demoOrderTemplate.shipping_zone,
          shipping_cost: shippingCost,
          subtotal_price: subtotal,
          total_price: totalPrice,
          notes: demoOrderTemplate.notes,
          status: 'pending',
          line_items: [
            {
              product_id: product.id,
              product_name: product.name,
              sku: product.sku,
              quantity: quantity,
              unit_price: product.price,
              total_price: subtotal,
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create demo order');
      }

      const order = await response.json();
      updateDemoData({ order });

      console.log('[DemoData] Created demo order:', order.id);
      return order;
    } catch (error) {
      console.error('[DemoData] Error creating demo order:', error);
      return null;
    }
  }, [demoData, updateDemoData]);

  // Confirm demo order
  const confirmDemoOrder = useCallback(async (): Promise<boolean> => {
    const { order } = demoData;

    if (!order?.id) {
      console.error('[DemoData] Cannot confirm: no demo order');
      return false;
    }

    try {
      const response = await fetch(`${API_BASE}/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ status: 'confirmed' }),
      });

      if (!response.ok) {
        throw new Error('Failed to confirm demo order');
      }

      const updatedOrder = await response.json();
      updateDemoData({ order: updatedOrder });

      console.log('[DemoData] Confirmed demo order:', order.id);
      return true;
    } catch (error) {
      console.error('[DemoData] Error confirming demo order:', error);
      return false;
    }
  }, [demoData, updateDemoData]);

  // Create picking session for demo order
  const createDemoPickingSession = useCallback(async (): Promise<string | null> => {
    const { order } = demoData;

    if (!order?.id) {
      console.error('[DemoData] Cannot create picking session: no demo order');
      return null;
    }

    try {
      const response = await fetch(`${API_BASE}/warehouse/sessions`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          order_ids: [order.id],
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create picking session');
      }

      const session = await response.json();
      updateDemoData({ pickingSessionId: session.id });

      console.log('[DemoData] Created picking session:', session.id);
      return session.id;
    } catch (error) {
      console.error('[DemoData] Error creating picking session:', error);
      return null;
    }
  }, [demoData, updateDemoData]);

  // Complete picking for demo session
  const completeDemoPicking = useCallback(async (): Promise<boolean> => {
    const { pickingSessionId } = demoData;

    if (!pickingSessionId) {
      console.error('[DemoData] Cannot complete picking: no session');
      return false;
    }

    try {
      // Get session items
      const itemsResponse = await fetch(`${API_BASE}/warehouse/sessions/${pickingSessionId}/picking-list`, {
        headers: getAuthHeaders(),
      });

      if (!itemsResponse.ok) {
        throw new Error('Failed to get picking items');
      }

      const items = await itemsResponse.json();

      // Mark all items as picked
      for (const item of items) {
        await fetch(`${API_BASE}/warehouse/sessions/${pickingSessionId}/pick`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            product_id: item.product_id,
            picked_quantity: item.total_quantity,
          }),
        });
      }

      // Complete picking phase
      await fetch(`${API_BASE}/warehouse/sessions/${pickingSessionId}/complete-picking`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });

      console.log('[DemoData] Completed picking for session:', pickingSessionId);
      return true;
    } catch (error) {
      console.error('[DemoData] Error completing picking:', error);
      return false;
    }
  }, [demoData]);

  // Complete packing for demo session
  const completeDemoPacking = useCallback(async (): Promise<boolean> => {
    const { pickingSessionId, order } = demoData;

    if (!pickingSessionId || !order?.id) {
      console.error('[DemoData] Cannot complete packing: missing data');
      return false;
    }

    try {
      // Complete packing for the order
      await fetch(`${API_BASE}/warehouse/sessions/${pickingSessionId}/complete-packing`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          order_id: order.id,
        }),
      });

      // Refresh order status
      const orderResponse = await fetch(`${API_BASE}/orders/${order.id}`, {
        headers: getAuthHeaders(),
      });

      if (orderResponse.ok) {
        const updatedOrder = await orderResponse.json();
        updateDemoData({ order: updatedOrder });
      }

      console.log('[DemoData] Completed packing for order:', order.id);
      return true;
    } catch (error) {
      console.error('[DemoData] Error completing packing:', error);
      return false;
    }
  }, [demoData, updateDemoData]);

  // Create dispatch session
  const createDemoDispatchSession = useCallback(async (): Promise<string | null> => {
    const { order } = demoData;

    if (!order?.id) {
      console.error('[DemoData] Cannot create dispatch: no demo order');
      return null;
    }

    try {
      const response = await fetch(`${API_BASE}/settlements/dispatch-sessions`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          order_ids: [order.id],
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create dispatch session');
      }

      const session = await response.json();
      updateDemoData({ dispatchSessionId: session.id });

      console.log('[DemoData] Created dispatch session:', session.id);
      return session.id;
    } catch (error) {
      console.error('[DemoData] Error creating dispatch session:', error);
      return null;
    }
  }, [demoData, updateDemoData]);

  return {
    demoData,
    createDemoCarrier,
    createDemoProduct,
    createDemoCustomer,
    createDemoOrder,
    confirmDemoOrder,
    createDemoPickingSession,
    completeDemoPicking,
    completeDemoPacking,
    createDemoDispatchSession,
  };
}
