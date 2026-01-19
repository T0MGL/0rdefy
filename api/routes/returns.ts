/**
 * Returns API Routes
 * Handles return/refund processing endpoints
 *
 * @author Bright Idea
 * @date 2025-12-02
 */

import { logger } from '../utils/logger';
import express from 'express';
import { verifyToken, extractStoreId } from '../middleware/auth.js';
import { extractUserRole, requireModule, requirePermission } from '../middleware/permissions.js';
import { requireFeature } from '../middleware/planLimits.js';
import { Module, Permission } from '../permissions.js';
import * as returnsService from '../services/returns.service.js';

const router = express.Router();

// Apply authentication middleware
router.use(verifyToken);
router.use(extractStoreId);
router.use(extractUserRole);

// Apply module-level access check for all routes
router.use(requireModule(Module.RETURNS));

// Apply plan feature check - returns requires Starter+ plan
router.use(requireFeature('returns'));

/**
 * GET /api/returns/eligible-orders
 * Get orders eligible for return (delivered, shipped, cancelled)
 */
router.get('/eligible-orders', async (req, res) => {
  try {
    const storeId = req.storeId;
    if (!storeId) {
      return res.status(400).json({ error: 'Se requiere el ID de la tienda' });
    }

    const orders = await returnsService.getEligibleOrders(storeId);
    res.json(orders);
  } catch (error) {
    logger.error('API', 'Error fetching eligible orders:', error);
    res.status(500).json({
      error: 'Error al obtener pedidos elegibles',
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
      return res.status(400).json({ error: 'Se requiere el ID de la tienda' });
    }

    const sessions = await returnsService.getReturnSessions(storeId);
    res.json(sessions);
  } catch (error) {
    logger.error('API', 'Error fetching return sessions:', error);
    res.status(500).json({
      error: 'Error al obtener sesiones de devolución',
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
      return res.status(400).json({ error: 'Se requiere el ID de la tienda' });
    }

    const session = await returnsService.getReturnSession(id);

    // SECURITY: Verify session belongs to the authenticated user's store
    if (session.store_id !== storeId) {
      logger.warn('API', `[Returns] Unauthorized access attempt: user from store ${storeId} tried to access session from store ${session.store_id}`);
      return res.status(404).json({ error: 'Sesión de devolución no encontrada' });
    }

    res.json(session);
  } catch (error) {
    logger.error('API', 'Error fetching return session:', error);
    res.status(500).json({
      error: 'Error al obtener sesión de devolución',
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
      return res.status(400).json({ error: 'Se requiere el ID de la tienda' });
    }
    if (!userId) {
      return res.status(400).json({ error: 'Se requiere el ID del usuario' });
    }

    const { order_ids, notes } = req.body;

    if (!order_ids || !Array.isArray(order_ids) || order_ids.length === 0) {
      return res.status(400).json({ error: 'Se requiere al menos un ID de pedido' });
    }

    const session = await returnsService.createReturnSession(
      storeId,
      order_ids,
      userId,
      notes
    );

    res.status(201).json(session);
  } catch (error) {
    logger.error('API', 'Error creating return session:', error);
    res.status(500).json({
      error: 'Error al crear sesión de devolución',
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
      return res.status(400).json({ error: 'Se requiere el ID de la tienda' });
    }

    // Validate quantities
    if (updates.quantity_accepted !== undefined && updates.quantity_accepted < 0) {
      return res.status(400).json({ error: 'quantity_accepted debe ser no negativo' });
    }
    if (updates.quantity_rejected !== undefined && updates.quantity_rejected < 0) {
      return res.status(400).json({ error: 'quantity_rejected debe ser no negativo' });
    }

    const item = await returnsService.updateReturnItem(id, updates, storeId);
    res.json(item);
  } catch (error) {
    logger.error('API', 'Error updating return item:', error);
    res.status(500).json({
      error: 'Error al actualizar ítem de devolución',
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
      return res.status(400).json({ error: 'Se requiere el ID de la tienda' });
    }

    // SECURITY: Verify session belongs to this store before completing
    const session = await returnsService.getReturnSession(id);
    if (session.store_id !== storeId) {
      logger.warn('API', `[Returns] Unauthorized complete attempt: store ${storeId} tried to complete session from store ${session.store_id}`);
      return res.status(404).json({ error: 'Sesión de devolución no encontrada' });
    }

    const result = await returnsService.completeReturnSession(id);
    res.json(result);
  } catch (error) {
    logger.error('API', 'Error completing return session:', error);
    res.status(500).json({
      error: 'Error al completar sesión de devolución',
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
      return res.status(400).json({ error: 'Se requiere el ID de la tienda' });
    }

    // SECURITY: Verify session belongs to this store before cancelling
    const session = await returnsService.getReturnSession(id);
    if (session.store_id !== storeId) {
      logger.warn('API', `[Returns] Unauthorized cancel attempt: store ${storeId} tried to cancel session from store ${session.store_id}`);
      return res.status(404).json({ error: 'Sesión de devolución no encontrada' });
    }

    await returnsService.cancelReturnSession(id);
    res.json({ message: 'Sesión de devolución cancelada exitosamente' });
  } catch (error) {
    logger.error('API', 'Error cancelling return session:', error);
    res.status(500).json({
      error: 'Error al cancelar sesión de devolución',
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
      return res.status(400).json({ error: 'Se requiere el ID de la tienda' });
    }

    const stats = await returnsService.getReturnStats(storeId);
    res.json(stats);
  } catch (error) {
    logger.error('API', 'Error fetching return stats:', error);
    res.status(500).json({
      error: 'Error al obtener estadísticas de devoluciones',
      details: error.message,
    });
  }
});

export default router;
