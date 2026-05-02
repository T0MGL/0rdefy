/**
 * Skeleton primitives matched to the shapes of real content.
 *
 * Replaces full-screen spinners and unmatched grey blocks with shapes that
 * mirror the final UI. When content arrives, layout does not jump.
 *
 * Conventions:
 *  - shimmer animation via animate-pulse (already wired by base Skeleton)
 *  - rounded corners match real cards (rounded-2xl on cards, rounded-xl on rows)
 *  - skeletons render the same vertical rhythm as real content
 *  - Mobile-first: layouts target the dense card style used in OrderMobileList
 */
import { Skeleton } from './skeleton';
import { cn } from '@/lib/utils';

interface CountProps {
  count?: number;
  className?: string;
}

/**
 * Mobile order card skeleton. Matches OrderMobileList card geometry
 * (id row, customer row, product row, badges row).
 */
export function OrderCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border/40 bg-card p-3">
      <div className="flex items-start gap-3">
        <Skeleton className="h-5 w-5 rounded shrink-0" />
        <div className="flex-1 space-y-2 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <div className="flex gap-2 pt-1">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function OrderListSkeleton({ count = 6, className }: CountProps) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <OrderCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Generic product card skeleton (mobile). Image + 2 text rows + price.
 */
export function ProductCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border/40 bg-card p-3 flex gap-3">
      <Skeleton className="h-16 w-16 rounded-xl shrink-0" />
      <div className="flex-1 space-y-2 min-w-0">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex items-center justify-between gap-2 pt-1">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-16" />
        </div>
      </div>
    </div>
  );
}

export function ProductListSkeleton({ count = 6, className }: CountProps) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * KPI card skeleton (Dashboard). Tile w/ value + label.
 */
export function StatCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border/40 bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
      <Skeleton className="h-7 w-24" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}

export function StatGridSkeleton({ count = 4, className }: CountProps) {
  return (
    <div
      className={cn('grid grid-cols-2 lg:grid-cols-4 gap-3', className)}
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Generic list row skeleton (suppliers, customers, carriers).
 * Avatar/icon + 2 text rows + trailing meta.
 */
export function ListRowSkeleton() {
  return (
    <div className="rounded-2xl border border-border/40 bg-card p-3 flex items-center gap-3">
      <Skeleton className="h-10 w-10 rounded-full shrink-0" />
      <div className="flex-1 space-y-2 min-w-0">
        <Skeleton className="h-4 w-3/5" />
        <Skeleton className="h-3 w-2/5" />
      </div>
      <Skeleton className="h-5 w-12 rounded-full shrink-0" />
    </div>
  );
}

export function ListRowsSkeleton({ count = 5, className }: CountProps) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <ListRowSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Page-level skeleton: header + filter bar + cards. Matches the typical
 * Orders/Products/Warehouse mobile layout exactly.
 */
export function PageListSkeleton({
  count = 6,
  showFilters = true,
  className,
}: CountProps & { showFilters?: boolean }) {
  return (
    <div className={cn('space-y-3', className)} aria-hidden="true">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-9 w-20 rounded-full" />
      </div>
      {showFilters && (
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-20 rounded-full shrink-0" />
          ))}
        </div>
      )}
      <OrderListSkeleton count={count} />
    </div>
  );
}
