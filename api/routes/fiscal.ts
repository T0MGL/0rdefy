/**
 * Fiscal Routes - Identity, Activities, Store Link (Paraguay SIFEN)
 *
 * Surface exposed at /api/fiscal/*. Splits the old monolithic
 * /api/invoicing/config into resource-oriented endpoints that mirror the
 * data model created by migration 161:
 *
 *   fiscal_identities           (RUC-level)
 *   fiscal_identity_activities  (economic activities)
 *   fiscal_identity_stores      (per-store link: timbrado, establecimiento,
 *                                 punto expedicion, next_document_number)
 *
 * Country gate: requireInvoicingCountry blocks any store whose country is
 * not Paraguay. Plan gate: same as /api/invoicing/* (Module.INVOICING
 * inside permissions.ts). Role gate: only OWNER can write identity data;
 * per-store config is also OWNER-scoped.
 */

import express, { Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { verifyToken, extractStoreId } from '../middleware/auth';
import {
  extractUserRole,
  requireModule,
  requireRole,
  PermissionRequest,
} from '../middleware/permissions';
import { requireInvoicingCountry } from '../middleware/require-invoicing-country';
import { Module, Role } from '../permissions';
import { logger } from '../utils/logger';
import { sanitizeErrorForClient, validateUUIDParam } from '../utils/sanitize';
import * as invoicingService from '../services/invoicing.service';
import * as sifenClient from '../services/sifen/sifen-client';

export const fiscalRouter = express.Router();

// ================================================================
// Multer: .p12 certificate upload (identity-level)
// ================================================================
// @ts-expect-error multer default-export typing
const upload = (multer as unknown)({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 },
  fileFilter: (_req: any, file: any, cb: any) => {
    const allowed = ['application/x-pkcs12', 'application/pkcs12', 'application/octet-stream'];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(p12|pfx)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Formato invalido. Solo se aceptan archivos .p12 o .pfx'));
    }
  },
});

// ================================================================
// Middleware chain
// verifyToken + extractStoreId + extractUserRole + requireModule +
// requireInvoicingCountry.
//
// Note: extractStoreId is required because requireInvoicingCountry reads
// stores.country from the current store. Endpoints that act only at the
// identity level still respect the gate (the user picked a store; if
// that store's country is unsupported, nothing fiscal is exposed).
// ================================================================
fiscalRouter.use(verifyToken);
fiscalRouter.use(extractStoreId);
fiscalRouter.use(extractUserRole);
fiscalRouter.use(requireModule(Module.INVOICING));
fiscalRouter.use(requireInvoicingCountry);

// ================================================================
// Zod schemas
// ================================================================

const identityCreateSchema = z.object({
  ruc: z.string().regex(/^\d{1,20}$/, 'RUC invalido (solo digitos, max 20)'),
  ruc_dv: z.number().int().min(0).max(9),
  razon_social: z.string().min(1).max(255),
  nombre_fantasia: z.string().max(255).nullable().optional(),
  tipo_contribuyente: z.union([z.literal(1), z.literal(2)]),
  tipo_regimen: z.number().int().nullable().optional(),
  sifen_environment: z.enum(['demo', 'test', 'prod']).optional(),
  representante_legal_nombre: z.string().max(255).nullable().optional(),
  representante_legal_documento_tipo: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(9)])
    .nullable()
    .optional(),
  representante_legal_documento_numero: z.string().max(50).nullable().optional(),
  representante_legal_cargo: z.string().max(100).nullable().optional(),
  domicilio_fiscal_direccion: z.string().nullable().optional(),
  domicilio_fiscal_numero_casa: z.string().max(20).nullable().optional(),
  domicilio_fiscal_departamento: z.number().int().nullable().optional(),
  domicilio_fiscal_distrito: z.number().int().nullable().optional(),
  domicilio_fiscal_ciudad: z.number().int().nullable().optional(),
});

const identityPatchSchema = identityCreateSchema.partial();

