/**
 * Warehouse API Routes
 * Endpoints for managing warehouse picking and packing workflow
 */

import { Router } from 'express';
import { verifyToken, extractStoreId } from '../middleware/auth';
import { extractUserRole, requireModule, requirePermission } from '../middleware/permissions';
import { Module, Permission } from '../permissions';
import * as warehouseService from '../services/warehouse.service';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyToken);
router.use(extractStoreId);
router.use(extractUserRole);

// Apply module-level access check for all routes
router.use(requireModule(Module.WAREHOUSE));

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
      return res.status(400).json({
        error: 'orderIds must be a non-empty array'
      });
    }

    const session = await warehouseService.createSession(
      storeId,
      orderIds,
      userId
    );

    res.status(201).json(session);
  } catch (error) {
    console.error('Error creating picking session:', error);
    res.status(500).json({
      error: 'Failed to create picking session',
      details: error.message
    });
  }
});

/**
 * GET /api/warehouse/sessions/:sessionId/picking-list
 * Gets the aggregated picking list for a session
 */
router.get('/sessions/:sessionId/picking-list', async (req, res) => {
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
    res.status(500).json({
      error: 'Failed to fetch picking list',
      details: error.message
    });
  }
});

/**
 * POST /api/warehouse/sessions/:sessionId/picking-progress
 * Updates picking progress for a specific product
 * Body: { productId: string, quantityPicked: number }
 */
router.post('/sessions/:sessionId/picking-progress', async (req, res) => {
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
    res.status(500).json({
      error: 'Failed to update picking progress',
      details: error.message
    });
  }
});

/**
 * POST /api/warehouse/sessions/:sessionId/finish-picking
 * Finishes picking phase and transitions to packing
 */
router.post('/sessions/:sessionId/finish-picking', async (req, res) => {
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
    res.status(500).json({
      error: 'Failed to finish picking',
      details: error.message
    });
  }
});

/**
 * GET /api/warehouse/sessions/:sessionId/packing-list
 * Gets the packing list with order details and progress
 */
router.get('/sessions/:sessionId/packing-list', async (req, res) => {
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
 * Assigns one unit of a product to an order
 * Body: { orderId: string, productId: string }
 */
router.post('/sessions/:sessionId/packing-progress', async (req, res) => {
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

    const updated = await warehouseService.updatePackingProgress(
      sessionId,
      orderId,
      productId,
      storeId
    );

    res.json(updated);
  } catch (error) {
    console.error('Error updating packing progress:', error);
    res.status(500).json({
      error: 'Failed to update packing progress',
      details: error.message
    });
  }
});

/**
 * POST /api/warehouse/sessions/:sessionId/complete
 * Completes a picking session
 */
router.post('/sessions/:sessionId/complete', async (req, res) => {
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
    res.status(500).json({
      error: 'Failed to complete session',
      details: error.message
    });
  }
});

export default router;
