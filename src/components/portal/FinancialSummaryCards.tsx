/**
 * Financial summary header for the courier portal.
 *
 * Mobile: horizontal snap scroll. Tablet/desktop: 4-column grid.
 *
 * Cards consume the typed PortalFinancialSummary returned by the backend.
 * Loading and error states keep layout stable with a placeholder dash to
 * avoid CLS when the React Query result lands.
 */

import { motion } from 'framer-motion';
import { Truck, PackageCheck, Coins, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/utils/currency';
import type { PortalFinancialSummary } from '@/services/portal.service';

interface FinancialSummaryCardsProps {
  summary?: PortalFinancialSummary;
  isLoading?: boolean;
  isError?: boolean;
  className?: string;
}

interface CardSpec {
  key: string;
  icon: LucideIcon;
  label: string;
  primary: string;
  secondary?: string;
  tone: 'amber' | 'sky' | 'violet' | 'rose' | 'emerald' | 'neutral';
}

const TONE_RING: Record<CardSpec['tone'], string> = {
  amber: 'ring-amber-200/60 dark:ring-amber-400/30',
  sky: 'ring-sky-200/60 dark:ring-sky-400/30',
  violet: 'ring-violet-200/60 dark:ring-violet-400/30',
  rose: 'ring-rose-200/60 dark:ring-rose-400/30',
  emerald: 'ring-emerald-200/60 dark:ring-emerald-400/30',
  neutral: 'ring-border',
};

const TONE_ICON_BG: Record<CardSpec['tone'], string> = {
  amber:
    'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  sky: 'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  violet:
    'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  rose: 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  emerald:
    'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  neutral: 'bg-muted text-muted-foreground',
};

function buildCards(summary?: PortalFinancialSummary): CardSpec[] {
  if (!summary) {
    return [
      {
        key: 'in_transit',
        icon: Truck,
        label: 'En tránsito',
        primary: '—',
        secondary: '—',
        tone: 'amber',
      },
      {
        key: 'unsettled',
        icon: PackageCheck,
        label: 'Por rendir',
        primary: '—',
        secondary: '—',
        tone: 'sky',
      },
      {
        key: 'fees',
        icon: Coins,
        label: 'Tu cobro',
        primary: '—',
        tone: 'violet',
      },
      {
        key: 'net',
        icon: Wallet,
        label: 'Saldo neto',
        primary: '—',
        tone: 'neutral',
      },
    ];
  }

  const inTransitCount = summary.in_transit.orders_count;
  const unsettledCount = summary.delivered_unsettled.orders_count;
  const fees = summary.delivered_unsettled.shipping_fees_to_receive;
  const failed = summary.delivered_unsettled.failed_attempt_fees;
  const net = summary.net_balance;

  return [
    {
      key: 'in_transit',
      icon: Truck,
      label: 'En tránsito',
      primary: formatCurrency(summary.in_transit.cod_pending_to_collect),
      secondary:
        inTransitCount === 0
          ? 'Sin pedidos activos'
          : inTransitCount === 1
            ? '1 pedido por cobrar'
            : `${inTransitCount} pedidos por cobrar`,
      tone: 'amber',
    },
    {
      key: 'unsettled',
      icon: PackageCheck,
      label: 'Por rendir',
      primary: formatCurrency(
        summary.delivered_unsettled.cod_collected_to_remit,
      ),
      secondary:
        unsettledCount === 0
          ? 'Nada pendiente de rendir'
          : unsettledCount === 1
            ? '1 entrega cobrada'
            : `${unsettledCount} entregas cobradas`,
      tone: 'sky',
    },
    {
      key: 'fees',
      icon: Coins,
      label: 'Tu cobro',
      primary: formatCurrency(fees),
      secondary: failed > 0 ? `- ${formatCurrency(failed)} fallidos` : undefined,
      tone: 'violet',
    },
    {
      key: 'net',
      icon: Wallet,
      label: 'Saldo neto',
      primary: formatCurrency(net),
      secondary:
        net > 0
          ? 'A pagar al store'
          : net < 0
            ? 'Te debe el store'
            : 'Estás al día',
      tone: net > 0 ? 'rose' : net < 0 ? 'emerald' : 'neutral',
    },
  ];
}

export function FinancialSummaryCards({
  summary,
  isLoading,
  isError,
  className,
}: FinancialSummaryCardsProps) {
  const cards = buildCards(summary);

  return (
    <div
      className={cn(
        '-mx-4 px-4 pb-1 sm:mx-0 sm:px-0',
        className,
      )}
    >
      <div
        className={cn(
          'flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-pl-4 pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
          'sm:grid sm:snap-none sm:grid-cols-2 sm:gap-3 sm:overflow-visible sm:pb-0',
          'lg:grid-cols-4',
        )}
      >
        {cards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: idx * 0.04 }}
              className={cn(
                'shrink-0 snap-start basis-[78%] rounded-2xl border border-border bg-card p-4 ring-1 ring-inset',
                'sm:basis-auto',
                TONE_RING[card.tone],
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-xl',
                    TONE_ICON_BG[card.tone],
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} />
                </span>
                <span className="text-xs font-medium text-muted-foreground">
                  {card.label}
                </span>
              </div>

              <div className="mt-3">
                {isLoading ? (
                  <div className="h-7 w-32 animate-pulse rounded-md bg-muted" />
                ) : isError ? (
                  <p className="text-2xl font-semibold tracking-tight text-muted-foreground">
                    —
                  </p>
                ) : (
                  <p className="text-2xl font-semibold tracking-tight text-foreground">
                    {card.primary}
                  </p>
                )}
                {card.secondary && !isLoading && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {card.secondary}
                  </p>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
