/**
 * Line Item Color Formatting (frontend)
 *
 * Operator facing presentation of the per color makeup of a bundle line item.
 * Consumes the `color_breakdown` field the API resolves server side from
 * bundle_selections (migration 181), so the Orders table, quick view,
 * confirmation dialog, edit form, warehouse and the shipping label all read the
 * same numbers and use the same Spanish wording.
 *
 * Wording matches ShippingLabelTemplate exactly:
 *   - 1 color:        "Pack Oficina (Rojo)"
 *   - multi color:    "Pack Oficina: 1 Rojo, 1 Naranja, 1 Amarillo"
 *   - no color makeup: name returned unchanged (simple product, color-less bundle)
 */

export interface ColorBreakdownEntry {
  color: string;
  quantity: number;
}

interface ColorBearingLineItem {
  color_breakdown?: ColorBreakdownEntry[] | null;
}

/**
 * Filter a color_breakdown down to the entries that are safe to render.
 * Returns an empty array when there is nothing meaningful to show.
 */
export function getRenderableColors(
  item: ColorBearingLineItem | null | undefined
): ColorBreakdownEntry[] {
  if (!item || !Array.isArray(item.color_breakdown)) return [];
  return item.color_breakdown.filter(
    (c) => c && typeof c.color === 'string' && c.color.length > 0 && c.quantity > 0
  );
}

/**
 * Build the operator facing color suffix/segment for a product name.
 * Returns the colors fragment without the base name so callers can compose it
 * however their layout needs (inline, badge, list).
 *
 *   1 color   -> "(Rojo)"
 *   multi     -> "1 Rojo, 1 Naranja, 1 Amarillo"
 *   none      -> ""
 */
export function formatColorFragment(
  item: ColorBearingLineItem | null | undefined
): string {
  const colors = getRenderableColors(item);
  if (colors.length === 0) return '';
  if (colors.length === 1) return `(${colors[0].color})`;
  return colors.map((c) => `${c.quantity} ${c.color}`).join(', ');
}

/**
 * Compose a full operator facing line for a product, matching the shipping
 * label wording. Degrades to the bare name when there is no color makeup.
 *
 *   1 color   -> "Pack Oficina (Rojo)"
 *   multi     -> "Pack Oficina: 1 Rojo, 1 Naranja, 1 Amarillo"
 *   none      -> "Pack Oficina"
 */
export function formatLineItemWithColors(
  baseName: string,
  item: ColorBearingLineItem | null | undefined
): string {
  const colors = getRenderableColors(item);
  if (colors.length === 0) return baseName;
  if (colors.length === 1) return `${baseName} (${colors[0].color})`;
  return `${baseName}: ${colors.map((c) => `${c.quantity} ${c.color}`).join(', ')}`;
}
