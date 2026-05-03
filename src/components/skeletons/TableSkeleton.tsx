import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';
import { OrderListSkeleton } from '@/components/ui/skeleton-matched';

interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  /**
   * Mobile shape. Defaults to "card" so that mobile users see a list of card
   * skeletons matching OrderMobileList instead of a horizontally-scrolling
   * table skeleton (anti-pattern per design spec).
   */
  mobileShape?: 'card' | 'table';
}

export function TableSkeleton({
  rows = 5,
  columns = 6,
  mobileShape = 'card',
}: TableSkeletonProps) {
  return (
    <>
      {/* Mobile: card list matched to OrderMobileList shape */}
      {mobileShape === 'card' && (
        <div className="lg:hidden">
          <OrderListSkeleton count={rows} />
        </div>
      )}

      {/* Desktop (or when mobile=table): traditional table skeleton */}
      <div
        className={
          mobileShape === 'card' ? 'hidden lg:block' : 'block'
        }
      >
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  {Array.from({ length: columns }).map((_, i) => (
                    <th key={i} className="py-4 px-6">
                      <Skeleton className="h-4 w-20" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rows }).map((_, rowIndex) => (
                  <tr key={rowIndex} className="border-t border-border">
                    {Array.from({ length: columns }).map((_, colIndex) => (
                      <td key={colIndex} className="py-4 px-6">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
