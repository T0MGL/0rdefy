/**
 * Punto a Punto wire schemas (ASP.NET Boilerplate backend).
 *
 * Grounded against the live swagger at
 * https://rastreo.puntoapunto.com.py/trackerservices/swagger/v1/swagger.json
 * verified 2026-06-06. Do not add fields that are not in the spec.
 */

import { z } from 'zod';

export const PROVIDER_KEY = 'punto_a_punto' as const;
export const PROVIDER_DISPLAY_NAME = 'Punto a Punto' as const;

export const AuthResponseSchema = z.object({
  result: z.object({
    accessToken: z.string().min(1),
    encryptedAccessToken: z.string().optional(),
    expireInSeconds: z.number().optional(),
    userId: z.number().optional(),
  }),
});

export const ComboboxItemsSchema = z.object({
  result: z.object({
    items: z.array(
      z.object({
        value: z.union([z.number(), z.string()]),
        displayText: z.string(),
        isSelected: z.boolean().optional(),
      }),
    ),
  }),
});

/**
 * CreatePaqueteV2 flat request. importe is the COD amount (number); everything
 * else is a nullable string. formaPago is intentionally absent: V2 does not
 * expose it, COD vs not is conveyed by importe (> 0 = cobrar contra entrega).
 */
export const CreatePaqueteV2RequestSchema = z.object({
  nroGuia1: z.string(),
  nombre: z.string(),
  tipoPaquete: z.string(),
  descripcion: z.string().nullable(),
  referencia: z.string(),
  tipoEntrega: z.string(),
  prioridadEntrega: z.string(),
  direccion: z.string().nullable(),
  vencimiento: z.string().nullable(),
  telefono: z.string().nullable(),
  nroDoc: z.string().nullable(),
  importe: z.number(),
  dpto: z.string().nullable(),
  ciudad: z.string().nullable(),
});

export type CreatePaqueteV2Request = z.infer<typeof CreatePaqueteV2RequestSchema>;

export const CreatePaqueteV2ResponseSchema = z.object({
  result: z.object({
    nroGuia: z.string(),
    id: z.number(),
  }),
});

/**
 * GetPaqueteInfoByReferencia. The endpoint returns the package when one exists
 * for the reference; shape is permissive because the swagger types it loosely.
 * A null/absent result means no package, which is what the idempotency guard
 * cares about.
 */
export const PaqueteInfoByReferenciaSchema = z.object({
  result: z
    .object({
      id: z.number().nullable().optional(),
      nroGuia: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

/**
 * ABP error envelope. error.code is an app-level numeric code; details/message
 * carry the human text. We surface message in validation/push errors.
 */
export const AbpErrorSchema = z.object({
  error: z.object({
    code: z.number().optional(),
    message: z.string().optional(),
    details: z.string().nullable().optional(),
  }),
});

export const PAQUETE_DEFAULTS = {
  tipoPaquete: 'Paquete',
  tipoEntrega: 'Cliente final',
  prioridadEntrega: 'Normal',
} as const;
