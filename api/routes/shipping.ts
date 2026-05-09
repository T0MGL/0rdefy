/**
 * Shipping API Routes
 * Endpoints for managing order dispatch to couriers
 *
 * Security: Requires CARRIERS module access
 * Roles with access: owner, admin, logistics
 */

import { logger } from '../utils/logger';
import { Router, Response } from 'express';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { extractUserRole, requireModule, PermissionRequest } from '../middleware/permissions';
import { Module } from '../permissions';
import * as shippingService from '../services/shipping.service';
import { isValidUUID, validateUUIDParam } from '../utils/sanitize';

const router = Router();

// Apply authentication middleware to all routes
router.use(verifyToken);
router.use(extractStoreId);
router.use(extractUserRole);

// Shipping operations require CARRIERS module access
router.use(requireModule(Module.CARRIERS));

/**
 * GET /api/shipping/ready-to-ship
 * Gets all orders ready to be dispatched to couriers.
 *
 * Query params (Wave Dispatch, Migration 178):
 *   product_ids (optional): comma-separated UUIDs. When supplied, only
 *     mono-product orders for those products are returned. Multi-product
 *     orders are excluded server-side.
 *   mixed (optional, 'true'/'false'): when true, returns only orders
 *     that contain line items from 2 or more distinct products. Mutually
 *     exclusive with product_ids; product_ids wins if both are present.
 */
