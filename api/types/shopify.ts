// TypeScript types for Shopify integration
// Defines all data structures used across backend services and API routes

// Shopify Integration Configuration
export interface ShopifyIntegration {
  id: string;
  store_id: string;
  shop_domain: string;
  api_key: string;
  api_secret_key: string;
  access_token: string;
  webhook_signature: string | null;
  import_products: boolean;
  import_customers: boolean;
  import_orders: boolean;
  import_historical_orders: boolean;
  status: 'active' | 'inactive' | 'error' | 'syncing';
  last_sync_at: string | null;
  sync_error: string | null;
  shopify_shop_id: string | null;
  shop_name: string | null;
  shop_email: string | null;
  shop_currency: string | null;
  shop_timezone: string | null;
  shop_data: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

// Configuration request payload
export interface ShopifyConfigRequest {
  shop_domain: string;
  api_key: string;
  api_secret_key: string;
  access_token: string;
  webhook_signature: string;
  import_products: boolean;
  import_customers: boolean;
  import_orders: boolean;
  import_historical_orders: boolean;
}

// Import Job Tracking
export interface ShopifyImportJob {
  id: string;
  integration_id: string;
  store_id: string;
  job_type: 'initial' | 'manual' | 'webhook' | 'scheduled';
  import_type: 'products' | 'customers' | 'orders' | 'all';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  total_items: number;
  processed_items: number;
  failed_items: number;
  success_items: number;
  current_page: number;
  page_size: number;
  has_more: boolean;
  last_cursor: string | null;
  error_message: string | null;
  error_details: Record<string, any> | null;
  retry_count: number;
  max_retries: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// Manual sync request
export interface ManualSyncRequest {
  sync_type: 'products' | 'customers' | 'orders' | 'all';
  force_full_sync?: boolean;
}

// Webhook event structure
export interface ShopifyWebhookEvent {
  id: string;
  integration_id: string | null;
  store_id: string;
  event_type: 'product' | 'customer' | 'order';
  shopify_topic: string;
  shopify_event_id: string | null;
  payload: Record<string, any>;
  headers: Record<string, any> | null;
  processed: boolean;
  processed_at: string | null;
  processing_error: string | null;
  retry_count: number;
  created_at: string;
}

// Sync conflict tracking
export interface ShopifySyncConflict {
  id: string;
  integration_id: string;
  store_id: string;
  entity_type: 'product' | 'customer' | 'order';
  entity_id: string;
  shopify_entity_id: string | null;
  local_data: Record<string, any>;
  shopify_data: Record<string, any>;
  conflict_fields: string[] | null;
  resolution_strategy: 'local_wins' | 'shopify_wins' | 'manual' | 'merge' | null;
  resolved: boolean;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

// Shopify API Product structure
export interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string | null;
  vendor: string;
  product_type: string;
  created_at: string;
  handle: string;
  updated_at: string;
  published_at: string | null;
  template_suffix: string | null;
  status: 'active' | 'archived' | 'draft';
  published_scope: string;
  tags: string;
  admin_graphql_api_id: string;
  variants: ShopifyProductVariant[];
  options: ShopifyProductOption[];
  images: ShopifyProductImage[];
  image: ShopifyProductImage | null;
}

export interface ShopifyProductVariant {
  id: number;
  product_id: number;
  title: string;
  price: string;
  sku: string;
  position: number;
  inventory_policy: string;
  compare_at_price: string | null;
  fulfillment_service: string;
  inventory_management: string;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  created_at: string;
  updated_at: string;
  taxable: boolean;
  barcode: string | null;
  grams: number;
  image_id: number | null;
  weight: number;
  weight_unit: string;
  inventory_item_id: number;
  inventory_quantity: number;
  old_inventory_quantity: number;
  requires_shipping: boolean;
  admin_graphql_api_id: string;
}

export interface ShopifyProductOption {
  id: number;
  product_id: number;
  name: string;
  position: number;
  values: string[];
}

export interface ShopifyProductImage {
  id: number;
  product_id: number;
  position: number;
  created_at: string;
  updated_at: string;
  alt: string | null;
  width: number;
  height: number;
  src: string;
  variant_ids: number[];
  admin_graphql_api_id: string;
}

// Shopify API Customer structure
export interface ShopifyCustomer {
  id: number;
  email: string;
  accepts_marketing: boolean;
  created_at: string;
  updated_at: string;
  first_name: string;
  last_name: string;
  orders_count: number;
  state: string;
  total_spent: string;
  last_order_id: number | null;
  note: string | null;
  verified_email: boolean;
  multipass_identifier: string | null;
  tax_exempt: boolean;
  phone: string | null;
  tags: string;
  last_order_name: string | null;
  currency: string;
  addresses: ShopifyAddress[];
  accepts_marketing_updated_at: string;
  marketing_opt_in_level: string | null;
  tax_exemptions: string[];
  admin_graphql_api_id: string;
  default_address: ShopifyAddress | null;
}

export interface ShopifyAddress {
  id: number;
  customer_id: number;
  first_name: string;
  last_name: string;
  company: string | null;
  address1: string;
  address2: string | null;
  city: string;
  province: string;
  country: string;
  zip: string;
  phone: string;
  name: string;
  province_code: string;
  country_code: string;
  country_name: string;
  default: boolean;
}

// Shopify API Order structure
export interface ShopifyOrder {
  id: number;
  admin_graphql_api_id: string;
  app_id: number | null;
  browser_ip: string | null;
  buyer_accepts_marketing: boolean;
  cancel_reason: string | null;
  cancelled_at: string | null;
  cart_token: string | null;
  checkout_id: number | null;
  checkout_token: string | null;
  client_details: Record<string, any> | null;
  closed_at: string | null;
  confirmed: boolean;
  contact_email: string | null;
  created_at: string;
  currency: string;
  current_subtotal_price: string;
  current_total_discounts: string;
  current_total_duties_set: any;
  current_total_price: string;
  current_total_tax: string;
  customer_locale: string | null;
  device_id: number | null;
  discount_codes: any[];
  email: string;
  estimated_taxes: boolean;
  financial_status: string;
  fulfillment_status: string | null;
  gateway: string;
  landing_site: string | null;
  landing_site_ref: string | null;
  location_id: number | null;
  name: string;
  note: string | null;
  note_attributes: any[];
  number: number;
  order_number: number;
  order_status_url: string;
  original_total_duties_set: any;
  payment_gateway_names: string[];
  phone: string | null;
  presentment_currency: string;
  processed_at: string;
  processing_method: string;
  reference: string | null;
  referring_site: string | null;
  source_identifier: string | null;
  source_name: string;
  source_url: string | null;
  subtotal_price: string;
  tags: string;
  tax_lines: any[];
  taxes_included: boolean;
  test: boolean;
  token: string;
  total_discounts: string;
  total_line_items_price: string;
  total_outstanding: string;
  total_price: string;
  total_shipping_price_set: any;
  total_tax: string;
  total_tip_received: string;
  total_weight: number;
  updated_at: string;
  user_id: number | null;
  billing_address: ShopifyAddress | null;
  customer: ShopifyCustomer;
  discount_applications: any[];
  fulfillments: any[];
  line_items: ShopifyLineItem[];
  payment_details: any;
  refunds: any[];
  shipping_address: ShopifyAddress | null;
  shipping_lines: any[];
}

export interface ShopifyLineItem {
  id: number;
  admin_graphql_api_id: string;
  fulfillable_quantity: number;
  fulfillment_service: string;
  fulfillment_status: string | null;
  gift_card: boolean;
  grams: number;
  name: string;
  price: string;
  price_set: any;
  product_exists: boolean;
  product_id: number;
  properties: any[];
  quantity: number;
  requires_shipping: boolean;
  sku: string;
  taxable: boolean;
  title: string;
  total_discount: string;
  total_discount_set: any;
  variant_id: number;
  variant_inventory_management: string;
  variant_title: string | null;
  vendor: string;
  tax_lines: any[];
  duties: any[];
  discount_allocations: any[];
}

// API Response structures
export interface ShopifyApiListResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total?: number;
    has_next: boolean;
    has_prev: boolean;
    next_cursor?: string;
    prev_cursor?: string;
  };
}

