// ================================================================
// ORDEFY API - CARRIER ACCOUNTS ROUTES
// ================================================================
// Manages carrier account balances, movements, and payments
//
// Security: Requires authenticated user with store access
// ================================================================

import { Router, Response } from 'express';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { extractUserRole, requireModule, requirePermission, PermissionRequest } from '../middleware/permissions';
import { Module, Permission } from '../permissions';
import * as carrierAccountsService from '../services/carrier-accounts.service';

export const carrierAccountsRouter = Router();

// All routes require authentication and store context
carrierAccountsRouter.use(verifyToken);
carrierAccountsRouter.use(extractStoreId);
carrierAccountsRouter.use(extractUserRole);

// Carrier accounts are part of CARRIERS module (or could be ANALYTICS for read-only)
// For now, we'll use CARRIERS module as it's the most logical

// ================================================================
// GET /api/carrier-accounts/balances - Get all carrier balances
// ================================================================
carrierAccountsRouter.get('/balances', requireModule(Module.CARRIERS), async (req: PermissionRequest, res: Response) => {
  try {
    logger.info('API', `📊 [CARRIER ACCOUNTS] Fetching balances for store ${req.storeId}`);

    const balances = await carrierAccountsService.getCarrierBalances(req.storeId!);

    res.json({
      success: true,
      data: balances,
      meta: {
        total_carriers: balances.length,
        carriers_with_balance: balances.filter(b => Math.abs(b.net_balance) > 0).length,
        total_unsettled: balances.reduce((sum, b) => sum + b.unsettled_balance, 0)
      }
    });
  } catch (error: any) {
    logger.error('API', '💥 [CARRIER ACCOUNTS] Error fetching balances:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener balances de transportadoras',
      message: error.message
    });
  }
});

// ================================================================
// GET /api/carrier-accounts/balances/:carrierId - Get carrier balance summary
// ================================================================
carrierAccountsRouter.get('/balances/:carrierId', requireModule(Module.CARRIERS), async (req: PermissionRequest, res: Response) => {
  try {
    const { carrierId } = req.params;
    const { from_date, to_date } = req.query;

    logger.info('API', `📊 [CARRIER ACCOUNTS] Fetching balance summary for carrier ${carrierId}`);

    const summary = await carrierAccountsService.getCarrierBalanceSummary(
      carrierId,
      from_date as string | undefined,
      to_date as string | undefined
    );

    if (!summary) {
      return res.status(404).json({
        success: false,
        error: 'Carrier not found or no movements'
      });
    }

    res.json({
      success: true,
      data: summary
    });
  } catch (error: any) {
    logger.error('API', '💥 [CARRIER ACCOUNTS] Error fetching carrier summary:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener resumen de transportadora',
      message: error.message
    });
  }
});

// ================================================================
// GET /api/carrier-accounts/movements/unsettled - Get unsettled movements
// ================================================================
carrierAccountsRouter.get('/movements/unsettled', requireModule(Module.CARRIERS), async (req: PermissionRequest, res: Response) => {
  try {
    const { carrier_id } = req.query;

    logger.info('API', `📋 [CARRIER ACCOUNTS] Fetching unsettled movements for store ${req.storeId}`);

    const movements = await carrierAccountsService.getUnsettledMovements(
      req.storeId!,
      carrier_id as string | undefined
    );

    // Group by carrier for easier consumption
    const groupedByCarrier = movements.reduce((acc, m) => {
      if (!acc[m.carrier_id]) {
        acc[m.carrier_id] = {
          carrier_id: m.carrier_id,
          carrier_name: m.carrier_name,
          movements: [],
          total_amount: 0,
          movement_count: 0
        };
      }
      acc[m.carrier_id].movements.push(m);
      acc[m.carrier_id].total_amount += m.amount;
      acc[m.carrier_id].movement_count++;
      return acc;
    }, {} as Record<string, any>);

    res.json({
      success: true,
      data: movements,
      grouped: Object.values(groupedByCarrier),
      meta: {
        total_movements: movements.length,
        total_carriers: Object.keys(groupedByCarrier).length
      }
    });
  } catch (error: any) {
    logger.error('API', '💥 [CARRIER ACCOUNTS] Error fetching unsettled movements:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener movimientos pendientes',
      message: error.message
    });
  }
});

