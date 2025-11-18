import { DashboardOverview, Product } from '@/types';

export interface HealthScore {
  score: number;
  status: 'excellent' | 'good' | 'warning' | 'critical';
  issues: string[];
  suggestions: string[];
}

export function calculateBusinessHealth(overview: DashboardOverview, products: Product[]): HealthScore {
  let score = 100;
  const issues: string[] = [];
  const suggestions: string[] = [];

  // Evaluar tasa de entrega (peso: 25 puntos)
  if (overview.deliveryRate < 70) {
    score -= 25;
    issues.push('Tasa de entrega muy baja');
    suggestions.push('Revisa las transportadoras con mal desempeño');
  } else if (overview.deliveryRate < 85) {
    score -= 15;
    issues.push('Tasa de entrega mejorable');
    suggestions.push('Optimiza la selección de transportadoras');
  } else if (overview.deliveryRate < 95) {
    score -= 5;
  }

  // Evaluar margen de rentabilidad (peso: 25 puntos)
  if (overview.profitMargin < 20) {
    score -= 25;
    issues.push('Margen de rentabilidad muy bajo');
    suggestions.push('Reduce costos o aumenta precios');
  } else if (overview.profitMargin < 35) {
    score -= 15;
    issues.push('Margen de rentabilidad bajo');
    suggestions.push('Busca proveedores más económicos');
  } else if (overview.profitMargin < 45) {
    score -= 5;
  }

  // Evaluar ROI (peso: 25 puntos)
  if (overview.roi < 1.5) {
    score -= 25;
    issues.push('ROI muy bajo');
    suggestions.push('Reduce inversión en marketing poco efectivo');
  } else if (overview.roi < 2.0) {
    score -= 15;
    issues.push('ROI mejorable');
    suggestions.push('Optimiza campañas publicitarias');
  } else if (overview.roi < 2.5) {
    score -= 5;
  }

  // Evaluar stock (peso: 25 puntos)
  const lowStock = products.filter((p) => p.stock < 10).length;
  const totalProducts = products.length;
  const lowStockPercentage = (lowStock / totalProducts) * 100;

  if (lowStockPercentage > 50) {
    score -= 25;
    issues.push('Muchos productos con stock bajo');
    suggestions.push('Realiza pedidos urgentes a proveedores');
  } else if (lowStockPercentage > 30) {
    score -= 15;
    issues.push('Varios productos con stock bajo');
    suggestions.push('Planifica reposición de inventario');
  } else if (lowStockPercentage > 10) {
    score -= 5;
  }

  // Determinar estado
  let status: HealthScore['status'];
  if (score >= 90) status = 'excellent';
  else if (score >= 70) status = 'good';
  else if (score >= 50) status = 'warning';
  else status = 'critical';

  return {
    score: Math.max(0, score),
    status,
    issues,
    suggestions,
  };
}