export interface ImportStatusResponse {
  integration_id: string;
  jobs: ShopifyImportJob[];
  overall_status: 'idle' | 'syncing' | 'completed' | 'error';
  total_progress: number;
  last_sync_at: string | null;
}

// Product creation/update payloads
export interface CreateProductRequest {
  title: string;
  description: string;
  price: number;
  sku: string;
  stock: number;
  vendor?: string;
  product_type?: string;
  tags?: string;
  status?: 'active' | 'draft' | 'archived';
  images?: string[];
  sync_to_shopify?: boolean;
}

export interface UpdateProductRequest {
  title?: string;
  description?: string;
  price?: number;
  sku?: string;
  stock?: number;
  vendor?: string;
  product_type?: string;
  tags?: string;
  status?: 'active' | 'draft' | 'archived';
  images?: string[];
  sync_to_shopify?: boolean;
}

// Rate limiting configuration
export interface RateLimitConfig {
  max_requests_per_second: number;
  bucket_size: number;
  refill_rate: number;
}

// Background job queue item
export interface JobQueueItem {
  job_id: string;
  integration_id: string;
  store_id: string;
  job_type: string;
  import_type: string;
  priority: number;
  scheduled_at: string;
  metadata: Record<string, any>;
}

export interface JobProgress {
  job_id: string;
  status: string;
  progress_percentage: number;
  current_item: number;
  total_items: number;
  estimated_time_remaining: number | null;
  error_message: string | null;
}