const activityCreateSchema = z.object({
  codigo: z.string().min(1).max(10),
  descripcion: z.string().min(1).max(255),
  is_principal: z.boolean().optional(),
  display_order: z.number().int().min(0).optional(),
});

const activityPatchSchema = activityCreateSchema.partial();

const storeLinkSchema = z.object({
  timbrado: z.string().regex(/^\d{8}$/, 'Timbrado debe ser 8 digitos numericos'),
  timbrado_fecha_inicio: z.string().nullable().optional(),
  timbrado_fecha_fin: z.string().nullable().optional(),
  establecimiento_codigo: z
    .string()
    .regex(/^\d{3}$/, 'Codigo de establecimiento debe ser 3 digitos')
    .optional(),
  punto_expedicion: z
    .string()
    .regex(/^\d{3}$/, 'Punto de expedicion debe ser 3 digitos')
    .optional(),
  establecimiento_direccion: z.string().nullable().optional(),
  establecimiento_departamento: z.number().int().nullable().optional(),
  establecimiento_distrito: z.number().int().nullable().optional(),
  establecimiento_ciudad: z.number().int().nullable().optional(),
  establecimiento_telefono: z.string().max(50).nullable().optional(),
  establecimiento_email: z.string().email().nullable().optional(),
  // Per-store commercial name override (migration 197).
  nombre_fantasia: z.string().max(255).nullable().optional(),
  // Invoicing preferences (migration 163 + 193).
  default_generic_description: z.string().trim().min(1).max(120).optional(),
  use_generic_description: z.boolean().optional(),
  auto_emit_invoice_on_delivery: z.boolean().optional(),
});

const storeLinkPatchSchema = storeLinkSchema.partial();

const linkBodySchema = z.object({
  identity_id: z.string().uuid(),
  link: storeLinkSchema,
});

// ================================================================
// GET /identities - list identities owned by the authenticated user
// ================================================================
fiscalRouter.get('/identities', async (req: PermissionRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const identities = await invoicingService.listIdentitiesForOwner(userId);
    res.json({ data: identities });
  } catch (err: any) {
    logger.error('BACKEND', `[Fiscal] GET /identities error: ${err.message}`);
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

// ================================================================
// POST /identities - create a new identity for the authenticated user
// ================================================================
fiscalRouter.post(
  '/identities',
  requireRole(Role.OWNER),
  async (req: PermissionRequest, res: Response) => {
    try {
      const parsed = identityCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Datos invalidos', details: parsed.error.flatten() });
      }
      const identity = await invoicingService.createIdentity(req.userId!, parsed.data as any);
      res.json({ data: identity, message: 'Identidad fiscal creada' });
    } catch (err: any) {
      logger.error('BACKEND', `[Fiscal] POST /identities error: ${err.message}`);
      res.status(400).json({ error: sanitizeErrorForClient(err) });
    }
  },
);

// ================================================================
// PATCH /identities/:id - update an existing identity
// Authz: verify the identity belongs to the calling user before mutating.
// ================================================================
fiscalRouter.patch(
  '/identities/:id',
  validateUUIDParam('id'),
  requireRole(Role.OWNER),
  async (req: PermissionRequest, res: Response) => {
    try {
      const parsed = identityPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Datos invalidos', details: parsed.error.flatten() });
      }
      await invoicingService.assertIdentityOwnedBy(req.params.id, req.userId!);
      const identity = await invoicingService.updateIdentity(req.params.id, parsed.data as any);
      res.json({ data: identity, message: 'Identidad fiscal actualizada' });
    } catch (err: any) {
      logger.error('BACKEND', `[Fiscal] PATCH /identities error: ${err.message}`);
      res.status(400).json({ error: sanitizeErrorForClient(err) });
    }
  },
);

