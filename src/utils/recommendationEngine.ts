import { Recommendation, Product, Ad, DashboardOverview } from '@/types';
import type { Carrier } from '@/services/carriers.service';

interface RecommendationEngineData {
  products: Product[];
  ads: Ad[];
  overview: DashboardOverview;
  carriers: Carrier[];
}

export interface RevenueProjection {
  shouldShow: boolean;
  projectedRevenue: number;
  currentRevenue: number;
  growthRate: number;
  daysAnalyzed: number;
}

export function generateRecommendations(data: RecommendationEngineData): Recommendation[] {
  const { products, ads, overview, carriers } = data;
  const recommendations: Recommendation[] = [];

  if (ads.length === 0 || products.length === 0) return recommendations;
  
  // Analizar ROAS por plataforma
  const sortedAds = [...ads].sort((a, b) => b.roas - a.roas);
  const bestPlatform = sortedAds[0];
  const worstPlatform = sortedAds[sortedAds.length - 1];
  
  if (bestPlatform.roas > worstPlatform.roas * 2) {
    recommendations.push({
      id: 'reallocate-budget',
      type: 'marketing',
      title: 'Reasignar presupuesto publicitario',
      description: `${bestPlatform.platform} tiene un ROAS de ${bestPlatform.roas}x mientras que ${worstPlatform.platform} solo ${worstPlatform.roas}x. Considera reasignar presupuesto.`,
      impact: `+ Gs. ${((worstPlatform.investment * 0.3) * (bestPlatform.roas - worstPlatform.roas)).toLocaleString()}/mes`,
      actionLabel: 'Ver anuncios',
      actionUrl: '/ads',
    });
  }
  
  // Analizar márgenes de productos
  const sortedProducts = [...products].sort((a, b) => b.profitability - a.profitability);
  const lowMarginProducts = sortedProducts.filter(p => p.profitability < 30);
  
  if (lowMarginProducts.length > 0) {
    recommendations.push({
      id: 'increase-prices',
      type: 'pricing',
      title: 'Ajustar precios de productos de bajo margen',
      description: `${lowMarginProducts.length} productos tienen margen inferior al 30%. Un aumento del 15% podría mejorar significativamente la rentabilidad.`,
      impact: `+ Gs. ${(lowMarginProducts.reduce((sum, p) => sum + (p.price * p.sales * 0.15), 0)).toLocaleString()}/mes`,
      actionLabel: 'Ver productos',
      actionUrl: '/products',
    });
  }
  
  // Analizar velocidad de ventas vs stock
  const fastMovers = products.filter(p => p.sales > 50 && p.stock < 20);
  if (fastMovers.length > 0) {
    recommendations.push({
      id: 'increase-inventory',
      type: 'inventory',
      title: 'Aumentar inventario de productos populares',
      description: `${fastMovers.length} productos de alta rotación tienen stock bajo. Aumentar el inventario puede incrementar las ventas.`,
      impact: `+ ${fastMovers.length * 10} ventas potenciales/mes`,
      actionLabel: 'Ver productos',
      actionUrl: '/products',
    });
  }
  
  // Analizar transportadoras
  const topCarriers = carriers
    .filter(c => c.status === 'active')
    .sort((a, b) => (b.delivery_rate || 0) - (a.delivery_rate || 0))
    .slice(0, 3);

  if (topCarriers.length === 0) return recommendations;

  const avgTopRate = topCarriers.reduce((sum, c) => sum + (c.delivery_rate || 0), 0) / topCarriers.length;
  const allAvgRate = carriers.reduce((sum, c) => sum + (c.delivery_rate || 0), 0) / carriers.length;
  
  if (avgTopRate > allAvgRate + 10) {
    recommendations.push({
      id: 'optimize-carriers',
      type: 'carrier',
      title: 'Priorizar transportadoras de alto rendimiento',
      description: `Las 3 mejores transportadoras tienen ${avgTopRate.toFixed(1)}% de tasa de entrega vs ${allAvgRate.toFixed(1)}% promedio. Prioriza su uso.`,
      impact: `+ ${((avgTopRate - allAvgRate) * 0.5).toFixed(1)}% entregas exitosas`,
      actionLabel: 'Ver transportadoras',
      actionUrl: '/carriers',
    });
  }
  
  return recommendations.slice(0, 5);
}

/**
 * Calculates revenue projection for next 30 days based on growth trend
 * Only shows projection if there's notable growth (≥10%)
 */
export function calculateRevenueProjection(overview: DashboardOverview): RevenueProjection {
  const currentRevenue = overview.revenue;
  const revenueChange = overview.changes?.revenue;

  // Don't show if no comparison data available
  if (revenueChange === null || revenueChange === undefined) {
    return {
      shouldShow: false,
      projectedRevenue: 0,
      currentRevenue,
      growthRate: 0,
      daysAnalyzed: 7,
    };
  }

  const growthRate = revenueChange;

  // Only show if growth is notable (≥10%)
  const MINIMUM_GROWTH_THRESHOLD = 10;
  if (growthRate < MINIMUM_GROWTH_THRESHOLD) {
    return {
      shouldShow: false,
      projectedRevenue: 0,
      currentRevenue,
      growthRate,
      daysAnalyzed: 7,
    };
  }

  // Calculate daily average revenue from current period (last 7 days)
  const avgDailyRevenue = currentRevenue / 7;

  // Project to 30 days assuming current pace continues
  const projectedRevenue = avgDailyRevenue * 30;

  return {
    shouldShow: true,
    projectedRevenue,
    currentRevenue,
    growthRate,
    daysAnalyzed: 7,
  };
}
