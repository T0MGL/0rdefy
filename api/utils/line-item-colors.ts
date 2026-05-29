/**
 * Line Item Color Resolver
 *
 * Single source of truth for turning a bundle line item's `bundle_selections`
 * (JSONB, resolved to real variant_ids by the preflight, migration 181) into an
 * operator facing color breakdown. Reused by every order returning endpoint so
 * the Orders table, quick view, confirmation dialog, edit view, warehouse and
 * the shipping label all speak the same language.
 *
 * The resolution rule mirrors warehouse.service.ts getPackingList exactly:
 *   color = product_variants.option1_value (when option1_name = 'Color')
 *         || bundle_selection.variant_name
 *         || product_variants.variant_title
 *
 * Degradation:
 *   - Line items without bundle_selections (simple products, Solenne shared
 *     stock bundles without color selections) get NO color_breakdown and render
 *     exactly as before.
 *   - A selection that does not resolve to a color falls back to its variant
 *     name; if that is also missing it is skipped, never throwing.
 */

import { supabaseAdmin } from '../db/connection';
import { logger } from './logger';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VARIANT_IN_BATCH_SIZE = 100;

export interface ColorBreakdownEntry {
  color: string;
  quantity: number;
}

interface BundleSelectionLike {
  variant_id?: string | null;
  variant_name?: string | null;
  quantity?: number | string | null;
}

interface LineItemLike {
  quantity?: number | string | null;
  units_per_pack?: number | string | null;
  variant_id?: string | null;
  bundle_selections?: BundleSelectionLike[] | null;
  [key: string]: unknown;
}

interface VariantColorInfo {
  color: string | null;
  variant_title: string | null;
}

/**
 * Collect every variant_id referenced by a set of line items, including the
 * variant_ids nested inside bundle_selections.
 */
function collectVariantIds(lineItems: LineItemLike[]): string[] {
  const ids = new Set<string>();
  for (const li of lineItems) {
    if (li.variant_id && UUID_REGEX.test(li.variant_id)) {
      ids.add(li.variant_id);
    }
    if (Array.isArray(li.bundle_selections)) {
      for (const sel of li.bundle_selections) {
        if (sel?.variant_id && UUID_REGEX.test(sel.variant_id)) {
          ids.add(sel.variant_id);
        }
      }
    }
  }
  return Array.from(ids);
}

/**
 * Fetch color + title for a set of variant ids. Batched to stay under the
 * PostgREST URL length limit. Never throws on a query error; on failure it
 * returns an empty map so callers degrade to variant_name fallbacks.
 */
async function fetchVariantColorMap(
  variantIds: string[]
): Promise<Map<string, VariantColorInfo>> {
  const map = new Map<string, VariantColorInfo>();
  if (variantIds.length === 0) return map;

  try {
    for (let i = 0; i < variantIds.length; i += VARIANT_IN_BATCH_SIZE) {
      const batch = variantIds.slice(i, i + VARIANT_IN_BATCH_SIZE);
      const { data, error } = await supabaseAdmin
        .from('product_variants')
        .select('id, option1_name, option1_value, variant_title')
        .in('id', batch);

      if (error) {
        logger.error('LINE_ITEM_COLORS', 'variant color fetch failed', error);
        continue;
      }

      for (const v of data || []) {
        const isColor =
          typeof v.option1_name === 'string' &&
          v.option1_name.toLowerCase() === 'color';
        map.set(v.id, {
          color: isColor ? v.option1_value || null : null,
          variant_title: v.variant_title || null,
        });
      }
    }
  } catch (err) {
    logger.error('LINE_ITEM_COLORS', 'variant color fetch threw', err);
  }

  return map;
}

/**
 * Compute the per-color physical unit breakdown for a single line item.
 * Returns undefined when the line item has no resolvable color makeup so the
 * caller can omit the field entirely (clean degradation).
 */
function computeColorBreakdown(
  lineItem: LineItemLike,
  variantColorMap: Map<string, VariantColorInfo>
): ColorBreakdownEntry[] | undefined {
  const lineQty = Number(lineItem.quantity) || 0;
  const selections = Array.isArray(lineItem.bundle_selections)
    ? lineItem.bundle_selections
    : [];

  const counts = new Map<string, number>();

  if (selections.length > 0) {
    // Composed bundle: each selection scaled by the line item pack quantity.
    for (const sel of selections) {
      const info = sel?.variant_id
        ? variantColorMap.get(sel.variant_id)
        : undefined;
      const color =
        info?.color || sel?.variant_name || info?.variant_title || null;
      const selQty = (Number(sel?.quantity) || 0) * (lineQty || 1);
      if (color && selQty > 0) {
        counts.set(color, (counts.get(color) || 0) + selQty);
      }
    }
  } else if (lineItem.variant_id) {
    // Mono color variation or bundle: the variant's own color x physical units.
    const info = variantColorMap.get(lineItem.variant_id);
    const unitsPerPack = Number(lineItem.units_per_pack) > 0
      ? Number(lineItem.units_per_pack)
      : 1;
    if (info?.color && lineQty > 0) {
      counts.set(info.color, lineQty * unitsPerPack);
    }
  }

  const breakdown = Array.from(counts.entries())
    .filter(([, qty]) => qty > 0)
    .map(([color, quantity]) => ({ color, quantity }));

  return breakdown.length > 0 ? breakdown : undefined;
}

/**
 * Enrich a list of line items in place with `color_breakdown` resolved from
 * bundle_selections. Line items without a resolvable makeup are returned
 * untouched. Safe to call on any tenant's data; never throws.
 *
 * Returns the same array reference (each item shallow cloned with the new
 * field) so callers can use the result directly in their response shape.
 */
export async function enrichLineItemsWithColors<T extends LineItemLike>(
  lineItems: T[] | null | undefined
): Promise<(T & { color_breakdown?: ColorBreakdownEntry[] })[]> {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return (lineItems as T[]) || [];
  }

  const variantIds = collectVariantIds(lineItems);
  const variantColorMap = await fetchVariantColorMap(variantIds);

  return lineItems.map((li) => {
    const color_breakdown = computeColorBreakdown(li, variantColorMap);
    if (!color_breakdown) return li;
    return { ...li, color_breakdown };
  });
}
