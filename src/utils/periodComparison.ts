import { ChartData } from '@/types';

export type PeriodType = 'today-yesterday' | 'week-lastweek' | 'month-lastmonth' | 'custom';

export interface PeriodComparison {
  current: {
    revenue: number;
    costs: number;
    profit: number;
    orders: number;
  };
  previous: {
    revenue: number;
    costs: number;
    profit: number;
    orders: number;
  };
  changes: {
    revenue: number;
    costs: number;
    profit: number;
    orders: number;
  };
}

export function calculatePeriodComparison(
  data: ChartData[],
  period: PeriodType
): PeriodComparison {
  // Simulación de datos para diferentes períodos
  const splitPoint = Math.floor(data.length / 2);
  const currentPeriod = data.slice(splitPoint);
  const previousPeriod = data.slice(0, splitPoint);
  
  const sumPeriod = (period: ChartData[]) => ({
    revenue: period.reduce((sum, d) => sum + d.revenue, 0),
    costs: period.reduce((sum, d) => sum + d.costs, 0),
    profit: period.reduce((sum, d) => sum + d.profit, 0),
    orders: period.length * 10, // Simulación
  });
  
  const current = sumPeriod(currentPeriod);
  const previous = sumPeriod(previousPeriod);
  
  const calculateChange = (curr: number, prev: number) => 
    prev === 0 ? 0 : ((curr - prev) / prev) * 100;
  
  return {
    current,
    previous,
    changes: {
      revenue: calculateChange(current.revenue, previous.revenue),
      costs: calculateChange(current.costs, previous.costs),
      profit: calculateChange(current.profit, previous.profit),
      orders: calculateChange(current.orders, previous.orders),
    },
  };
}

export function getComparisonChartData(
  data: ChartData[],
  period: PeriodType
): { current: ChartData[]; previous: ChartData[] } {
  const splitPoint = Math.floor(data.length / 2);
  
  return {
    current: data.slice(splitPoint),
    previous: data.slice(0, splitPoint).map((d, i) => ({
      ...d,
      date: data[splitPoint + i]?.date || d.date,
    })),
  };
}
