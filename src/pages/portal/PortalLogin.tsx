/**
 * Standalone login screen for the courier portal.
 *
 * Reuses the AuthContext.signIn flow (same /api/auth/login endpoint, same
 * token + Supabase realtime token plumbing). After signIn succeeds we read
 * currentStore.role from AuthContext on the next render, redirect couriers
 * to /portal, and bounce non-couriers back to /portal/login with a clear
 * error so they don't end up in the admin shell by mistake.
 *
 * Visual identity: fullscreen, gradient backdrop, no admin sidebar / header.
 * Mobile-first form (44px+ tap targets, autofill-friendly autocomplete).
 */

import { useEffect, useRef, useState, FormEvent } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Loader2, Truck, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';

const ROLE_REDIRECTS = {
  COURIER: '/portal',
  OTHER: '/',
} as const;

export default function PortalLogin() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, user, currentStore, loading } = useAuth();

  const isMountedRef = useRef(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // If a session is already active, send the user where they belong.
  useEffect(() => {
    if (loading) return;
    if (!user) return;
    const role = currentStore?.role?.toLowerCase();
    if (role === 'courier') {
      navigate(ROLE_REDIRECTS.COURIER, { replace: true });
    } else if (role) {
      // Authenticated but not a courier — keep them out of the portal.
      setErrorMessage(
        'Esta cuenta no tiene acceso al portal de couriers.',
      );
    }
  }, [loading, user, currentStore?.role, navigate]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const result = await signIn(email.trim(), password);

      if (!isMountedRef.current) return;

      if (result.error) {
        setSubmitting(false);
        setErrorMessage(result.error);
        return;
      }

      // After signIn, AuthContext re-renders with the new currentStore.
      // The effect above either redirects or surfaces "not a courier" via
      // setErrorMessage. Either way the user has feedback — we don't want a
      // permanent spinner if the role check fails, so release it after a
      // short delay if no navigation happened.
      if (isMountedRef.current) {
        setTimeout(() => {
          if (isMountedRef.current) setSubmitting(false);
        }, 800);
      }
    } catch (err) {
      // signIn can throw on transport errors (500/network). Without this
      // catch the spinner stayed forever and the user couldn't retry.
      if (!isMountedRef.current) return;
      setSubmitting(false);
      setErrorMessage(
        err instanceof Error && err.message
          ? err.message
          : 'No se pudo iniciar sesión. Probá de nuevo.',
      );
    }
  };

  const fromLocation = (location.state as { from?: Location })?.from;

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-background">
      {/* Backdrop accents */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
      >
        <div className="absolute -top-32 -left-24 h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
        <div className="absolute -bottom-32 -right-24 h-80 w-80 rounded-full bg-violet-500/10 blur-3xl" />
      </div>

      <div
        className="relative mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-6 pt-12 pb-8"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top) + 3rem)',
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)',
        }}
      >
        {/* Brand */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-10"
        >
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
            <Truck className="h-6 w-6" strokeWidth={2} />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Portal courier
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Entrá con tu correo para ver los pedidos del día.
          </p>
        </motion.div>

        {/* Form */}
        <motion.form
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          onSubmit={handleSubmit}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-sm font-medium">
              Correo
            </Label>
            <Input
              id="email"
              type="email"
              required
              autoFocus
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
              className="h-12 text-base"
              placeholder="tu@correo.com"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-sm font-medium">
              Contraseña
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                className="h-12 pr-12 text-base"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                aria-label={
                  showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
                }
                className="absolute inset-y-0 right-0 flex h-12 w-12 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {errorMessage && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              role="alert"
              className="rounded-xl border border-rose-200/60 bg-rose-50/60 px-3 py-2 text-sm text-rose-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300"
            >
              {errorMessage}
            </motion.div>
          )}

          <Button
            type="submit"
            disabled={submitting || !email || !password}
            className="h-12 w-full text-base"
            size="lg"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Entrando...
              </>
            ) : (
              'Entrar'
            )}
          </Button>

          <div className="flex items-center justify-between pt-1 text-xs">
            <Link
              to="/forgot-password"
              className="text-muted-foreground hover:text-foreground"
            >
              ¿Olvidaste la contraseña?
            </Link>
            {fromLocation && (
              <span className="text-muted-foreground">
                Sesión expirada
              </span>
            )}
          </div>
        </motion.form>

        <div className="mt-auto pt-10">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
            Acceso protegido. Solo couriers autorizados.
          </div>
        </div>
      </div>
    </div>
  );
}
