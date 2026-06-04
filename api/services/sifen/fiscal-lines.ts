/**
 * Fiscal line builder (pure, no I/O).
 *
 * Turns raw order line items into the SIFEN-facing lines consumed by both the
 * DTE (xmlgen) and the KUDE PDF, applying bundle physical-unit expansion so the
 * invoiced quantity equals the delivered quantity.
 *
 * Extracted from invoicing.service.ts so it is unit-testable without pulling in
 * the Supabase/SIFEN runtime dependencies.
 */

import { parseStringPromise } from 'xml2js';

/**
 * A raw order line item as fetched for invoicing, including the joined
 * `product_variants` row needed to resolve bundle physical-unit expansion.
 * `product_variant` is the embedded relation from the orders query (Supabase
 * returns the FK embed as a single object or, depending on alias, an array).
 */
export interface RawInvoiceLineItem {
  product_name?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  sku?: string | null;
  products?:
    | { fiscal_description?: string | null }
    | Array<{ fiscal_description?: string | null }>
    | null;
  variant_id?: string | null;
  variant_type?: string | null;
  product_variant?:
    | { variant_type?: string | null; units_per_pack?: number | null; uses_shared_stock?: boolean | null }
    | Array<{ variant_type?: string | null; units_per_pack?: number | null; uses_shared_stock?: boolean | null }>
    | null;
}

/**
 * A fiscal line ready for both the DTE (xmlgen) and the KUDE PDF. `cantidad`
 * and `precioUnitario` are the SIFEN-facing values after bundle expansion.
 *
 * INVARIANT: `precioUnitario` is ALWAYS a non-negative integer. Guaraní (PYG)
 * has no cents, so a fractional unit price must never reach dPUniProSer (XML)
 * or the KUDE PDF. xmlgen writes precioUnitario verbatim to dPUniProSer
 * (jsonDteItem.service.js line 152), so an integer in means an integer out.
 * The line total xmlgen emits is round(cantidad x precioUnitario) which, with
 * integer operands, is already exact.
 */
export interface FiscalLineItem {
  codigo: string;
  descripcion: string;
  cantidad: number;
  precioUnitario: number;
  ivaRate: 0 | 5 | 10;
}

export interface FiscalLineBuildResult {
  items: FiscalLineItem[];
  /**
   * Per-line data-integrity warnings surfaced to logs/event context. These do
   * NOT block emission (the algebra stays exact); they flag master-data gaps
   * (missing parent fiscal_description, bundle variant missing units_per_pack)
   * that a human should correct.
   */
  integrityFlags: string[];
}

/**
 * Resolve the fiscal description for an order line item. The invoice must
 * carry the legal/fiscal product description, NOT the commercial/marketing
 * name (e.g. "NOCTE Blue Light Blocking Glasses" is a brand label, and for a
 * bundle the product_name is the pack name like "Pack Pareja" which must never
 * reach the fiscal document). Priority:
 *   1. products.fiscal_description (parent product fiscal name, migration 193)
 *   2. product_name (commercial fallback when fiscal one is missing)
 *   3. 'Producto'
 * The per-store generic override (applyGenericDescription) is applied ON TOP
 * of this when the store opts in, so it always wins.
 */
export function resolveItemFiscalDescription(item: {
  product_name?: string | null;
  products?:
    | { fiscal_description?: string | null }
    | Array<{ fiscal_description?: string | null }>
    | null;
}): string {
  const product = Array.isArray(item.products) ? item.products[0] : item.products;
  const fiscalDesc = product?.fiscal_description?.trim();
  return fiscalDesc || item.product_name || 'Producto';
}

/**
 * Resolve the embedded `product_variant` relation off a raw line item.
 * Supabase may return the embed as an object or a single-element array.
 */