// ================================================================
// POST /identities/:id/certificate - upload .p12 (identity-level)
// ================================================================
fiscalRouter.post(
  '/identities/:id/certificate',
  validateUUIDParam('id'),
  requireRole(Role.OWNER),
  upload.single('certificate'),
  async (req: PermissionRequest, res: Response) => {
    try {
      const file = (req as any).file;
      if (!file) return res.status(400).json({ error: 'No se recibio archivo de certificado' });

      const password = req.body.password;
      if (typeof password !== 'string') {
        return res.status(400).json({ error: 'Contrasena del certificado requerida' });
      }

      await invoicingService.assertIdentityOwnedBy(req.params.id, req.userId!);
      const result = await invoicingService.uploadCertificate(req.params.id, file.buffer, password);
      res.json({ data: result, message: 'Certificado cargado exitosamente' });
    } catch (err: any) {
      logger.error('BACKEND', `[Fiscal] POST /identities/:id/certificate error: ${err.message}`);
      res.status(400).json({ error: sanitizeErrorForClient(err) });
    }
  },
);

// ================================================================
// POST /identities/:id/csc - store DNIT-issued CSC pair (prod only)
// ================================================================
const cscSchema = z.object({
  csc_id: z.string().min(1).max(4),
  csc: z.string().length(32),
});

fiscalRouter.post(
  '/identities/:id/csc',
  validateUUIDParam('id'),
  requireRole(Role.OWNER),
  async (req: PermissionRequest, res: Response) => {
    try {
      const parsed = cscSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Datos invalidos', details: parsed.error.flatten() });
      }
      await invoicingService.assertIdentityOwnedBy(req.params.id, req.userId!);
      const result = await invoicingService.setIdentityCsc(
        req.params.id,
        parsed.data.csc_id,
        parsed.data.csc,
      );
      res.json({ data: result, message: 'CSC guardado' });
    } catch (err: any) {
      logger.error('BACKEND', `[Fiscal] POST /identities/:id/csc error: ${err.message}`);
      res.status(400).json({ error: sanitizeErrorForClient(err) });
    }
  },
);

// ================================================================
// POST /identities/:id/activities - add activity
// ================================================================
fiscalRouter.post(
  '/identities/:id/activities',
  validateUUIDParam('id'),
  requireRole(Role.OWNER),
  async (req: PermissionRequest, res: Response) => {
    try {
      const parsed = activityCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Datos invalidos', details: parsed.error.flatten() });
      }
      await invoicingService.assertIdentityOwnedBy(req.params.id, req.userId!);
      const activity = await invoicingService.addIdentityActivity(req.params.id, parsed.data);
      res.json({ data: activity, message: 'Actividad agregada' });
    } catch (err: any) {
      logger.error('BACKEND', `[Fiscal] POST /identities/:id/activities error: ${err.message}`);
      res.status(400).json({ error: sanitizeErrorForClient(err) });
    }
  },
);

// ================================================================
// PATCH /identities/:id/activities/:aid - update activity (set principal,
// rename, etc)
// ================================================================
fiscalRouter.patch(
  '/identities/:id/activities/:aid',
  validateUUIDParam('id'),
  validateUUIDParam('aid'),
  requireRole(Role.OWNER),
  async (req: PermissionRequest, res: Response) => {
    try {
      const parsed = activityPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Datos invalidos', details: parsed.error.flatten() });
      }
      await invoicingService.assertIdentityOwnedBy(req.params.id, req.userId!);
      const activity = await invoicingService.updateIdentityActivity(
        req.params.id,
        req.params.aid,
        parsed.data,
      );
      res.json({ data: activity, message: 'Actividad actualizada' });
    } catch (err: any) {
      logger.error('BACKEND', `[Fiscal] PATCH /identities/:id/activities/:aid error: ${err.message}`);
      res.status(400).json({ error: sanitizeErrorForClient(err) });
    }
  },
);

