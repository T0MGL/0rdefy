/**
 * Mobile-first layout for the courier portal — also fully usable on web.
 *
 * Three pieces:
 *   - Sticky header: store switcher (left, only when courier carries
 *     >1 store), carrier name (center, sm+), avatar dropdown (right).
 *   - Main: <Outlet /> centered with a max width so the long-form
 *     pages don't sprawl on desktop monitors but still expand a bit
 *     past the mobile column.
 *   - Sticky bottom nav: 4 tabs with safe-area bottom inset on mobile;
 *     same nav on desktop (the portal is a single-purpose surface, the
 *     bottom nav is the only navigation primitive — keeps web parity
 *     with mobile).
 *
 * Store switching: a courier user (user_stores.role='courier') may be
 * active in multiple stores. When that's the case we expose a button
 * in the header that opens a dropdown of courier-role stores, calling
 * AuthContext.switchStore() on selection. Switching invalidates all
 * portal queries so the new store's data loads fresh.
 *
 * No sidebar, no admin Header. Different visual identity from the
 * admin shell, but the same web-grade quality of interactions.
 */

import { useMemo, useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Truck,
  CheckCircle2,
  History,
  Receipt,
  LogOut,
  Settings,
  ChevronsUpDown,
  Check,
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
  { to: '/portal/conciliacion', label: 'Conciliar', icon: Receipt },
  { to: '/portal/history', label: 'Historial', icon: History },
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
  const queryClient = useQueryClient();
  const { signOut, user, currentStore, switchStore } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [switchingStoreId, setSwitchingStoreId] = useState<string | null>(null);

  // Restrict the switcher to stores where this user is an active
  // courier. The admin shell shows all stores; here we never expose
  // stores where the user has a different role.
  const courierStores = useMemo(
    () => (user?.stores ?? []).filter((s) => s.role?.toLowerCase() === 'courier'),
    [user?.stores],
  );

  const meQuery = useQuery<PortalMe>({
    queryKey: ['portal', 'me', currentStore?.id],
    queryFn: ({ signal }) => portalService.getMe({ signal }),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const me = meQuery.data;
  const carrierName = me?.carrier?.name;
  const storeName = me?.store?.name ?? currentStore?.name;
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

  const handleSwitchStore = async (storeId: string) => {
    if (storeId === currentStore?.id) return;
    setSwitchingStoreId(storeId);
    try {
      await switchStore(storeId);
      // Invalidate every portal query so the new store's data loads
      // fresh. React Query will refetch the active subscribers.
      queryClient.invalidateQueries({ queryKey: ['portal'] });
    } finally {
      setSwitchingStoreId(null);
    }
  };

  return (
    <div className="flex min-h-[100dvh] w-full max-w-[100vw] flex-col overflow-x-hidden bg-gradient-to-b from-background to-muted/40">
      {/* Header */}
      <header
        className="sticky top-0 z-40 overflow-hidden border-b border-border/70 bg-background/80 backdrop-blur-md"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4">
          {/* Left: store switcher (or plain label when only one store) */}
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Portal courier
            </p>
            {courierStores.length > 1 ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="group inline-flex max-w-full items-center gap-1.5 rounded-md text-left text-sm font-semibold text-foreground transition-colors hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  aria-label="Cambiar de tienda"
                >
                  <span className="truncate">
                    {storeName ?? 'Cargando...'}
                  </span>
                  <ChevronsUpDown
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary"
                    strokeWidth={2}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-56">
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Tus tiendas ({courierStores.length})
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {courierStores.map((s) => {
                    const isActive = s.id === currentStore?.id;
                    const isSwitching = switchingStoreId === s.id;
                    return (
                      <DropdownMenuItem
                        key={s.id}
                        onSelect={(e) => {
                          e.preventDefault();
                          handleSwitchStore(s.id);
                        }}
                        disabled={isSwitching}
                        className="flex items-center justify-between gap-3"
                      >
                        <span className="truncate">{s.name}</span>
                        {isActive && (
                          <Check
                            className="h-3.5 w-3.5 shrink-0 text-primary"
                            strokeWidth={2.25}
                          />
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <p className="truncate text-sm font-semibold text-foreground">
                {storeName ?? 'Cargando...'}
              </p>
            )}
          </div>

          {/* Center: carrier (sm+ only) */}
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
        className="mx-auto w-full max-w-3xl flex-1 overflow-x-hidden px-4 pb-28 pt-4"
      >
        <Outlet />
      </main>

      {/* Bottom nav */}
      <nav
        aria-label="Navegación del portal courier"
        className="fixed bottom-0 left-0 right-0 z-50 overflow-hidden"
      >
        <div className="border-t border-border/70 bg-card/85 backdrop-blur-xl shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.18)] dark:shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.5)]">
          <div className="mx-auto flex h-16 w-full max-w-screen-sm items-stretch px-2">
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
