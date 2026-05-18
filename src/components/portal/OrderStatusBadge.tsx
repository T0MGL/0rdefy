/**
 * Status pill for the courier portal.
 *
 * Maps the (sometimes-internal) `sleeves_status` values onto a small set of
 * Spanish labels with semantic colors. Keeps the same visual language across
 * order cards, the detail view, and the today/history lists.
 */

import { cn } from '@/lib/utils';

const STATUS_MAP: Record<string, { label: string; tone: Tone }> = {
  ready_to_ship: { label: 'Listo', tone: 'sky' },
  shipped: { label: 'En tránsito', tone: 'amber' },
  in_transit: { label: 'En tránsito', tone: 'amber' },
  delivered: { label: 'Entregada', tone: 'green' },
  returned: { label: 'Devuelta', tone: 'slate' },
  incident: { label: 'Incidencia', tone: 'rose' },
  cancelled: { label: 'Cancelada', tone: 'slate' },
};

type Tone = 'sky' | 'amber' | 'green' | 'rose' | 'slate';

const TONE_CLASSES: Record<Tone, string> = {
  sky: 'bg-sky-50 text-sky-700 ring-sky-200/60 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/30',
  amber:
    'bg-amber-50 text-amber-700 ring-amber-200/60 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30',
  green: 'bg-primary/15 text-primary ring-primary/30',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200/60 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/30',
  slate:
    'bg-slate-100 text-slate-700 ring-slate-200/60 dark:bg-slate-500/15 dark:text-slate-300 dark:ring-slate-400/30',
};

interface OrderStatusBadgeProps {
  status: string;
  className?: string;
  size?: 'sm' | 'md';
}

export function OrderStatusBadge({
  status,
  className,
  size = 'sm',
}: OrderStatusBadgeProps) {
  const entry = STATUS_MAP[status] ?? {
    label: status,
    tone: 'slate' as Tone,
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium ring-1 ring-inset',
        size === 'sm'
          ? 'px-2 py-0.5 text-[11px]'
          : 'px-2.5 py-1 text-xs',
        TONE_CLASSES[entry.tone],
        className,
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          entry.tone === 'sky' && 'bg-sky-500',
          entry.tone === 'amber' && 'bg-amber-500',
          entry.tone === 'green' && 'bg-primary',
          entry.tone === 'rose' && 'bg-rose-500',
          entry.tone === 'slate' && 'bg-slate-400',
        )}
      />
      {entry.label}
    </span>
  );
}