// ================================================================
// DELETE /identities/:id/activities/:aid - delete activity
// ================================================================
fiscalRouter.delete(
  '/identities/:id/activities/:aid',
  validateUUIDParam('id'),
  validateUUIDParam('aid'),
  requireRole(Role.OWNER),
  async (req: PermissionRequest, res: Response) => {
    try {
      await invoicingService.assertIdentityOwnedBy(req.params.id, req.userId!);
      await invoicingService.deleteIdentityActivity(req.params.id, req.params.aid);
      res.json({ message: 'Actividad eliminada' });
    } catch (err: any) {
      logger.error('BACKEND', `[Fiscal] DELETE /identities/:id/activities/:aid error: ${err.message}`);
      res.status(400).json({ error: sanitizeErrorForClient(err) });
    }
  },
);

// ================================================================
// POST /stores/:storeId/link - link an identity to the current store
// ================================================================
fiscalRouter.post(
  '/stores/:storeId/link',
  validateUUIDParam('storeId'),
  requireRole(Role.OWNER),
  async (req: PermissionRequest, res: Response) => {
    try {
      // Scope: only allow linking the store the operator is currently scoped to.
      if (req.params.storeId !== req.storeId) {
        return res.status(403).json({ error: 'Solo puedes vincular la tienda actual' });
      }
      const parsed = linkBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Datos invalidos', details: parsed.error.flatten() });
      }
      await invoicingService.assertIdentityOwnedBy(parsed.data.identity_id, req.userId!);
      const link = await invoicingService.linkIdentityToStore(
        parsed.data.identity_id,
        req.params.storeId,
        parsed.data.link,
      );
      res.json({ data: link, message: 'Tienda vinculada a la identidad fiscal' });
    } catch (err: any) {
      logger.error('BACKEND', `[Fiscal] POST /stores/:id/link error: ${err.message}`);
      res.status(400).json({ error: sanitizeErrorForClient(err) });
    }
  },
);

// ================================================================
// PATCH /stores/:storeId - update per-store fiscal fields
// ================================================================
fiscalRouter.patch(
  '/stores/:storeId',
  validateUUIDParam('storeId'),
  requireRole(Role.OWNER),
  async (req: PermissionRequest, res: Response) => {
    try {
      if (req.params.storeId !== req.storeId) {
        return res.status(403).json({ error: 'Solo puedes editar la tienda actual' });
      }
      const parsed = storeLinkPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Datos invalidos', details: parsed.error.flatten() });
      }
      const link = await invoicingService.updateStoreFields(req.params.storeId, parsed.data);
      res.json({ data: link, message: 'Datos fiscales de la tienda actualizados' });
    } catch (err: any) {
      logger.error('BACKEND', `[Fiscal] PATCH /stores/:storeId error: ${err.message}`);
      res.status(400).json({ error: sanitizeErrorForClient(err) });
    }
  },
);

// ================================================================
// GET /context - resolved fiscal context for the current store
// Used by the frontend hook useInvoicingAvailability to gate the UI.
// ================================================================
fiscalRouter.get('/context', async (req: PermissionRequest, res: Response) => {
  try {
    const ctx = await invoicingService.getFiscalContext(req.storeId!);
    res.json({ data: ctx });
  } catch (err: any) {
    logger.error('BACKEND', `[Fiscal] GET /context error: ${err.message}`);
    res.status(500).json({ error: sanitizeErrorForClient(err) });
  }
});

