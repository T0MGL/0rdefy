/**
 * Fiscal Guards
 *
 * Small, composable assertions for the invoicing service.
 * Keeping these isolated prevents each service function from growing its
 * own inlined validation and lets the unit tests assert them in one place.
 *
 * Contract:
 *   - Each guard throws a human-readable Error (Spanish) when the invariant
 *     is violated. Callers should let the error bubble up; the route layer
 *     will sanitize it before returning to the client.
 *   - Guards are idempotent: calling them twice with the same arguments is
 *     safe.
 */

import type { FiscalContext } from '../services/invoicing.service';

/**
 * Validate Paraguay RUC check digit using Modulo 11.
 *
 * DNIT publishes this as the official algorithm for validating RUC+DV
 * pairs. We enforce it at the setup step so invalid RUCs never reach
 * xmlgen (which would reject them later with a less actionable error).
 */
export function validateRucDV(ruc: string, dv: number): boolean {
  if (!ruc || !/^\d+$/.test(ruc)) return false;
  if (!Number.isInteger(dv) || dv < 0 || dv > 9) return false;

  const baseMax = 11;
  let total = 0;
  let factor = 2;
  for (let i = ruc.length - 1; i >= 0; i--) {
    total += parseInt(ruc[i], 10) * factor;
    factor++;
    if (factor > baseMax) factor = 2;
  }
  const resto = total % 11;
  const expected = resto > 1 ? 11 - resto : 0;
  return expected === dv;
}

/**
 * Assert the fiscal context resolves to a SIFEN-capable country.
 *
 * Today we only support Paraguay. AR/BR/UY/etc. require different backends
 * (AFIP, SEFAZ, DGI). We surface a clear error instead of generating an
 * XML that SIFEN would reject.
 */
export function assertInvoicingCountry(ctx: FiscalContext): void {
  if (ctx.identity.country !== 'PY') {
    throw new Error(
      `Facturacion electronica solo disponible para Paraguay (pais actual: ${ctx.identity.country})`,
    );
  }
}

/**
 * Assert the identity has a usable SIFEN certificate when the environment
 * is test/prod. Demo mode explicitly does not require one.
 */
export function assertCertificateForEnvironment(ctx: FiscalContext): void {
  const env = ctx.identity.sifen_environment;
  if (env === 'demo') return;

  if (!ctx.identity.has_certificate) {
    throw new Error(
      `Certificado digital (.p12) requerido para ambiente ${env}. Subalo en Configuracion Fiscal > Identidad.`,
    );
  }
}

/**
 * Assert the identity has a principal economic activity registered.
 * SIFEN requires at least one actividad economica per emitter; without
 * it, xmlgen cannot build the gEmis block.
 */
export function assertIdentityHasPrincipalActivity(ctx: FiscalContext): void {
  const principal = ctx.activities.find((a) => a.is_principal);
  if (!principal) {
    throw new Error(
      'La identidad fiscal no tiene una actividad economica principal configurada.',
    );
  }
}

/**
 * Assert the identity has representante_legal data. SIFEN's gOpeDE / gEmis
 * block requires a natural person to sign as emitter representative.
 */
export function assertIdentityHasRepresentanteLegal(ctx: FiscalContext): void {
  const id = ctx.identity;
  if (
    !id.representante_legal_nombre ||
    !id.representante_legal_documento_tipo ||
    !id.representante_legal_documento_numero
  ) {
    throw new Error(
      'La identidad fiscal no tiene un representante legal completo (nombre, tipo y numero de documento).',
    );
  }
}

/**
 * Assert the store link carries a valid timbrado window for today.
 *
 * A timbrado can be out-of-range in two ways:
 *   - fecha_inicio in the future: not yet authorized, SIFEN will reject
 *   - fecha_fin in the past: expired, DNIT requires a new one
 */
export function assertTimbradoIsActive(ctx: FiscalContext): void {
  const link = ctx.link;
  const today = new Date().toISOString().split('T')[0];

  if (link.timbrado_fecha_inicio && link.timbrado_fecha_inicio > today) {
    throw new Error(
      `El timbrado ${link.timbrado} aun no esta vigente (inicia ${link.timbrado_fecha_inicio}).`,
    );
  }
  if (link.timbrado_fecha_fin && link.timbrado_fecha_fin < today) {
    throw new Error(
      `El timbrado ${link.timbrado} expiro el ${link.timbrado_fecha_fin}. Renuevelo en DNIT y actualice la tienda.`,
    );
  }
}

/**
 * Convenience: run every invariant needed before calling xmlgen.
 * Order matters (country first, cert last) so the error the merchant sees
 * is the earliest-possible fix.
 */
export function assertReadyToEmit(ctx: FiscalContext): void {
  assertInvoicingCountry(ctx);
  assertIdentityHasPrincipalActivity(ctx);
  assertIdentityHasRepresentanteLegal(ctx);
  assertTimbradoIsActive(ctx);
  assertCertificateForEnvironment(ctx);
}
