/**
 * Returns API Routes
 * Handles return/refund processing endpoints
 *
 * @author Bright Idea
 * @date 2025-12-02
 */

import express from 'express';
import { verifyToken, extractStoreId } from '../middleware/auth.js';
import { extractUserRole, requireModule, requirePermission } from '../middleware/permissions.js';
import { Module, Permission } from '../permissions.js';
import * as returnsService from '../services/returns.service.js';

const router = express.Router();

// Apply authentication middleware
router.use(verifyToken);
router.use(extractStoreId);
router.use(extractUserRole);

// Apply module-level access check for all routes
router.use(requireModule(Module.RETURNS));

/**
 * GET /api/returns/eligible-orders
 * Get orders eligible for return (delivered, shipped, cancelled)
 */
router.get('/eligible-orders', async (req, res) => {
  try {
    const storeId = req.storeId;
    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const orders = await returnsService.getEligibleOrders(storeId);
    res.json(orders);
  } catch (error) {
    console.error('Error fetching eligible orders:', error);
    res.status(500).json({
      error: 'Failed to fetch eligible orders',
      details: error.message,
    });
  }
});

/**
 * GET /api/returns/sessions
 * Get all return sessions for a store
 */
router.get('/sessions', async (req, res) => {
  try {
    const storeId = req.storeId;
    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const sessions = await returnsService.getReturnSessions(storeId);
    res.json(sessions);
  } catch (error) {
    console.error('Error fetching return sessions:', error);
    res.status(500).json({
      error: 'Failed to fetch return sessions',
      details: error.message,
    });
  }
});

/**
 * GET /api/returns/sessions/:id
 * Get return session details with items and orders
 */
router.get('/sessions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const storeId = req.storeId;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const session = await returnsService.getReturnSession(id);

    // SECURITY: Verify session belongs to the authenticated user's store
    if (session.store_id !== storeId) {
      console.warn(`[Returns] Unauthorized access attempt: user from store ${storeId} tried to access session from store ${session.store_id}`);
      return res.status(404).json({ error: 'Return session not found' });
    }

    res.json(session);
  } catch (error) {
    console.error('Error fetching return session:', error);
    res.status(500).json({
      error: 'Failed to fetch return session',
      details: error.message,
    });
  }
});

/**
 * POST /api/returns/sessions
 * Create a new return session
 *
 * Body:
 * {
 *   order_ids: string[],
 *   notes?: string
 * }
 */
router.post('/sessions', async (req, res) => {
  try {
    const storeId = req.storeId;
    const userId = req.userId;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const { order_ids, notes } = req.body;

    if (!order_ids || !Array.isArray(order_ids) || order_ids.length === 0) {
      return res.status(400).json({ error: 'At least one order ID is required' });
    }

    const session = await returnsService.createReturnSession(
      storeId,
      order_ids,
      userId,
      notes
    );

    res.status(201).json(session);
  } catch (error) {
    console.error('Error creating return session:', error);
    res.status(500).json({
      error: 'Failed to create return session',
      details: error.message,
    });
  }
});

/**
 * PATCH /api/returns/items/:id
 * Update return item (accept/reject quantities)
 *
 * Body:
 * {
 *   quantity_received?: number,
 *   quantity_accepted?: number,
 *   quantity_rejected?: number,
 *   rejection_reason?: string,
 *   rejection_notes?: string
 * }
 */
router.patch('/items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const storeId = req.storeId;
    const updates = req.body;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    // Validate quantities
    if (updates.quantity_accepted !== undefined && updates.quantity_accepted < 0) {
      return res.status(400).json({ error: 'quantity_accepted must be non-negative' });
    }
    if (updates.quantity_rejected !== undefined && updates.quantity_rejected < 0) {
      return res.status(400).json({ error: 'quantity_rejected must be non-negative' });
    }

    const item = await returnsService.updateReturnItem(id, updates, storeId);
    res.json(item);
  } catch (error) {
    console.error('Error updating return item:', error);
    res.status(500).json({
      error: 'Failed to update return item',
      details: error.message,
    });
  }
});

/**
 * POST /api/returns/sessions/:id/complete
 * Complete return session (process inventory and order status updates)
 */
router.post('/sessions/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const storeId = req.storeId;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    // SECURITY: Verify session belongs to this store before completing
    const session = await returnsService.getReturnSession(id);
    if (session.store_id !== storeId) {
      console.warn(`[Returns] Unauthorized complete attempt: store ${storeId} tried to complete session from store ${session.store_id}`);
      return res.status(404).json({ error: 'Return session not found' });
    }

    const result = await returnsService.completeReturnSession(id);
    res.json(result);
  } catch (error) {
    console.error('Error completing return session:', error);
    res.status(500).json({
      error: 'Failed to complete return session',
      details: error.message,
    });
  }
});

/**
 * POST /api/returns/sessions/:id/cancel
 * Cancel return session
 */
router.post('/sessions/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    const storeId = req.storeId;

    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    // SECURITY: Verify session belongs to this store before cancelling
    const session = await returnsService.getReturnSession(id);
    if (session.store_id !== storeId) {
      console.warn(`[Returns] Unauthorized cancel attempt: store ${storeId} tried to cancel session from store ${session.store_id}`);
      return res.status(404).json({ error: 'Return session not found' });
    }

    await returnsService.cancelReturnSession(id);
    res.json({ message: 'Return session cancelled successfully' });
  } catch (error) {
    console.error('Error cancelling return session:', error);
    res.status(500).json({
      error: 'Failed to cancel return session',
      details: error.message,
    });
  }
});

/**
 * GET /api/returns/stats
 * Get return statistics for a store
 */
router.get('/stats', async (req, res) => {
  try {
    const storeId = req.storeId;
    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const stats = await returnsService.getReturnStats(storeId);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching return stats:', error);
    res.status(500).json({
      error: 'Failed to fetch return stats',
      details: error.message,
    });
  }
});

export default router;
