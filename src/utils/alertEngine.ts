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

  // ✅ CORREGIDO: Analizar tasa de confirmación usando confirmedByWhatsApp
  const confirmedOrders = orders.filter(o => o.confirmedByWhatsApp === true);
  const confirmationRate = (confirmedOrders.length / orders.length) * 100;

  if (confirmationRate < 50 && orders.length > 10) {
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

  // ✅ CORREGIDO: Analizar ROI real (no proyectado) con threshold realista para LATAM COD
  // ROI típico en e-commerce COD en LATAM: 120% - 150% es aceptable (anteriormente 1.2x - 1.5x)
  const realRoi = overview.realRoi || overview.roi;
  if (realRoi < 120 && overview.totalOrders > 20) {
    alerts.push({
      id: 'low-roi',
      severity: 'warning',
      title: 'ROI por debajo del objetivo',
      description: `El ROI real es ${realRoi.toFixed(1)}%. El objetivo mínimo es 120% para mantener rentabilidad.`,
      actionUrl: '/ads',
      actionLabel: 'Revisar campañas',
      timestamp: new Date().toISOString(),
      dismissed: false,
    });
  }

  // ✅ ELIMINADO: Alerta de stock bajo desde orders (no tiene sentido)
  // El stock se debe analizar desde la tabla de productos directamente

  // ✅ CORREGIDO: Analizar transportadoras con threshold realista para COD
  // En COD, una tasa de entrega del 70% es considerada aceptable en LATAM
  const poorPerformers = carriers.filter(c =>
    (c.delivery_rate || 0) < 70 &&
    (c.total_deliveries || c.totalShipments || 0) > 10 // Solo si tiene suficientes entregas
  );
  if (poorPerformers.length > 0) {
    alerts.push({
      id: 'poor-carriers',
      severity: 'warning',
      title: 'Transportadoras con bajo rendimiento',
      description: `${poorPerformers.length} transportadoras tienen tasa de entrega inferior al 70%.`,
      actionUrl: '/carriers',
      actionLabel: 'Ver transportadoras',
      timestamp: new Date().toISOString(),
      dismissed: false,
    });
  }

  // ✅ NUEVO: Analizar margen neto bajo (crítico para la salud del negocio)
  const netMargin = overview.realNetMargin || overview.netMargin;
  if (netMargin < 15 && overview.totalOrders > 20) {
    alerts.push({
      id: 'low-net-margin',
      severity: 'critical',
      title: 'Margen neto muy bajo',
      description: `El margen neto es ${netMargin.toFixed(1)}%. Se recomienda mantenerlo por encima del 15% para rentabilidad sostenible.`,
      actionUrl: '/dashboard',
      actionLabel: 'Ver métricas',
      timestamp: new Date().toISOString(),
      dismissed: false,
    });
  }

  return alerts;
}
