/**
 * Shipping API Routes
 * Endpoints for managing order dispatch to couriers
 */

import { Router } from 'express';
import { verifyToken, extractStoreId } from '../middleware/auth';
import * as shippingService from '../services/shipping.service';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyToken);
router.use(extractStoreId);

/**
 * GET /api/shipping/ready-to-ship
 * Gets all orders ready to be dispatched to couriers
 */
router.get('/ready-to-ship', async (req, res) => {
  try {
    const storeId = req.storeId;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const orders = await shippingService.getReadyToShipOrders(storeId);

    res.json(orders);
  } catch (error) {
    console.error('Error fetching ready to ship orders:', error);
    res.status(500).json({
      error: 'Failed to fetch ready to ship orders',
      details: error.message
    });
  }
});

/**
 * POST /api/shipping/dispatch
 * Dispatches a single order to courier
 * Body: { orderId: string, notes?: string }
 */
router.post('/dispatch', async (req, res) => {
  try {
    const storeId = req.storeId;
    const userId = req.userId;
    const { orderId, notes } = req.body;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }

    const shipment = await shippingService.createShipment(
      storeId,
      orderId,
      userId,
      notes
    );

    res.status(201).json(shipment);
  } catch (error) {
    console.error('Error dispatching order:', error);
    res.status(500).json({
      error: 'Failed to dispatch order',
      details: error.message
    });
  }
});

/**
 * POST /api/shipping/dispatch-batch
 * Dispatches multiple orders to couriers at once
 * Body: { orderIds: string[], notes?: string }
 */
router.post('/dispatch-batch', async (req, res) => {
  try {
    const storeId = req.storeId;
    const userId = req.userId;
    const { orderIds, notes } = req.body;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({
        error: 'orderIds must be a non-empty array'
      });
    }

    const results = await shippingService.createShipmentsBatch(
      storeId,
      orderIds,
      userId,
      notes
    );

    // Check if all succeeded
    const failed = results.filter(r => !r.success);
    const succeeded = results.filter(r => r.success);

    res.status(201).json({
      total: results.length,
      succeeded: succeeded.length,
      failed: failed.length,
      results
    });
  } catch (error) {
    console.error('Error dispatching batch:', error);
    res.status(500).json({
      error: 'Failed to dispatch batch',
      details: error.message
    });
  }
});

/**
 * GET /api/shipping/order/:orderId
 * Gets shipment history for a specific order
 */
router.get('/order/:orderId', async (req, res) => {
  try {
    const storeId = req.storeId;
    const { orderId } = req.params;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const shipments = await shippingService.getOrderShipments(orderId, storeId);

    res.json(shipments);
  } catch (error) {
    console.error('Error fetching order shipments:', error);
    res.status(500).json({
      error: 'Failed to fetch order shipments',
      details: error.message
    });
  }
});

/**
 * GET /api/shipping/history
 * Gets shipment history for the store (paginated)
 * Query params: limit, offset
 */
router.get('/history', async (req, res) => {
  try {
    const storeId = req.storeId;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const result = await shippingService.getShipments(storeId, limit, offset);

    res.json(result);
  } catch (error) {
    console.error('Error fetching shipment history:', error);
    res.status(500).json({
      error: 'Failed to fetch shipment history',
      details: error.message
    });
  }
});

export default router;
