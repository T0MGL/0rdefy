/**
 * Invoicing Routes - Electronic Invoicing (SIFEN Paraguay)
 *
 * Endpoints for fiscal configuration, invoice generation,
 * and SIFEN integration management.
 *
 * Country-gated: Only available for stores with country = 'PY'
 * Plan-gated: Growth+ ($79/month)
 */

import express, { Request, Response } from 'express';
import multer from 'multer';
import { verifyToken, extractStoreId } from '../middleware/auth';
import { extractUserRole, requireModule, requirePermission, requireRole, PermissionRequest } from '../middleware/permissions';
import { requireInvoicingCountry } from '../middleware/require-invoicing-country';
import { Module, Role, Permission } from '../permissions';
import { logger } from '../utils/logger';
import { validateUUIDParam, parsePagination, sanitizeErrorForClient } from '../utils/sanitize';
import * as invoicingService from '../services/invoicing.service';

export const invoicingRouter = express.Router();

// ================================================================
// Multer config for certificate upload (.p12 files)
// ================================================================
// @ts-expect-error - multer types issue with default export
const upload = (multer as unknown)({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 }, // 500KB max (certs are typically 2-5KB)
  fileFilter: (_req: any, file: any, cb: any) => {
    // Accept .p12 and .pfx certificate files
    const allowed = [
      'application/x-pkcs12',
      'application/pkcs12',
      'application/octet-stream', // Some browsers send .p12 as octet-stream
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(p12|pfx)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Formato inválido. Solo se aceptan archivos .p12 o .pfx'));
    }
  },
});

// ================================================================
// Apply middleware chain
// requireInvoicingCountry replaces the old inline requireParaguayStore
// and will stay accurate as we expand to other SIFEN-style backends.
// ================================================================
invoicingRouter.use(verifyToken);
invoicingRouter.use(extractStoreId);
invoicingRouter.use(extractUserRole);
invoicingRouter.use(requireModule(Module.INVOICING));
invoicingRouter.use(requireInvoicingCountry);

