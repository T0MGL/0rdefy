// ================================================================
// DELIVERY ATTEMPTS SERVICE
// ================================================================
// Handles CRUD operations for delivery attempts with backend API
// ================================================================

import { DeliveryAttempt } from '@/types';

const API_BASE = import.meta.env.VITE_API_URL || 'https://api.ordefy.io';

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
// GET ALL DELIVERY ATTEMPTS
// ================================================================
export const getDeliveryAttempts = async (params?: {
  order_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ data: DeliveryAttempt[]; pagination: any }> => {
  const queryParams = new URLSearchParams();
  if (params?.order_id) queryParams.append('order_id', params.order_id);
  if (params?.status) queryParams.append('status', params.status);
  if (params?.limit) queryParams.append('limit', params.limit.toString());
  if (params?.offset) queryParams.append('offset', params.offset.toString());

  const response = await fetch(
    `${API_BASE}/api/delivery-attempts?${queryParams.toString()}`,
    {
      headers: getAuthHeaders(),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Error al obtener intentos de entrega');
  }

  return response.json();
};

// ================================================================
// GET SINGLE DELIVERY ATTEMPT
// ================================================================
export const getDeliveryAttemptById = async (id: string): Promise<DeliveryAttempt> => {
  const response = await fetch(`${API_BASE}/api/delivery-attempts/${id}`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Error al obtener intento de entrega');
  }

  return response.json();
};

// ================================================================
// CREATE DELIVERY ATTEMPT
// ================================================================
export const createDeliveryAttempt = async (
  data: Partial<DeliveryAttempt>
): Promise<DeliveryAttempt> => {
  const response = await fetch(`${API_BASE}/api/delivery-attempts`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Error al crear intento de entrega');
  }

  const result = await response.json();
  return result.data;
};

// ================================================================
// UPDATE DELIVERY ATTEMPT
// ================================================================
export const updateDeliveryAttempt = async (
  id: string,
  data: Partial<DeliveryAttempt>
): Promise<DeliveryAttempt> => {
  const response = await fetch(`${API_BASE}/api/delivery-attempts/${id}`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Error al actualizar intento de entrega');
  }

  const result = await response.json();
  return result.data;
};

// ================================================================
// MARK AS DELIVERED
// ================================================================
export const markDeliveryAttemptDelivered = async (
  id: string,
  data: {
    photo_url?: string;
    notes?: string;
  }
): Promise<DeliveryAttempt> => {
  const response = await fetch(
    `${API_BASE}/api/delivery-attempts/${id}/mark-delivered`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Error al marcar como entregado');
  }

  const result = await response.json();
  return result.data;
};

// ================================================================
// MARK AS FAILED
// ================================================================
export const markDeliveryAttemptFailed = async (
  id: string,
  data: {
    failed_reason: string;
    notes?: string;
  }
): Promise<DeliveryAttempt> => {
  const response = await fetch(
    `${API_BASE}/api/delivery-attempts/${id}/mark-failed`,
    {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(data),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Error al marcar como fallido');
  }

  const result = await response.json();
  return result.data;
};

// ================================================================
// DELETE DELIVERY ATTEMPT
// ================================================================
export const deleteDeliveryAttempt = async (id: string): Promise<void> => {
  const response = await fetch(`${API_BASE}/api/delivery-attempts/${id}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Error al eliminar intento de entrega');
  }
};

// ================================================================
// EXPORT ALL
// ================================================================
export const deliveryAttemptsService = {
  getAll: getDeliveryAttempts,
  getById: getDeliveryAttemptById,
  create: createDeliveryAttempt,
  update: updateDeliveryAttempt,
  markDelivered: markDeliveryAttemptDelivered,
  markFailed: markDeliveryAttemptFailed,
  delete: deleteDeliveryAttempt,
};
