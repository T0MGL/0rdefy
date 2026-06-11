import { ArrowUp, ArrowDown, AlertCircle } from 'lucide-react';
import { Card } from './ui/card';
import { Skeleton } from './ui/skeleton';
import { cn } from '@/lib/utils';
import { MetricCardProps } from '@/types';

/**
 * Locale-agnostic zero check for a rendered metric value.
 *
 * The previous implementation parsed "Gs. 1.234.567" with parseFloat and read
 * it as 1.234, so real amounts could be misclassified. We only need to know
 * whether the metric is zero, and that is true exactly when the string
 * contains digits and every digit is "0" ("Gs. 0", "0%", "0,00").
 */
function isRenderedValueZero(value: string | number): boolean {
  if (typeof value === 'number') return value === 0;
  const digits = String(value).replace(/[^0-9]/g, '');
  if (digits === '') return false;
  return /^0+$/.test(digits);
}

export function MetricCard({
  title,
  value,
  change,
  trend,
  icon,
  variant = 'default',
  subtitle,
  onClick,
  dense = false,
  state = 'ok',
}: MetricCardProps) {
  // Only show percentage indicator if:
  // 1. change is defined and not null (null means no previous data to compare)
  // 2. trend is defined
  // 3. The metric value is not zero
  const shouldShowChange =
    state === 'ok' &&
    change !== undefined &&
    change !== null &&
    trend !== undefined &&
    !isRenderedValueZero(value);

  const renderValue = () => {
    if (state === 'loading') {
      return <Skeleton className={cn('w-24', dense ? 'h-7' : 'h-9')} data-testid="metric-skeleton" />;
    }
    if (state === 'error') {
      return (
        <span className="flex items-center gap-1.5 text-base font-medium text-red-600 dark:text-red-400">
          <AlertCircle size={16} />
          Error al cargar
        </span>
      );
    }
    if (state === 'no-data') {
      return <span className="text-base font-medium text-muted-foreground">Sin datos</span>;
    }
    return (
      <p
        className={cn(
          'font-bold text-card-foreground tabular-nums whitespace-nowrap overflow-hidden text-ellipsis',
          dense ? 'text-2xl xl:text-base 2xl:text-lg' : 'text-3xl'
        )}
        title={typeof value === 'string' || typeof value === 'number' ? String(value) : undefined}
      >
        {value}
      </p>
    );
  };

  return (
    <Card
      className={cn(
        "bg-card border border-border hover:shadow-elegant transition-all duration-200",
        dense ? "p-5" : "p-6",
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
                ? 'text-primary bg-primary/5 dark:text-primary dark:bg-primary/20'
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
      {renderValue()}
      {state === 'ok' && subtitle && (
        <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
      )}
    </Card>
  );
}
