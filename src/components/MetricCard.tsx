import { ArrowUp, ArrowDown } from 'lucide-react';
import { Card } from './ui/card';
import { cn } from '@/lib/utils';
import { MetricCardProps } from '@/types';

export function MetricCard({
  title,
  value,
  change,
  trend,
  icon,
  variant = 'default',
  onClick,
}: MetricCardProps) {
  // Extract numeric value to check if it's zero
  const numericValue = typeof value === 'number'
    ? value
    : parseFloat(String(value).replace(/[^0-9.-]/g, '')) || 0;

  // Only show percentage indicator if:
  // 1. change is defined and not null (null means no previous data to compare)
  // 2. trend is defined
  // 3. The metric value is not zero
  const shouldShowChange = change !== undefined && change !== null && trend !== undefined && numericValue !== 0;

  return (
    <Card
      className={cn(
        "p-6 bg-card border border-border hover:shadow-elegant transition-all duration-200",
        onClick && "cursor-pointer hover:scale-105"
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="p-2.5 rounded-lg bg-primary/10">
          {icon}
        </div>
        {shouldShowChange && (
          <span
            className={cn(
              'flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full',
              trend === 'up'
                ? 'text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-950/20'
                : 'text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-950/20'
            )}
          >
            {trend === 'up' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {Math.abs(change)}%
          </span>
        )}
      </div>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
        {title}
      </p>
      <p className="text-3xl font-bold text-card-foreground">{value}</p>
    </Card>
  );
}