// ================================================================
// GET /config - Get fiscal configuration
// ================================================================
invoicingRouter.get('/config', async (req: PermissionRequest, res: Response) => {
  try {
    const config = await invoicingService.getFiscalConfig(req.storeId!);
    if (!config) {
      return res.json({ data: null, setup_required: true });
    }

    // Aggregate "ready to emit" check so the UI knows when to surface the
    // completion banner. Covers:
    //   - link.setup_completed (certificate uploaded OR demo-mode link)
    //   - representante_legal fully populated (SIFEN XML requirement)
    //   - at least one economic activity registered
    // The front-end uses setup_required to gate the "Nueva Factura" button
    // and render the amber completion banner.
    const readiness = await invoicingService.getFiscalReadiness(req.storeId!);
    const setupRequired = !readiness.ready;

    res.json({
      data: config,
      setup_required: setupRequired,
      readiness,
    });
  } catch (err: any) {
    logger.error('[Invoicing] GET /config error:', err.message);
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

// ================================================================
// POST /config - Create or update fiscal configuration
// ================================================================
invoicingRouter.post('/config', requireRole(Role.OWNER), async (req: PermissionRequest, res: Response) => {
  try {
    const { ruc, ruc_dv, razon_social, tipo_contribuyente, timbrado } = req.body;

    // Validate required fields
    if (!ruc || typeof ruc !== 'string' || !/^\d{1,20}$/.test(ruc)) {
      return res.status(400).json({ error: 'RUC inválido. Debe contener solo números (máx. 20 dígitos).' });
    }
    if (ruc_dv === undefined || ruc_dv === null || !Number.isInteger(Number(ruc_dv)) || Number(ruc_dv) < 0 || Number(ruc_dv) > 9) {
      return res.status(400).json({ error: 'Dígito verificador (DV) inválido.' });
    }
    if (!razon_social || typeof razon_social !== 'string' || razon_social.trim().length === 0) {
      return res.status(400).json({ error: 'Razón social requerida.' });
    }
    if (!tipo_contribuyente || ![1, 2].includes(Number(tipo_contribuyente))) {
      return res.status(400).json({ error: 'Tipo de contribuyente inválido (1 o 2).' });
    }
    if (!timbrado || typeof timbrado !== 'string' || timbrado.trim().length === 0) {
      return res.status(400).json({ error: 'Timbrado requerido.' });
    }
    if (!/^\d+$/.test(timbrado.trim())) {
      return res.status(400).json({ error: 'El número de timbrado solo puede contener dígitos.' });
    }
    if (timbrado.length > 50) {
      return res.status(400).json({ error: 'Número de timbrado muy largo (máx. 50 caracteres).' });
    }

    const { establecimiento_telefono } = req.body;
    if (establecimiento_telefono && typeof establecimiento_telefono === 'string' && establecimiento_telefono.length > 50) {
      return res.status(400).json({ error: 'Teléfono muy largo (máx. 50 caracteres).' });
    }

    const config = await invoicingService.setupFiscalConfig(req.storeId!, req.body);
    res.json({ data: config, message: 'Configuración fiscal guardada' });
  } catch (err: any) {
    logger.error('[Invoicing] POST /config error:', err.message);
    res.status(400).json({ error: sanitizeErrorForClient(err) });
  }
});

// ================================================================
// POST /config/certificate - Upload .p12 certificate
// ================================================================
invoicingRouter.post(
  '/config/certificate',
  requireRole(Role.OWNER),
  upload.single('certificate'),
  async (req: PermissionRequest, res: Response) => {
    try {
      const file = (req as any).file;
      if (!file) {
        return res.status(400).json({ error: 'No se recibió archivo de certificado' });
      }

      const password = req.body.password;
      if (!password) {
        return res.status(400).json({ error: 'Contraseña del certificado requerida' });
      }

      const result = await invoicingService.uploadCertificate(
        req.storeId!,
        file.buffer,
        password
      );

      res.json({
        data: result,
        message: 'Certificado cargado exitosamente',
      });
    } catch (err: any) {
      logger.error('[Invoicing] POST /config/certificate error:', err.message);
      res.status(400).json({ error: sanitizeErrorForClient(err) });
    }
  }
);

// ================================================================
// GET /config/validate - Validate current fiscal config
// ================================================================
invoicingRouter.get('/config/validate', async (req: PermissionRequest, res: Response) => {
  try {
    const result = await invoicingService.validateConfig(req.storeId!);
    res.json({ data: result });
  } catch (err: any) {
    logger.error('[Invoicing] GET /config/validate error:', err.message);
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

// ================================================================
// POST /generate/manual - Generate invoice without an order
// Must be registered before /generate/:orderId to avoid the
// :orderId param matching the literal string "manual".
// ================================================================
invoicingRouter.post(
  '/generate/manual',
  requirePermission(Module.INVOICING, Permission.CREATE),
  async (req: PermissionRequest, res: Response) => {
    try {
      const { tipoDocumento, customerName, customerRuc, customerRucDv, customerEmail, items } = req.body;

      const validDocTypes = [1, 5, 6];
      if (!tipoDocumento || !validDocTypes.includes(Number(tipoDocumento))) {
        return res.status(400).json({ error: 'Tipo de documento inválido. Valores válidos: 1 (Factura), 5 (Nota de Crédito), 6 (Nota de Débito).' });
      }

      if (!customerName || typeof customerName !== 'string' || customerName.trim().length === 0) {
        return res.status(400).json({ error: 'Nombre del comprador requerido.' });
      }

      if (customerRuc !== undefined && customerRuc !== null && customerRuc !== '') {
        if (typeof customerRuc !== 'string' || !/^\d{1,20}$/.test(customerRuc)) {
          return res.status(400).json({ error: 'RUC inválido.' });
        }
        if (customerRucDv === undefined || customerRucDv === null || !Number.isInteger(Number(customerRucDv))) {
          return res.status(400).json({ error: 'Dígito verificador del comprador requerido.' });
        }
      }

      if (customerEmail !== undefined && customerEmail !== null && customerEmail !== '') {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(customerEmail)) {
          return res.status(400).json({ error: 'Email del comprador inválido.' });
        }
      }

      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Se requiere al menos un ítem.' });
      }

      const validIvaRates = [0, 5, 10];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item.descripcion || typeof item.descripcion !== 'string' || item.descripcion.trim().length === 0) {
          return res.status(400).json({ error: `Ítem ${i + 1}: descripción requerida.` });
        }
        if (!Number.isFinite(item.cantidad) || item.cantidad <= 0) {
          return res.status(400).json({ error: `Ítem ${i + 1}: cantidad debe ser mayor a 0.` });
        }
        if (!Number.isFinite(item.precioUnitario) || item.precioUnitario < 0) {
          return res.status(400).json({ error: `Ítem ${i + 1}: precio unitario inválido.` });
        }
        if (!validIvaRates.includes(Number(item.ivaRate))) {
          return res.status(400).json({ error: `Ítem ${i + 1}: tasa IVA inválida. Valores válidos: 0, 5, 10.` });
        }
      }

      const result = await invoicingService.generateManualInvoice(req.storeId!, {
        tipoDocumento: Number(tipoDocumento) as 1 | 5 | 6,
        customerName: customerName.trim(),
        customerRuc: customerRuc || undefined,
        customerRucDv: customerRucDv !== undefined && customerRucDv !== null && customerRucDv !== '' ? Number(customerRucDv) : undefined,
        customerEmail: customerEmail || undefined,
        items: items.map((item: any) => ({
          descripcion: item.descripcion.trim(),
          cantidad: Number(item.cantidad),
          precioUnitario: Number(item.precioUnitario),
          ivaRate: Number(item.ivaRate) as 10 | 5 | 0,
        })),
      });

      res.json({
        data: result,
        message: 'Factura emitida exitosamente',
      });
    } catch (err: any) {
      logger.error('[Invoicing] POST /generate/manual error:', err.message);
      res.status(400).json({ error: sanitizeErrorForClient(err) });
    }
  }
);

// ================================================================
// POST /generate/:orderId - Generate invoice for an order
// ================================================================
invoicingRouter.post(
  '/generate/:orderId',
  validateUUIDParam('orderId'),
  requirePermission(Module.INVOICING, Permission.CREATE),
  async (req: PermissionRequest, res: Response) => {
    try {
      const { orderId } = req.params;
      const result = await invoicingService.generateInvoice(req.storeId!, orderId);
      res.json({
        data: result,
        message: 'Factura generada exitosamente',
      });
    } catch (err: any) {
      logger.error('[Invoicing] POST /generate error:', err.message);
      res.status(400).json({ error: sanitizeErrorForClient(err) });
    }
  }
);

// ================================================================
// GET /invoices - List invoices with filters
// ================================================================
invoicingRouter.get('/invoices', async (req: PermissionRequest, res: Response) => {
  try {
    const { status, tipo_documento, from_date, to_date, limit: rawLimit, offset: rawOffset } = req.query;
    const { limit, offset } = parsePagination(rawLimit, rawOffset);

    // Validate status filter if provided
    const validStatuses = ['pending', 'sent', 'approved', 'rejected', 'cancelled', 'demo'];
    if (status && !validStatuses.includes(status as string)) {
      return res.status(400).json({ error: `Estado inválido. Valores válidos: ${validStatuses.join(', ')}` });
    }

    // Validate tipo_documento if provided
    if (tipo_documento && ![1, 5, 6].includes(Number(tipo_documento))) {
      return res.status(400).json({ error: 'Tipo de documento inválido (1, 5, 6).' });
    }

    const result = await invoicingService.getInvoices(req.storeId!, {
      status: status as string,
      tipo_documento: tipo_documento ? Number(tipo_documento) : undefined,
      from_date: from_date as string,
      to_date: to_date as string,
      limit,
      offset,
    });
    res.json(result);
  } catch (err: any) {
    logger.error('[Invoicing] GET /invoices error:', err.message);
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

// ================================================================
// GET /invoices/:id - Get invoice detail with events
// ================================================================
invoicingRouter.get('/invoices/:id', validateUUIDParam('id'), async (req: PermissionRequest, res: Response) => {
  try {
    const invoice = await invoicingService.getInvoice(req.storeId!, req.params.id);
    if (!invoice) {
      return res.status(404).json({ error: 'Factura no encontrada' });
    }
    res.json({ data: invoice });
  } catch (err: any) {
    logger.error('[Invoicing] GET /invoices/:id error:', err.message);
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

// ================================================================
// GET /invoices/:id/xml - Download invoice XML
// ================================================================
invoicingRouter.get('/invoices/:id/xml', validateUUIDParam('id'), async (req: PermissionRequest, res: Response) => {
  try {
    const { xml, filename } = await invoicingService.downloadXML(req.storeId!, req.params.id);
    if (!xml) {
      return res.status(404).json({ error: 'XML no disponible' });
    }
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(xml);
  } catch (err: any) {
    logger.error('[Invoicing] GET /invoices/:id/xml error:', err.message);
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

// ================================================================
// GET /invoices/:id/kude - Download invoice KUDE PDF
// ================================================================
// Returns 404 for invoices that are not in an approved/demo state. The
// PDF represents a CDC authorized by SIFEN; we never render one for a
// pending or rejected invoice.
invoicingRouter.get('/invoices/:id/kude', validateUUIDParam('id'), async (req: PermissionRequest, res: Response) => {
  try {
    const result = await invoicingService.downloadKude(req.storeId!, req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'KUDE no disponible. La factura debe estar aprobada por SIFEN.' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Content-Length', String(result.pdf.length));
    res.send(result.pdf);
  } catch (err: any) {
    logger.error('[Invoicing] GET /invoices/:id/kude error:', err.message);
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

// ================================================================
// POST /invoices/:id/cancel - Cancel invoice
// ================================================================
invoicingRouter.post(
  '/invoices/:id/cancel',
  validateUUIDParam('id'),
  requireRole(Role.OWNER),
  async (req: PermissionRequest, res: Response) => {
    try {
      const { motivo } = req.body;
      if (!motivo || typeof motivo !== 'string' || motivo.trim().length === 0) {
        return res.status(400).json({ error: 'Motivo de cancelación requerido' });
      }
      if (motivo.length > 500) {
        return res.status(400).json({ error: 'Motivo de cancelación muy largo (máx. 500 caracteres)' });
      }
      const result = await invoicingService.cancelInvoice(req.storeId!, req.params.id, motivo.trim());
      res.json({ data: result, message: 'Factura cancelada exitosamente' });
    } catch (err: any) {
      logger.error('[Invoicing] POST /invoices/:id/cancel error:', err.message);
      res.status(400).json({ error: sanitizeErrorForClient(err) });
    }
  }
);

// ================================================================
// POST /invoices/:id/retry - Retry failed SIFEN send
// ================================================================
invoicingRouter.post(
  '/invoices/:id/retry',
  validateUUIDParam('id'),
  requirePermission(Module.INVOICING, Permission.EDIT),
  async (req: PermissionRequest, res: Response) => {
    try {
      const result = await invoicingService.retryInvoice(req.storeId!, req.params.id);
      res.json({ data: result, message: 'Reintento procesado' });
    } catch (err: any) {
      logger.error('[Invoicing] POST /invoices/:id/retry error:', err.message);
      res.status(400).json({ error: sanitizeErrorForClient(err) });
    }
  }
);

// ================================================================
// POST /invoices/:id/resend-email - Re-send the KUDE + email for an
// already-approved invoice (does NOT re-send to SIFEN). Used to deliver a
// corrected KUDE to the customer after a rendering fix without touching the
// fiscal document.
// ================================================================
invoicingRouter.post(
  '/invoices/:id/resend-email',
  validateUUIDParam('id'),
  requirePermission(Module.INVOICING, Permission.EDIT),
  async (req: PermissionRequest, res: Response) => {
    try {
      const result = await invoicingService.dispatchApprovedInvoiceEmail(
        req.storeId!,
        req.params.id,
      );
      if (!result.dispatched) {
        return res.status(400).json({ error: `No se reenvió el email: ${result.reason}` });
      }
      res.json({ data: result, message: 'KUDE reenviado al cliente' });
    } catch (err: any) {
      logger.error('[Invoicing] POST /invoices/:id/resend-email error:', err.message);
      res.status(400).json({ error: sanitizeErrorForClient(err) });
    }
  }
);

// ================================================================
// GET /stats - Invoice statistics
// ================================================================
invoicingRouter.get('/stats', async (req: PermissionRequest, res: Response) => {
  try {
    const stats = await invoicingService.getInvoiceStats(req.storeId!);
    res.json({ data: stats });
  } catch (err: any) {
    logger.error('[Invoicing] GET /stats error:', err.message);
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});
