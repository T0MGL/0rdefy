/**
 * SKU resolution helpers for external order ingestion.
 *
 * Context (2026-05-16 reconciliation):
 *   Three Solenne orders were ingested with bare parent SKU `SOLENNE-TAPE`
 *   when the warehouse SKU is `SOLENNE-TAPE-100`. Because the parent product
 *   row also carries the bare SKU, the webhook silently mapped to the parent
 *   and proceeded with variant_id=NULL. Downstream, units_per_pack defaulted
 *   to 1 even when the buyer paid for a multi-pack, which is how the PDRN
 *   ghost-bottle drift started.
 *
 *   We cannot fix that purely with a NOT NULL on variant_id because legacy
 *   line items still have NULL there, and some products genuinely sell only
 *   at the parent level (services, single-SKU products). The structural fix
 *   is at ingestion time: when a product has any active variant, the parent
 *   SKU must NOT be accepted as the resolved entity. The caller has to use
 *   one of the variant SKUs explicitly. Single-variant products and pure
 *   parent-only products are unaffected.
 *
 * This module is intentionally pure (no Supabase, no logger) so it can be
 * unit tested without booting the API.
 */

export type SkuMatchEntity = 'variant' | 'product';

export interface SkuMatch {
  entity_type: SkuMatchEntity;
  product_id: string;
  variant_id: string | null;
  product_name: string;
  variant_title: string | null;
  sku: string;
}

export interface VariantSummary {
  id: string;
  sku: string | null;
  variant_title: string | null;
  is_active: boolean;
}

export type SkuResolutionResult =
  | { ok: true; entity_type: SkuMatchEntity; product_id: string; variant_id: string | null }
  | {
      ok: false;
      code:
        | 'SKU_NOT_FOUND'
        | 'AMBIGUOUS_PARENT_SKU'
        | 'INVALID_SKU';
      message: string;
      suggested_skus?: string[];
    };

/**
 * Normalize a SKU for comparison. Mirrors the DB function:
 *   UPPER(TRIM(sku))
 * Returns null for blank/invalid input.
 */
export function normalizeSku(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

/**
 * Decide whether an inbound SKU lookup is acceptable.
 *
 * Rules:
 *   - SKU resolved to a variant -> accept (the unambiguous happy path).
 *   - SKU resolved to a product with NO active variants -> accept (parent-only
 *     product, e.g. services or single-SKU items).
 *   - SKU resolved to a product that DOES have active variants -> reject with
 *     AMBIGUOUS_PARENT_SKU and return the list of variant SKUs the caller
 *     should use instead. This is the bare-parent bug.
 *   - SKU did not resolve at all -> reject with SKU_NOT_FOUND.
 */
export function resolveSkuMatch(
  rawSku: unknown,
  match: SkuMatch | null,
  variantsForProduct: VariantSummary[],
): SkuResolutionResult {
  const normalized = normalizeSku(rawSku);
  if (!normalized) {
    return {
      ok: false,
      code: 'INVALID_SKU',
      message: 'sku must be a non-empty string',
    };
  }

  if (!match) {
    return {
      ok: false,
      code: 'SKU_NOT_FOUND',
      message: `SKU "${normalized}" not found for this store`,
    };
  }

  if (match.entity_type === 'variant') {
    return {
      ok: true,
      entity_type: 'variant',
      product_id: match.product_id,
      variant_id: match.variant_id,
    };
  }

  // entity_type === 'product'. The parent SKU is only acceptable when the
  // product has no active variants. Otherwise it is ambiguous and the caller
  // must pick a variant SKU.
  const activeVariants = variantsForProduct.filter((v) => v.is_active);
  if (activeVariants.length === 0) {
    return {
      ok: true,
      entity_type: 'product',
      product_id: match.product_id,
      variant_id: null,
    };
  }

  const suggested = activeVariants
    .map((v) => v.sku)
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '');

  return {
    ok: false,
    code: 'AMBIGUOUS_PARENT_SKU',
    message:
      `SKU "${normalized}" matches parent product "${match.product_name}" but the product has ` +
      `${activeVariants.length} active variant(s). Send the variant SKU instead.`,
    suggested_skus: suggested,
  };
}
