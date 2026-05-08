/**
 * Mobile-first layout for the courier portal.
 *
 * Three pieces:
 *   - Sticky header: store name (left), carrier name truncated (center),
 *     courier avatar dropdown (right).
 *   - Main: <Outlet /> with bottom-padding so content clears the nav.
 *   - Sticky bottom nav: 4 tabs with safe-area bottom inset.
 *
 * The layout calls /api/portal/me once on mount, caches it through React Query
 * (staleTime 5min), and uses it to render the header. If the call fails we
 * still render the layout — pages handle their own data fetching.
 *
 * No sidebar, no admin Header. Different visual identity from the admin shell.
 */

import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import {
  Truck,
  CheckCircle2,
  History,
  User,
  LogOut,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { portalService, type PortalMe } from '@/services/portal.service';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface TabConfig {
  to: string;
  label: string;
  icon: typeof Truck;
  end?: boolean;
}

const TABS: TabConfig[] = [
  { to: '/portal', label: 'Activos', icon: Truck, end: true },
  { to: '/portal/today', label: 'Hoy', icon: CheckCircle2 },
  { to: '/portal/history', label: 'Historial', icon: History },
  { to: '/portal/profile', label: 'Perfil', icon: User },
];

function initialsFrom(name: string | null | undefined, email: string): string {
  const source = name?.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function CourierPortalLayout() {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const meQuery = useQuery<PortalMe>({
    queryKey: ['portal', 'me'],
    queryFn: ({ signal }) => portalService.getMe({ signal }),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const me = meQuery.data;
  const carrierName = me?.carrier?.name;
  const storeName = me?.store?.name;
  const courierName = me?.user?.name || user?.name || user?.email || 'Operador';
  const courierEmail = me?.user?.email || user?.email || '';
  const initials = initialsFrom(courierName, courierEmail);

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
    <div className="flex min-h-[100dvh] flex-col bg-gradient-to-b from-background to-muted/40">
      {/* Header */}
      <header
        className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-md"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 px-4">
          {/* Left: store mark */}
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Portal courier
            </p>
            <p className="truncate text-sm font-semibold text-foreground">
              {storeName ?? 'Cargando...'}
            </p>
          </div>

          {/* Center: carrier */}
          <div className="hidden min-w-0 flex-1 text-center sm:block">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Transportadora
            </p>
            <p className="truncate text-sm font-medium text-foreground">
              {carrierName ?? '—'}
            </p>
          </div>

          {/* Right: avatar menu */}
          <div className="shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/20 transition-colors hover:bg-primary/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label="Menú de la cuenta"
              >
                {initials}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{courierName}</span>
                    <span className="truncate text-xs font-normal text-muted-foreground">
                      {courierEmail}
                    </span>
                    {carrierName && (
                      <span className="mt-1 text-xs font-normal text-muted-foreground">
                        {carrierName}
                      </span>
                    )}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/portal/profile')}>
                  <Settings className="mr-2 h-4 w-4" />
                  Mi perfil
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="text-rose-600 focus:bg-rose-50 focus:text-rose-700 dark:text-rose-400 dark:focus:bg-rose-500/15 dark:focus:text-rose-300"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Main */}
      <main
        id="portal-main"
        className="mx-auto w-full max-w-2xl flex-1 px-4 pb-28 pt-4"
      >
        <Outlet />
      </main>

      {/* Bottom nav */}
      <nav
        aria-label="Navegación del portal courier"
        className="fixed bottom-0 left-0 right-0 z-50"
      >
        <div className="border-t border-border/70 bg-card/85 backdrop-blur-xl shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.18)] dark:shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.5)]">
          <div className="mx-auto flex h-16 max-w-md items-stretch px-2">
            {TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className="relative flex-1 focus:outline-none"
              >
                {({ isActive }) => (
                  <div className="relative flex h-full flex-col items-center justify-center gap-0.5">
                    <AnimatePresence>
                      {isActive && (
                        <motion.span
                          layoutId="portal-nav-pill"
                          className="absolute inset-x-3 top-1.5 h-9 rounded-full bg-primary/10"
                          transition={{
                            type: 'spring',
                            stiffness: 500,
                            damping: 35,
                          }}
                        />
                      )}
                    </AnimatePresence>

                    <motion.div
                      animate={{ scale: isActive ? 1.05 : 1 }}
                      transition={{
                        type: 'spring',
                        stiffness: 500,
                        damping: 30,
                      }}
                      className="relative"
                    >
                      <tab.icon
                        className={cn(
                          'h-5 w-5 transition-colors',
                          isActive ? 'text-primary' : 'text-muted-foreground',
                        )}
                        strokeWidth={isActive ? 2.25 : 1.75}
                      />
                    </motion.div>
                    <span
                      className={cn(
                        'relative text-[10.5px] font-medium transition-colors',
                        isActive ? 'text-primary' : 'text-muted-foreground',
                      )}
                    >
                      {tab.label}
                    </span>
                  </div>
                )}
              </NavLink>
            ))}
          </div>
          <div className="h-[env(safe-area-inset-bottom)]" />
        </div>
      </nav>
    </div>
  );
}
