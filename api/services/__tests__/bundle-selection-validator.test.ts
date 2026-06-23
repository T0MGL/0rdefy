/**
 * Unit tests for validateBundleSelections, the authoritative gate that the
 * manual order paths (POST /api/orders, PUT /api/orders/:id) run before writing
 * order_line_items. Proves the 2026-06 NOCTE color-pack regression cannot recur:
 *   (a) a color pack with missing/partial selections is rejected,
 *   (b) a color pack with a complete composition (including MIXED colors) passes,
 *   (c) single products and quantity-only packs pass with no selections.
 *
 * Run with:
 *   npx tsx --test api/services/__tests__/bundle-selection-validator.test.ts
 *
 * The validator takes an injectable db, so we stub bundle_components and
 * product_variants without a live database. A color pack is gated by having
 * >=1 bundle_components row; the colors a slot may take come from the parent
 * product's ACTIVE variations, which the fixture models per product_id.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'http://localhost';
process.env.SUPABASE_ANON_KEY ??= 'test-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service';

const { validateBundleSelections } = await import('../bundle-selection-validator');
type ResolvedVariant = import('../bundle-selection-validator').ResolvedVariant;
type BundleValidationLineItem = import('../bundle-selection-validator').BundleValidationLineItem;

const STORE = '1eeaf2c7-2cd2-4257-8213-d90b1280a19d'; // NOCTE store

type ComponentRow = { bundle_variant_id: string };

interface DbFixture {
    // bundle_variant_ids that have >=1 bundle_components row (i.e. are color packs).
    colorPackBundleIds: string[];
    // product_id -> ids of its ACTIVE sibling color variations (the slot universe).
    activeVariationsByParent: Record<string, string[]>;
}

// Minimal supabase-js query-builder stub. Records the table and the .in() set,
// resolves to the rows the fixture defines for each table. .or() is a no-op:
// the parent-product variation universe is already pre-filtered in the fixture.
function makeDb(fixture: DbFixture): any {
    return {
        from(table: string) {
            const state: { table: string; inCol: string; inValues: string[] } = { table, inCol: '', inValues: [] };
            const builder: any = {
                select() { return this; },
                eq() { return this; },
                or() { return this; },
                in(col: string, values: string[]) { state.inCol = col; state.inValues = values; return this; },
                then(resolve: (v: any) => any) {
                    if (state.table === 'bundle_components') {
                        const rows: ComponentRow[] = fixture.colorPackBundleIds
                            .filter(id => state.inValues.includes(id))
                            .map(id => ({ bundle_variant_id: id }));
                        return Promise.resolve({ data: rows, error: null }).then(resolve);
                    }
                    if (state.table === 'product_variants') {
                        const rows = state.inValues.flatMap(pid =>
                            (fixture.activeVariationsByParent[pid] ?? []).map(id => ({ id, product_id: pid })),
                        );
                        return Promise.resolve({ data: rows, error: null }).then(resolve);
                    }
                    return Promise.resolve({ data: [], error: null }).then(resolve);
                },
            };
            return builder;
        },
    };
}

function variant(over: Partial<ResolvedVariant> & { id: string }): ResolvedVariant {
    return {
        product_id: PARENT_NOCTE,
        units_per_pack: 2,
        variant_type: 'bundle',
        uses_shared_stock: true,
        ...over,
    };
}

const PARENT_NOCTE = 'p-nocte';
const PACK_PAREJA = 'bundle-pareja';
const PACK_OFICINA = 'bundle-oficina';
const ROJO = 'var-rojo';
const NARANJA = 'var-naranja';
const AMARILLO = 'var-amarillo';

// NOCTE parent product with three active colors. Each pack's bundle_components
// only carries its own default (Rojo), but a slot may take any of the three.
const colorPackFixture: DbFixture = {
    colorPackBundleIds: [PACK_PAREJA, PACK_OFICINA],
    activeVariationsByParent: { [PARENT_NOCTE]: [ROJO, NARANJA, AMARILLO] },
};

describe('validateBundleSelections', () => {
    it('rejects a color pack submitted with NO selections', async () => {
        const items: BundleValidationLineItem[] = [
            { variant_id: PACK_PAREJA, quantity: 1, bundle_selections: null },
        ];
        const map = new Map([[PACK_PAREJA, variant({ id: PACK_PAREJA })]]);

        const result = await validateBundleSelections(STORE, items, map, makeDb(colorPackFixture));

        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.code, 'BUNDLE_SELECTIONS_REQUIRED');
        assert.equal(result.lineIndex, 0);
    });

    it('rejects a color pack with a partial composition (1 of 2 units)', async () => {
        const items: BundleValidationLineItem[] = [
            { variant_id: PACK_PAREJA, quantity: 1, bundle_selections: [{ variant_id: ROJO, quantity: 1 }] },
        ];
        const map = new Map([[PACK_PAREJA, variant({ id: PACK_PAREJA })]]);

        const result = await validateBundleSelections(STORE, items, map, makeDb(colorPackFixture));

        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.code, 'BUNDLE_SELECTIONS_INCOMPLETE');
    });

    it('accepts a MIXED-color Pareja pack (Rojo + Naranja) though its default component is only Rojo', async () => {
        const items: BundleValidationLineItem[] = [
            { variant_id: PACK_PAREJA, quantity: 1, bundle_selections: [
                { variant_id: ROJO, quantity: 1 },
                { variant_id: NARANJA, quantity: 1 },
            ] },
        ];
        const map = new Map([[PACK_PAREJA, variant({ id: PACK_PAREJA })]]);

        const result = await validateBundleSelections(STORE, items, map, makeDb(colorPackFixture));

        assert.equal(result.ok, true);
    });

    it('accepts a 3-slot Oficina pack with Rojo + Naranja + Amarillo', async () => {
        const items: BundleValidationLineItem[] = [
            { variant_id: PACK_OFICINA, quantity: 1, bundle_selections: [
                { variant_id: ROJO, quantity: 1 },
                { variant_id: NARANJA, quantity: 1 },
                { variant_id: AMARILLO, quantity: 1 },
            ] },
        ];
        const map = new Map([[PACK_OFICINA, variant({ id: PACK_OFICINA, units_per_pack: 3 })]]);

        const result = await validateBundleSelections(STORE, items, map, makeDb(colorPackFixture));

        assert.equal(result.ok, true);
    });

    it('rejects a selection that is not an active variation of the parent product', async () => {
        const items: BundleValidationLineItem[] = [
            { variant_id: PACK_PAREJA, quantity: 1, bundle_selections: [
                { variant_id: ROJO, quantity: 1 },
                { variant_id: 'var-from-another-product', quantity: 1 },
            ] },
        ];
        const map = new Map([[PACK_PAREJA, variant({ id: PACK_PAREJA })]]);

        const result = await validateBundleSelections(STORE, items, map, makeDb(colorPackFixture));

        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.code, 'BUNDLE_SELECTION_NOT_A_COMPONENT');
    });

    it('rejects a selection pointing at a deactivated color (not in the active set)', async () => {
        // Amarillo is deactivated: it drops out of the parent's active variations.
        const fixture: DbFixture = {
            colorPackBundleIds: [PACK_PAREJA],
            activeVariationsByParent: { [PARENT_NOCTE]: [ROJO, NARANJA] },
        };
        const items: BundleValidationLineItem[] = [
            { variant_id: PACK_PAREJA, quantity: 1, bundle_selections: [
                { variant_id: ROJO, quantity: 1 },
                { variant_id: AMARILLO, quantity: 1 },
            ] },
        ];
        const map = new Map([[PACK_PAREJA, variant({ id: PACK_PAREJA })]]);

        const result = await validateBundleSelections(STORE, items, map, makeDb(fixture));

        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.code, 'BUNDLE_SELECTION_NOT_A_COMPONENT');
    });

    it('accepts a quantity 2 Pareja => 4 required units composed of mixed colors', async () => {
        const items: BundleValidationLineItem[] = [
            { variant_id: PACK_PAREJA, quantity: 2, bundle_selections: [
                { variant_id: ROJO, quantity: 3 },
                { variant_id: NARANJA, quantity: 1 },
            ] },
        ];
        const map = new Map([[PACK_PAREJA, variant({ id: PACK_PAREJA })]]);

        const result = await validateBundleSelections(STORE, items, map, makeDb(colorPackFixture));

        assert.equal(result.ok, true);
    });

    it('passes a quantity-only pack (bundle with NO components) with null selections', async () => {
        const QTY_PACK = 'bundle-solenne-duo';
        const items: BundleValidationLineItem[] = [
            { variant_id: QTY_PACK, quantity: 1, bundle_selections: null },
        ];
        const map = new Map([[QTY_PACK, variant({ id: QTY_PACK, product_id: 'p-solenne' })]]);
        // No bundle_components rows => quantity-only pack.
        const result = await validateBundleSelections(
            STORE,
            items,
            map,
            makeDb({ colorPackBundleIds: [], activeVariationsByParent: {} }),
        );

        assert.equal(result.ok, true);
    });

    it('passes a single product (non-bundle variant) untouched', async () => {
        const items: BundleValidationLineItem[] = [
            { variant_id: 'var-single', quantity: 1, bundle_selections: null },
        ];
        const map = new Map([['var-single', variant({ id: 'var-single', variant_type: 'variation', uses_shared_stock: false })]]);

        const result = await validateBundleSelections(
            STORE,
            items,
            map,
            makeDb({ colorPackBundleIds: [], activeVariationsByParent: {} }),
        );

        assert.equal(result.ok, true);
    });

    it('passes a line item with no variant_id (free-text product)', async () => {
        const items: BundleValidationLineItem[] = [
            { variant_id: null, quantity: 1, bundle_selections: null },
        ];
        const result = await validateBundleSelections(
            STORE,
            items,
            new Map(),
            makeDb({ colorPackBundleIds: [], activeVariationsByParent: {} }),
        );

        assert.equal(result.ok, true);
    });
});
