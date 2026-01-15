/**
 * Warehouse API Routes
 * Endpoints for managing warehouse picking and packing workflow
 */

import { Router } from 'express';
import { verifyToken, extractStoreId } from '../middleware/auth';
import { extractUserRole, requireModule, requirePermission } from '../middleware/permissions';
import { requireFeature } from '../middleware/planLimits';
import { Module, Permission } from '../permissions';
import * as warehouseService from '../services/warehouse.service';
import { noOrdersSelected, serverError, missingRequiredFields } from '../utils/errorResponses';
import { validateUUIDParam, validateUUIDParams } from '../utils/sanitize';

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
    console.error('Error fetching confirmed orders:', error);
    res.status(500).json({
      error: 'Failed to fetch confirmed orders',
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
    console.error('Error fetching active sessions:', error);
    res.status(500).json({
      error: 'Failed to fetch active sessions',
      details: error.message
    });
  }
});

/**
 * POST /api/warehouse/sessions
 * Creates a new picking session from confirmed orders
 * Body: { orderIds: string[] }
 */
router.post('/sessions', async (req, res) => {
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

    const session = await warehouseService.createSession(
      storeId,
      orderIds,
      userId
    );

    res.status(201).json(session);
  } catch (error) {
    console.error('Error creating picking session:', error);
    return serverError(res, error);
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
    console.error('Error fetching picking list:', error);
    return serverError(res, error);
  }
});

/**
 * POST /api/warehouse/sessions/:sessionId/picking-progress
 * Updates picking progress for a specific product
 * Body: { productId: string, quantityPicked: number }
 */
router.post('/sessions/:sessionId/picking-progress', validateUUIDParam('sessionId'), async (req, res) => {
  try {
    const storeId = req.storeId;
    const { sessionId } = req.params;
    const { productId, quantityPicked } = req.body;

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
      storeId
    );

    res.json(updated);
  } catch (error) {
    console.error('Error updating picking progress:', error);
    // Use 400 for validation errors (stock), 500 for technical errors
    const isValidationError = error.message?.includes('Stock') ||
                              error.message?.includes('stock') ||
                              error.message?.includes('Cantidad');
    res.status(isValidationError ? 400 : 500).json({
      error: 'Failed to update picking progress',
      details: error.message
    });
  }
});

/**
 * POST /api/warehouse/sessions/:sessionId/finish-picking
 * Finishes picking phase and transitions to packing
 */
router.post('/sessions/:sessionId/finish-picking', validateUUIDParam('sessionId'), async (req, res) => {
  try {
    const storeId = req.storeId;
    const { sessionId } = req.params;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const session = await warehouseService.finishPicking(sessionId, storeId);

    res.json(session);
  } catch (error) {
    console.error('Error finishing picking:', error);
    // Use 400 for validation errors (stock, incomplete picking), 500 for technical errors
    const isValidationError = error.message?.includes('Stock') ||
                              error.message?.includes('stock') ||
                              error.message?.includes('productos deben ser recogidos');
    res.status(isValidationError ? 400 : 500).json({
      error: 'Failed to finish picking',
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
    console.error('Error fetching packing list:', error);
    res.status(500).json({
      error: 'Failed to fetch packing list',
      details: error.message
    });
  }
});

/**
 * POST /api/warehouse/sessions/:sessionId/packing-progress
 * Assigns one unit of a product to an order (using atomic RPC with row locking)
 * Body: { orderId: string, productId: string }
 */
router.post('/sessions/:sessionId/packing-progress', validateUUIDParam('sessionId'), async (req, res) => {
  try {
    const storeId = req.storeId;
    const { sessionId } = req.params;
    const { orderId, productId } = req.body;

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
      storeId
    );

    res.json(updated);
  } catch (error) {
    console.error('Error updating packing progress:', error);

    // Provide user-friendly error messages for common validation errors
    const isValidationError = error.message?.includes('not found') ||
                              error.message?.includes('completed') ||
                              error.message?.includes('cancelled') ||
                              error.message?.includes('rejected') ||
                              error.message?.includes('fully packed') ||
                              error.message?.includes('No more units') ||
                              error.message?.includes('packing status');

    res.status(isValidationError ? 400 : 500).json({
      error: 'Failed to update packing progress',
      details: error.message
    });
  }
});

/**
 * POST /api/warehouse/sessions/:sessionId/complete
 * Completes a picking session
 */
router.post('/sessions/:sessionId/complete', validateUUIDParam('sessionId'), async (req, res) => {
  try {
    const storeId = req.storeId;
    const { sessionId } = req.params;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const session = await warehouseService.completeSession(sessionId, storeId);

    res.json(session);
  } catch (error) {
    console.error('Error completing session:', error);
    // Use 400 for validation errors (stock, incomplete packing), 500 for technical errors
    const isValidationError = error.message?.includes('Stock') ||
                              error.message?.includes('empacar') ||
                              error.message?.includes('completar');
    res.status(isValidationError ? 400 : 500).json({
      error: 'Failed to complete session',
      details: error.message
    });
  }
});

/**
 * POST /api/warehouse/sessions/:sessionId/abandon
 * Abandons a picking session and restores orders to confirmed status
 * Body: { reason?: string }
 */
router.post('/sessions/:sessionId/abandon', validateUUIDParam('sessionId'), async (req, res) => {
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
    console.error('Error abandoning session:', error);
    const isValidationError = error.message?.includes('not found') ||
                              error.message?.includes('completed') ||
                              error.message?.includes('already');
    res.status(isValidationError ? 400 : 500).json({
      error: 'Failed to abandon session',
      details: error.message
    });
  }
});

/**
 * DELETE /api/warehouse/sessions/:sessionId/orders/:orderId
 * Removes a single order from a session and restores it to confirmed
 */
router.delete('/sessions/:sessionId/orders/:orderId', validateUUIDParams(['sessionId', 'orderId']), async (req, res) => {
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
    console.error('Error removing order from session:', error);
    res.status(500).json({
      error: 'Failed to remove order from session',
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
    const hoursInactive = parseInt(req.query.hours as string) || 48;

    const result = await warehouseService.cleanupExpiredSessions(hoursInactive);

    res.json(result);
  } catch (error) {
    console.error('Error cleaning up sessions:', error);
    res.status(500).json({
      error: 'Failed to cleanup sessions',
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
    console.error('Error fetching stale sessions:', error);
    res.status(500).json({
      error: 'Failed to fetch stale sessions',
      details: error.message
    });
  }
});

export default router;