// ================================================================
// POST /api/carrier-accounts/payments - Register a payment
// ================================================================
carrierAccountsRouter.post(
  '/payments',
  requirePermission(Module.CARRIERS, Permission.CREATE),
  async (req: PermissionRequest, res: Response) => {
    try {
      const {
        carrier_id,
        amount,
        direction,
        payment_method,
        payment_reference,
        notes,
        settlement_ids,
        movement_ids
      } = req.body;

      // Validation
      if (!carrier_id || !amount || !direction || !payment_method) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields',
          required: ['carrier_id', 'amount', 'direction', 'payment_method']
        });
      }

      if (amount <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Amount must be positive'
        });
      }

      if (!['from_carrier', 'to_carrier'].includes(direction)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid direction',
          valid_values: ['from_carrier', 'to_carrier']
        });
      }

      logger.info('API', `💰 [CARRIER ACCOUNTS] Registering payment for carrier ${carrier_id}`, {
        amount,
        direction,
        method: payment_method
      });

      const paymentId = await carrierAccountsService.registerCarrierPayment({
        storeId: req.storeId!,
        carrierId: carrier_id,
        amount,
        direction,
        paymentMethod: payment_method,
        paymentReference: payment_reference,
        notes,
        settlementIds: settlement_ids,
        movementIds: movement_ids,
        createdBy: req.userId
      });

      res.status(201).json({
        success: true,
        message: 'Payment registered successfully',
        payment_id: paymentId
      });
    } catch (error: any) {
      logger.error('API', '💥 [CARRIER ACCOUNTS] Error registering payment:', error);
      res.status(500).json({
        success: false,
        error: 'Error al registrar pago',
        message: error.message
      });
    }
  }
);

// ================================================================
// GET /api/carrier-accounts/payments - Get payment records
// ================================================================
carrierAccountsRouter.get('/payments', requireModule(Module.CARRIERS), async (req: PermissionRequest, res: Response) => {
  try {
    const { carrier_id, status } = req.query;

    logger.info('API', `📋 [CARRIER ACCOUNTS] Fetching payment records for store ${req.storeId}`);

    const payments = await carrierAccountsService.getPaymentRecords(
      req.storeId!,
      carrier_id as string | undefined,
      status as string | undefined
    );

    res.json({
      success: true,
      data: payments,
      meta: {
        total_payments: payments.length,
        total_amount: payments.reduce((sum, p) => sum + p.amount, 0)
      }
    });
  } catch (error: any) {
    logger.error('API', '💥 [CARRIER ACCOUNTS] Error fetching payments:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener registros de pago',
      message: error.message
    });
  }
});

// ================================================================
// POST /api/carrier-accounts/backfill - Backfill movements (admin only)
// ================================================================
carrierAccountsRouter.post(
  '/backfill',
  requirePermission(Module.CARRIERS, Permission.EDIT),
  async (req: PermissionRequest, res: Response) => {
    try {
      // Check if user is owner/admin
      if (req.userRole !== 'owner' && req.userRole !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Only owners and admins can run backfill'
        });
      }

      logger.info('API', `🔄 [CARRIER ACCOUNTS] Starting backfill for store ${req.storeId}`);

      const result = await carrierAccountsService.backfillCarrierMovements(req.storeId!);

      res.json({
        success: true,
        message: 'Backfill completed successfully',
        orders_processed: result.orders_processed,
        movements_created: result.movements_created
      });
    } catch (error: any) {
      logger.error('API', '💥 [CARRIER ACCOUNTS] Error in backfill:', error);
      res.status(500).json({
        success: false,
        error: 'Error al rellenar movimientos',
        message: error.message
      });
    }
  }
);

// ================================================================
// GET /api/carrier-accounts/health - Health check endpoint
// ================================================================
carrierAccountsRouter.get('/health', async (req: AuthRequest, res: Response) => {
  res.json({
    success: true,
    message: 'Carrier accounts API is healthy',
    timestamp: new Date().toISOString()
  });
});
