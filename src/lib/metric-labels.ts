/**
 * Canonical metric labels.
 *
 * Single source of truth for the Spanish copy that surfaces every
 * KPI shown in the merchant-facing dashboards. The metrics-integrity
 * audit (outputs/ordefy/metrics-audit-2026-05-09.md) found that the
 * same concept ("Real revenue / pedidos entregados") was rendered with
 * three different labels across Dashboard, DashboardLogistics, and
 * the Wrapped page. Centralizing the strings here forces every surface
 * that reuses a metric to read it the same way.
 *
 * Conventions:
 *   - Spanish accents are mandatory. "Confirmación" not "Confirmacion",
 *     "Devolución" not "Devolucion", "Envíos" not "Envios". The DB layer
 *     is allowed to omit accents but the UI layer always restores them.
 *   - Every entry has both a `title` (used as a card heading) and a
 *     `subtitle` (used as supporting copy). The subtitle explains the
 *     denominator or the timezone scope so a non-technical merchant can
 *     understand what they are looking at without opening a tooltip.
 *   - The keys mirror the canonical metric IDs from
 *     api/utils/metrics-canonical.ts. New metrics must be added to BOTH
 *     files (the formula in api/utils, the label here).
 *   - Absolutely no em dash or double hyphen, per project rule.
 */

export type MetricKey =
  | 'revenueReal'
  | 'revenueProjected'
  | 'revenueInTransit'
  | 'revenueTotal'
  | 'deliveryRate'
  | 'grossProfitReal'
  | 'netProfit'
  | 'adSpend'
  | 'taxCollected'
  | 'averageOrderValue'
  | 'cancellationRate'
  | 'confirmationRate'
  | 'shippingCost'
  | 'cogs'
  | 'roas'
  | 'cashFlow'
  | 'pendingSettlements'
  | 'returnRate'
  | 'confirmationFee'
  | 'pendingCash'
  | 'collectedCash'
  | 'inDeliveryOrders'
  | 'failedDeliveryRate'
  | 'doorRejectionRate'
  | 'avgConfirmationTime'
  | 'avgDeliveryTime'
  | 'totalCustomers'
  | 'returningCustomers'
  | 'customerLifetimeValue'
  | 'customerOrders';

export interface MetricLabel {
  readonly title: string;
  readonly subtitle?: string;
}

export const metricLabels: Record<MetricKey, MetricLabel> = {
  revenueReal: {
    title: 'Ingresos Reales',
    subtitle: 'Solo pedidos entregados',
  },
  revenueProjected: {
    title: 'Ingresos Proyectados',
    subtitle: 'Entregados + en tránsito',
  },
  revenueInTransit: {
    title: 'Ingresos En Tránsito',
    subtitle: 'Pedidos despachados sin entregar',
  },
  revenueTotal: {
    title: 'Ingresos Totales',
    subtitle: 'Todos los pedidos del periodo',
  },
  deliveryRate: {
    title: 'Tasa de Entrega',
    subtitle: 'Entregados sobre despachados',
  },
  grossProfitReal: {
    title: 'Beneficio Bruto Real',
    subtitle: 'Ingresos reales menos COGS',
  },
  netProfit: {
    title: 'Beneficio Neto',
    subtitle: 'Bruto menos envío y publicidad',
  },
  adSpend: {
    title: 'Gasto Publicitario',
    subtitle: 'Inversión en anuncios del periodo',
  },
  taxCollected: {
    title: 'IVA Recaudado',
    subtitle: 'Sobre pedidos entregados',
  },
  averageOrderValue: {
    title: 'Ticket Promedio',
    subtitle: 'Valor medio por pedido',
  },
  cancellationRate: {
    title: 'Tasa de Cancelación',
    subtitle: 'Cancelados y rechazados',
  },
  confirmationRate: {
    title: 'Tasa de Confirmación',
    subtitle: 'Confirmados sobre total',
  },
  shippingCost: {
    title: 'Costo de Envío',
    subtitle: 'Gasto pagado a transportistas',
  },
  cogs: {
    title: 'Costo de Productos',
    subtitle: 'Sobre pedidos entregados',
  },
  roas: {
    title: 'ROAS',
    subtitle: 'Retorno sobre gasto publicitario',
  },
  cashFlow: {
    title: 'Flujo de Caja',
    subtitle: 'Ingresos menos egresos',
  },
  pendingSettlements: {
    title: 'Liquidaciones Pendientes',
    subtitle: 'Por cobrar a transportistas',
  },
  returnRate: {
    title: 'Tasa de Devolución',
    subtitle: 'Devueltos sobre entregados',
  },
  confirmationFee: {
    title: 'Cargo por Confirmación',
    subtitle: 'Ingresos por validación de pedidos',
  },
  pendingCash: {
    title: 'Caja Pendiente',
    subtitle: 'Por cobrar al transportista',
  },
  collectedCash: {
    title: 'Cobrado Hoy',
    subtitle: 'Reconciliado del día',
  },
  inDeliveryOrders: {
    title: 'Pedidos En Entrega',
    subtitle: 'Despachados con pago pendiente',
  },
  failedDeliveryRate: {
    title: 'Tasa de Fallos',
    subtitle: 'No entregados sobre despachados',
  },
  doorRejectionRate: {
    title: 'Rechazos en Puerta',
    subtitle: 'Sobre intentos de entrega',
  },
  avgConfirmationTime: {
    title: 'Tiempo Prom. Confirmación',
    subtitle: 'Desde creación hasta confirmación',
  },
  avgDeliveryTime: {
    title: 'Tiempo Prom. Entrega',
    subtitle: 'Desde creación hasta entrega',
  },
  totalCustomers: {
    title: 'Total Clientes',
    subtitle: 'Únicos en el periodo',
  },
  returningCustomers: {
    title: 'Clientes Recurrentes',
    subtitle: 'Más de un pedido',
  },
  customerLifetimeValue: {
    title: 'Valor de Vida',
    subtitle: 'Promedio por cliente',
  },
  customerOrders: {
    title: 'Pedidos Promedio',
    subtitle: 'Por cliente',
  },
};

/**
 * Resolve a metric label or fall back to the raw key. Use when the
 * metric ID is dynamic (e.g. drilldown views that build their cards
 * from API response keys).
 */
export function getMetricLabel(key: string): MetricLabel {
  if (key in metricLabels) {
    return metricLabels[key as MetricKey];
  }
  return { title: key };
}
