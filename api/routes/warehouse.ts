/**
 * Warehouse API Routes
 * Endpoints for managing warehouse picking and packing workflow
 */

import { logger } from '../utils/logger';
import { Router } from 'express';
import { verifyToken, extractStoreId } from '../middleware/auth';
import { extractUserRole, requireModule, requirePermission } from '../middleware/permissions';
import { requireFeature } from '../middleware/planLimits';
import { Module, Permission } from '../permissions';
import * as warehouseService from '../services/warehouse.service';
import { noOrdersSelected, serverError, missingRequiredFields } from '../utils/errorResponses';
import { validateUUIDParam, validateUUIDParams } from '../utils/sanitize';
import { supabaseAdmin } from '../db/connection';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyToken);
router.use(extractStoreId);
router.use(extractUserRole);

// Apply module-level access check for all routes
router.use(requireModule(Module.WAREHOUSE));

// Apply plan feature check - warehouse requires Starter+ plan
router.use(requireFeature('warehouse'));

/**
 * GET /api/warehouse/orders/confirmed
 * Gets all confirmed orders ready for preparation
 */
router.get('/orders/confirmed', async (req, res) => {
  try {
    const storeId = req.storeId;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const orders = await warehouseService.getConfirmedOrders(storeId);

    res.json(orders);
  } catch (error) {
    logger.error('API', 'Error fetching confirmed orders:', error);
    res.status(500).json({
      error: 'Error al obtener pedidos confirmados',
      details: error.message
    });
  }
});

/**
 * GET /api/warehouse/sessions/active
 * Gets all active picking sessions
 */
router.get('/sessions/active', async (req, res) => {
  try {
    const storeId = req.storeId;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const sessions = await warehouseService.getActiveSessions(storeId);

    res.json(sessions);
  } catch (error) {
    logger.error('API', 'Error fetching active sessions:', error);
    res.status(500).json({
      error: 'Error al obtener sesiones activas',
      details: error.message
    });
  }
});

/**
 * POST /api/warehouse/sessions
 * Creates a new picking session from confirmed orders
 * Body: { orderIds: string[] }
 */
router.post('/sessions', requirePermission(Module.WAREHOUSE, Permission.CREATE), async (req, res) => {
  try {
    const storeId = req.storeId;
    const userId = req.userId;
    const { orderIds } = req.body;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return noOrdersSelected(res);
    }

    // Limit max orders per session to prevent excessive query times
    const MAX_ORDERS_PER_SESSION = 500;
    if (orderIds.length > MAX_ORDERS_PER_SESSION) {
      return res.status(400).json({
        error: 'Demasiados pedidos seleccionados',
        details: `Máximo ${MAX_ORDERS_PER_SESSION} pedidos por sesión. Seleccionaste ${orderIds.length}. Divide en múltiples sesiones.`
      });
    }

    const session = await warehouseService.createSession(
      storeId,
      orderIds,
      userId
    );

    res.status(201).json(session);
  } catch (error: any) {
    logger.error('API', 'Error creating picking session:', error);

    // Return user-friendly error messages for known validation errors
    const errorMessage = error?.message || 'Error desconocido';

    // Check for validation errors that should return 400
    const isValidationError =
      errorMessage.includes('confirmado') ||
      errorMessage.includes('confirmed') ||
      errorMessage.includes('inventario') ||
      errorMessage.includes('Stock') ||
      errorMessage.includes('stock') ||
      errorMessage.includes('producto') ||
      errorMessage.includes('product') ||
      errorMessage.includes('Invalid order') ||
      errorMessage.includes('Invalid product') ||
      errorMessage.includes('No valid products') ||
      errorMessage.includes('no existen');

    if (isValidationError) {
      return res.status(400).json({
        error: 'Error de validación',
        details: errorMessage
      });
    }

    // For unknown errors, still provide some context
    return res.status(500).json({
      error: 'Error al crear sesión de preparación',
      details: errorMessage
    });
  }
});

/**
 * GET /api/warehouse/sessions/:sessionId/picking-list
 * Gets the aggregated picking list for a session
 */
