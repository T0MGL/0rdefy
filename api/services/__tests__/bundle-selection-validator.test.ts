/**
 * Unit tests for validateBundleSelections, the authoritative gate that the
 * manual order paths (POST /api/orders, PUT /api/orders/:id) run before writing
 * order_line_items. Proves the 2026-06 NOCTE color-pack regression cannot recur:
 *   (a) a color pack with missing/partial selections is rejected,
 *   (b) a color pack with a complete composition passes,
 *   (c) single products and quantity-only packs pass with no selections.
 *
 * Run with:
 *   npx tsx --test api/services/__tests__/bundle-selection-validator.test.ts
 *
 * The validator takes an injectable db, so we stub bundle_components and
 * product_variants without a live database. component lookups key off the
 * bundle_variant_id passed to .in(); the active-variation lookup returns every
 * stubbed component id as active unless a test overrides it.
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

type ComponentRow = { bundle_variant_id: string; component_variant_id: string };

interface DbFixture {
    components: ComponentRow[];
    inactiveVariationIds?: Set<string>;
}

// Minimal supabase-js query-builder stub. Records the table and the .in() set,
// resolves to the rows the fixture defines for each table.
function makeDb(fixture: DbFixture): any {
    return {
        from(table: string) {
            const state: { table: string; inValues: string[] } = { table, inValues: [] };
            const builder: any = {
                select() { return this; },
                eq() { return this; },
                in(_col: string, values: string[]) { state.inValues = values; return this; },
                then(resolve: (v: any) => any) {
                    if (state.table === 'bundle_components') {
                        const rows = fixture.components.filter(c => state.inValues.includes(c.bundle_variant_id));
                        return Promise.resolve({ data: rows, error: null }).then(resolve);
                    }
                    if (state.table === 'product_variants') {
                        const inactive = fixture.inactiveVariationIds ?? new Set<string>();
                        const rows = state.inValues
                            .filter(id => !inactive.has(id))
                            .map(id => ({ id }));
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
        product_id: 'p-nocte',
        units_per_pack: 2,
        variant_type: 'bundle',
        uses_shared_stock: true,
        ...over,
    };
}

const PACK_PAREJA = 'bundle-pareja';
const COLOR_BLACK = 'var-black';
const COLOR_TORTOISE = 'var-tortoise';

// A color pack: Pack Pareja (2 units) composed of black + tortoise variations.
const colorPackFixture: DbFixture = {
    components: [
        { bundle_variant_id: PACK_PAREJA, component_variant_id: COLOR_BLACK },
        { bundle_variant_id: PACK_PAREJA, component_variant_id: COLOR_TORTOISE },
    ],
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
            { variant_id: PACK_PAREJA, quantity: 1, bundle_selections: [{ variant_id: COLOR_BLACK, quantity: 1 }] },
        ];
        const map = new Map([[PACK_PAREJA, variant({ id: PACK_PAREJA })]]);

        const result = await validateBundleSelections(STORE, items, map, makeDb(colorPackFixture));

        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.code, 'BUNDLE_SELECTIONS_INCOMPLETE');
    });

    it('rejects a selection that is not a component of the pack', async () => {
        const items: BundleValidationLineItem[] = [
            { variant_id: PACK_PAREJA, quantity: 1, bundle_selections: [
                { variant_id: COLOR_BLACK, quantity: 1 },
                { variant_id: 'var-not-in-pack', quantity: 1 },
            ] },
        ];
        const map = new Map([[PACK_PAREJA, variant({ id: PACK_PAREJA })]]);

        const result = await validateBundleSelections(STORE, items, map, makeDb(colorPackFixture));

        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.code, 'BUNDLE_SELECTION_NOT_A_COMPONENT');
    });

    it('rejects a selection pointing at a deactivated component', async () => {
        const items: BundleValidationLineItem[] = [
            { variant_id: PACK_PAREJA, quantity: 1, bundle_selections: [
                { variant_id: COLOR_BLACK, quantity: 1 },
                { variant_id: COLOR_TORTOISE, quantity: 1 },
            ] },
        ];
        const map = new Map([[PACK_PAREJA, variant({ id: PACK_PAREJA })]]);
        const db = makeDb({ ...colorPackFixture, inactiveVariationIds: new Set([COLOR_TORTOISE]) });

        const result = await validateBundleSelections(STORE, items, map, db);

        assert.equal(result.ok, false);
        if (result.ok) return;
        assert.equal(result.code, 'BUNDLE_SELECTION_NOT_A_COMPONENT');
    });

    it('accepts a color pack with a complete composition', async () => {
        const items: BundleValidationLineItem[] = [
            { variant_id: PACK_PAREJA, quantity: 1, bundle_selections: [
                { variant_id: COLOR_BLACK, quantity: 1 },
                { variant_id: COLOR_TORTOISE, quantity: 1 },
            ] },
        ];
        const map = new Map([[PACK_PAREJA, variant({ id: PACK_PAREJA })]]);

        const result = await validateBundleSelections(STORE, items, map, makeDb(colorPackFixture));

        assert.equal(result.ok, true);
    });

    it('accepts multiple color packs (quantity 2 => 4 required units)', async () => {
        const items: BundleValidationLineItem[] = [
            { variant_id: PACK_PAREJA, quantity: 2, bundle_selections: [
                { variant_id: COLOR_BLACK, quantity: 3 },
                { variant_id: COLOR_TORTOISE, quantity: 1 },
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
        const map = new Map([[QTY_PACK, variant({ id: QTY_PACK })]]);
        // No bundle_components rows => quantity-only pack.
        const result = await validateBundleSelections(STORE, items, map, makeDb({ components: [] }));

        assert.equal(result.ok, true);
    });

    it('passes a single product (non-bundle variant) untouched', async () => {
        const items: BundleValidationLineItem[] = [
            { variant_id: 'var-single', quantity: 1, bundle_selections: null },
        ];
        const map = new Map([['var-single', variant({ id: 'var-single', variant_type: 'variation', uses_shared_stock: false })]]);

        const result = await validateBundleSelections(STORE, items, map, makeDb({ components: [] }));

        assert.equal(result.ok, true);
    });

    it('passes a line item with no variant_id (free-text product)', async () => {
        const items: BundleValidationLineItem[] = [
            { variant_id: null, quantity: 1, bundle_selections: null },
        ];
        const result = await validateBundleSelections(STORE, items, new Map(), makeDb({ components: [] }));

        assert.equal(result.ok, true);
    });
});