router.get('/ready-to-ship', async (req: PermissionRequest, res: Response) => {
  try {
    const storeId = req.storeId;

    if (!storeId) {
      return res.status(400).json({ error: 'Se requiere el ID de la tienda' });
    }

    let productIds: string[] | undefined;
    const rawProductIds = req.query.product_ids;
    if (rawProductIds && typeof rawProductIds === 'string') {
      const ids = rawProductIds
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0 && isValidUUID(s));

      if (ids.length === 0) {
        return res.json([]);
      }
      productIds = ids;
    }

    const mixedOnly = req.query.mixed === 'true' && !productIds;

    const orders = await shippingService.getReadyToShipOrders(storeId, productIds, mixedOnly);

    res.json(orders);
  } catch (error) {
    logger.error('API', 'Error fetching ready to ship orders:', error);
    res.status(500).json({
      error: 'Error al obtener pedidos listos para envío',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/shipping/dispatch-summary
 * Returns aggregated stats per product for the ready-to-ship dispatch view,
 * plus a single "Mixtos" bucket aggregating multi-product orders. Powers
 * the cards UI in /shipping (Migration 178).
 */
router.get('/dispatch-summary', async (req: PermissionRequest, res: Response) => {
  try {
    const storeId = req.storeId;

    if (!storeId) {
      return res.status(400).json({ error: 'Se requiere el ID de la tienda' });
    }

    const summary = await shippingService.getDispatchSummary(storeId);

    res.json(summary);
  } catch (error) {
    logger.error('API', 'Error fetching dispatch summary:', error);
    res.status(500).json({
      error: 'Error al obtener resumen de despacho',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/shipping/pick-list
 * Returns variant-level aggregated quantities for a given set of orders.
 * Used by the printable pick list PDF. Body: { orderIds: string[] }.
 *
 * Validates every UUID before issuing the RPC. Returns [] on empty input.
 */
router.post('/pick-list', async (req: PermissionRequest, res: Response) => {
  try {
    const storeId = req.storeId;

    if (!storeId) {
      return res.status(400).json({ error: 'Se requiere el ID de la tienda' });
    }

    const { orderIds } = req.body as { orderIds?: unknown };

    if (!Array.isArray(orderIds)) {
      return res.status(400).json({ error: 'orderIds debe ser un array' });
    }

    const validIds = orderIds
      .filter((id): id is string => typeof id === 'string')
      .map(id => id.trim())
      .filter(id => isValidUUID(id));

    if (validIds.length === 0) {
      return res.json([]);
    }

    const pickList = await shippingService.getPickList(storeId, validIds);

    res.json(pickList);
  } catch (error) {
    logger.error('API', 'Error fetching pick list:', error);
    res.status(500).json({
      error: 'Error al obtener pick list',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/shipping/dispatch
 * Dispatches a single order to courier
 * Body: { orderId: string, notes?: string }
 */
router.post('/dispatch', async (req: PermissionRequest, res: Response) => {
  try {
    const storeId = req.storeId;
    const userId = req.userId;
    const { orderId, notes } = req.body;

    if (!storeId || !userId) {
      return res.status(400).json({ error: 'Se requiere el ID de la tienda' });
    }

    if (!orderId) {
      return res.status(400).json({ error: 'Se requiere orderId' });
    }

    const shipment = await shippingService.createShipment(
      storeId,
      orderId,
      userId,
      notes
    );

    res.status(201).json(shipment);
  } catch (error) {
    logger.error('API', 'Error dispatching order:', error);
    res.status(500).json({
      error: 'Error al despachar pedido',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/shipping/dispatch-batch
 * Dispatches multiple orders to couriers at once
 * Body: { orderIds: string[], notes?: string }
 */
router.post('/dispatch-batch', async (req: PermissionRequest, res: Response) => {
  try {
    const storeId = req.storeId;
    const userId = req.userId;
    const { orderIds, notes } = req.body;

    if (!storeId || !userId) {
      return res.status(400).json({ error: 'Se requiere el ID de la tienda' });
    }

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({
        error: 'orderIds debe ser un array no vacío'
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
    logger.error('API', 'Error dispatching batch:', error);
    res.status(500).json({
      error: 'Error al despachar lote',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/shipping/order/:orderId
 * Gets shipment history for a specific order
 */
router.get('/order/:orderId', validateUUIDParam('orderId'), async (req: PermissionRequest, res: Response) => {
  try {
    const storeId = req.storeId;
    const { orderId } = req.params;

    if (!storeId) {
      return res.status(400).json({ error: 'Se requiere el ID de la tienda' });
    }

    const shipments = await shippingService.getOrderShipments(orderId, storeId);

    res.json(shipments);
  } catch (error) {
    logger.error('API', 'Error fetching order shipments:', error);
    res.status(500).json({
      error: 'Error al obtener envíos del pedido',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /api/shipping/history
 * Gets shipment history for the store (paginated)
 * Query params: limit, offset
 */
router.get('/history', async (req: PermissionRequest, res: Response) => {
  try {
    const storeId = req.storeId;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const offset = parseInt(req.query.offset as string, 10) || 0;

    if (!storeId) {
      return res.status(400).json({ error: 'Se requiere el ID de la tienda' });
    }

    const result = await shippingService.getShipments(storeId, limit, offset);

    res.json(result);
  } catch (error) {
    logger.error('API', 'Error fetching shipment history:', error);
    res.status(500).json({
      error: 'Error al obtener historial de envíos',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /api/shipping/export-excel
 * Exports selected orders as professional Excel file with Ordefy branding
 * Body: { orderIds: string[], carrierName: string }
 *
 * Features:
 * - Ordefy brand colors and styling
 * - Dropdown validation for ESTADO_ENTREGA and MOTIVO
 * - Protected columns that courier shouldn't edit
 * - Clear instructions for courier
 * - Number formatting for amounts
 */
router.post('/export-excel', async (req: PermissionRequest, res: Response) => {
  try {
    const storeId = req.storeId;
    const { orderIds, carrierName } = req.body;

    if (!storeId) {
      return res.status(400).json({ error: 'Se requiere el ID de la tienda' });
    }

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({ error: 'orderIds debe ser un array no vacío' });
    }

    if (!carrierName) {
      return res.status(400).json({ error: 'Se requiere carrierName' });
    }

    const excelBuffer = await shippingService.exportOrdersExcel(storeId, orderIds, carrierName);

    // Generate filename with date
    const today = new Date();
    const dateStr = today.toLocaleDateString('es-PY', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).replace(/\//g, '');
    const sanitizedCarrier = carrierName.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
    const filename = `DESPACHO-${sanitizedCarrier}-${dateStr}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(excelBuffer);
  } catch (error) {
    logger.error('API', 'Error exporting orders to Excel:', error);
    res.status(500).json({
      error: 'Error al exportar pedidos',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

export default router;
