export interface DashboardOverview {
  totalOrders: number;
  revenue: number;
  costs: number;
  marketing: number;
  netProfit: number;
  profitMargin: number;
  roi: number;
  deliveryRate: number;
  changes?: {
    totalOrders: number | null;
    revenue: number | null;
    costs: number | null;
    marketing: number | null;
    netProfit: number | null;
    profitMargin: number | null;
    roi: number | null;
    deliveryRate: number | null;
  };
}

export interface Order {
  id: string;
  customer: string;
  address?: string;
  product: string;
  quantity: number;
  total: number;
  status: 'pending_confirmation' | 'confirmed' | 'prepared' | 'delivered_to_courier' | 'in_transit' | 'delivered' | 'not_delivered' | 'reconciled' | 'rejected' | 'cancelled';
  payment_status?: 'pending' | 'collected' | 'failed';
  carrier: string;
  carrier_id?: string;
  date: string;
  phone: string;
  phone_backup?: string;
  confirmedByWhatsApp?: boolean;
  confirmationTimestamp?: string;
  confirmationMethod?: 'whatsapp' | 'phone' | 'manual';
  rejectionReason?: string;
  // New confirmation flow fields
  upsell_added?: boolean;
  proof_photo_url?: string;
  qr_code_url?: string;
  delivery_link_token?: string;
  delivery_status?: 'pending' | 'confirmed' | 'failed';
  delivery_failure_reason?: string;
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
  // Geolocation for map
  latitude?: number;
  longitude?: number;
}

export interface Product {
  id: string;
  name: string;
  image: string;
  stock: number;
  price: number;
  cost: number;
  profitability: number;
  sales: number;
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
  category: 'marketing' | 'sales' | 'employees' | 'operational';
  description: string;
  amount: number;
  date: string;
  type: 'expense' | 'income';
}

export interface Integration {
  id: string;
  name: string;
  category: 'general' | 'marketing' | 'store';
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
  revenue: number;
  costs: number;
  marketing: number;
  profit: number;
}

export interface MetricCardProps {
  title: string;
  value: string | number;
  change?: number;
  trend?: 'up' | 'down';
  icon: React.ReactNode;
  variant?: 'default' | 'primary' | 'secondary' | 'accent' | 'purple';
  onClick?: () => void;
}

export interface ConfirmationMetrics {
  totalPending: number;
  totalConfirmed: number;
  confirmationRate: number;
  avgConfirmationTime: number;
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
  type: 'pricing' | 'inventory' | 'marketing' | 'carrier';
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

export * from './notification';
