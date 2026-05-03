/**
 * Declarative confirm dialog. Renders as bottom-sheet on mobile and
 * dialog on desktop via ResponsiveDialog. Back-compat API: existing call
 * sites keep working without changes.
 *
 * Prefer the imperative `confirm()` from `@/components/ui/confirm` for new
 * code (one-liner, no boilerplate state). This component remains for places
 * that need controlled open state or bind to async flows.
 */
import { useEffect, useRef } from 'react';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogBody,
  ResponsiveDialogFooter,
} from '@/components/ui/responsive-dialog';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { destructive as destructiveHaptic, tap } from '@/lib/haptics';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
  variant?: 'destructive' | 'warning' | 'default';
  confirmText?: string;
  cancelText?: string;
  /**
   * Optional preview node rendered between description and CTAs (e.g. the
   * item being deleted). Recommended for destructive actions per design spec.
   */
  preview?: React.ReactNode;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  variant = 'default',
  confirmText = 'Confirmar',
  cancelText = 'Cancelar',
  preview,
}: ConfirmDialogProps) {
  const isDestructive = variant === 'destructive';
  const isWarning = variant === 'warning';
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);

  // Focus management: destructive auto-focuses cancel for safety.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (isDestructive) cancelButtonRef.current?.focus();
      else confirmButtonRef.current?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, [open, isDestructive]);

  const handleConfirm = () => {
    if (isDestructive) destructiveHaptic();
    else tap();
    onConfirm();
    onOpenChange(false);
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
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
              <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
              <ResponsiveDialogDescription className="mt-1.5">
                {description}
              </ResponsiveDialogDescription>
            </div>
          </div>
        </ResponsiveDialogHeader>

        {preview ? (
          <ResponsiveDialogBody>{preview}</ResponsiveDialogBody>
        ) : (
          <ResponsiveDialogBody className="hidden" />
        )}

        <ResponsiveDialogFooter>
          <Button
            ref={cancelButtonRef}
            variant="ghost"
            onClick={() => {
              tap();
              onOpenChange(false);
            }}
            className="touch-target"
          >
            {cancelText}
          </Button>
          <Button
            ref={confirmButtonRef}
            variant={isDestructive ? 'destructive' : 'default'}
            onClick={handleConfirm}
            className={cn(
              'touch-target',
              isWarning && 'bg-yellow-600 text-white hover:bg-yellow-700',
            )}
          >
            {confirmText}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
