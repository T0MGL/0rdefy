/**
 * Pure helpers used by api/routes/public-orders.ts. Kept side-effect free
 * (no DB imports) so they can be unit-tested without booting the env.
 */

export interface PublicLineItem {
    product_name: string | null;
    sku: string | null;
    variant_title: string | null;
    quantity: number;
    unit_price: number;
    image_url: string | null;
}

// Shape returned by Migration 192's get_order_coverage_status RPC.
// Mirrored here so callers can normalize / type-narrow without importing
// the route file.
export type CoverageReason =
    | 'no_shipping_city'
    | 'unknown_city'
    | 'no_coverage_in_store'
    | null;

export type CarrierKind = 'internal' | 'external';

export interface CoverageCarrier {
    carrier_id: string;
    name: string;
    rate: number;
    is_cheapest: boolean;
    carrier_type: CarrierKind;
}

export interface CoverageResultShape {
    shipping_city: string | null;
    shipping_city_normalized: string | null;
    has_coverage: boolean | null;
    reason: CoverageReason;
    store_active_carriers_count: number;
    available_carriers: CoverageCarrier[];
}

const ALLOWED_REASONS: ReadonlySet<string> = new Set([
    'no_shipping_city',
    'unknown_city',
    'no_coverage_in_store',
]);

// Defensive normalizer for the coverage RPC payload. Validates the shape
// and coerces field-by-field so a malformed JSONB response never crashes
// the consumer. Returns null for anything that does not look like the
// documented contract; the caller can then fall back to a safe stub.
export function normalizeCoverageResult(raw: unknown): CoverageResultShape | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;

    const has_coverage =
        r.has_coverage === true || r.has_coverage === false
            ? (r.has_coverage as boolean)
            : r.has_coverage === null || r.has_coverage === undefined
                ? null
                : null;

    const reason: CoverageReason =
        r.reason === null || r.reason === undefined
            ? null
            : typeof r.reason === 'string' && ALLOWED_REASONS.has(r.reason)
                ? (r.reason as Exclude<CoverageReason, null>)
                : null;

    const store_active_carriers_count =
        typeof r.store_active_carriers_count === 'number' &&
        Number.isFinite(r.store_active_carriers_count) &&
        r.store_active_carriers_count >= 0
            ? Math.floor(r.store_active_carriers_count)
            : 0;

    const shipping_city = typeof r.shipping_city === 'string' ? r.shipping_city : null;
    const shipping_city_normalized =
        typeof r.shipping_city_normalized === 'string' ? r.shipping_city_normalized : null;

    const carriersRaw = Array.isArray(r.available_carriers) ? r.available_carriers : [];
    const available_carriers: CoverageCarrier[] = [];
    for (const item of carriersRaw) {
        if (!item || typeof item !== 'object') continue;
        const c = item as Record<string, unknown>;
        const carrier_id = typeof c.carrier_id === 'string' ? c.carrier_id : null;
        const name = typeof c.name === 'string' ? c.name : null;
        const carrier_type =
            c.carrier_type === 'internal' || c.carrier_type === 'external'
                ? (c.carrier_type as CarrierKind)
                : null;
        const rateRaw = c.rate;
        const rate =
            typeof rateRaw === 'number' && Number.isFinite(rateRaw)
                ? rateRaw
                : typeof rateRaw === 'string' && rateRaw.trim() !== ''
                    ? Number(rateRaw)
                    : NaN;
        if (!carrier_id || !name || !carrier_type || !Number.isFinite(rate)) continue;
        available_carriers.push({
            carrier_id,
            name,
            rate,
            is_cheapest: c.is_cheapest === true,
            carrier_type,
        });
    }

    return {
        shipping_city,
        shipping_city_normalized,
        has_coverage,
        reason,
        store_active_carriers_count,
        available_carriers,
    };
}

// Resolve the customer-visible order number using the same precedence the
// rest of the app uses: shopify_order_name (#1234) > shopify_order_number
// > order_number > short UUID fallback.
export function resolveOrderNumber(row: {
    shopify_order_name: string | null;
    shopify_order_number: string | null;
    order_number: string | null;
    id: string;
}): string {
    if (row.shopify_order_name && row.shopify_order_name.trim().length > 0) {
        return row.shopify_order_name.trim();
    }
    if (row.shopify_order_number && row.shopify_order_number.trim().length > 0) {
        const trimmed = row.shopify_order_number.trim();
        return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    }
    if (row.order_number && row.order_number.trim().length > 0) {
        return row.order_number.trim();
    }
    return `#${row.id.slice(-4)}`;
}

// JSONB line_items shape varies historically (Shopify import, manual create,
// legacy formats). Pick safe fields only, never propagate raw shopify_data.
export function projectJsonbLineItems(raw: unknown): PublicLineItem[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((item) => {
        const i = (item ?? {}) as Record<string, unknown>;
        const qtyRaw = i.quantity ?? i.qty;
        const priceRaw = i.unit_price ?? i.price ?? i.unitPrice;
        return {
            product_name:
                typeof i.product_name === 'string' ? i.product_name :
                typeof i.title === 'string'        ? i.title :
                typeof i.name === 'string'         ? i.name : null,
            sku: typeof i.sku === 'string' ? i.sku : null,
            variant_title: typeof i.variant_title === 'string' ? i.variant_title : null,
            quantity: typeof qtyRaw === 'number' ? qtyRaw :
                      typeof qtyRaw === 'string' && qtyRaw.trim() !== '' ? Number(qtyRaw) || 0 : 0,
            unit_price: typeof priceRaw === 'number' ? priceRaw :
                        typeof priceRaw === 'string' && priceRaw.trim() !== '' ? Number(priceRaw) || 0 : 0,
            image_url:
                typeof i.image_url === 'string' ? i.image_url :
                typeof i.image === 'string'     ? i.image : null,
        };
    });
}

// Strip shipping_address fields that could leak unrelated PII. We surface
// address1/2/city/province/country/zip only.
export function projectShippingAddress(raw: unknown): {
    address1: string | null;
    address2: string | null;
    city: string | null;
    province: string | null;
    country: string | null;
    zip: string | null;
} | null {
    if (!raw || typeof raw !== 'object') return null;
    const sa = raw as Record<string, unknown>;
    return {
        address1: typeof sa.address1 === 'string' ? sa.address1 : null,
        address2: typeof sa.address2 === 'string' ? sa.address2 : null,
        city:     typeof sa.city     === 'string' ? sa.city     : null,
        province: typeof sa.province === 'string' ? sa.province : null,
        country:  typeof sa.country  === 'string' ? sa.country  : null,
        zip:      typeof sa.zip      === 'string' ? sa.zip      : null,
    };
}
