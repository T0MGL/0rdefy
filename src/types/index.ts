export interface DashboardOverview {
  totalOrders: number;
  revenue: number;
  // Costos separados para transparencia
  productCosts?: number; // Costo de productos solamente
  costs: number; // Costos totales (productos + envío + gasto publicitario)
  deliveryCosts?: number; // Costos de envío
  gasto_publicitario: number;
  // Gross profit and margin (Revenue - Product Costs only)
  grossProfit: number; // Beneficio bruto (Ingresos - Costos de productos)
  grossMargin: number; // Margen bruto (%) (Beneficio bruto / Ingresos × 100)
  // Net profit and margin (Revenue - All Costs)
  netProfit: number; // Beneficio neto (Ingresos - Costos totales)
  netMargin: number; // Margen neto (%) (Beneficio neto / Ingresos × 100)
  profitMargin: number; // Deprecated: use netMargin instead
  // Real cash metrics (only delivered orders)
  realRevenue?: number; // Ingreso real (solo pedidos entregados)
  projectedRevenue?: number; // Ingreso proyectado (entregados + en tránsito ajustado por tasa de entrega)
  realProductCosts?: number; // Costo de productos reales (solo pedidos entregados)
  realCosts?: number; // Costos totales reales (solo pedidos entregados)
  realDeliveryCosts?: number; // Costos de envío reales (solo pedidos entregados)
  realGrossProfit?: number; // Beneficio bruto real (solo pedidos entregados)
  realGrossMargin?: number; // Margen bruto real (%) (solo pedidos entregados)
  realNetProfit?: number; // Beneficio neto real (solo pedidos entregados)
  realNetMargin?: number; // Margen neto real (%) (solo pedidos entregados)
  realProfitMargin?: number; // Deprecated: use realNetMargin instead
  // ROI and ROAS metrics
  roi: number; // ROI proyectado (todos los pedidos)
  roas: number; // ROAS proyectado (todos los pedidos)
  realRoi?: number; // ROI real (solo pedidos entregados)
  realRoas?: number; // ROAS real (solo pedidos entregados)
  deliveryRate: number;
  taxCollected: number; // IVA recolectado incluido en los ingresos
  taxRate: number; // Tasa de IVA configurada en el onboarding (ej: 10 para 10%)
  costPerOrder: number; // Costo promedio por pedido
  averageOrderValue: number; // Ticket promedio (valor promedio por pedido)
  changes?: {
    totalOrders: number | null;
    revenue: number | null;
    costs: number | null;
    deliveryCosts?: number | null;
    productCosts?: number | null;
    gasto_publicitario: number | null;
    grossProfit?: number | null;
    grossMargin?: number | null;
    netProfit: number | null;
    netMargin?: number | null;
    profitMargin: number | null;
    realRevenue?: number | null;
    realCosts?: number | null;
    realDeliveryCosts?: number | null;
    realProductCosts?: number | null;
    realGrossProfit?: number | null;
    realGrossMargin?: number | null;
    realNetProfit?: number | null;
    realNetMargin?: number | null;
    realProfitMargin?: number | null;
    roi: number | null;
    roas: number | null;
    deliveryRate: number | null;
    taxCollected: number | null;
    costPerOrder: number | null;
    averageOrderValue: number | null;
  };
}