router.get('/sessions/:sessionId/picking-list', validateUUIDParam('sessionId'), async (req, res) => {
  try {
    const storeId = req.storeId;
    const { sessionId } = req.params;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const pickingList = await warehouseService.getPickingList(
      sessionId,
      storeId
    );

    res.json(pickingList);
  } catch (error) {
    logger.error('API', 'Error fetching picking list:', error);
    return serverError(res, error);
  }
});

/**
 * POST /api/warehouse/sessions/:sessionId/picking-progress
 * Updates picking progress for a specific product
 * Body: { productId: string, quantityPicked: number, variantId?: string }
 */
router.post('/sessions/:sessionId/picking-progress', validateUUIDParam('sessionId'), requirePermission(Module.WAREHOUSE, Permission.EDIT), async (req, res) => {
  try {
    const storeId = req.storeId;
    const { sessionId } = req.params;
    const { productId, quantityPicked, variantId } = req.body;  // NEW: variantId support

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    if (!productId || quantityPicked === undefined) {
      return res.status(400).json({
        error: 'productId and quantityPicked are required'
      });
    }

    const updated = await warehouseService.updatePickingProgress(
      sessionId,
      productId,
      quantityPicked,
      storeId,
      variantId || null  // NEW: pass variantId to service
    );

    res.json(updated);
  } catch (error) {
    logger.error('API', 'Error updating picking progress:', error);
    // Use 400 for validation errors (stock), 500 for technical errors
    const isValidationError = error.message?.includes('Stock') ||
                              error.message?.includes('stock') ||
                              error.message?.includes('Cantidad');
    res.status(isValidationError ? 400 : 500).json({
      error: 'Error al actualizar progreso de picking',
      details: error.message
    });
  }
});

/**
 * POST /api/warehouse/sessions/:sessionId/finish-picking
 * Finishes picking phase and transitions to packing
 */
router.post('/sessions/:sessionId/finish-picking', validateUUIDParam('sessionId'), requirePermission(Module.WAREHOUSE, Permission.EDIT), async (req, res) => {
  try {
    const storeId = req.storeId;
    const { sessionId } = req.params;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const session = await warehouseService.finishPicking(sessionId, storeId);

    res.json(session);
  } catch (error) {
    logger.error('API', 'Error finishing picking:', error);
    // Use 400 for validation errors (stock, incomplete picking), 500 for technical errors
    const isValidationError = error.message?.includes('Stock') ||
                              error.message?.includes('stock') ||
                              error.message?.includes('productos deben ser recogidos');
    res.status(isValidationError ? 400 : 500).json({
      error: 'Error al finalizar picking',
      details: error.message
    });
  }
});

/**
 * GET /api/warehouse/sessions/:sessionId/packing-list
 * Gets the packing list with order details and progress
 */
router.get('/sessions/:sessionId/packing-list', validateUUIDParam('sessionId'), async (req, res) => {
  try {
    const storeId = req.storeId;
    const { sessionId } = req.params;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const packingList = await warehouseService.getPackingList(
      sessionId,
      storeId
    );

    res.json(packingList);
  } catch (error) {
    logger.error('API', 'Error fetching packing list:', error);
    res.status(500).json({
      error: 'Error al obtener lista de empaque',
      details: error.message
    });
  }
});

/**
 * POST /api/warehouse/sessions/:sessionId/packing-progress
 * Assigns one unit of a product to an order (using atomic RPC with row locking)
 * Body: { orderId: string, productId: string, variantId?: string }
 */
router.post('/sessions/:sessionId/packing-progress', validateUUIDParam('sessionId'), requirePermission(Module.WAREHOUSE, Permission.EDIT), async (req, res) => {
  try {
    const storeId = req.storeId;
    const { sessionId } = req.params;
    const { orderId, productId, variantId } = req.body;  // NEW: variantId support

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    if (!orderId || !productId) {
      return res.status(400).json({
        error: 'orderId and productId are required'
      });
    }

    // Use atomic function with row locking to prevent lost updates
    // when two users pack the same product simultaneously
    const updated = await warehouseService.updatePackingProgressAtomic(
      sessionId,
      orderId,
      productId,
      storeId,
      variantId || null  // NEW: pass variantId to service
    );

    res.json(updated);
  } catch (error) {
    logger.error('API', 'Error updating packing progress:', error);

    // Provide user-friendly error messages for common validation errors
    const isValidationError = error.message?.includes('not found') ||
                              error.message?.includes('completed') ||
                              error.message?.includes('cancelled') ||
                              error.message?.includes('rejected') ||
                              error.message?.includes('fully packed') ||
                              error.message?.includes('No more units') ||
                              error.message?.includes('packing status');

    res.status(isValidationError ? 400 : 500).json({
      error: 'Error al actualizar progreso de empaque',
      details: error.message
    });
  }
});

