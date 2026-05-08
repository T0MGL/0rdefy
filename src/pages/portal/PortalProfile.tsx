/**
 * Profile screen for the courier.
 *
 * Read-only personal info + change password sheet (reuses
 * AuthContext.changePassword) + sign out. Keeps the surface small on purpose:
 * the courier shouldn't be tweaking store config from here.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  LogOut,
  Mail,
  Phone,
  Truck,
  Building2,
  ShieldCheck,
  Lock,
  Loader2,
  ChevronRight,
  HelpCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { portalService, type PortalMe } from '@/services/portal.service';

const APP_VERSION = import.meta.env.VITE_APP_VERSION || '1.0.0';

export default function PortalProfile() {
  const navigate = useNavigate();
  const { signOut, changePassword } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [passwordSheetOpen, setPasswordSheetOpen] = useState(false);

  const meQuery = useQuery<PortalMe>({
    queryKey: ['portal', 'me'],
    queryFn: ({ signal }) => portalService.getMe({ signal }),
    staleTime: 5 * 60 * 1000,
  });

  const me = meQuery.data;

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      navigate('/portal/login', { replace: true });
    }
  };

  return (
    <div className="space-y-4 pb-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Mi cuenta
        </p>
        <h1 className="mt-0.5 text-xl font-semibold tracking-tight">Perfil</h1>
      </div>

      {/* Identity */}
      <Card>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Vos
        </p>
        <h2 className="mt-1 text-base font-semibold tracking-tight">
          {me?.user?.name || 'Cargando...'}
        </h2>

        <div className="mt-3 space-y-2">
          {me?.user?.email && (
            <Row icon={Mail} value={me.user.email} muted />
          )}
          {me?.user?.phone && (
            <Row icon={Phone} value={me.user.phone} muted />
          )}
          {!me && (
            <div className="space-y-2">
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            </div>
          )}
        </div>
      </Card>

      {/* Carrier + store */}
      <Card>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Operás para
        </p>
        <h2 className="mt-1 text-base font-semibold tracking-tight">
          {me?.carrier?.name || '—'}
        </h2>
        <div className="mt-3 space-y-2">
          {me?.store?.name && <Row icon={Building2} value={me.store.name} />}
          {me?.carrier?.name && (
            <Row icon={Truck} value={`Transportadora · ${me.carrier.name}`} muted />
          )}
        </div>
      </Card>

      {/* Actions */}
      <Card padding="sm">
        <ProfileAction
          icon={Lock}
          label="Cambiar contraseña"
          onClick={() => setPasswordSheetOpen(true)}
        />
        <Divider />
        <ProfileAction
          icon={HelpCircle}
          label="Soporte"
          onClick={() =>
            window.open(
              'mailto:soporte@ordefy.io?subject=Portal%20courier',
              '_blank',
            )
          }
        />
        <Divider />
        <ProfileAction
          icon={LogOut}
          label="Cerrar sesión"
          onClick={handleSignOut}
          tone="danger"
          loading={signingOut}
        />
      </Card>

      {/* Footer */}
      <div className="pt-4 text-center text-[11px] text-muted-foreground">
        <div className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3 w-3" strokeWidth={1.75} />
          Ordefy · Portal courier · v{APP_VERSION}
        </div>
      </div>

      <ChangePasswordSheet
        open={passwordSheetOpen}
        onOpenChange={setPasswordSheetOpen}
        onSubmit={changePassword}
      />
    </div>
  );
}

function Card({
  children,
  padding = 'md',
}: {
  children: React.ReactNode;
  padding?: 'sm' | 'md';
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'rounded-2xl border border-border bg-card shadow-sm',
        padding === 'md' && 'p-4',
      )}
    >
      {children}
    </motion.section>
  );
}

function Row({
  icon: Icon,
  value,
  muted = false,
}: {
  icon: typeof Mail;
  value: string;
  muted?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 text-sm',
        muted ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
      <span className="truncate">{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="mx-4 h-px bg-border" />;
}

function ProfileAction({
  icon: Icon,
  label,
  onClick,
  tone = 'neutral',
  loading,
}: {
  icon: typeof Lock;
  label: string;
  onClick: () => void;
  tone?: 'neutral' | 'danger';
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors first:rounded-t-2xl last:rounded-b-2xl hover:bg-muted/60 active:bg-muted',
        tone === 'danger' && 'text-rose-600 dark:text-rose-400',
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={1.75} />
      <span className="flex-1 text-sm font-medium">{label}</span>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      )}
    </button>
  );
}

// ============================================================================
// Change-password sheet
// ============================================================================

interface ChangePasswordSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    current: string,
    next: string,
  ) => Promise<{ success?: boolean; error?: string }>;
}

function ChangePasswordSheet({
  open,
  onOpenChange,
  onSubmit,
}: ChangePasswordSheetProps) {
  const { toast } = useToast();
  const isMountedRef = useRef(true);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setCurrent('');
      setNext('');
      setConfirm('');
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const validate = (): string | null => {
    if (current.length === 0) return 'Ingresá tu contraseña actual';
    if (next.length < 8) return 'La nueva contraseña debe tener al menos 8 caracteres';
    if (next !== confirm) return 'Las contraseñas no coinciden';
    if (next === current) return 'La nueva contraseña debe ser distinta a la actual';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setSubmitting(true);

    const result = await onSubmit(current, next);

    if (!isMountedRef.current) return;

    if (result.error) {
      setSubmitting(false);
      setError(result.error);
      return;
    }

    toast({
      title: 'Contraseña actualizada',
      description: 'Usá la nueva la próxima vez que entres.',
    });
    setSubmitting(false);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showDragHandle
        withSafeArea
        className="rounded-t-3xl p-0 max-h-[88vh] flex flex-col"
        aria-describedby={undefined}
      >
        <SheetHeader className="px-6 pt-1 pb-4 border-b border-border">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Lock className="h-5 w-5" strokeWidth={2} />
            Cambiar contraseña
          </SheetTitle>
          <SheetDescription className="text-xs">
            Mínimo 8 caracteres.
          </SheetDescription>
        </SheetHeader>

        <form
          onSubmit={handleSubmit}
          className="flex flex-1 flex-col"
        >
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pw-current">Contraseña actual</Label>
              <Input
                id="pw-current"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                disabled={submitting}
                className="h-12"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pw-new">Nueva contraseña</Label>
              <Input
                id="pw-new"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                disabled={submitting}
                className="h-12"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pw-confirm">Repetir nueva</Label>
              <Input
                id="pw-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={submitting}
                className="h-12"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-rose-200/60 bg-rose-50/60 px-3 py-2 text-sm text-rose-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300"
              >
                {error}
              </div>
            )}
          </div>

          <div className="border-t border-border bg-card px-6 py-3">
            <Button
              type="submit"
              disabled={submitting}
              className="h-12 w-full text-base"
              size="lg"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                'Actualizar contraseña'
              )}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
