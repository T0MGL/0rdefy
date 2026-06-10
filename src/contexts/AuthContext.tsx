import { createContext, useContext, useEffect, useState, ReactNode, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios, { CancelTokenSource } from 'axios';
import { safeJsonParse } from '@/lib/utils';
import { logger } from '@/utils/logger';
import { supabase } from '@/lib/supabase';
import { getActiveStoreId, setActiveStoreId, clearActiveStore } from '@/lib/activeStore';
import { resetStoreQueryClients } from '@/lib/queryClients';
import { deriveOnboardingCompleted, isCourierOnly } from '@/lib/onboarding';

// Bridges the custom Express JWT to Supabase Realtime. The backend mints a
// second token signed with SUPABASE_JWT_SECRET on login/register/profile-update.
// We persist it so the Realtime client can authenticate WebSocket handshakes
// and the RLS-aware filters resolve auth.uid() correctly.
const SUPABASE_TOKEN_STORAGE_KEY = 'supabase_token';

function applySupabaseRealtimeToken(token: string | null) {
  if (token) {
    localStorage.setItem(SUPABASE_TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(SUPABASE_TOKEN_STORAGE_KEY);
  }
  try {
    supabase.realtime.setAuth(token);
  } catch (err) {
    logger.warn('⚠️ [AUTH] Failed to set Supabase realtime auth token:', err);
  }
}

// ================================================================
// Permission System Types and Constants
// ================================================================
export enum Role {
  OWNER = 'owner',
  ADMIN = 'admin',
  LOGISTICS = 'logistics',
  CONFIRMADOR = 'confirmador',
  CONTADOR = 'contador',
  INVENTARIO = 'inventario',
  // Courier role (Phase 4): scoped to the embedded courier portal.
  // Couriers have no access to admin modules; the routing layer redirects
  // them to /portal/*. ROLE_PERMISSIONS[Role.COURIER] keeps every module
  // empty so any accidental admin route render shows a permission denial
  // instead of leaking data.
  COURIER = 'courier'
}

export enum Module {
  DASHBOARD = 'dashboard',
  ORDERS = 'orders',
  PRODUCTS = 'products',
  WAREHOUSE = 'warehouse',
  RETURNS = 'returns',
  MERCHANDISE = 'merchandise',
  CUSTOMERS = 'customers',
  SUPPLIERS = 'suppliers',
  CARRIERS = 'carriers',
  CAMPAIGNS = 'campaigns',
  ANALYTICS = 'analytics',
  SETTINGS = 'settings',
  TEAM = 'team',
  BILLING = 'billing',
  INTEGRATIONS = 'integrations',
  INVOICING = 'invoicing'
}

export enum Permission {
  VIEW = 'view',
  CREATE = 'create',
  EDIT = 'edit',
  DELETE = 'delete'
}

type ModulePermissions = {
  [key in Module]: Permission[];
};

type RolePermissions = {
  [key in Role]: ModulePermissions;
};

const ROLE_PERMISSIONS: RolePermissions = {
  [Role.OWNER]: {
    [Module.DASHBOARD]: [Permission.VIEW],
    [Module.ORDERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.PRODUCTS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.WAREHOUSE]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.RETURNS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.MERCHANDISE]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CUSTOMERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.SUPPLIERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CARRIERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CAMPAIGNS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.ANALYTICS]: [Permission.VIEW],
    [Module.SETTINGS]: [Permission.VIEW, Permission.EDIT],
    [Module.TEAM]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.BILLING]: [Permission.VIEW, Permission.EDIT],
    [Module.INTEGRATIONS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.INVOICING]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
  },
  [Role.ADMIN]: {
    [Module.DASHBOARD]: [Permission.VIEW],
    [Module.ORDERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.PRODUCTS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.WAREHOUSE]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.RETURNS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.MERCHANDISE]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CUSTOMERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.SUPPLIERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CARRIERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CAMPAIGNS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.ANALYTICS]: [Permission.VIEW],
    [Module.SETTINGS]: [Permission.VIEW, Permission.EDIT],
    [Module.TEAM]: [],
    [Module.BILLING]: [],
    [Module.INTEGRATIONS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.INVOICING]: [Permission.VIEW, Permission.CREATE, Permission.EDIT],
  },
  [Role.LOGISTICS]: {
    [Module.DASHBOARD]: [Permission.VIEW],
    [Module.ORDERS]: [Permission.VIEW],
    [Module.PRODUCTS]: [],
    [Module.WAREHOUSE]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.RETURNS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.MERCHANDISE]: [],
    [Module.CUSTOMERS]: [],
    [Module.SUPPLIERS]: [],
    [Module.CARRIERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CAMPAIGNS]: [],
    [Module.ANALYTICS]: [],
    [Module.SETTINGS]: [],
    [Module.TEAM]: [],
    [Module.BILLING]: [],
    [Module.INTEGRATIONS]: [],
    [Module.INVOICING]: [],
  },
  [Role.CONFIRMADOR]: {
    [Module.DASHBOARD]: [Permission.VIEW],
    [Module.ORDERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT],
    [Module.PRODUCTS]: [],
    [Module.WAREHOUSE]: [],
    [Module.RETURNS]: [],
    [Module.MERCHANDISE]: [],
    [Module.CUSTOMERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT],
    [Module.SUPPLIERS]: [],
    [Module.CARRIERS]: [Permission.VIEW],
    [Module.CAMPAIGNS]: [],
    [Module.ANALYTICS]: [],
    [Module.SETTINGS]: [],
    [Module.TEAM]: [],
    [Module.BILLING]: [],
    [Module.INTEGRATIONS]: [],
    [Module.INVOICING]: [],
  },
  [Role.CONTADOR]: {
    [Module.DASHBOARD]: [Permission.VIEW],
    [Module.ORDERS]: [Permission.VIEW],
    [Module.PRODUCTS]: [Permission.VIEW],
    [Module.WAREHOUSE]: [],
    [Module.RETURNS]: [],
    [Module.MERCHANDISE]: [],
    [Module.CUSTOMERS]: [Permission.VIEW],
    [Module.SUPPLIERS]: [],
    [Module.CARRIERS]: [],
    [Module.CAMPAIGNS]: [Permission.VIEW],
    [Module.ANALYTICS]: [Permission.VIEW],
    [Module.SETTINGS]: [],
    [Module.TEAM]: [],
    [Module.BILLING]: [],
    [Module.INTEGRATIONS]: [],
    [Module.INVOICING]: [Permission.VIEW],
  },
  [Role.INVENTARIO]: {
    [Module.DASHBOARD]: [Permission.VIEW],
    [Module.ORDERS]: [],
    [Module.PRODUCTS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.WAREHOUSE]: [],
    [Module.RETURNS]: [],
    [Module.MERCHANDISE]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CUSTOMERS]: [],
    [Module.SUPPLIERS]: [Permission.VIEW, Permission.CREATE, Permission.EDIT, Permission.DELETE],
    [Module.CARRIERS]: [],
    [Module.CAMPAIGNS]: [],
    [Module.ANALYTICS]: [],
    [Module.SETTINGS]: [],
    [Module.TEAM]: [],
    [Module.BILLING]: [],
    [Module.INTEGRATIONS]: [],
    [Module.INVOICING]: [],
  },
  [Role.COURIER]: {
    // Couriers have no admin module access; their UI lives entirely under
    // /portal. The PermissionRoute on admin pages will treat them as
    // unauthorized, but the role-based redirect below short-circuits that
    // and sends them to the portal first.
    [Module.DASHBOARD]: [],
    [Module.ORDERS]: [],
    [Module.PRODUCTS]: [],
    [Module.WAREHOUSE]: [],
    [Module.RETURNS]: [],
    [Module.MERCHANDISE]: [],
    [Module.CUSTOMERS]: [],
    [Module.SUPPLIERS]: [],
    [Module.CARRIERS]: [],
    [Module.CAMPAIGNS]: [],
    [Module.ANALYTICS]: [],
    [Module.SETTINGS]: [],
    [Module.TEAM]: [],
    [Module.BILLING]: [],
    [Module.INTEGRATIONS]: [],
    [Module.INVOICING]: [],
  }
};