function resolveLineVariant(item: RawInvoiceLineItem): {
  variant_type?: string | null;
  units_per_pack?: number | null;
  uses_shared_stock?: boolean | null;
} | null {
  const v = item.product_variant;
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

/**
 * Build the SIFEN-facing fiscal lines from raw order line items, applying the
 * bundle physical-unit expansion so invoiced quantity equals delivered
 * quantity, with an INTEGER unit price on every emitted line.
 *
 * Resolve N = product_variants.units_per_pack authoritatively from the variant
 * joined by variant_id (NOT from any order_line_items snapshot, which the
 * external webhook does not reliably set).
 *
 * Expand ONLY when the line is a bundle with N > 1. For a bundle line with
 * pack unit price P (integer Gs), order quantity Q and units_per_pack N:
 *
 *     cantidad   = Q * N                    (real physical units delivered)
 *     lineTotal  = Q * P                    (exact amount the customer paid)
 *     base       = floor(lineTotal / cantidad)   INTEGER unit price
 *     remainder  = lineTotal - base * cantidad   in [0, cantidad)
 *
 *   - remainder === 0 (NOCTE's real packs 349000/2 -> 174500, 489000/3 ->
 *     163000, and any pack whose price divides cleanly): ONE line, integer
 *     precioUnitario = base, total = base * cantidad = lineTotal exactly.
 *
 *   - remainder > 0 (a price that does not divide by cantidad, e.g. 350000/3):
 *     SPLIT into TWO integer-only lines so the total is exact with ZERO
 *     decimals anywhere:
 *         Line A: cantidad = cantidad - remainder, precioUnitario = base
 *         Line B: cantidad = remainder,            precioUnitario = base + 1
 *     Sum = (cantidad - remainder)*base + remainder*(base + 1)
 *         = cantidad*base + remainder = lineTotal, EXACTLY.
 *     Both unit prices and both quantities are integers, so dPUniProSer and
 *     dTotOpeItem stay decimal-free and the line reconciles to the cent.
 *
 * Why split rather than a per-line discount: xmlgen's dDescItem is a PER-UNIT
 * value written verbatim (jsonDteItem.service.js line 182,
 * dTotOpeItem = (precioUnitario - dDescItem) * cantidad). Absorbing a
 * line-level remainder R via a discount needs dDescItem = R/cantidad, which is
 * fractional and would put decimals back into the XML (dDescItem). The
 * two-line integer split keeps every emitted number an integer. The split path
 * only triggers for non-dividing prices; NOCTE's real packs never hit it.
 *
 * Non-bundle lines (variation, plain product, bundle with N = 1, no variant)
 * pass through unchanged: cantidad = quantity, precioUnitario = unit_price.
 *
 * Description ALWAYS comes from resolveItemFiscalDescription, i.e. the parent
 * product's fiscal_description (order_line_items.product_id points to the
 * parent for a bundle). The pack/variant title is NEVER injected into the
 * fiscal description.
 */
export function buildFiscalLineItems(lineItems: RawInvoiceLineItem[]): FiscalLineBuildResult {
  const integrityFlags: string[] = [];
  const items: FiscalLineItem[] = [];

  lineItems.forEach((item, index) => {
    const codigo = item.sku || String(index + 1);
    const descripcion = resolveItemFiscalDescription(item);
    const quantity = item.quantity || 1;
    const unitPrice = item.unit_price || 0;

    // Flag missing parent fiscal_description: resolveItemFiscalDescription
    // silently falls back to product_name (the pack name for a bundle), which
    // is exactly what we must avoid on the fiscal document. Surface it.
    const product = Array.isArray(item.products) ? item.products[0] : item.products;
    if (!product?.fiscal_description?.trim()) {
      integrityFlags.push(
        `Line ${index + 1} (sku=${item.sku ?? 'n/a'}): parent product has no fiscal_description; ` +
          `falling back to "${descripcion}". Set products.fiscal_description.`,
      );
    }

    const variant = resolveLineVariant(item);
    const isBundle =
      (item.variant_type === 'bundle' || variant?.variant_type === 'bundle') && !!item.variant_id;

    if (isBundle) {
      // units_per_pack is resolved authoritatively from the variant row, never
      // from an order_line_items snapshot.
      const unitsPerPack = variant?.units_per_pack ?? null;
      if (unitsPerPack == null) {
        integrityFlags.push(
          `Line ${index + 1} (sku=${item.sku ?? 'n/a'}): bundle variant ${item.variant_id} ` +
            `has no units_per_pack on product_variants; emitting without expansion (cantidad=${quantity}).`,
        );
      } else if (unitsPerPack > 1) {
        const cantidad = quantity * unitsPerPack;
        const lineTotal = quantity * unitPrice;
        const base = Math.floor(lineTotal / cantidad);
        const remainder = lineTotal - base * cantidad; // in [0, cantidad)

        if (remainder === 0) {
          // Clean divide (NOCTE's real packs): one integer-priced line.
          items.push({ codigo, descripcion, cantidad, precioUnitario: base, ivaRate: 10 });
        } else {
          // Non-dividing price: split so every number stays an integer and the
          // total is exact. Line A at base, line B (remainder units) at base+1.
          items.push({
            codigo,
            descripcion,
            cantidad: cantidad - remainder,
            precioUnitario: base,
            ivaRate: 10,
          });
          items.push({
            codigo,
            descripcion,
            cantidad: remainder,
            precioUnitario: base + 1,
            ivaRate: 10,
          });
        }
        return;
      }
      // unitsPerPack === 1 -> bundle that is physically one unit, no expansion.
    }

    items.push({
      codigo,
      descripcion,
      cantidad: quantity,
      precioUnitario: unitPrice,
      ivaRate: 10,
    });
  });

  return { items, integrityFlags };
}

/**
 * Recover the fiscal lines from a signed DTE XML.
 *
 * The signed XML is the source of truth for what was emitted to SIFEN. For
 * manual invoices (no order_id, hence no order_line_items to rebuild from), the
 * KUDE/email previously fell back to a single synthetic line ("Productos varios",
 * cantidad 1, precio = total), which misrepresented the real items even though
 * the legal document (the XML) was correct. This parser reads the actual
 * `gCamItem` blocks back out so the PDF and email match the DTE exactly.
 *
 * Pure and async (xml2js). Returns null when the XML is absent, malformed, or
 * carries no item block, so callers can keep a literal last-resort fallback for
 * those genuinely degraded cases (never as the normal path).
 *
 * SIFEN DTE item shape (namespaces stripped):
 *   gCamItem
 *     dCodInt        -> codigo
 *     dDesProSer     -> descripcion
 *     dCantProSer    -> cantidad
 *     gValorItem/dPUniProSer -> precioUnitario
 *     gCamIVA/dTasaIVA       -> ivaRate (0 | 5 | 10)
 */
export async function parseFiscalLinesFromSignedXml(
  xmlSigned: string | null | undefined,
): Promise<FiscalLineItem[] | null> {
  if (!xmlSigned || !xmlSigned.trim()) return null;

  let parsed: unknown;
  try {
    parsed = await parseStringPromise(xmlSigned, {
      explicitArray: false,
      ignoreAttrs: true,
      tagNameProcessors: [(name: string) => name.replace(/.*:/, '')],
    });
  } catch {
    return null;
  }

  // Walk to gCamItem regardless of the rDE/DE wrapper depth. xml2js with the
  // namespace stripper yields plain nested objects; we locate gCamItem by a
  // shallow recursive search to avoid coupling to the exact envelope shape.
  const itemNodes = findItemNodes(parsed);
  if (itemNodes.length === 0) return null;

  const items: FiscalLineItem[] = [];
  for (const node of itemNodes) {
    const descripcion = toStr(node.dDesProSer);
    const cantidad = toNum(node.dCantProSer);
    const valor = asObject(node.gValorItem);
    const precioUnitario = toNum(valor.dPUniProSer);
    if (!descripcion || cantidad == null || precioUnitario == null) return null;

    const codigo = toStr(node.dCodInt) || String(items.length + 1);
    const iva = asObject(node.gCamIVA);
    const ivaRate = parseIvaRate(iva.dTasaIVA);

    items.push({
      codigo,
      descripcion,
      cantidad,
      precioUnitario,
      ivaRate,
    });
  }

  return items.length > 0 ? items : null;
}

/** Recursively collect every `gCamItem` value, flattened, from a parsed DTE. */
function findItemNodes(root: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (node: unknown): void => {
    if (node == null || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if ('gCamItem' in obj) {
      const item = obj.gCamItem;
      if (Array.isArray(item)) {
        for (const it of item) if (it && typeof it === 'object') out.push(it as Record<string, unknown>);
      } else if (item && typeof item === 'object') {
        out.push(item as Record<string, unknown>);
      }
    }
    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(root);
  return out;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function toStr(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function toNum(value: unknown): number | null {
  const s = toStr(value);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseIvaRate(value: unknown): 0 | 5 | 10 {
  const n = toNum(value);
  if (n === 0) return 0;
  if (n === 5) return 5;
  return 10;
}
