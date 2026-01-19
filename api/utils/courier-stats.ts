// ================================================================
// COURIER STATISTICS UTILITY
// ================================================================
// Utilities for calculating courier delivery rates and performance metrics
// ================================================================

import { supabaseAdmin } from '../db/connection';

/**
 * Calculate delivery rate for a courier
 * @param courierId - UUID of the courier
 * @returns Object with delivery statistics
 */
export async function calculateCourierDeliveryRate(courierId: string) {
  try {
    const { data, error } = await supabaseAdmin
      .from('courier_performance')
      .select('*')
      .eq('id', courierId)
      .single();

    if (error) {
      logger.error('BACKEND', '[Courier Stats] Error fetching courier performance:', error);
      return null;
    }

    return {
      courier_id: data.id,
      courier_name: data.name,
      total_deliveries: data.total_deliveries || 0,
      successful_deliveries: data.successful_deliveries || 0,
      failed_deliveries: data.failed_deliveries || 0,
      delivery_rate: data.delivery_rate || 0,
      assigned_orders: data.assigned_orders || 0,
      delivered_orders: data.delivered_orders || 0,
      pending_orders: data.pending_orders || 0,
      avg_delivery_time_hours: data.avg_delivery_time_hours || null
    };
  } catch (error) {
    logger.error('BACKEND', '[Courier Stats] Error calculating delivery rate:', error);
    return null;
  }
}

/**
 * Get performance metrics for all couriers in a store
 * @param storeId - UUID of the store
 * @returns Array of courier performance metrics
 */
export async function getCourierPerformanceByStore(storeId: string) {
  try {
    const { data, error } = await supabaseAdmin
      .from('courier_performance')
      .select('*')
      .eq('store_id', storeId)
      .order('delivery_rate', { ascending: false });

    if (error) {
      logger.error('BACKEND', '[Courier Stats] Error fetching store courier performance:', error);
      return [];
    }

    return data.map(courier => ({
      courier_id: courier.id,
      courier_name: courier.name,
      phone: courier.phone,
      total_deliveries: courier.total_deliveries || 0,
      successful_deliveries: courier.successful_deliveries || 0,
      failed_deliveries: courier.failed_deliveries || 0,
      delivery_rate: courier.delivery_rate || 0,
      assigned_orders: courier.assigned_orders || 0,
      delivered_orders: courier.delivered_orders || 0,
      failed_orders: courier.failed_orders || 0,
      pending_orders: courier.pending_orders || 0,
      avg_delivery_time_hours: courier.avg_delivery_time_hours || null
    }));
  } catch (error) {
    logger.error('BACKEND', '[Courier Stats] Error fetching courier performance:', error);
    return [];
  }
}

/**
 * Get top performing couriers for a store
 * @param storeId - UUID of the store
 * @param limit - Number of top couriers to return (default: 5)
 * @returns Array of top courier performance metrics
 */
export async function getTopCouriers(storeId: string, limit: number = 5) {
  try {
    const { data, error } = await supabaseAdmin
      .from('courier_performance')
      .select('*')
      .eq('store_id', storeId)
      .gte('total_deliveries', 5) // Only include couriers with at least 5 deliveries
      .order('delivery_rate', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('BACKEND', '[Courier Stats] Error fetching top couriers:', error);
      return [];
    }

    return data.map(courier => ({
      courier_id: courier.id,
      courier_name: courier.name,
      phone: courier.phone,
      delivery_rate: courier.delivery_rate || 0,
      total_deliveries: courier.total_deliveries || 0,
      successful_deliveries: courier.successful_deliveries || 0,
      avg_delivery_time_hours: courier.avg_delivery_time_hours || null
    }));
  } catch (error) {
    logger.error('BACKEND', '[Courier Stats] Error fetching top couriers:', error);
    return [];
  }
}

/**
 * Get underperforming couriers (delivery rate < threshold)
 * @param storeId - UUID of the store
 * @param threshold - Minimum acceptable delivery rate (default: 80)
 * @returns Array of underperforming courier metrics
 */
export async function getUnderperformingCouriers(storeId: string, threshold: number = 80) {
  try {
    const { data, error } = await supabaseAdmin
      .from('courier_performance')
      .select('*')
      .eq('store_id', storeId)
      .gte('total_deliveries', 5) // Only include couriers with at least 5 deliveries
      .lt('delivery_rate', threshold)
      .order('delivery_rate', { ascending: true });

    if (error) {
      logger.error('BACKEND', '[Courier Stats] Error fetching underperforming couriers:', error);
      return [];
    }

    return data.map(courier => ({
      courier_id: courier.id,
      courier_name: courier.name,
      phone: courier.phone,
      delivery_rate: courier.delivery_rate || 0,
      total_deliveries: courier.total_deliveries || 0,
      failed_deliveries: courier.failed_deliveries || 0,
      pending_orders: courier.pending_orders || 0
    }));
  } catch (error) {
    logger.error('BACKEND', '[Courier Stats] Error fetching underperforming couriers:', error);
    return [];
  }
}
