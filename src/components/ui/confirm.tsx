/**
 * Imperative confirm() replacement.
 *
 * Mounts a global host once and exposes `confirm(opts)` returning a Promise<boolean>.
 * Used to drop in as a 1-line replacement for window.confirm() while getting:
 *  - Themed UI (light/dark, brand)
 *  - Mobile bottom-sheet on small screens, dialog on desktop
 *  - Destructive variant
 *  - Haptic feedback on confirm
 *  - Keyboard navigable (Enter to confirm, Esc to cancel)
 *
 * Usage:
 *   const ok = await confirm({
 *     title: 'Eliminar pedido?',
 *     description: 'Esta accion no se puede deshacer.',
 *     confirmText: 'Eliminar',
 *     variant: 'destructive',
 *   });
 *   if (ok) doDelete();
 *
 * Setup: render <ConfirmHost /> once at app root.
 */
import * as React from 'react';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogBody,
  ResponsiveDialogFooter,
} from './responsive-dialog';
import { Button } from './button';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

type ConfirmVariant = 'default' | 'destructive' | 'warning';

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
}

interface ConfirmRequest extends ConfirmOptions {
  id: number;
  resolve: (value: boolean) => void;
}

let pushRequest: ((req: ConfirmRequest) => void) | null = null;
let nextId = 0;

/**
 * Imperative confirm. Returns true if user confirmed, false otherwise.
 * Falls back to window.confirm if host is not mounted (SSR / boot race).
 */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  if (!pushRequest) {
    if (typeof window !== 'undefined' && window.confirm) {
      // Sane fallback during boot. Should not happen in normal app lifecycle.
      const desc = typeof opts.description === 'string' ? `\n\n${opts.description}` : '';
      return Promise.resolve(window.confirm(`${opts.title}${desc}`));
    }
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    pushRequest!({ ...opts, id: ++nextId, resolve });
  });
}

/**
 * Mount once at the app root. Renders pending confirmation requests.
 */
export function ConfirmHost() {
  const [queue, setQueue] = React.useState<ConfirmRequest[]>([]);

  React.useEffect(() => {
    pushRequest = (req) => setQueue((q) => [...q, req]);
    return () => {
      pushRequest = null;
    };
  }, []);

  const current = queue[0];

  const close = (value: boolean) => {
    if (!current) return;
    current.resolve(value);
    setQueue((q) => q.slice(1));
  };

  if (!current) return null;

  const variant = current.variant ?? 'default';
  const isDestructive = variant === 'destructive';
  const isWarning = variant === 'warning';

  return (
    <ResponsiveDialog
      key={current.id}
      open
      onOpenChange={(open) => {
        if (!open) close(false);
      }}
    >
      <ResponsiveDialogContent desktopMaxWidth="max-w-md">
        <ResponsiveDialogHeader>
          <div className="flex items-start gap-3">
            {(isDestructive || isWarning) && (
              <div
                className={cn(
                  'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                  isDestructive && 'bg-destructive/10 text-destructive',
                  isWarning && 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-500',
                )}
                aria-hidden="true"
              >
                <AlertTriangle className="h-5 w-5" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <ResponsiveDialogTitle>{current.title}</ResponsiveDialogTitle>
              {current.description && (
                <ResponsiveDialogDescription className="mt-1.5">
                  {current.description}
                </ResponsiveDialogDescription>
              )}
            </div>
          </div>
        </ResponsiveDialogHeader>
        {/* Empty body keeps consistent spacing; could host a preview slot in future */}
        <ResponsiveDialogBody className="hidden" />
        <ResponsiveDialogFooter>
          <Button
            variant="ghost"
            onClick={() => close(false)}
            className="touch-target"
            autoFocus={!isDestructive}
          >
            {current.cancelText ?? 'Cancelar'}
          </Button>
          <Button
            variant={isDestructive ? 'destructive' : 'default'}
            onClick={() => {
              if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                navigator.vibrate?.(10);
              }
              close(true);
            }}
            className={cn(
              'touch-target',
              isWarning && 'bg-yellow-600 text-white hover:bg-yellow-700',
            )}
            autoFocus={isDestructive}
          >
            {current.confirmText ?? 'Confirmar'}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