// ================================================================
// POST /test-connection - ping SIFEN with the stored mTLS material
// ================================================================
//
// Para que el owner pueda verificar de un click que el cert + CSC + env
// estan bien configurados sin emitir una factura real. Usamos
// consultLote(0) que es una operacion barata: SIFEN devuelve
// `dCodResLot=0360 (Numero de lote inexistente)` cuando el protocolo no
// existe, lo cual indica que: TLS mutual handshake OK, cert aceptado,
// SIFEN procesa requests. Cualquier otra respuesta (timeout, TLS error,
// 0421 sin permiso) la mostramos con el detalle para que el owner sepa
// que arreglar.
fiscalRouter.post('/test-connection', requireRole(Role.OWNER), async (req: PermissionRequest, res: Response) => {
  const start = Date.now();
  try {
    const ctx = await invoicingService.getFiscalContext(req.storeId!);
    if (!ctx) {
      return res.json({
        data: {
          ok: false,
          stage: 'context',
          message: 'No hay configuracion fiscal activa en esta tienda.',
        },
      });
    }

    const env = ctx.identity.sifen_environment;
    if (env === 'demo') {
      return res.json({
        data: {
          ok: true,
          stage: 'demo',
          environment: env,
          latencyMs: 0,
          message: 'Modo demo: las facturas se simulan localmente, SIFEN no se contacta.',
        },
      });
    }
    if (!ctx.identity.has_certificate) {
      return res.json({
        data: {
          ok: false,
          stage: 'certificate',
          environment: env,
          message: 'No hay certificado digital cargado. Subi el .p12 antes de probar.',
        },
      });
    }
    if (env === 'prod' && !ctx.identity.csc_id) {
      return res.json({
        data: {
          ok: false,
          stage: 'csc',
          environment: env,
          message: 'Falta CSC + idCSC. DNIT los emite en Marangatu al habilitarte como Facturador Electronico.',
        },
      });
    }

    const { certPem, privateKeyPem } = await invoicingService.loadCertificateMaterial(ctx.identity.id);
    // Dummy protocol: 15 digitos (formato valido por XSD) que no existe, asi
    // SIFEN responde 0360 (lote inexistente) en vez de 0160 (XML malformado,
    // que es lo que devuelve prod cuando el protocolo no pasa el schema, p.ej.
    // un '0' de 1 digito).
    const result = await sifenClient.consultLote('999999999999999', env as 'test' | 'prod', {
      certPem,
      privateKeyPem,
    });
    const latencyMs = Date.now() - start;

    // El objetivo del test es probar cert + mTLS + alcance. Cualquier codigo
    // de respuesta de negocio devuelto sobre el canal mTLS ya prueba las tres
    // cosas: un cert rechazado fallaria en el handshake TLS (cae al catch), no
    // volveria con un dCodResLot. 0360 es el ping limpio; otros codigos
    // (0160, etc.) igual confirman conexion, solo los mostramos con detalle.
    const reachedSifen =
      Boolean(result.responseCode) &&
      result.responseCode !== 'PARSE_ERROR' &&
      result.responseCode !== 'UNKNOWN';
    const cleanPing = result.state === 'not_found' || result.responseCode === '0360';
    res.json({
      data: {
        ok: reachedSifen,
        stage: 'sifen',
        environment: env,
        latencyMs,
        responseCode: result.responseCode,
        responseMessage: result.responseMessage,
        message: cleanPing
          ? `SIFEN ${env} respondio OK en ${latencyMs} ms (cert + mTLS aceptados).`
          : reachedSifen
            ? `Conexion con SIFEN ${env} OK (cert + mTLS aceptados, ${latencyMs} ms). Respuesta de prueba: ${result.responseCode} ${result.responseMessage}.`
            : `SIFEN ${env} respondio con ${result.responseCode}: ${result.responseMessage}`,
      },
    });
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    const message: string = err?.message ?? 'Error desconocido';
    const isTimeout = /timeout/i.test(message);
    const isCertRejected = /unauthorized|certificate|tls|handshake/i.test(message);
    res.json({
      data: {
        ok: false,
        stage: isTimeout ? 'timeout' : isCertRejected ? 'tls' : 'unknown',
        latencyMs,
        message: isTimeout
          ? `SIFEN no respondio en ${latencyMs} ms. Intenta de nuevo en un minuto.`
          : isCertRejected
            ? 'SIFEN rechazo el certificado. Verifica que sea el .p12 emitido por una CA habilitada y que no este vencido.'
            : `Error de conexion: ${message.slice(0, 200)}`,
      },
    });
  }
});