export interface Order {
  id: string;
  shopify_order_id?: string; // ID de Shopify (ej: "5678901234")
  shopify_order_number?: string; // Número de orden de Shopify (ej: "1001")
  shopify_order_name?: string; // Nombre de orden de Shopify (ej: "#1001")
  payment_gateway?: string; // Gateway de pago (shopify_payments, manual, paypal, etc.)
  cancel_reason?: string; // Razón de cancelación del pedido
  customer: string;
  address?: string;
  product: string;
  quantity: number;
  total: number;
  status: 'pending' | 'contacted' | 'awaiting_carrier' | 'confirmed' | 'in_preparation' | 'ready_to_ship' | 'shipped' | 'in_transit' | 'delivered' | 'returned' | 'cancelled' | 'incident';
  payment_status?: 'pending' | 'collected' | 'failed';
  carrier: string;
  carrier_id?: string;
  date: string;
  phone: string;
  phone_backup?: string;
  confirmedByWhatsApp?: boolean;
  confirmationTimestamp?: string;
  confirmationMethod?: 'whatsapp' | 'phone' | 'manual';
  inTransitTimestamp?: string;
  deliveredTimestamp?: string;
  cancelledTimestamp?: string;
  rejectionReason?: string;
  // New confirmation flow fields
  upsell_added?: boolean;
  proof_photo_url?: string;
  qr_code_url?: string;
  delivery_link_token?: string;
  delivery_status?: 'pending' | 'confirmed' | 'failed';
  delivery_failure_reason?: string;
  courier_notes?: string; // Notas del transportista durante confirmación/falla
  delivered_at?: string;
  reconciled_at?: string;
  // COD specific fields
  delivery_attempts?: number;
  failed_reason?: string;
  risk_score?: number;
  customer_address?: string;
  address_reference?: string;
  neighborhood?: string;
  delivery_notes?: string;
  // NEW: Internal admin notes (not visible to customers)
  internal_notes?: string;
  has_internal_notes?: boolean; // Quick indicator for list views
  // NEW: City extraction from Shopify
  shipping_city?: string;
  shipping_city_normalized?: string;
  // NEW: Shopify shipping method (from checkout)
  shopify_shipping_method?: string;
  shopify_shipping_method_code?: string;
  // Cash on Delivery (COD)
  payment_method?: string; // 'cash', 'online', 'card', 'transfer', 'yape', 'plin', 'efectivo', etc.
  cod_amount?: number; // Monto que debe cobrar la transportadora en efectivo
  // Financial status from Shopify - CRITICAL for shipping labels
  financial_status?: 'pending' | 'paid' | 'authorized' | 'refunded' | 'voided' | 'partially_refunded' | 'partially_paid';
  total_price?: number; // Total price of the order
  // Discounts
  total_discounts?: number; // Descuento aplicado al pedido
  // Geolocation for map
  latitude?: number;
  longitude?: number;
  google_maps_link?: string; // Link directo de Google Maps
  // Printing status
  printed?: boolean;
  printed_at?: string;
  printed_by?: string;
  // Soft delete and test status
  deleted_at?: string;
  deleted_by?: string;
  deletion_type?: 'soft' | 'hard';
  is_test?: boolean;
  marked_test_by?: string;
  marked_test_at?: string;
  // n8n webhook integration
  n8n_sent?: boolean;
  n8n_processed_at?: string;
  // Order line items (for Shopify orders)
  order_line_items?: Array<{
    id: string;
    product_id?: string;
    variant_id?: string; // Local variant ID (Migration 097)
    product_name: string;
    variant_title?: string;
    sku?: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    units_per_pack?: number; // Snapshot for audit (Migration 097)
    shopify_product_id?: string;
    shopify_variant_id?: string;
    products?: {
      id: string;
      name: string;
      image_url?: string;
    };
  }>;
  // Amount discrepancy (when courier collects different amount)
  amount_collected?: number;
  has_amount_discrepancy?: boolean;
  // Pickup orders (retiro en local - no shipping)
  is_pickup?: boolean;
  // Prepaid COD orders (pagado por transferencia antes del envío)
  prepaid_method?: 'transfer' | 'efectivo_local' | 'qr' | 'otro';
  prepaid_at?: string;
  prepaid_by?: string;
  // Delivery rating (customer feedback after QR scan)
  delivery_rating?: number; // 1-5 stars
  delivery_rating_comment?: string;
  rated_at?: string;
  // Electronic invoicing (SIFEN - Paraguay)
  customer_ruc?: string;
  customer_ruc_dv?: number;
  invoice_id?: string;
}

export interface CreateOrderInput {
  customer: string;
  phone: string;
  address?: string;
  product: string;
  product_id?: string;
  quantity: number;
  total: number;
  status: Order['status'];
  carrier: string;
  paymentMethod?: 'paid' | 'cod';
}

export interface UpdateOrderInput extends Partial<CreateOrderInput> { }

export interface Product {
  id: string;
  name: string;
  description?: string;
  sku?: string;
  category?: string;
  image: string; // Frontend uses 'image', backend uses 'image_url' (transformed in service)
  stock: number;
  price: number;
  cost: number;
  packaging_cost?: number;
  additional_costs?: number;
  is_service?: boolean;
  profitability: number;
  sales: number;
  // Shopify integration fields
  shopify_product_id?: string;
  shopify_variant_id?: string;
  shopify_data?: any;
  last_synced_at?: string;
  sync_status?: 'synced' | 'pending' | 'error';
  // Variant support (Migration 086/087/097)
  has_variants?: boolean;
  variants?: ProductVariant[];
}

// ============================================================================
// Product Variants: Bundles vs Variations (Migration 101)
// ============================================================================
//
// BUNDLE: Quantity packs with shared stock (1x, 2x, 3x)
//   - uses_shared_stock = true (always)
//   - units_per_pack >= 1
//   - stock = 0 (uses parent product stock)
//   - available_packs = floor(parent_stock / units_per_pack)
//
// VARIATION: Different product versions with independent stock (Size, Color)
//   - uses_shared_stock = false (always)
//   - units_per_pack = 1 (always)
//   - stock = independent quantity
//   - option1/2/3 for attributes (Size/M, Color/Blue)
//
// ============================================================================

export type VariantType = 'bundle' | 'variation';

