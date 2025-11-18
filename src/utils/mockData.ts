import { DashboardOverview, Order, Product, Ad, AdditionalValue, Integration, Supplier, ChartData } from '@/types';

export const dashboardOverview: DashboardOverview = {
  totalOrders: 1234,
  revenue: 45680,
  costs: 18500,
  marketing: 8200,
  netProfit: 18980,
  profitMargin: 41.5,
  roi: 2.3,
  deliveryRate: 87.5,
};

export const orders: Order[] = [
  {
    id: 'ORD-001',
    customer: 'María González',
    product: 'Reloj Inteligente Pro',
    quantity: 1,
    total: 299,
    status: 'confirmed',
    carrier: 'Servientrega',
    date: '2025-01-15',
    phone: '+57 300 123 4567',
    confirmedByWhatsApp: true,
    confirmationTimestamp: '2025-01-15T09:30:00',
    confirmationMethod: 'whatsapp',
  },
  {
    id: 'ORD-002',
    customer: 'Carlos Rodríguez',
    product: 'Audífonos Bluetooth',
    quantity: 2,
    total: 158,
    status: 'in_transit',
    carrier: 'Coordinadora',
    date: '2025-01-14',
    phone: '+57 310 987 6543',
    confirmedByWhatsApp: true,
    confirmationTimestamp: '2025-01-14T10:15:00',
    confirmationMethod: 'phone',
  },
  {
    id: 'ORD-003',
    customer: 'Ana Martínez',
    product: 'Cámara HD 4K',
    quantity: 1,
    total: 450,
    status: 'delivered',
    carrier: 'Deprisa',
    date: '2025-01-13',
    phone: '+57 320 555 8888',
    confirmedByWhatsApp: true,
    confirmationTimestamp: '2025-01-13T11:45:00',
    confirmationMethod: 'whatsapp',
  },
];

export const products: Product[] = [
  {
    id: 'PROD-001',
    name: 'Reloj Inteligente Pro',
    image: '/placeholder.svg',
    stock: 45,
    price: 299,
    cost: 150,
    profitability: 49.8,
    sales: 156,
  },
  {
    id: 'PROD-002',
    name: 'Audífonos Bluetooth',
    image: '/placeholder.svg',
    stock: 78,
    price: 79,
    cost: 35,
    profitability: 55.7,
    sales: 203,
  },
  {
    id: 'PROD-003',
    name: 'Cámara HD 4K',
    image: '/placeholder.svg',
    stock: 23,
    price: 450,
    cost: 220,
    profitability: 51.1,
    sales: 89,
  },
];

export const ads: Ad[] = [
  {
    id: 'AD-001',
    platform: 'Facebook',
    campaign: 'Relojes Verano 2025',
    spend: 1200,
    clicks: 4500,
    conversions: 145,
    roas: 3.2,
    status: 'active',
    startDate: '2025-01-01',
  },
  {
    id: 'AD-002',
    platform: 'Instagram',
    campaign: 'Audífonos Premium',
    spend: 850,
    clicks: 3200,
    conversions: 98,
    roas: 2.8,
    status: 'active',
    startDate: '2025-01-05',
  },
];

export const additionalValues: AdditionalValue[] = [
  {
    id: 'VAL-001',
    category: 'marketing',
    description: 'Influencer marketing - Instagram',
    amount: 500,
    date: '2025-01-10',
    type: 'expense',
  },
  {
    id: 'VAL-002',
    category: 'operational',
    description: 'Alquiler oficina',
    amount: 800,
    date: '2025-01-01',
    type: 'expense',
  },
];

export const integrations: Integration[] = [
  {
    id: 'INT-001',
    name: 'WhatsApp Business',
    category: 'general',
    icon: 'MessageCircle',
    description: 'Automatiza confirmaciones por WhatsApp',
    status: 'connected',
  },
  {
    id: 'INT-002',
    name: 'Facebook Ads',
    category: 'marketing',
    icon: 'Facebook',
    description: 'Sincroniza campañas publicitarias',
    status: 'available',
  },
  {
    id: 'INT-003',
    name: 'Shopify',
    category: 'store',
    icon: 'ShoppingBag',
    description: 'Conecta tu tienda Shopify',
    status: 'available',
  },
];

export const suppliers: Supplier[] = [
  {
    id: 'SUP-001',
    name: 'TechSupply LATAM',
    contact: 'Juan Pérez',
    email: 'juan@techsupply.com',
    phone: '+57 300 111 2222',
    rating: 4.5,
    productsSupplied: 12,
    lastOrder: '2025-01-10',
  },
  {
    id: 'SUP-002',
    name: 'Electronics Wholesale',
    contact: 'Laura Silva',
    email: 'laura@electronics.com',
    phone: '+57 310 333 4444',
    rating: 4.8,
    productsSupplied: 8,
    lastOrder: '2025-01-08',
  },
];

export const chartData: ChartData[] = [
  { date: '2025-01-01', revenue: 3200, costs: 1400, marketing: 600, profit: 1200 },
  { date: '2025-01-02', revenue: 2800, costs: 1200, marketing: 550, profit: 1050 },
  { date: '2025-01-03', revenue: 4100, costs: 1800, marketing: 700, profit: 1600 },
  { date: '2025-01-04', revenue: 3500, costs: 1500, marketing: 650, profit: 1350 },
  { date: '2025-01-05', revenue: 4500, costs: 2000, marketing: 800, profit: 1700 },
  { date: '2025-01-06', revenue: 3900, costs: 1700, marketing: 720, profit: 1480 },
  { date: '2025-01-07', revenue: 5200, costs: 2300, marketing: 900, profit: 2000 },
];

export function calculateConfirmationMetrics() {
  const totalOrders = orders.length;
  const confirmedOrders = orders.filter(o => o.confirmedByWhatsApp).length;
  const pendingOrders = orders.filter(o => o.status === 'pending' && !o.confirmedByWhatsApp).length;
  
  const today = new Date().toDateString();
  const todayConfirmed = orders.filter(
    o => o.confirmedByWhatsApp && new Date(o.date).toDateString() === today
  ).length;
  const todayPending = orders.filter(
    o => o.status === 'pending' && !o.confirmedByWhatsApp && new Date(o.date).toDateString() === today
  ).length;
  
  return {
    totalPending: pendingOrders,
    totalConfirmed: confirmedOrders,
    confirmationRate: (confirmedOrders / totalOrders) * 100,
    avgConfirmationTime: 2.5, // horas (simulado)
    confirmationsToday: todayConfirmed,
    pendingToday: todayPending,
  };
}
