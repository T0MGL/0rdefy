import { Alert, Order, DashboardOverview } from '@/types';
import type { Carrier } from '@/services/carriers.service';

interface AlertEngineData {
  orders: Order[];
  overview: DashboardOverview;
  carriers: Carrier[];
}

export function generateAlerts(data: AlertEngineData): Alert[] {
  const { orders, overview, carriers } = data;
  const alerts: Alert[] = [];

  if (orders.length === 0) return alerts;

  // Analizar tasa de confirmación
  const pendingOrders = orders.filter(o => o.status === 'pending');
  const confirmedOrders = orders.filter(o => o.confirmedByWhatsApp);
  const confirmationRate = (confirmedOrders.length / orders.length) * 100;
  
  if (confirmationRate < 50) {
    alerts.push({
      id: 'low-confirmation',
      severity: 'critical',
      title: 'Tasa de confirmación baja',
      description: `Solo el ${confirmationRate.toFixed(1)}% de los pedidos están confirmados. Esto puede afectar las entregas.`,
      actionUrl: '/orders',
      actionLabel: 'Ver pedidos pendientes',
      timestamp: new Date().toISOString(),
      dismissed: false,
    });
  }
  
  // Analizar ROAS
  if (overview.roi < 2) {
    alerts.push({
      id: 'low-roi',
      severity: 'warning',
      title: 'ROI por debajo del objetivo',
      description: `El ROI actual es ${overview.roi}x. El objetivo es mantenerlo por encima de 2x.`,
      actionUrl: '/ads',
      actionLabel: 'Revisar campañas',
      timestamp: new Date().toISOString(),
      dismissed: false,
    });
  }
  
  // Analizar stock crítico
  const lowStockProducts = orders.filter(o => o.quantity < 5);
  if (lowStockProducts.length > 0) {
    alerts.push({
      id: 'low-stock',
      severity: 'warning',
      title: 'Productos con stock bajo',
      description: `${lowStockProducts.length} productos tienen menos de 5 unidades en stock.`,
      actionUrl: '/products',
      actionLabel: 'Ver productos',
      timestamp: new Date().toISOString(),
      dismissed: false,
    });
  }
  
  // Analizar transportadoras
  const poorPerformers = carriers.filter(c => (c.delivery_rate || 0) < 75);
  if (poorPerformers.length > 0) {
    alerts.push({
      id: 'poor-carriers',
      severity: 'warning',
      title: 'Transportadoras con bajo rendimiento',
      description: `${poorPerformers.length} transportadoras tienen tasa de entrega inferior al 75%.`,
      actionUrl: '/carriers',
      actionLabel: 'Ver transportadoras',
      timestamp: new Date().toISOString(),
      dismissed: false,
    });
  }
  
  return alerts;
}
