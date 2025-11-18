export interface Carrier {
  id: string;
  name: string;
  logo?: string;
  contactPerson?: string;
  email?: string;
  phone: string;
  status: 'active' | 'inactive';

  // Performance metrics
  totalShipments?: number;
  deliveredOnTime?: number;
  delayed?: number;
  returned?: number;
  lost?: number;

  // New COD delivery metrics (from DB)
  total_deliveries?: number;
  successful_deliveries?: number;
  failed_deliveries?: number;

  // KPIs
  deliveryRate: number; // % - Calculated from successful/total deliveries
  avgDeliveryTime?: number; // days
  returnRate?: number; // %
  costPerShipment?: number;
  customerSatisfaction?: number; // rating 1-5

  // Geographic analysis
  coverageAreas?: string[];
  performanceByRegion?: {
    region: string;
    deliveryRate: number;
    avgTime: number;
    cost: number;
  }[];

  // Costs and rates
  baseRate?: number;
  pricePerKg?: number;
  pricePerKm?: number;
  insurance?: boolean;
  insuranceCost?: number;

  // History
  createdAt?: string;
  lastShipment?: string;
  totalRevenue?: number;

  // Additional fields
  is_active?: boolean;
  notes?: string;
  store_id?: string;
}

export interface ShipmentTracking {
  id: string;
  orderId: string;
  carrierId: string;
  trackingNumber: string;
  status: 'pending' | 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'failed';
  estimatedDelivery: string;
  actualDelivery?: string;
  origin: string;
  destination: string;
  events: {
    timestamp: string;
    status: string;
    location: string;
    notes?: string;
  }[];
}

export interface CarrierStats {
  totalShipments: number;
  avgDeliveryRate: number;
  avgCostPerShipment: number;
  avgDeliveryTime: number;
}
