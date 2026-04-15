/**
 * ComingSoonPlaceholder
 *
 * Neutral, non-blocking placeholder for features gated by country or
 * plan. Avoid using Error boundary styles - this is informational, not a
 * failure.
 *
 * Pass `title`, `message`, and optional `hint` (e.g. "Planeado para Q3 2026").
 * Use `icon` when the consumer wants a themed glyph (lucide element).
 */

import { ReactNode } from 'react';
import { Construction } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface ComingSoonPlaceholderProps {
  title?: string;
  message?: string;
  hint?: string;
  icon?: ReactNode;
  className?: string;
  action?: ReactNode;
}

export function ComingSoonPlaceholder({
  title = 'Proximamente',
  message = 'Esta funcionalidad aun no esta disponible para tu tienda.',
  hint,
  icon,
  className,
  action,
}: ComingSoonPlaceholderProps) {
  return (
    <div className={cn('flex items-center justify-center py-16 px-4', className)}>
      <Card className="max-w-md w-full border-dashed">
        <CardContent className="p-8 flex flex-col items-center text-center gap-4">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            {icon ?? <Construction className="h-7 w-7" />}
          </div>
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <p className="text-sm text-muted-foreground">{message}</p>
          {hint ? <p className="text-xs text-muted-foreground/80">{hint}</p> : null}
          {action ? <div className="pt-2">{action}</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}
