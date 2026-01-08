// Utility functions for cleaning up demo data after tour completion

import type { DemoData } from '../DemoTourProvider';

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

// Delete a demo order (will cascade to line items)
export async function deleteDemoOrder(orderId: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/orders/${orderId}/hard-delete`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      console.warn(`[DemoCleanup] Failed to delete order ${orderId}:`, response.status);
      return false;
    }

    console.log(`[DemoCleanup] Order ${orderId} deleted successfully`);
    return true;
  } catch (error) {
    console.error(`[DemoCleanup] Error deleting order ${orderId}:`, error);
    return false;
  }
}

// Delete a picking session
export async function deleteDemoPickingSession(sessionId: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/warehouse/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      console.warn(`[DemoCleanup] Failed to delete picking session ${sessionId}:`, response.status);
      return false;
    }

    console.log(`[DemoCleanup] Picking session ${sessionId} deleted successfully`);
    return true;
  } catch (error) {
    console.error(`[DemoCleanup] Error deleting picking session ${sessionId}:`, error);
    return false;
  }
}

// Delete a dispatch session
export async function deleteDemoDispatchSession(sessionId: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/settlements/dispatch-sessions/${sessionId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      console.warn(`[DemoCleanup] Failed to delete dispatch session ${sessionId}:`, response.status);
      return false;
    }

    console.log(`[DemoCleanup] Dispatch session ${sessionId} deleted successfully`);
    return true;
  } catch (error) {
    console.error(`[DemoCleanup] Error deleting dispatch session ${sessionId}:`, error);
    return false;
  }
}

// Delete an inbound shipment
export async function deleteDemoInboundShipment(shipmentId: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/merchandise/${shipmentId}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    });

    if (!response.ok) {
      console.warn(`[DemoCleanup] Failed to delete inbound shipment ${shipmentId}:`, response.status);
      return false;
    }

    console.log(`[DemoCleanup] Inbound shipment ${shipmentId} deleted successfully`);
    return true;
  } catch (error) {
    console.error(`[DemoCleanup] Error deleting inbound shipment ${shipmentId}:`, error);
    return false;
  }
}

// Clean up all demo data
export async function cleanupAllDemoData(demoData: DemoData): Promise<void> {
  console.log('[DemoCleanup] Starting cleanup of demo data...');

  const results: Record<string, boolean> = {};

  // Delete in reverse order of creation (dependencies first)

  // 1. Delete dispatch session
  if (demoData.dispatchSessionId) {
    results.dispatchSession = await deleteDemoDispatchSession(demoData.dispatchSessionId);
  }

  // 2. Delete picking session
  if (demoData.pickingSessionId) {
    results.pickingSession = await deleteDemoPickingSession(demoData.pickingSessionId);
  }

  // 3. Delete inbound shipment (if demo, not from Shopify)
  if (demoData.inboundShipmentId) {
    results.inboundShipment = await deleteDemoInboundShipment(demoData.inboundShipmentId);
  }

  // 4. Delete demo order
  if (demoData.order?.id) {
    results.order = await deleteDemoOrder(demoData.order.id);
  }

  // Note: We don't delete carriers or products as they were designed to stay
  // (per user's requirements: Shopify/products stay, demo orders deleted)

  console.log('[DemoCleanup] Cleanup results:', results);

  // Clear localStorage demo data
  localStorage.removeItem('ordefy_demo_tour_data');
}

// Check if there's pending demo data to clean up
export function hasPendingDemoData(): boolean {
  const savedData = localStorage.getItem('ordefy_demo_tour_data');
  if (!savedData) return false;

  try {
    const data: DemoData = JSON.parse(savedData);
    return !!(data.order?.id || data.pickingSessionId || data.dispatchSessionId);
  } catch {
    return false;
  }
}

// Get pending demo data from localStorage
export function getPendingDemoData(): DemoData | null {
  const savedData = localStorage.getItem('ordefy_demo_tour_data');
  if (!savedData) return null;

  try {
    return JSON.parse(savedData);
  } catch {
    return null;
  }
}