let cleanBaseURL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
cleanBaseURL = cleanBaseURL.replace(/\/+$/, '');
while (cleanBaseURL.endsWith('/api')) {
  cleanBaseURL = cleanBaseURL.slice(0, -4);
  cleanBaseURL = cleanBaseURL.replace(/\/+$/, '');
}
const BASE_API_URL = `${cleanBaseURL}/api`;
const API_URL = `${BASE_API_URL}/auth`;

// Token validation is handled in API interceptor (api.client.ts)
// No need for duplicate validation here - saves resources

export interface Store {
  id: string;
  name: string;
  country: string;
  currency: string;
  role: string;
  timezone?: string;
  separate_confirmation_flow?: boolean;
  // Migration 168. Defaults TRUE on the backend; we keep it optional in TS so
  // a stale cached `user` payload (pre-deploy) is still type-safe. Consumers
  // must read it as `currentStore?.auto_assign_cheapest_carrier !== false` to
  // preserve the auto-pick default.
  auto_assign_cheapest_carrier?: boolean;
}

interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  stores: Store[];
  // Durable onboarding flag. The backend is the single source of truth: it
  // returns `onboardingCompleted` at login (api/routes/auth.ts). We persist it
  // ON the user object so it survives cold starts (reload, new tab, PWA
  // relaunch) instead of relying on a separate localStorage key that may be
  // absent. Optional so pre-deploy cached `user` payloads stay type-safe; the
  // restore path backfills it. See `deriveOnboardingCompleted`.
  onboardingCompleted?: boolean;
}

