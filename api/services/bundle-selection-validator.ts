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
 *   2. the selected component variants (active + belonging to this store and to
 *      the bundle's parent product) only for lines that supplied selections.
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

    // A bundle is a color pack iff it has component rows. componentsByBundle maps
    // bundle_variant_id -> set of its allowed component variation ids.
    const { data: components } = await db
        .from('bundle_components')
        .select('bundle_variant_id, component_variant_id')
        .eq('store_id', storeId)
        .in('bundle_variant_id', Array.from(new Set(bundleVariantIds)));

    const componentsByBundle = new Map<string, Set<string>>();
    for (const row of components ?? []) {
        const set = componentsByBundle.get(row.bundle_variant_id) ?? new Set<string>();
        set.add(row.component_variant_id);
        componentsByBundle.set(row.bundle_variant_id, set);
    }

    // Active set of every component referenced by any color pack in this order,
    // so a selection cannot point at a deactivated color variation.
    const allComponentIds = Array.from(
        new Set([...componentsByBundle.values()].flatMap((set) => Array.from(set))),
    );
    const activeComponents = new Set<string>();
    if (allComponentIds.length > 0) {
        const { data: variations } = await db
            .from('product_variants')
            .select('id')
            .eq('store_id', storeId)
            .eq('is_active', true)
            .in('id', allComponentIds);
        for (const row of variations ?? []) activeComponents.add(row.id);
    }

    for (let i = 0; i < lineItems.length; i++) {
        const item = lineItems[i];
        const variant = item.variant_id ? variantsMap.get(item.variant_id) : undefined;
        if (!variant || !isBundleVariant(variant)) continue;

        const allowedComponents = componentsByBundle.get(variant.id);
        // No components => quantity-only pack. Selections are not required; the
        // handler stores null, preserving the Solenne path byte-for-byte.
        if (!allowedComponents || allowedComponents.size === 0) continue;

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
            if (!sel.variant_id || !allowedComponents.has(sel.variant_id) || !activeComponents.has(sel.variant_id)) {
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