// Base interface with common fields
interface ProductVariantBase {
  id: string;
  product_id: string;
  store_id?: string;
  sku?: string;
  variant_title: string;
  price: number;
  cost?: number;
  is_active: boolean;
  position?: number;
  image_url?: string;
  // Shopify integration
  shopify_variant_id?: string;
  shopify_inventory_item_id?: string;
  created_at?: string;
  updated_at?: string;
}

// Bundle: Pack de cantidad con stock compartido del producto padre
export interface BundleVariant extends ProductVariantBase {
  variant_type: 'bundle';
  uses_shared_stock: true;
  units_per_pack: number;       // >= 1, e.g., 2 for "Pareja"
  stock: 0;                     // Always 0, uses parent stock
  available_packs?: number;     // Calculated: floor(parent_stock / units_per_pack)
  // Bundles don't use option attributes
  option1_name?: undefined;
  option1_value?: undefined;
  option2_name?: undefined;
  option2_value?: undefined;
  option3_name?: undefined;
  option3_value?: undefined;
}

// Variation: Version del producto con stock independiente
export interface VariationVariant extends ProductVariantBase {
  variant_type: 'variation';
  uses_shared_stock: false;
  units_per_pack: 1;            // Always 1 for variations
  stock: number;                // Independent stock
  available_stock?: number;     // Same as stock for variations
  // Attribute options (Size, Color, Material)
  option1_name?: string;
  option1_value?: string;
  option2_name?: string;
  option2_value?: string;
  option3_name?: string;
  option3_value?: string;
}

// Union type - a variant is either a Bundle OR a Variation
export type ProductVariant = BundleVariant | VariationVariant;

// Type guards for discriminated union
export const isBundle = (variant: ProductVariant): variant is BundleVariant =>
  variant.variant_type === 'bundle';

export const isVariation = (variant: ProductVariant): variant is VariationVariant =>
  variant.variant_type === 'variation';

// Helper to get available quantity (packs for bundles, units for variations)
export const getAvailableQuantity = (variant: ProductVariant, parentStock?: number): number => {
  if (isBundle(variant)) {
    if (variant.available_packs !== undefined) return variant.available_packs;
    if (parentStock !== undefined) return Math.floor(parentStock / variant.units_per_pack);
    return 0;
  }
  return variant.available_stock ?? variant.stock ?? 0;
};

// Legacy interface for backward compatibility during transition
// TODO: Remove after full migration
export interface ProductVariantLegacy {
  id: string;
  product_id: string;
  store_id?: string;
  sku?: string;
  variant_title: string;
  option1_name?: string;
  option1_value?: string;
  option2_name?: string;
  option2_value?: string;
  option3_name?: string;
  option3_value?: string;
  price: number;
  cost?: number;
  stock: number;
  uses_shared_stock: boolean;
  units_per_pack: number;
  available_stock?: number;
  is_active: boolean;
  position?: number;
  image_url?: string;
  shopify_variant_id?: string;
  shopify_inventory_item_id?: string;
  variant_type?: VariantType;
}

export interface Ad {
  id: string;
  platform: string;
  campaign_name: string;
  investment: number;
  clicks: number;
  conversions: number;
  roas: number;
  status: 'active' | 'paused' | 'ended';
  created_at: string;
  updated_at?: string;
}

export interface AdditionalValue {
  id: string;
  category: 'gasto_publicitario' | 'sales' | 'employees' | 'operational';
  description: string;
  amount: number;
  date: string;
  type: 'expense' | 'income';
}

export interface Integration {
  id: string;
  name: string;
  category: 'general' | 'gasto_publicitario' | 'store';
  icon: string;
  description: string;
  status: 'connected' | 'available' | 'coming_soon';
}

export interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  total_orders: number;
  total_spent: number;
  accepts_marketing: boolean;
  last_order_at?: string;
  created_at: string;
  updated_at?: string;
}

export interface Supplier {
  id: string;
  name: string;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  rating: number | null;
  products_count: number;
  products_supplied?: number;  // Alias for backward compatibility
  created_at: string;
  updated_at: string;
}

export interface ChartData {
  date: string;
  revenue: number;          // Revenue proyectado (todos los pedidos)
  realRevenue: number;      // Revenue real (solo entregados)
  costs: number;            // Costos totales (producto + envío) de entregados
  productCosts: number;     // Costo de productos de entregados
  shippingCosts: number;    // Costo de envío de entregados
  gasto_publicitario: number;
  profit: number;           // Beneficio real (solo entregados)
}

export interface MetricCardProps {
  title: string | React.ReactNode;
  value: string | number;
  change?: number;
  trend?: 'up' | 'down';
  icon: React.ReactNode;
  variant?: 'default' | 'primary' | 'secondary' | 'accent' | 'purple';
  subtitle?: string;
  onClick?: () => void;
}

