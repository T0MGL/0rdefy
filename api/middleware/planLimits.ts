/**
 * Plan Limits Middleware
 *
 * Enforces subscription plan limits on API endpoints:
 * - Order creation limits (per month)
 * - Product creation limits (total)
 * - User limits (handled by collaborator system)
 * - Feature access (warehouse, returns, etc.)
 *
 * Usage:
 *   router.post('/orders', checkOrderLimit, createOrder);
 *   router.post('/products', checkProductLimit, createProduct);
 *   router.use('/warehouse', requireFeature('warehouse'), warehouseRoutes);
 */

import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../db/connection';

// Extend request with plan info
export interface PlanLimitRequest extends Request {
  storeId?: string;
  planLimits?: {
    plan: string;
    orders: { used: number; limit: number; canCreate: boolean };
    products: { used: number; limit: number; canCreate: boolean };
    users: { used: number; limit: number; canCreate: boolean };
  };
}

/**
 * Get current usage for a store
 */
async function getStoreUsage(storeId: string): Promise<{
  plan: string;
  ordersUsed: number;
  ordersLimit: number;
  productsUsed: number;
  productsLimit: number;
  usersUsed: number;
  usersLimit: number;
} | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('get_store_usage', {
      p_store_id: storeId,
    });

    if (error) {
      logger.error('BACKEND', '[PlanLimits] Error getting store usage:', error.message);
      return null;
    }

    if (!data || data.length === 0) {
      // Return default free plan limits
      return {
        plan: 'free',
        ordersUsed: 0,
        ordersLimit: 50,
        productsUsed: 0,
        productsLimit: 100,
        usersUsed: 0,
        usersLimit: 1,
      };
    }

    const usage = data[0];
    return {
      plan: usage.plan,
      ordersUsed: usage.orders_this_month,
      ordersLimit: usage.max_orders,
      productsUsed: usage.products_count,
      productsLimit: usage.max_products,
      usersUsed: usage.users_count,
      usersLimit: usage.max_users,
    };
  } catch (error: any) {
    logger.error('BACKEND', '[PlanLimits] Exception:', error.message);
    return null;
  }
}

/**
 * Check if within order creation limit
 * Use this middleware on POST /orders endpoint
 */
export async function checkOrderLimit(
  req: PlanLimitRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const storeId = req.storeId;
    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const usage = await getStoreUsage(storeId);
    if (!usage) {
      // SECURITY: Fail closed - if we can't verify limits, deny the action
      logger.error('BACKEND', '[PlanLimits] Could not get usage, denying action (fail-closed)');
      return res.status(503).json({
        error: 'SERVICE_UNAVAILABLE',
        message: 'No se pudo verificar los límites de tu plan. Por favor, intenta de nuevo.',
      });
    }

    // Check if at order limit (-1 means unlimited)
    if (usage.ordersLimit !== -1 && usage.ordersUsed >= usage.ordersLimit) {
      return res.status(403).json({
        error: 'ORDER_LIMIT_REACHED',
        message: `Has alcanzado el límite de ${usage.ordersLimit} pedidos este mes. Actualiza tu plan para continuar.`,
        usage: {
          used: usage.ordersUsed,
          limit: usage.ordersLimit,
          plan: usage.plan,
        },
      });
    }

    // Attach usage to request for downstream use
    req.planLimits = {
      plan: usage.plan,
      orders: {
        used: usage.ordersUsed,
        limit: usage.ordersLimit,
        canCreate: usage.ordersLimit === -1 || usage.ordersUsed < usage.ordersLimit,
      },
      products: {
        used: usage.productsUsed,
        limit: usage.productsLimit,
        canCreate: usage.productsLimit === -1 || usage.productsUsed < usage.productsLimit,
      },
      users: {
        used: usage.usersUsed,
        limit: usage.usersLimit,
        canCreate: usage.usersLimit === -1 || usage.usersUsed < usage.usersLimit,
      },
    };

    next();
  } catch (error: any) {
    logger.error('BACKEND', '[PlanLimits] checkOrderLimit error:', error.message);
    // SECURITY: Fail closed - deny action on error
    return res.status(503).json({
      error: 'SERVICE_UNAVAILABLE',
      message: 'Error verificando límites de plan. Por favor, intenta de nuevo.',
    });
  }
}

/**
 * Check if within product creation limit
 * Use this middleware on POST /products endpoint
 */
