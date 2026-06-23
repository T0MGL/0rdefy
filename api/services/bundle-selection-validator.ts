// ================================================================
// BUNDLE SELECTION VALIDATOR
// ================================================================
// Authoritative gate for the manual order paths (POST /api/orders,
// PUT /api/orders/:id). A "color pack" bundle (NOCTE Pack Pareja/Oficina)
// is composed of selectable color variations: each pack slot carries a color
// the customer chooses, persisted in order_line_items.bundle_selections.
//
// The 2026-06 forensic on prod (store 1eeaf2c7, NOCTE) found the manual paths
// stored bundle_selections null on 96% of color-pack orders: both the form and
// the backend silently accepted a bundle line with missing/partial colors.
// This module is the single source of truth that rejects that case before the
// order is written, so a color pack can never persist without its composition.
//
// The load-bearing distinction (color pack vs quantity-only pack): a bundle
// REQUIRES selections if and only if it has rows in bundle_components (its
// makeup of color variations). Quantity-only packs (Solenne) have no
// bundle_components and keep null, exactly as before. This mirrors the
// definition migration 181 itself uses for composed vs parent-pool inventory.
//
// What a selection may point at is NOT the single bundle_components default
// row (each NOCTE color-pack variant carries exactly one, its own default
// color). Mixed-color packs are a real, supported case (prod orders
// ORD-20260621-ee620f Rojo+Naranja, ORD-20260622-7f3630 Rojo+Naranja+Amarillo).
// A slot can take ANY active sibling color variation of the bundle's PARENT
// product. So bundle_components presence is only the "is this a color pack"
// gate; the allowed color set is the parent product's active variations.
// ================================================================

import { supabaseAdmin } from '../db/connection';

export interface BundleValidationLineItem {
    variant_id?: string | null;
    quantity?: number | unknown;
    bundle_selections?: Array<{ variant_id?: string; quantity?: number | unknown }> | null;
}

// Subset of product_variants already batch-fetched by the order handlers.
export interface ResolvedVariant {
    id: string;
    product_id: string;
    units_per_pack: number | null;
    variant_type: string | null;
    uses_shared_stock: boolean | null;
}

export type BundleValidationResult =
    | { ok: true }
    | { ok: false; lineIndex: number; code: string; message: string };

const isBundleVariant = (v: ResolvedVariant): boolean =>
    v.variant_type === 'bundle' || v.uses_shared_stock === true;

const toPositiveInt = (value: unknown): number | null => {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(n) || n <= 0) return null;
    return n;
};

/**
 * Validates that every color-pack bundle line carries a complete composition.
 * Quantity-only packs, single products, and non-bundle lines pass untouched.
 *
 * Two DB reads, both batched to avoid N+1:
 *   1. bundle_components for the candidate bundle variants (presence => color pack).
 *   2. the active sibling variations of every color pack's parent product, the
 *      universe a slot may be composed from. A selection is valid iff it is an
 *      active variation of its own bundle's parent.
 */
export async function validateBundleSelections(
    storeId: string,
    lineItems: BundleValidationLineItem[],
    variantsMap: Map<string, ResolvedVariant>,
    db: typeof supabaseAdmin = supabaseAdmin,
): Promise<BundleValidationResult> {
    const bundleVariantIds = lineItems
        .map((item) => (item.variant_id ? variantsMap.get(item.variant_id) : undefined))
        .filter((v): v is ResolvedVariant => !!v && isBundleVariant(v))
        .map((v) => v.id);

    if (bundleVariantIds.length === 0) return { ok: true };

    // A bundle is a color pack iff it has at least one component row. We only
    // need the boolean here, not the rows: bundle_components carries each pack's
    // single default color, which is NOT the universe a slot may pick from.
    const { data: components } = await db
        .from('bundle_components')
        .select('bundle_variant_id')
        .eq('store_id', storeId)
        .in('bundle_variant_id', Array.from(new Set(bundleVariantIds)));

    const colorPackVariantIds = new Set<string>();
    for (const row of components ?? []) colorPackVariantIds.add(row.bundle_variant_id);

    // The allowed color set for a slot is its bundle's PARENT product active
    // variations (any color, mixed packs allowed), not the bundle_components
    // default. Resolve the parent product_id of every color pack in this order
    // and batch-fetch their active variations in one query (no N+1).
    const parentProductIds = new Set<string>();
    for (const id of colorPackVariantIds) {
        const v = variantsMap.get(id);
        if (v) parentProductIds.add(v.product_id);
    }

    // product_id -> set of its active variation ids (the colors a slot can be).
    const activeVariationsByParent = new Map<string, Set<string>>();
    if (parentProductIds.size > 0) {
        const { data: variations } = await db
            .from('product_variants')
            .select('id, product_id')
            .eq('store_id', storeId)
            .eq('is_active', true)
            .in('product_id', Array.from(parentProductIds))
            .or('variant_type.eq.variation,and(uses_shared_stock.eq.false,variant_type.is.null)');
        for (const row of variations ?? []) {
            const set = activeVariationsByParent.get(row.product_id) ?? new Set<string>();
            set.add(row.id);
            activeVariationsByParent.set(row.product_id, set);
        }
    }

    for (let i = 0; i < lineItems.length; i++) {
        const item = lineItems[i];
        const variant = item.variant_id ? variantsMap.get(item.variant_id) : undefined;
        if (!variant || !isBundleVariant(variant)) continue;

        // No component rows => quantity-only pack. Selections are not required;
        // the handler stores null, preserving the Solenne path byte-for-byte.
        if (!colorPackVariantIds.has(variant.id)) continue;

        const allowedColors = activeVariationsByParent.get(variant.product_id) ?? new Set<string>();

        const lineQty = toPositiveInt(item.quantity);
        if (lineQty === null) {
            return { ok: false, lineIndex: i, code: 'INVALID_BUNDLE_QUANTITY', message: `Línea ${i + 1}: cantidad del pack inválida.` };
        }
        const unitsPerPack = variant.units_per_pack && variant.units_per_pack > 0 ? variant.units_per_pack : 1;
        const requiredUnits = lineQty * unitsPerPack;

        const selections = Array.isArray(item.bundle_selections) ? item.bundle_selections : [];
        if (selections.length === 0) {
            return {
                ok: false,
                lineIndex: i,
                code: 'BUNDLE_SELECTIONS_REQUIRED',
                message: `Línea ${i + 1}: este pack requiere elegir el color de las ${requiredUnits} unidades. No se recibió ninguna selección.`,
            };
        }

        let selectedUnits = 0;
        for (const sel of selections) {
            if (!sel.variant_id || !allowedColors.has(sel.variant_id)) {
                return {
                    ok: false,
                    lineIndex: i,
                    code: 'BUNDLE_SELECTION_NOT_A_COMPONENT',
                    message: `Línea ${i + 1}: una de las variaciones elegidas no pertenece a este pack o ya no está activa.`,
                };
            }
            const selQty = toPositiveInt(sel.quantity);
            if (selQty === null) {
                return { ok: false, lineIndex: i, code: 'INVALID_BUNDLE_SELECTION', message: `Línea ${i + 1}: la cantidad de una variación es inválida.` };
            }
            selectedUnits += selQty;
        }

        if (selectedUnits !== requiredUnits) {
            return {
                ok: false,
                lineIndex: i,
                code: 'BUNDLE_SELECTIONS_INCOMPLETE',
                message: `Línea ${i + 1}: faltan colores. El pack necesita ${requiredUnits} unidades y se eligieron ${selectedUnits}.`,
            };
        }
    }

    return { ok: true };
}