/**
 * POST /api/warehouse/sessions/:sessionId/auto-pack
 * Packs all items for all orders in a session with a single call
 * This dramatically reduces warehouse operation time from O(n*m) clicks to O(1)
 */
router.post('/sessions/:sessionId/auto-pack', validateUUIDParam('sessionId'), requirePermission(Module.WAREHOUSE, Permission.EDIT), async (req, res) => {
  try {
    const storeId = req.storeId;
    const { sessionId } = req.params;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const result = await warehouseService.autoPackSession(sessionId, storeId);

    res.json(result);
  } catch (error) {
    logger.error('API', 'Error auto-packing session:', error);

    const isValidationError = error.message?.includes('not found') ||
                              error.message?.includes('packing status') ||
                              error.message?.includes('access denied');

    res.status(isValidationError ? 400 : 500).json({
      error: 'Error al empacar automáticamente',
      details: error.message
    });
  }
});

/**
 * POST /api/warehouse/sessions/:sessionId/pack-order/:orderId
 * Packs all items for a single order in one call
 * Useful for the "Empacar" button on individual order cards
 */
router.post('/sessions/:sessionId/pack-order/:orderId', validateUUIDParams(['sessionId', 'orderId']), requirePermission(Module.WAREHOUSE, Permission.EDIT), async (req, res) => {
  try {
    const storeId = req.storeId;
    const { sessionId, orderId } = req.params;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const result = await warehouseService.packAllItemsForOrder(sessionId, orderId, storeId);

    res.json(result);
  } catch (error) {
    logger.error('API', 'Error packing order:', error);

    const isValidationError = error.message?.includes('not found') ||
                              error.message?.includes('packing status') ||
                              error.message?.includes('Cannot pack order');

    res.status(isValidationError ? 400 : 500).json({
      error: 'Error al empacar pedido',
      details: error.message
    });
  }
});

/**
 * POST /api/warehouse/sessions/:sessionId/complete
 * Completes a picking session
 */
router.post('/sessions/:sessionId/complete', validateUUIDParam('sessionId'), requirePermission(Module.WAREHOUSE, Permission.EDIT), async (req, res) => {
  try {
    const storeId = req.storeId;
    const { sessionId } = req.params;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const session = await warehouseService.completeSession(sessionId, storeId);

    res.json(session);
  } catch (error) {
    logger.error('API', 'Error completing session:', error);
    // Use 400 for validation errors (stock, incomplete packing), 500 for technical errors
    const isValidationError = error.message?.includes('Stock') ||
                              error.message?.includes('empacar') ||
                              error.message?.includes('completar');
    res.status(isValidationError ? 400 : 500).json({
      error: 'Error al completar sesión',
      details: error.message
    });
  }
});

/**
 * POST /api/warehouse/sessions/:sessionId/abandon
 * Abandons a picking session and restores orders to confirmed status
 * Body: { reason?: string }
 */
router.post('/sessions/:sessionId/abandon', validateUUIDParam('sessionId'), requirePermission(Module.WAREHOUSE, Permission.EDIT), async (req, res) => {
  try {
    const storeId = req.storeId;
    const userId = req.userId;
    const { sessionId } = req.params;
    const { reason } = req.body;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const result = await warehouseService.abandonSession(
      sessionId,
      storeId,
      userId,
      reason
    );

    res.json(result);
  } catch (error) {
    logger.error('API', 'Error abandoning session:', error);
    const isValidationError = error.message?.includes('not found') ||
                              error.message?.includes('completed') ||
                              error.message?.includes('already');
    res.status(isValidationError ? 400 : 500).json({
      error: 'Error al abandonar sesión',
      details: error.message
    });
  }
});

