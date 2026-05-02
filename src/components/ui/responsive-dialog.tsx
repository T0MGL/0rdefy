/**
 * ResponsiveDialog
 *
 * Renders a Dialog on desktop (lg+) and a bottom Sheet on mobile (<lg).
 * Production-grade defaults:
 *  - Drag-handle indicator on mobile
 *  - safe-area-inset-bottom respected
 *  - Rounded top corners on the sheet
 *  - Built-in sticky footer slot via <ResponsiveDialogFooter>
 *  - Scrollable body, footer always visible
 *  - Single API across desktop and mobile
 *
 * Usage:
 *   <ResponsiveDialog open={open} onOpenChange={setOpen}>
 *     <ResponsiveDialogContent>
 *       <ResponsiveDialogHeader>
 *         <ResponsiveDialogTitle>...</ResponsiveDialogTitle>
 *         <ResponsiveDialogDescription>...</ResponsiveDialogDescription>
 *       </ResponsiveDialogHeader>
 *       <ResponsiveDialogBody>...content...</ResponsiveDialogBody>
 *       <ResponsiveDialogFooter>...CTAs...</ResponsiveDialogFooter>
 *     </ResponsiveDialogContent>
 *   </ResponsiveDialog>
 */
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/hooks/use-media-query';

interface ResponsiveDialogContextValue {
  isMobile: boolean;
}

const ResponsiveDialogContext = React.createContext<ResponsiveDialogContextValue>({
  isMobile: false,
});

interface ResponsiveDialogProps extends React.ComponentProps<typeof DialogPrimitive.Root> {
  /** Force mobile (sheet) layout regardless of viewport. */
  forceMobile?: boolean;
}

export function ResponsiveDialog({ children, forceMobile, ...props }: ResponsiveDialogProps) {
  // lg breakpoint matches the sidebar/bottom-nav switch so dialog flips at the same point.
  const isLgUp = useMediaQuery('(min-width: 1024px)');
  const isMobile = forceMobile ? true : !isLgUp;

  return (
    <ResponsiveDialogContext.Provider value={{ isMobile }}>
      <DialogPrimitive.Root {...props}>{children}</DialogPrimitive.Root>
    </ResponsiveDialogContext.Provider>
  );
}

export const ResponsiveDialogTrigger = DialogPrimitive.Trigger;
export const ResponsiveDialogClose = DialogPrimitive.Close;

const Overlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
Overlay.displayName = 'ResponsiveDialogOverlay';

interface ResponsiveDialogContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** Desktop max-width Tailwind class. Default: max-w-lg. */
  desktopMaxWidth?: string;
  /** Mobile sheet height. Default: 90vh (allows partial visibility of page behind). */
  mobileHeight?: string;
  /** Hide the default close button. */
  hideCloseButton?: boolean;
}

export const ResponsiveDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  ResponsiveDialogContentProps
>(
  (
    {
      className,
      children,
      desktopMaxWidth = 'max-w-lg',
      mobileHeight = '90vh',
      hideCloseButton = false,
      ...props
    },
    ref,
  ) => {
    const { isMobile } = React.useContext(ResponsiveDialogContext);

    if (isMobile) {
      return (
        <DialogPrimitive.Portal>
          <Overlay />
          <DialogPrimitive.Content
            ref={ref}
            style={{ maxHeight: mobileHeight }}
            className={cn(
              'fixed inset-x-0 bottom-0 z-50 flex flex-col',
              'rounded-t-2xl border-t border-border bg-card shadow-2xl',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
              'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
              'data-[state=closed]:duration-200 data-[state=open]:duration-300',
              className,
            )}
            {...props}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-2.5 pb-1.5 shrink-0">
              <div
                className="h-1 w-10 rounded-full bg-muted-foreground/30"
                aria-hidden="true"
              />
            </div>
            {!hideCloseButton && (
              <DialogPrimitive.Close
                className="absolute right-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-full bg-muted/60 text-muted-foreground hover:bg-muted active:scale-95 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
            )}
            {children}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      );
    }

    return (
      <DialogPrimitive.Portal>
        <Overlay />
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            'fixed left-[50%] top-[50%] z-50 w-full translate-x-[-50%] translate-y-[-50%]',
            'flex flex-col max-h-[90vh] gap-0 border bg-background shadow-lg sm:rounded-lg',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'duration-200',
            desktopMaxWidth,
            className,
          )}
          {...props}
        >
          {children}
          {!hideCloseButton && (
            <DialogPrimitive.Close
              className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    );
  },
);
ResponsiveDialogContent.displayName = 'ResponsiveDialogContent';

export function ResponsiveDialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { isMobile } = React.useContext(ResponsiveDialogContext);
  return (
    <div
      className={cn(
        'flex flex-col gap-1 shrink-0',
        isMobile ? 'px-5 pb-3 pt-1' : 'p-6 pb-4',
        className,
      )}
      {...props}
    />
  );
}

export const ResponsiveDialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-tight tracking-tight', className)}
    {...props}
  />
));
ResponsiveDialogTitle.displayName = 'ResponsiveDialogTitle';

export const ResponsiveDialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
ResponsiveDialogDescription.displayName = 'ResponsiveDialogDescription';

/**
 * Scrollable body region. Required to contain content; the footer stays sticky.
 */
export function ResponsiveDialogBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { isMobile } = React.useContext(ResponsiveDialogContext);
  return (
    <div
      className={cn(
        'flex-1 overflow-y-auto overscroll-contain',
        isMobile ? 'px-5 pb-3' : 'px-6 pb-6',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Sticky footer with safe-area bottom padding on mobile. Pin CTAs here.
 */
export function ResponsiveDialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { isMobile } = React.useContext(ResponsiveDialogContext);
  return (
    <div
      className={cn(
        'shrink-0 flex flex-col-reverse gap-2 border-t border-border bg-card sm:flex-row sm:justify-end',
        isMobile
          ? 'px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]'
          : 'px-6 py-4',
        className,
      )}
      {...props}
    />
  );
}
