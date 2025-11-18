export const COUNTRIES = [
  { value: 'PY', label: 'Paraguay' },
  { value: 'AR', label: 'Argentina' },
  { value: 'BR', label: 'Brasil' },
  { value: 'UY', label: 'Uruguay' },
  { value: 'CL', label: 'Chile' },
  { value: 'BO', label: 'Bolivia' },
  { value: 'PE', label: 'Perú' },
  { value: 'CO', label: 'Colombia' },
  { value: 'MX', label: 'México' },
];

export const CURRENCIES = [
  { value: 'PYG', label: 'Guaraní', symbol: 'Gs.' },
  { value: 'USD', label: 'Dólar', symbol: '$' },
  { value: 'BRL', label: 'Real', symbol: 'R$' },
  { value: 'ARS', label: 'Peso Argentino', symbol: 'AR$' },
  { value: 'CLP', label: 'Peso Chileno', symbol: 'CLP$' },
  { value: 'UYU', label: 'Peso Uruguayo', symbol: 'UY$' },
];

export const ORDER_STATUSES = [
  { value: 'pending', label: 'Pendiente', color: 'bg-yellow-500/20 text-yellow-700 border-yellow-500/30' },
  { value: 'confirmed', label: 'Confirmado', color: 'bg-blue-500/20 text-blue-700 border-blue-500/30' },
  { value: 'in_transit', label: 'En Tránsito', color: 'bg-purple-500/20 text-purple-700 border-purple-500/30' },
  { value: 'delivered', label: 'Entregado', color: 'bg-primary/20 text-primary border-primary/30' },
  { value: 'cancelled', label: 'Cancelado', color: 'bg-red-500/20 text-red-700 border-red-500/30' },
];

export const SUBSCRIPTION_PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    currency: 'USD',
    interval: 'month',
    features: [
      '100 pedidos/mes',
      '1 usuario',
      'Integraciones básicas',
      'Dashboard básico',
      'Soporte por email',
    ],
    limitations: [
      'Sin confirmación automática COD',
      'Sin API access',
      'Sin reportes avanzados',
    ],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: 49,
    currency: 'USD',
    interval: 'month',
    popular: false,
    features: [
      '500 pedidos/mes',
      '3 usuarios',
      'Todas las integraciones',
      'Confirmación automática COD',
      'Dashboard avanzado',
      'Reportes básicos',
      'Soporte prioritario',
    ],
    limitations: [
      'Sin API access',
      'Sin white-label',
    ],
  },
  {
    id: 'growth',
    name: 'Growth',
    price: 149,
    currency: 'USD',
    interval: 'month',
    popular: true,
    features: [
      'Pedidos ilimitados',
      'Usuarios ilimitados',
      'Todas las integraciones',
      'Confirmación automática COD con IA',
      'Dashboard avanzado',
      'Reportes avanzados',
      'API access completo',
      'Webhooks',
      'Soporte prioritario 24/7',
      'Recomendaciones con IA',
    ],
    limitations: [],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: null,
    currency: 'USD',
    interval: 'month',
    popular: false,
    features: [
      'Todo de Growth',
      'White-label',
      'Multi-tienda',
      'SLA garantizado',
      'Gerente de cuenta dedicado',
      'Capacitación personalizada',
      'Integración custom',
    ],
    limitations: [],
  },
];

export const AD_PLATFORMS = [
  { value: 'facebook', label: 'Facebook Ads' },
  { value: 'google', label: 'Google Ads' },
  { value: 'instagram', label: 'Instagram Ads' },
  { value: 'tiktok', label: 'TikTok Ads' },
  { value: 'twitter', label: 'Twitter Ads' },
];

export const ADDITIONAL_VALUE_CATEGORIES = [
  { value: 'marketing', label: 'Marketing' },
  { value: 'sales', label: 'Ventas' },
  { value: 'employees', label: 'Empleados' },
  { value: 'operational', label: 'Operacional' },
];

export const ADDITIONAL_VALUE_TYPES = [
  { value: 'expense', label: 'Gasto' },
  { value: 'income', label: 'Ingreso' },
];