/**
 * DELETE /api/warehouse/sessions/:sessionId/orders/:orderId
 * Removes a single order from a session and restores it to confirmed
 */
router.delete('/sessions/:sessionId/orders/:orderId', validateUUIDParams(['sessionId', 'orderId']), requirePermission(Module.WAREHOUSE, Permission.DELETE), async (req, res) => {
  try {
    const storeId = req.storeId;
    const { sessionId, orderId } = req.params;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const result = await warehouseService.removeOrderFromSession(
      sessionId,
      orderId,
      storeId
    );

    res.json(result);
  } catch (error) {
    logger.error('API', 'Error removing order from session:', error);
    res.status(500).json({
      error: 'Error al eliminar pedido de la sesión',
      details: error.message
    });
  }
});

/**
 * POST /api/warehouse/cleanup-sessions
 * Cleans up expired/stale sessions (for cron job)
 * Query: { hours?: number } - default 48
 */
router.post('/cleanup-sessions', async (req, res) => {
  try {
    const hoursInactive = parseInt(req.query.hours as string, 10) || 48;

    const result = await warehouseService.cleanupExpiredSessions(hoursInactive);

    res.json(result);
  } catch (error) {
    logger.error('API', 'Error cleaning up sessions:', error);
    res.status(500).json({
      error: 'Error al limpiar sesiones',
      details: error.message
    });
  }
});

/**
 * GET /api/warehouse/sessions/stale
 * Gets list of stale sessions that may need attention
 */
router.get('/sessions/stale', async (req, res) => {
  try {
    const storeId = req.storeId;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const staleSessions = await warehouseService.getStaleSessions(storeId);

    res.json(staleSessions);
  } catch (error) {
    logger.error('API', 'Error fetching stale sessions:', error);
    res.status(500).json({
      error: 'Error al obtener sesiones obsoletas',
      details: error.message
    });
  }
});

/**
 * GET /api/warehouse/sessions/orphaned
 * Gets list of sessions with orders that have incompatible statuses
 * (e.g., orders that are already shipped/delivered but still in active sessions)
 */
router.get('/sessions/orphaned', async (req, res) => {
  try {
    const storeId = req.storeId;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const { data, error } = await supabaseAdmin
      .from('v_orphaned_picking_session_orders')
      .select('*')
      .eq('store_id', storeId);

    if (error) throw error;

    res.json({
      orphaned_orders: data || [],
      count: data?.length || 0
    });
  } catch (error) {
    logger.error('API', 'Error fetching orphaned sessions:', error);
    res.status(500).json({
      error: 'Error al obtener sesiones huérfanas',
      details: error.message
    });
  }
});

/**
 * POST /api/warehouse/cleanup-orphaned-sessions
 * Cleans up sessions that contain orders with incompatible statuses
 * This uses the cleanup_orphaned_picking_sessions() RPC function
 * Requires DELETE permission on WAREHOUSE module (admin/owner only)
 */
router.post('/cleanup-orphaned-sessions', requirePermission(Module.WAREHOUSE, Permission.DELETE), async (req, res) => {
  try {
    const storeId = req.storeId;
    const userId = req.userId;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    // Log who triggered the cleanup for audit trail
    logger.info('API', `User ${userId} initiated orphaned session cleanup for store ${storeId}`);

    const { data, error } = await supabaseAdmin
      .rpc('cleanup_orphaned_picking_sessions', { p_store_id: storeId });

    if (error) throw error;

    const results = data || [];
    const sessionsProcessed = results.length;
    const ordersRemoved = results.reduce((sum: number, r: any) => sum + (r.orders_removed || 0), 0);

    logger.info('API', `Cleanup completed: ${sessionsProcessed} sessions processed, ${ordersRemoved} orders removed by user ${userId}`);

    res.json({
      success: true,
      sessions_processed: sessionsProcessed,
      orders_removed: ordersRemoved,
      details: results
    });
  } catch (error) {
    logger.error('API', 'Error cleaning up orphaned sessions:', error);
    res.status(500).json({
      error: 'Error al limpiar sesiones huérfanas',
      details: error.message
    });
  }
});

export default router;
