/**
 * Outbound Webhooks Routes
 *
 * CRUD endpoints for managing outbound webhook configurations.
 * Gated by Professional plan (custom_webhooks feature).
 *
 * Endpoints:
 *   GET    /api/outbound-webhooks/configs          - List configs
 *   POST   /api/outbound-webhooks/configs          - Create config
 *   PUT    /api/outbound-webhooks/configs/:id      - Update config
 *   DELETE /api/outbound-webhooks/configs/:id      - Delete config
 *   POST   /api/outbound-webhooks/configs/:id/test - Send test webhook
 *   POST   /api/outbound-webhooks/configs/:id/regenerate-secret - Regenerate signing secret
 *   GET    /api/outbound-webhooks/deliveries       - Delivery history
 *   GET    /api/outbound-webhooks/events           - List supported events
 */

import { Router, Response } from 'express';
import { verifyToken, extractStoreId, AuthRequest } from '../middleware/auth';
import { requireFeature } from '../middleware/planLimits';
import { extractUserRole, requireModule, requirePermission, PermissionRequest } from '../middleware/permissions';
import { Module, Permission } from '../permissions';
import { OutboundWebhookService, OUTBOUND_WEBHOOK_EVENTS } from '../services/outbound-webhook.service';
import { logger } from '../utils/logger';
import { isValidUUID, validateUUIDParam } from '../utils/sanitize';

const router = Router();

// All routes require auth + Professional plan + role extraction
router.use(verifyToken as any);
router.use(extractStoreId as any);
router.use(requireFeature('custom_webhooks') as any);
router.use(extractUserRole as any);
router.use(requireModule(Module.INTEGRATIONS) as any);

// ================================================================
// GET /configs - List all outbound webhook configs for this store
// ================================================================
router.get('/configs', async (req: AuthRequest, res: Response) => {
    try {
        const configs = await OutboundWebhookService.getConfigs(req.storeId!);

        // Never expose signing_secret in list view
        const safeConfigs = configs.map(c => ({
            ...c,
            signing_secret: undefined,
            signing_secret_prefix: c.signing_secret?.substring(0, 10) + '...',
        }));

        res.json({ success: true, configs: safeConfigs });
    } catch (error: any) {
        logger.error('OUTBOUND_WEBHOOK', 'GET /configs error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ================================================================
// POST /configs - Create a new outbound webhook config
// ================================================================
router.post('/configs', requirePermission(Module.INTEGRATIONS, Permission.CREATE) as any, async (req: PermissionRequest, res: Response) => {
    try {
        const { name, url, events, custom_headers } = req.body;

        // Validate name length
        if (name && (typeof name !== 'string' || name.length > 100)) {
            return res.status(400).json({ error: 'Nombre debe ser texto de máximo 100 caracteres' });
        }

        // Validate required fields
        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'URL es requerida' });
        }

        if (!/^https?:\/\/.+/.test(url)) {
            return res.status(400).json({ error: 'URL debe comenzar con http:// o https://' });
        }

        if (!events || !Array.isArray(events) || events.length === 0) {
            return res.status(400).json({ error: 'Debes seleccionar al menos un evento' });
        }

        // Validate events
        const validEvents = [...OUTBOUND_WEBHOOK_EVENTS] as string[];
        const invalidEvents = events.filter((e: string) => !validEvents.includes(e));
        if (invalidEvents.length > 0) {
            return res.status(400).json({
                error: `Eventos inválidos: ${invalidEvents.join(', ')}`,
                valid_events: validEvents,
            });
        }

        // Validate custom_headers
        if (custom_headers && typeof custom_headers !== 'object') {
            return res.status(400).json({ error: 'custom_headers debe ser un objeto' });
        }

        const result = await OutboundWebhookService.createConfig(
            req.storeId!,
            req.userId!,
            {
                name: name || 'Mi Webhook',
                url,
                events,
                custom_headers: custom_headers || {},
            }
        );

        // Return the signing secret ONLY on creation (one-time display)
        res.status(201).json({
            success: true,
            config: {
                ...result.config,
                signing_secret: undefined,
                signing_secret_prefix: result.config.signing_secret?.substring(0, 10) + '...',
            },
            signing_secret: result.signing_secret,
            message: 'Webhook creado exitosamente. Guarda el secreto de firma, no se mostrará de nuevo.',
        });
    } catch (error: any) {
        logger.error('OUTBOUND_WEBHOOK', 'POST /configs error:', error.message);
        const isKnown = error.message?.includes('Máximo') || error.message?.includes('Maximum');
        res.status(isKnown ? 400 : 500).json({ error: isKnown ? error.message : 'Error interno del servidor' });
    }
});

// ================================================================
// PUT /configs/:id - Update a webhook config
// ================================================================
router.put('/configs/:id', validateUUIDParam('id') as any, requirePermission(Module.INTEGRATIONS, Permission.EDIT) as any, async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { name, url, events, is_active, custom_headers } = req.body;

        // Validate URL if provided
        if (url !== undefined) {
            if (typeof url !== 'string' || !/^https?:\/\/.+/.test(url)) {
                return res.status(400).json({ error: 'URL debe comenzar con http:// o https://' });
            }
        }

        // Validate events if provided
        if (events !== undefined) {
            if (!Array.isArray(events) || events.length === 0) {
                return res.status(400).json({ error: 'Debes seleccionar al menos un evento' });
            }
            const validEvents = [...OUTBOUND_WEBHOOK_EVENTS] as string[];
            const invalidEvents = events.filter((e: string) => !validEvents.includes(e));
            if (invalidEvents.length > 0) {
                return res.status(400).json({ error: `Eventos inválidos: ${invalidEvents.join(', ')}` });
            }
        }

        const config = await OutboundWebhookService.updateConfig(req.storeId!, id, {
            name,
            url,
            events,
            is_active,
            custom_headers,
        });

        res.json({
            success: true,
            config: {
                ...config,
                signing_secret: undefined,
                signing_secret_prefix: config.signing_secret?.substring(0, 10) + '...',
            },
        });
    } catch (error: any) {
        logger.error('OUTBOUND_WEBHOOK', 'PUT /configs/:id error:', error.message);
        const isKnown = error.message?.includes('Configuración') || error.message?.includes('no encontrada');
        res.status(isKnown ? 404 : 500).json({ error: isKnown ? error.message : 'Error interno del servidor' });
    }
});