export async function checkProductLimit(
  req: PlanLimitRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const storeId = req.storeId;
    if (!storeId) {
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const usage = await getStoreUsage(storeId);
    if (!usage) {
      // SECURITY: Fail closed - if we can't verify limits, deny the action
      logger.error('BACKEND', '[PlanLimits] Could not get usage, denying action (fail-closed)');
      return res.status(503).json({
        error: 'SERVICE_UNAVAILABLE',
        message: 'No se pudo verificar los límites de tu plan. Por favor, intenta de nuevo.',
      });
    }

    // Check if at product limit (-1 means unlimited)
    if (usage.productsLimit !== -1 && usage.productsUsed >= usage.productsLimit) {
      return res.status(403).json({
        error: 'PRODUCT_LIMIT_REACHED',
        message: `Has alcanzado el límite de ${usage.productsLimit} productos. Actualiza tu plan para añadir más.`,
        usage: {
          used: usage.productsUsed,
          limit: usage.productsLimit,
          plan: usage.plan,
        },
      });
    }

    // Attach usage to request
    req.planLimits = {
      plan: usage.plan,
      orders: {
        used: usage.ordersUsed,
        limit: usage.ordersLimit,
        canCreate: usage.ordersLimit === -1 || usage.ordersUsed < usage.ordersLimit,
      },
      products: {
        used: usage.productsUsed,
        limit: usage.productsLimit,
        canCreate: usage.productsLimit === -1 || usage.productsUsed < usage.productsLimit,
      },
      users: {
        used: usage.usersUsed,
        limit: usage.usersLimit,
        canCreate: usage.usersLimit === -1 || usage.usersUsed < usage.usersLimit,
      },
    };

    next();
  } catch (error: any) {
    logger.error('BACKEND', '[PlanLimits] checkProductLimit error:', error.message);
    // SECURITY: Fail closed - deny action on error
    return res.status(503).json({
      error: 'SERVICE_UNAVAILABLE',
      message: 'Error verificando límites de plan. Por favor, intenta de nuevo.',
    });
  }
}

/**
 * Check if store has access to a specific feature
 * Use this middleware to protect feature-specific routes
 *
 * @param feature - Feature name matching has_* column in plan_limits
 *
 * Usage:
 *   router.use('/warehouse', requireFeature('warehouse'), warehouseRoutes);
 *   router.use('/returns', requireFeature('returns'), returnsRoutes);
 */
export function requireFeature(feature: string) {
  return async (req: PlanLimitRequest, res: Response, next: NextFunction) => {
    try {
      const storeId = req.storeId;
      if (!storeId) {
        return res.status(400).json({ error: 'Store ID is required' });
      }

      // Check feature access via RPC
      const { data: hasAccess, error } = await supabaseAdmin.rpc('has_feature_access', {
        p_store_id: storeId,
        p_feature: feature,
      });

      if (error) {
        logger.error('BACKEND', '[PlanLimits] Feature check error:', error.message);
        // SECURITY: Fail closed - deny access on error
        return res.status(503).json({
          error: 'SERVICE_UNAVAILABLE',
          message: 'No se pudo verificar el acceso a esta función. Por favor, intenta de nuevo.',
        });
      }

      if (!hasAccess) {
        // Map feature to human-readable name
        const featureNames: Record<string, string> = {
          warehouse: 'Almacén y Picking',
          returns: 'Devoluciones',
          merchandise: 'Mercadería',
          shipping_labels: 'Etiquetas de Envío',
          auto_inventory: 'Inventario Automático',
          shopify_import: 'Importar desde Shopify',
          shopify_bidirectional: 'Sincronización Bidireccional',
          team_management: 'Gestión de Equipo',
          smart_alerts: 'Alertas Inteligentes',
          campaign_tracking: 'Seguimiento de Campañas',
          api_read: 'API de Lectura',
          api_write: 'API de Escritura',
          custom_webhooks: 'Webhooks Personalizados',
          pdf_excel_reports: 'Reportes PDF/Excel',
        };

        return res.status(403).json({
          error: 'FEATURE_NOT_AVAILABLE',
          feature,
          message: `${featureNames[feature] || feature} no está disponible en tu plan actual. Actualiza para acceder.`,
        });
      }

      next();
    } catch (error: any) {
      logger.error('BACKEND', '[PlanLimits] requireFeature error:', error.message);
      // SECURITY: Fail closed - deny access on error
      return res.status(503).json({
        error: 'SERVICE_UNAVAILABLE',
        message: 'Error verificando acceso a función. Por favor, intenta de nuevo.',
      });
    }
  };
}

/**
 * Get current plan usage (for informational purposes)
 * Useful for displaying limits in UI
 */
export async function getPlanUsage(
  req: PlanLimitRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const storeId = req.storeId;
    if (!storeId) {
      return next();
    }

    const usage = await getStoreUsage(storeId);
    if (usage) {
      req.planLimits = {
        plan: usage.plan,
        orders: {
          used: usage.ordersUsed,
          limit: usage.ordersLimit,
          canCreate: usage.ordersLimit === -1 || usage.ordersUsed < usage.ordersLimit,
        },
        products: {
          used: usage.productsUsed,
          limit: usage.productsLimit,
          canCreate: usage.productsLimit === -1 || usage.productsUsed < usage.productsLimit,
        },
        users: {
          used: usage.usersUsed,
          limit: usage.usersLimit,
          canCreate: usage.usersLimit === -1 || usage.usersUsed < usage.usersLimit,
        },
      };
    }

    next();
  } catch (error: any) {
    logger.error('BACKEND', '[PlanLimits] getPlanUsage error:', error.message);
    next();
  }
}

export default {
  checkOrderLimit,
  checkProductLimit,
  requireFeature,
  getPlanUsage,
};
