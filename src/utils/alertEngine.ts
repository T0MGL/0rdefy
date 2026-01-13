import { Alert, Order, DashboardOverview } from '@/types';
import type { Carrier } from '@/services/carriers.service';

interface AlertEngineData {
  orders: Order[];
  overview: DashboardOverview;
  carriers: Carrier[];
}

/**
 * Safely get a numeric value, returning 0 if null/undefined/NaN
 */
function safeNumber(value: number | null | undefined): number {
  if (value === null || value === undefined || isNaN(value)) {
    return 0;
  }
  return value;
}

/**
 * Check if we have sufficient data to generate meaningful alerts
 */
function hasValidOverviewData(overview: DashboardOverview | null | undefined): boolean {
  if (!overview) return false;
  // At minimum we need totalOrders to be a valid number
  return typeof overview.totalOrders === 'number' && !isNaN(overview.totalOrders);
}

export function generateAlerts(data: AlertEngineData): Alert[] {
  const { orders, overview, carriers } = data;
  const alerts: Alert[] = [];

  // Guard against null/undefined data
  if (!orders || orders.length === 0) return alerts;
  if (!hasValidOverviewData(overview)) return alerts;

  // ✅ Analizar tasa de confirmación usando confirmedByWhatsApp
  const confirmedOrders = orders.filter(o => o.confirmedByWhatsApp === true);
  const confirmationRate = (confirmedOrders.length / orders.length) * 100;

  if (confirmationRate < 50 && orders.length > 10) {
    alerts.push({
      id: 'low-confirmation',
      severity: 'critical',
      title: 'Tasa de confirmación baja',
      description: `Solo el ${confirmationRate.toFixed(1)}% de los pedidos están confirmados. Esto puede afectar las entregas.`,
      actionUrl: '/orders?filter=pending',
      actionLabel: 'Ver pedidos pendientes',
      timestamp: new Date().toISOString(),
      dismissed: false,
    });
  }

  // ✅ Analizar ROI real (no proyectado) con threshold realista para LATAM COD
  // Only generate ROI alert if we have actual campaign data (ROI > 0 means campaigns exist)
  const realRoi = safeNumber(overview.realRoi) || safeNumber(overview.roi);
  if (realRoi > 0 && realRoi < 120 && overview.totalOrders > 20) {
    alerts.push({
      id: 'low-roi',
      severity: 'warning',
      title: 'ROI por debajo del objetivo',
      description: `El ROI real es ${realRoi.toFixed(1)}%. El objetivo mínimo es 120% para mantener rentabilidad.`,
      actionUrl: '/dashboard', // Ads page is placeholder
      actionLabel: 'Ver métricas',
      timestamp: new Date().toISOString(),
      dismissed: false,
    });
  }

  // ✅ Analizar transportadoras con threshold realista para COD
  // Only process if carriers array exists and has data
  if (carriers && carriers.length > 0) {
    const poorPerformers = carriers.filter(c => {
      const deliveryRate = safeNumber(c.delivery_rate);
      const totalDeliveries = safeNumber(c.total_deliveries) || safeNumber(c.totalShipments);
      return deliveryRate < 70 && totalDeliveries > 10;
    });

    if (poorPerformers.length > 0) {
      alerts.push({
        id: 'poor-carriers',
        severity: 'warning',
        title: 'Transportadoras con bajo rendimiento',
        description: `${poorPerformers.length} transportadora${poorPerformers.length > 1 ? 's tienen' : ' tiene'} tasa de entrega inferior al 70%.`,
        actionUrl: '/carriers?filter=poor-performance',
        actionLabel: 'Ver transportadoras',
        timestamp: new Date().toISOString(),
        dismissed: false,
      });
    }
  }

  // ✅ Analizar margen neto bajo (crítico para la salud del negocio)
  // Only generate if we have valid margin data (not 0, which could be default)
  const netMargin = safeNumber(overview.realNetMargin) || safeNumber(overview.netMargin);
  const hasMarginData = (overview.realNetMargin !== undefined && overview.realNetMargin !== null) ||
                        (overview.netMargin !== undefined && overview.netMargin !== null);

  if (hasMarginData && netMargin < 15 && netMargin > -100 && overview.totalOrders > 20) {
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

  // ✅ NEW: Alert for orders pending too long (>48h without confirmation)
  const now = new Date();
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const veryOldPending = orders.filter(o => {
    if (o.status !== 'pending') return false;
    const orderDate = new Date(o.date);
    return orderDate < fortyEightHoursAgo;
  });

  if (veryOldPending.length > 5) {
    alerts.push({
      id: 'very-old-pending',
      severity: 'critical',
      title: 'Pedidos sin procesar por más de 48h',
      description: `${veryOldPending.length} pedidos llevan más de 48 horas pendientes. Esto puede resultar en cancelaciones.`,
      actionUrl: '/orders?filter=pending',
      actionLabel: 'Procesar pedidos',
      timestamp: new Date().toISOString(),
      dismissed: false,
    });
  }

  return alerts;
}