export interface ConfirmationMetrics {
  totalPending: number;
  totalConfirmed: number;
  confirmationRate: number;
  avgConfirmationTime: number;
  avgDeliveryTime?: number;
  confirmationsToday: number;
  pendingToday: number;
  confirmationRateChange?: number | null;
}

export interface Alert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  actionUrl?: string;
  actionLabel?: string;
  timestamp: string;
  dismissed: boolean;
}

export interface Recommendation {
  id: string;
  type: 'pricing' | 'inventory' | 'gasto_publicitario' | 'carrier';
  title: string;
  description: string;
  impact: string;
  actionLabel: string;
  actionUrl?: string;
}

// ================================================================
// COD (Contra Entrega) Types
// ================================================================

export interface DeliveryAttempt {
  id: string;
  order_id: string;
  store_id: string;
  attempt_number: number;
  scheduled_date: string;
  actual_date?: string;
  status: 'scheduled' | 'delivered' | 'failed' | 'customer_absent' | 'address_wrong' | 'customer_refused';
  notes?: string;
  failed_reason?: string;
  failure_notes?: string; // Información adicional sobre el problema en la entrega
  photo_url?: string;
  payment_method?: string; // Método de pago usado: efectivo, tarjeta, transferencia, yape, plin, etc.
  carrier_id?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface DailySettlement {
  id: string;
  store_id: string;
  settlement_date: string;
  carrier_id?: string;
  carrier_name?: string;
  expected_cash: number;
  collected_cash: number;
  difference: number;
  status: 'pending' | 'completed' | 'with_issues';
  notes?: string;
  settled_by?: string;
  orders: SettlementOrder[];
  created_at: string;
  updated_at: string;
}

export interface SettlementOrder {
  id: string;
  settlement_id: string;
  order_id: string;
  order_number?: string;
  customer_name?: string;
  amount: number;
  created_at: string;
}

export interface CODMetrics {
  confirmation_rate: number;
  payment_success_rate: number;
  average_delivery_attempts: number;
  failed_deliveries_loss: number;
  pending_cash: number;
  collected_today: number;
  orders_in_delivery: number;
}

// ================================================================
// Merchandise / Inbound Shipments Types
// ================================================================

export interface InboundShipment {
  id: string;
  store_id: string;
  internal_reference: string;
  supplier_id?: string;
  supplier_name?: string;
  carrier_id?: string;
  carrier_name?: string;
  tracking_code?: string;
  estimated_arrival_date?: string;
  received_date?: string;
  status: 'pending' | 'partial' | 'received';
  shipping_cost: number;
  total_cost: number;
  evidence_photo_url?: string;
  notes?: string;
  created_by?: string;
  received_by?: string;
  created_at: string;
  updated_at: string;
  // Summary fields (from view)
  total_items?: number;
  total_qty_ordered?: number;
  total_qty_received?: number;
  total_qty_rejected?: number;
  items_with_discrepancies?: number;
  // Items array for details
  items?: InboundShipmentItem[];
}

export interface InboundShipmentItem {
  id: string;
  shipment_id: string;
  product_id: string;
  product_name?: string;
  product_image?: string;
  qty_ordered: number;
  qty_received: number;
  qty_rejected: number;
  unit_cost: number;
  total_cost: number;
  discrepancy_notes?: string;
  has_discrepancy?: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateShipmentDTO {
  supplier_id?: string;
  carrier_id?: string;
  tracking_code?: string;
  estimated_arrival_date?: string;
  shipping_cost?: number;
  evidence_photo_url?: string;
  notes?: string;
  items: CreateShipmentItemDTO[];
}

export interface CreateShipmentItemDTO {
  product_id: string;
  qty_ordered: number;
  unit_cost: number;
}

export interface ReceiveShipmentDTO {
  items: ReceiveShipmentItemDTO[];
}

export interface ReceiveShipmentItemDTO {
  item_id: string;
  qty_received: number;
  qty_rejected?: number;
  discrepancy_notes?: string;
}

export interface ShopifyIntegration {
  id: string;
  shop: string;
  scope: string;
  access_token?: string; // Usually not exposed to frontend
  status: 'active' | 'inactive' | 'disconnected';
  installed_at: string;
  last_sync_at?: string;
  updated_at: string;
}

// Collaborators & Team Management
export interface CollaboratorStats {
  current_users: number;
  pending_invitations: number;
  max_users: number;
  plan: string;
  slots_available: number;
  can_add_more: boolean;
}

export interface CollaboratorInvitation {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'pending' | 'expired' | 'used';
  invitedBy?: { name: string };
  expiresAt: string;
  createdAt: string;
  usedAt?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
  invitedBy?: string;
  invitedAt?: string;
  joinedAt: string;
}

export * from './notification';