// ================================================================
// DELETE /configs/:id - Delete a webhook config
// ================================================================
router.delete('/configs/:id', validateUUIDParam('id') as any, requirePermission(Module.INTEGRATIONS, Permission.DELETE) as any, async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;

        await OutboundWebhookService.deleteConfig(req.storeId!, id);
        res.json({ success: true, message: 'Webhook eliminado exitosamente' });
    } catch (error: any) {
        logger.error('OUTBOUND_WEBHOOK', 'DELETE /configs/:id error:', error.message);
        const isKnown = error.message?.includes('Configuración') || error.message?.includes('no encontrada');
        res.status(isKnown ? 404 : 500).json({ error: isKnown ? error.message : 'Error interno del servidor' });
    }
});

// ================================================================
// POST /configs/:id/test - Send a test webhook
// ================================================================
router.post('/configs/:id/test', validateUUIDParam('id') as any, async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        const result = await OutboundWebhookService.sendTestWebhook(req.storeId!, id);

        res.json({
            success: result.status === 'success',
            result,
            message: result.status === 'success'
                ? `Test exitoso (${result.response_status}, ${result.duration_ms}ms)`
                : `Test fallido: ${result.error_message}`,
        });
    } catch (error: any) {
        logger.error('OUTBOUND_WEBHOOK', 'POST /configs/:id/test error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ================================================================
// POST /configs/:id/regenerate-secret - Regenerate signing secret
// ================================================================
router.post('/configs/:id/regenerate-secret', validateUUIDParam('id') as any, requirePermission(Module.INTEGRATIONS, Permission.EDIT) as any, async (req: PermissionRequest, res: Response) => {
    try {
        const { id } = req.params;

        const newSecret = await OutboundWebhookService.regenerateSecret(req.storeId!, id);

        res.json({
            success: true,
            signing_secret: newSecret,
            message: 'Secreto regenerado. Actualiza tu endpoint con el nuevo secreto.',
        });
    } catch (error: any) {
        logger.error('OUTBOUND_WEBHOOK', 'POST /regenerate-secret error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ================================================================
// GET /deliveries - Delivery history
// ================================================================
router.get('/deliveries', async (req: AuthRequest, res: Response) => {
    try {
        const configId = req.query.config_id as string | undefined;
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
        const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

        // Validate config_id if provided
        if (configId && !isValidUUID(configId)) {
            return res.status(400).json({ error: 'config_id inválido' });
        }

        const result = await OutboundWebhookService.getDeliveries(
            req.storeId!,
            configId,
            limit,
            offset
        );

        res.json({ success: true, ...result });
    } catch (error: any) {
        logger.error('OUTBOUND_WEBHOOK', 'GET /deliveries error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ================================================================
// GET /events - List supported events
// ================================================================
router.get('/events', (_req: AuthRequest, res: Response) => {
    const eventDescriptions: Record<string, string> = {
        'order.status_changed': 'Se dispara con cualquier cambio de estado',
        'order.confirmed': 'Pedido confirmado',
        'order.in_preparation': 'Pedido en preparación',
        'order.ready_to_ship': 'Pedido listo para enviar',
        'order.shipped': 'Pedido enviado / en tránsito',
        'order.delivered': 'Pedido entregado',
        'order.cancelled': 'Pedido cancelado o rechazado',
        'order.returned': 'Pedido devuelto',
    };

    res.json({
        success: true,
        events: OUTBOUND_WEBHOOK_EVENTS.map(e => ({
            event: e,
            description: eventDescriptions[e] || e,
        })),
    });
});

export { router as outboundWebhooksRouter };