// Onboarding-completion logic lives in a pure, React-free module so it is the
// single testable source of truth shared with OnboardingGuard. See
// `src/lib/onboarding.ts`.

// Permission helper interface
interface PermissionHelpers {
  hasPermission: (module: Module, permission: Permission) => boolean;
  canAccessModule: (module: Module) => boolean;
  getAccessibleModules: () => Module[];
  currentRole: Role | null;
}

interface AuthContextType {
  user: User | null;
  currentStore: Store | null;
  stores: Store[];
  loading: boolean;
  // Derived, durable onboarding state. OnboardingGuard reads THIS instead of a
  // fragile standalone localStorage flag. See `deriveOnboardingCompleted`.
  onboardingCompleted: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, name: string, referralCode?: string) => Promise<{ error?: string }>;
  signOut: () => void;
  switchStore: (storeId: string) => void;
  updateProfile: (data: { userName?: string; userPhone?: string; storeName?: string; storeId?: string }) => Promise<{ error?: string }>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ success?: boolean; error?: string }>;
  deleteAccount: (password: string) => Promise<{ success?: boolean; error?: string }>;
  createStore: (data: { name: string; country?: string; currency?: string; taxRate?: number; adminFee?: number }) => Promise<{ success?: boolean; error?: string; storeId?: string }>;
  deleteStore: (storeId: string) => Promise<{ success?: boolean; error?: string }>;
  refreshStores: () => Promise<{ success?: boolean; error?: string }>;
  // Permission helpers
  permissions: PermissionHelpers;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [currentStore, setCurrentStore] = useState<Store | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);

  // Track mounted state and active requests for cleanup
  const isMountedRef = useRef(true);
  const activeRequestsRef = useRef<Set<CancelTokenSource>>(new Set());

  // Helper to create cancellable request
  const createCancellableRequest = useCallback(() => {
    const source = axios.CancelToken.source();
    activeRequestsRef.current.add(source);
    return source;
  }, []);

  // Helper to cleanup request
  const cleanupRequest = useCallback((source: CancelTokenSource) => {
    activeRequestsRef.current.delete(source);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    const activeRequests = activeRequestsRef.current;
    return () => {
      isMountedRef.current = false;
      // Cancel all pending requests
      activeRequests.forEach(source => {
        source.cancel('Component unmounted');
      });
      activeRequests.clear();
    };
  }, []);

  // CRITICAL: Define signOut BEFORE any useEffect that uses it
  const signOut = useCallback(async () => {
    logger.log('👋 [AUTH] Signing out');

    const cancelSource = createCancellableRequest();

    // Call backend to terminate session
    try {
      const token = localStorage.getItem('auth_token');
      if (token) {
        await axios.post(`${API_URL}/logout`, {}, {
          headers: {
            'Authorization': `Bearer ${token}`
          },
          cancelToken: cancelSource.token
        });
        logger.log('✅ [AUTH] Session terminated on server');
      }
    } catch (err) {
      if (axios.isCancel(err)) {
        logger.log('🚫 [AUTH] Logout request cancelled');
        return;
      }
      logger.error('⚠️ [AUTH] Failed to terminate session on server:', err);
      // Continue with client-side logout even if server call fails
    } finally {
      cleanupRequest(cancelSource);
    }

    // Only update state if still mounted
    if (!isMountedRef.current) return;

    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    clearActiveStore();
    localStorage.removeItem('onboarding_completed');
    applySupabaseRealtimeToken(null);

    // Purge every store's QueryClient cache so order/customer/settlement PII
    // does not survive in the JS heap after the session ends (no page reload
    // on logout means the per-store client map would otherwise persist).
    resetStoreQueryClients();

    setUser(null);
    setStores([]);
    setCurrentStore(null);

    logger.log('✅ [AUTH] Signed out successfully');
  }, [createCancellableRequest, cleanupRequest]);

  useEffect(() => {
    logger.log('🔄 [AUTH] Initializing auth state...');

    const token = localStorage.getItem('auth_token');
    const savedUser = localStorage.getItem('user');
    const savedStoreId = getActiveStoreId();
    const savedSupabaseToken = localStorage.getItem(SUPABASE_TOKEN_STORAGE_KEY);

    if (token && savedUser) {
      // Use safeJsonParse to prevent crashes from corrupted localStorage data
      const parsedUser = safeJsonParse<User | null>(savedUser, null);

      if (parsedUser) {
        logger.log('✅ [AUTH] Found existing session:', parsedUser.email);

        // Re-arm Supabase Realtime auth so WebSocket subscriptions work on
        // page reloads. If the token is missing the user must re-login to
        // mint a fresh one (older sessions predating this bridge).
        if (savedSupabaseToken) {
          applySupabaseRealtimeToken(savedSupabaseToken);
        }

        // Backfill the durable onboarding flag on session restore. A cold start
        // (page reload, new tab, PWA relaunch, bookmarked /portal URL) rehydrates
        // the user from localStorage. Older cached payloads (and the standalone
        // `onboarding_completed` key) may be missing, which previously made
        // OnboardingGuard bounce a fully-onboarded user — owner OR courier — back
        // into the store-setup form. We derive completion from durable user state
        // (backend flag, courier role, or the same rule the backend uses) and
        // stamp it onto the user object so the derived context value is stable.
        const restoredUser: User = {
          ...parsedUser,
          onboardingCompleted: deriveOnboardingCompleted(parsedUser),
        };
        setUser(restoredUser);
        setStores(restoredUser.stores || []);

        // Keep the user object and the legacy standalone key consistent so any
        // code still reading the key during the transition agrees with context.
        localStorage.setItem('user', JSON.stringify(restoredUser));
        if (restoredUser.onboardingCompleted) {
          localStorage.setItem('onboarding_completed', 'true');
        } else {
          localStorage.removeItem('onboarding_completed');
        }

        if (savedStoreId && parsedUser.stores) {
          const store = parsedUser.stores.find((s: Store) => s.id === savedStoreId);
          const resolved = store || parsedUser.stores[0];
          setCurrentStore(resolved);
          // Pin the resolved store to THIS tab's sessionStorage. On a fresh tab
          // savedStoreId comes from the localStorage fallback; without this seed
          // the tab would keep tracking the global value and another tab could
          // change it underneath us.
          if (resolved) setActiveStoreId(resolved.id);
        } else if (parsedUser.stores && parsedUser.stores.length > 0) {
          setCurrentStore(parsedUser.stores[0]);
          setActiveStoreId(parsedUser.stores[0].id);
        }
      } else {
        // Parse failed - clear corrupted data
        logger.error('❌ [AUTH] Failed to parse saved user data - clearing session');
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user');
        applySupabaseRealtimeToken(null);
      }
    } else {
      logger.log('⚠️ [AUTH] No existing session found');
    }

    setLoading(false);
  }, []);

  // Listen for session expiration events from api.client.ts
  useEffect(() => {
    const handleSessionExpired = () => {
      logger.warn('⚠️ [AUTH] Session expired event received. Logging out...');
      signOut();
    };

    window.addEventListener('auth:session-expired', handleSessionExpired);

    return () => {
      window.removeEventListener('auth:session-expired', handleSessionExpired);
    };
  }, [signOut]); // Include signOut in dependencies to prevent stale closure

  // ================================================================
  // Role-based routing (Phase 4 — courier portal)
  // ================================================================
  // - Couriers landing on any non-portal route go to /portal.
  // - Admins/owners landing on /portal go to /.
  // - /portal/login and a small set of public routes are exempt.
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!user) return;

    const role = currentStore?.role?.toLowerCase();
    if (!role) return;

    const path = location.pathname;
    const isPortalRoute = path === '/portal' || path.startsWith('/portal/');
    const isPortalLogin = path === '/portal/login';
    // Public/standalone routes that any role can hit without redirect.
    const isPublicSafe =
      path.startsWith('/login') ||
      path.startsWith('/signup') ||
      path.startsWith('/forgot-password') ||
      path.startsWith('/reset-password') ||
      path.startsWith('/i/') ||
      path.startsWith('/accept-invite/') ||
      path.startsWith('/delivery/') ||
      path.startsWith('/r/') ||
      path.startsWith('/wrapped/') ||
      path === '/shopify-oauth-callback';

    if (role === 'courier') {
      // Couriers belong in the portal. Anything else, redirect.
      if (!isPortalRoute && !isPortalLogin && !isPublicSafe) {
        navigate('/portal', { replace: true });
      }
    } else {
      // Non-couriers should not see the portal shell.
      if (isPortalRoute && !isPortalLogin) {
        navigate('/', { replace: true });
      }
    }
  }, [loading, user, currentStore?.role, location.pathname, navigate]);

  // NO periodic check - token validation happens ONLY in API interceptor
  // This saves resources and is sufficient for 7-day tokens

  const signIn = useCallback(async (email: string, password: string) => {
    logger.log('🔐 [AUTH] Signing in:', email);

    const cancelSource = createCancellableRequest();

    try {
      const response = await axios.post(`${API_URL}/login`, {
        email,
        password,
      }, {
        cancelToken: cancelSource.token
      });

      cleanupRequest(cancelSource);

      // Check if still mounted before updating state
      if (!isMountedRef.current) return { error: undefined };

      logger.log('✅ [AUTH] Login response:', response.data);

      if (response.data.success) {
        // Stamp the backend's onboarding verdict onto the durable user object
        // so it survives cold starts. Couriers are exempt regardless. The
        // standalone key is kept in sync only for backward compatibility.
        const serverOnboarding = response.data.onboardingCompleted === true;
        const userData: User = {
          ...response.data.user,
          onboardingCompleted: serverOnboarding || isCourierOnly(response.data.user?.stores),
        };

        localStorage.setItem('auth_token', response.data.token);
        localStorage.setItem('user', JSON.stringify(userData));
        applySupabaseRealtimeToken(response.data.supabaseToken ?? null);

        if (userData.onboardingCompleted) {
          localStorage.setItem('onboarding_completed', 'true');
          logger.log('✅ [AUTH] User has already completed onboarding');
        } else {
          localStorage.removeItem('onboarding_completed');
          logger.log('⚠️ [AUTH] User needs to complete onboarding');
        }

        if (userData.stores && userData.stores.length > 0) {
          setActiveStoreId(userData.stores[0].id);
          setCurrentStore(userData.stores[0]);
        }

        setUser(userData);
        setStores(userData.stores || []);

        logger.log('🎉 [AUTH] Login successful');
        return { error: undefined };
      } else {
        logger.error('❌ [AUTH] Login failed:', response.data.error);
        return { error: response.data.error || 'Error al iniciar sesión' };
      }
    } catch (err: any) {
      cleanupRequest(cancelSource);

      if (axios.isCancel(err)) {
        logger.log('🚫 [AUTH] Login request cancelled');
        return { error: undefined };
      }

      logger.error('💥 [AUTH] Login error:', err);

      if (err.response) {
        const errorData = err.response.data;
        const errorMessage = errorData.error || 'Credenciales inválidas';
        const errorCode = errorData.errorCode;

        // Special handling for ACCESS_REVOKED (user was removed from all stores)
        if (errorCode === 'ACCESS_REVOKED') {
          logger.warn('⛔ [AUTH] Access revoked - user was removed from stores');
        }

        return { error: errorMessage };
      } else if (err.request) {
        return { error: 'No se pudo conectar con el servidor' };
      } else {
        return { error: 'Error inesperado' };
      }
    }
  }, [createCancellableRequest, cleanupRequest]);

  const signUp = useCallback(async (email: string, password: string, name: string, referralCode?: string) => {
    logger.log('📝 [AUTH] Signing up:', email, referralCode ? `with referral: ${referralCode}` : '');

    const cancelSource = createCancellableRequest();

    try {
      const response = await axios.post(`${API_URL}/register`, {
        email,
        password,
        name,
        referralCode,
      }, {
        cancelToken: cancelSource.token
      });

      cleanupRequest(cancelSource);

      // Check if still mounted before updating state
      if (!isMountedRef.current) return { error: undefined };

      logger.log('✅ [AUTH] Registration response:', response.data);

      if (response.data.success) {
        // A freshly registered user has NOT completed store setup. Stamp the
        // durable flag false explicitly so the restore-path derive rule can't
        // later mistake "has a default store + name" for "onboarded". The
        // Onboarding page flips this to true on completion.
        const userData: User = {
          ...response.data.user,
          onboardingCompleted: false,
        };

        localStorage.setItem('auth_token', response.data.token);
        localStorage.setItem('user', JSON.stringify(userData));
        applySupabaseRealtimeToken(response.data.supabaseToken ?? null);

        // DON'T set onboarding_completed here - user needs to complete onboarding first!
        // The onboarding will be set after the user completes the onboarding form
        localStorage.removeItem('onboarding_completed');

        if (userData.stores && userData.stores.length > 0) {
          setActiveStoreId(userData.stores[0].id);
          setCurrentStore(userData.stores[0]);
        }

        setUser(userData);
        setStores(userData.stores || []);

        logger.log('🎉 [AUTH] Registration successful - user needs to complete onboarding');
        return { error: undefined };
      } else {
        logger.error('❌ [AUTH] Registration failed:', response.data.error);
        return { error: response.data.error || 'Error al crear la cuenta' };
      }
    } catch (err: any) {
      cleanupRequest(cancelSource);

      if (axios.isCancel(err)) {
        logger.log('🚫 [AUTH] Registration request cancelled');
        return { error: undefined };
      }

      logger.error('💥 [AUTH] Registration error:', err);

      if (err.response) {
        return { error: err.response.data.error || 'Error al crear la cuenta' };
      } else if (err.request) {
        return { error: 'No se pudo conectar con el servidor' };
      } else {
        return { error: 'Error inesperado' };
      }
    }
  }, [createCancellableRequest, cleanupRequest]);

  const switchStore = useCallback(async (storeId: string) => {
    logger.log('🔄 [AUTH] Switching store:', storeId);

    const store = stores.find(s => s.id === storeId);
    if (store) {
      // Pin the store to this tab (sessionStorage) + update the new-tab default
      // (localStorage). No cache clear: StoreScopedQueryProvider in App.tsx swaps
      // to this store's own QueryClient, which keeps each store's cache isolated.
      // Data from another store can never appear because they never share a cache.
      setActiveStoreId(storeId);
      setCurrentStore(store);

      logger.log('✅ [AUTH] Switched to store:', store.name);

      // Navigate to dashboard to ensure fresh state (optional, but good UX)
      // window.location.href = '/'; // Still reload? No, we want soft switch.
      // But we might want to redirect to '/' if they are on a specific resource page
    }
  }, [stores]);

  const refreshStores = useCallback(async () => {
    logger.log('🔄 [AUTH] Refreshing stores from server');

    const cancelSource = createCancellableRequest();

    try {
      const token = localStorage.getItem('auth_token');
      const response = await axios.get(`${API_URL}/stores`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        cancelToken: cancelSource.token
      });

      cleanupRequest(cancelSource);

      if (!isMountedRef.current) return { success: true };

      if (!response.data?.success) {
        return { error: response.data?.error || 'No se pudieron refrescar las tiendas' };
      }

      const nextStores: Store[] = response.data.stores || [];
      setStores(nextStores);

      setUser(prev => {
        if (!prev) return prev;
        const updated = { ...prev, stores: nextStores };
        localStorage.setItem('user', JSON.stringify(updated));
        return updated;
      });

      const preferredStoreId = getActiveStoreId() || currentStore?.id || nextStores[0]?.id;
      const updatedCurrentStore = nextStores.find(s => s.id === preferredStoreId) || nextStores[0] || null;
      setCurrentStore(updatedCurrentStore);

      if (updatedCurrentStore) {
        setActiveStoreId(updatedCurrentStore.id);
      } else {
        clearActiveStore();
      }

      return { success: true };
    } catch (err: any) {
      cleanupRequest(cancelSource);

      if (axios.isCancel(err)) {
        return { success: true };
      }

      logger.error('💥 [AUTH] Error refreshing stores:', err);
      if (err.response) {
        return { error: err.response.data?.error || 'Error al refrescar tiendas' };
      }
      if (err.request) {
        return { error: 'No se pudo conectar con el servidor' };
      }
      return { error: 'Error inesperado' };
    }
  }, [createCancellableRequest, cleanupRequest, currentStore?.id]);

  const updateProfile = useCallback(async (data: { userName?: string; userPhone?: string; storeName?: string; storeId?: string }) => {
    logger.log('📝 [AUTH] Updating profile:', data);

    const cancelSource = createCancellableRequest();

    // Auto-fill storeId from current store when storeName is being updated and storeId not explicitly provided
    const payload = data.storeName && !data.storeId && currentStore?.id
      ? { ...data, storeId: currentStore.id }
      : data;

    try {
      const response = await axios.put(`${API_URL}/profile`, payload, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        },
        cancelToken: cancelSource.token
      });

      cleanupRequest(cancelSource);

      // Check if still mounted before updating state
      if (!isMountedRef.current) return { error: undefined };

      logger.log('✅ [AUTH] Profile update response:', response.data);

      if (response.data.success) {
        const userData = response.data.user;

        // Update localStorage
        localStorage.setItem('auth_token', response.data.token);
        localStorage.setItem('user', JSON.stringify(userData));
        if (response.data.supabaseToken) {
          applySupabaseRealtimeToken(response.data.supabaseToken);
        }

        // Update state
        setUser(userData);
        setStores(userData.stores || []);

        // Update current store if name changed
        if (data.storeName && currentStore) {
          const updatedStore = userData.stores.find((s: Store) => s.id === currentStore.id);
          if (updatedStore) {
            setCurrentStore(updatedStore);
          }
        }

        logger.log('🎉 [AUTH] Profile updated successfully');
        return { error: undefined };
      } else {
        logger.error('❌ [AUTH] Profile update failed:', response.data.error);
        return { error: response.data.error || 'Error al actualizar perfil' };
      }
    } catch (err: any) {
      cleanupRequest(cancelSource);

      if (axios.isCancel(err)) {
        logger.log('🚫 [AUTH] Profile update request cancelled');
        return { error: undefined };
      }

      logger.error('💥 [AUTH] Profile update error:', err);

      if (err.response) {
        return { error: err.response.data.error || 'Error al actualizar perfil' };
      } else if (err.request) {
        return { error: 'No se pudo conectar con el servidor' };
      } else {
        return { error: 'Error inesperado' };
      }
    }
  }, [createCancellableRequest, cleanupRequest, currentStore]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    logger.log('🔐 [AUTH] Changing password');

    const cancelSource = createCancellableRequest();

    try {
      const token = localStorage.getItem('auth_token');
      const response = await axios.post(
        `${API_URL}/change-password`,
        { currentPassword, newPassword },
        {
          headers: { Authorization: `Bearer ${token}` },
          cancelToken: cancelSource.token
        }
      );

      cleanupRequest(cancelSource);

      if (response.data.success) {
        logger.log('✅ [AUTH] Password changed successfully');
        return { success: true };
      } else {
        logger.error('❌ [AUTH] Password change failed:', response.data.error);
        return { error: response.data.error || 'Error al cambiar contraseña' };
      }
    } catch (err: any) {
      cleanupRequest(cancelSource);

      if (axios.isCancel(err)) {
        logger.log('🚫 [AUTH] Password change request cancelled');
        return { error: undefined };
      }

      logger.error('💥 [AUTH] Password change error:', err);

      if (err.response?.status === 401) {
        return { error: 'Contraseña actual incorrecta' };
      } else if (err.response) {
        return { error: err.response.data.error || 'Error al cambiar contraseña' };
      } else if (err.request) {
        return { error: 'No se pudo conectar con el servidor' };
      } else {
        return { error: 'Error inesperado' };
      }
    }
  }, [createCancellableRequest, cleanupRequest]);

  const deleteAccount = useCallback(async (password: string) => {
    logger.log('🗑️ [AUTH] Deleting account');

    const cancelSource = createCancellableRequest();

    try {
      const token = localStorage.getItem('auth_token');
      const response = await axios.post(
        `${API_URL}/delete-account`,
        { password },
        {
          headers: { Authorization: `Bearer ${token}` },
          cancelToken: cancelSource.token
        }
      );

      cleanupRequest(cancelSource);

      if (response.data.success) {
        logger.log('✅ [AUTH] Account deleted successfully');
        // Clear all local data
        signOut();
        return { success: true };
      } else {
        logger.error('❌ [AUTH] Account deletion failed:', response.data.error);
        return { error: response.data.error || 'Error al eliminar cuenta' };
      }
    } catch (err: any) {
      cleanupRequest(cancelSource);

      if (axios.isCancel(err)) {
        logger.log('🚫 [AUTH] Account deletion request cancelled');
        return { error: undefined };
      }

      logger.error('💥 [AUTH] Account deletion error:', err);

      if (err.response?.status === 401) {
        return { error: 'Contraseña incorrecta' };
      } else if (err.response) {
        return { error: err.response.data.error || 'Error al eliminar cuenta' };
      } else if (err.request) {
        return { error: 'No se pudo conectar con el servidor' };
      } else {
        return { error: 'Error inesperado' };
      }
    }
  }, [createCancellableRequest, cleanupRequest, signOut]);

  const createStore = useCallback(async (data: { name: string; country?: string; currency?: string; taxRate?: number; adminFee?: number }) => {
    logger.log('🏪 [AUTH] Creating new store:', data.name);

    const cancelSource = createCancellableRequest();

    try {
      const token = localStorage.getItem('auth_token');
      const apiUrl = `${BASE_API_URL}/stores`;

      const response = await axios.post(
        apiUrl,
        {
          name: data.name,
          country: data.country || 'PY',
          currency: data.currency || 'USD',
          tax_rate: data.taxRate || 10.00,
          admin_fee: data.adminFee || 0.00,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
          cancelToken: cancelSource.token
        }
      );

      cleanupRequest(cancelSource);

      // Check if still mounted before updating state
      if (!isMountedRef.current) return { success: true, storeId: response.data.data?.id };

      if (response.data.data) {
        const newStore = response.data.data;
        logger.log('✅ [AUTH] Store created successfully:', newStore.id);

        // Update current user with the new store
        if (user) {
          const newStoreData: Store = {
            id: newStore.id,
            name: newStore.name,
            country: newStore.country,
            currency: newStore.currency,
            role: 'owner'
          };

          const updatedUser = {
            ...user,
            stores: [...user.stores, newStoreData]
          };

          setUser(updatedUser);
          setStores(updatedUser.stores);
          setCurrentStore(newStoreData);
          localStorage.setItem('user', JSON.stringify(updatedUser));
          setActiveStoreId(newStore.id);

          // Reload the page to ensure all data is fresh
          window.location.reload();
        }

        return { success: true, storeId: newStore.id };
      } else {
        logger.error('❌ [AUTH] Store creation failed:', response.data.error);
        return { error: response.data.error || 'Error al crear tienda' };
      }
    } catch (err: any) {
      cleanupRequest(cancelSource);

      if (axios.isCancel(err)) {
        logger.log('🚫 [AUTH] Store creation request cancelled');
        return { error: undefined };
      }

      logger.error('💥 [AUTH] Store creation error:', err);

      if (err.response) {
        return { error: err.response.data.error || err.response.data.message || 'Error al crear tienda' };
      } else if (err.request) {
        return { error: 'No se pudo conectar con el servidor' };
      } else {
        return { error: 'Error inesperado' };
      }
    }
  }, [createCancellableRequest, cleanupRequest, user]);

  const deleteStore = useCallback(async (storeId: string) => {
    logger.log('🗑️ [AUTH] Deleting store:', storeId);

    const cancelSource = createCancellableRequest();

    try {
      const token = localStorage.getItem('auth_token');
      const apiUrl = `${BASE_API_URL}/stores/${storeId}`;

      const response = await axios.delete(apiUrl, {
        headers: { Authorization: `Bearer ${token}` },
        cancelToken: cancelSource.token
      });

      cleanupRequest(cancelSource);

      // Check if still mounted before updating state
      if (!isMountedRef.current) return { success: true };

      if (response.data) {
        logger.log('✅ [AUTH] Store deleted successfully');

        // Update user state - remove the deleted store
        if (user) {
          const updatedStores = user.stores.filter(s => s.id !== storeId);
          const updatedUser = {
            ...user,
            stores: updatedStores
          };

          setUser(updatedUser);
          setStores(updatedStores);

          // If the deleted store was the current store, switch to another one
          if (currentStore?.id === storeId && updatedStores.length > 0) {
            setCurrentStore(updatedStores[0]);
            setActiveStoreId(updatedStores[0].id);
          } else if (updatedStores.length === 0) {
            // This shouldn't happen due to backend validation, but just in case
            setCurrentStore(null);
            clearActiveStore();
          }

          localStorage.setItem('user', JSON.stringify(updatedUser));

          // Reload the page to ensure all data is fresh
          window.location.reload();
        }

        return { success: true };
      } else {
        logger.error('❌ [AUTH] Store deletion failed');
        return { error: 'Error al eliminar tienda' };
      }
    } catch (err: any) {
      cleanupRequest(cancelSource);

      if (axios.isCancel(err)) {
        logger.log('🚫 [AUTH] Store deletion request cancelled');
        return { error: undefined };
      }

      logger.error('💥 [AUTH] Store deletion error:', err);

      if (err.response?.status === 400) {
        return { error: err.response.data.message || 'No puedes eliminar tu última tienda' };
      } else if (err.response?.status === 403) {
        return { error: err.response.data.message || 'No tienes permiso para eliminar esta tienda' };
      } else if (err.response) {
        return { error: err.response.data.error || err.response.data.message || 'Error al eliminar tienda' };
      } else if (err.request) {
        return { error: 'No se pudo conectar con el servidor' };
      } else {
        return { error: 'Error inesperado' };
      }
    }
  }, [createCancellableRequest, cleanupRequest, user, currentStore]);

  // ================================================================
  // Permission System Helpers
  // ================================================================
  const currentRole = useMemo((): Role | null => {
    if (!currentStore?.role) return null;
    const role = currentStore.role.toLowerCase() as Role;
    return Object.values(Role).includes(role) ? role : null;
  }, [currentStore?.role]);

  const permissions = useMemo((): PermissionHelpers => {
    const hasPermission = (module: Module, permission: Permission): boolean => {
      if (!currentRole) return false;
      const modulePermissions = ROLE_PERMISSIONS[currentRole]?.[module] || [];
      return modulePermissions.includes(permission);
    };

    const canAccessModule = (module: Module): boolean => {
      if (!currentRole) return false;
      const modulePermissions = ROLE_PERMISSIONS[currentRole]?.[module] || [];
      return modulePermissions.length > 0;
    };

    const getAccessibleModules = (): Module[] => {
      if (!currentRole) return [];
      return Object.entries(ROLE_PERMISSIONS[currentRole])
        .filter(([_, perms]) => perms.length > 0)
        .map(([mod]) => mod as Module);
    };

    return {
      hasPermission,
      canAccessModule,
      getAccessibleModules,
      currentRole
    };
  }, [currentRole]);

  const onboardingCompleted = useMemo(
    () => deriveOnboardingCompleted(user),
    [user]
  );

  const value = useMemo(() => ({
    user,
    currentStore,
    stores,
    loading,
    onboardingCompleted,
    signIn,
    signUp,
    signOut,
    switchStore,
    updateProfile,
    changePassword,
    deleteAccount,
    createStore,
    deleteStore,
    refreshStores,
    permissions,
  }), [
    user,
    currentStore,
    stores,
    loading,
    onboardingCompleted,
    signIn,
    signUp,
    signOut,
    switchStore,
    updateProfile,
    changePassword,
    deleteAccount,
    createStore,
    deleteStore,
    refreshStores,
    permissions,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
