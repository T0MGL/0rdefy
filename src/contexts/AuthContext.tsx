import { createContext, useContext, useEffect, useState, ReactNode, useMemo, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import axios, { CancelTokenSource } from 'axios';
import { safeJsonParse } from '@/lib/utils';
import { logger } from '@/utils/logger';

// ================================================================
// Permission System Types and Constants
// ================================================================
export enum Role {
  OWNER = 'owner',
  ADMIN = 'admin',
  LOGISTICS = 'logistics',
  CONFIRMADOR = 'confirmador',
  CONTADOR = 'contador',
  INVENTARIO = 'inventario'
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
  INTEGRATIONS = 'integrations'
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

interface Store {
  id: string;
  name: string;
  country: string;
  currency: string;
  role: string;
  timezone?: string;
  separate_confirmation_flow?: boolean;
}

interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  stores: Store[];
}

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
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, name: string, referralCode?: string) => Promise<{ error?: string }>;
  signOut: () => void;
  switchStore: (storeId: string) => void;
  updateProfile: (data: { userName?: string; userPhone?: string; storeName?: string }) => Promise<{ error?: string }>;
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
    return () => {
      isMountedRef.current = false;
      // Cancel all pending requests
      activeRequestsRef.current.forEach(source => {
        source.cancel('Component unmounted');
      });
      activeRequestsRef.current.clear();
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
    localStorage.removeItem('current_store_id');
    localStorage.removeItem('onboarding_completed');

    setUser(null);
    setStores([]);
    setCurrentStore(null);

    logger.log('✅ [AUTH] Signed out successfully');
  }, [createCancellableRequest, cleanupRequest]);

  useEffect(() => {
    logger.log('🔄 [AUTH] Initializing auth state...');

    const token = localStorage.getItem('auth_token');
    const savedUser = localStorage.getItem('user');
    const savedStoreId = localStorage.getItem('current_store_id');

    if (token && savedUser) {
      // Use safeJsonParse to prevent crashes from corrupted localStorage data
      const parsedUser = safeJsonParse<User | null>(savedUser, null);

      if (parsedUser) {
        logger.log('✅ [AUTH] Found existing session:', parsedUser.email);

        setUser(parsedUser);
        setStores(parsedUser.stores || []);

        if (savedStoreId && parsedUser.stores) {
          const store = parsedUser.stores.find((s: Store) => s.id === savedStoreId);
          setCurrentStore(store || parsedUser.stores[0]);
        } else if (parsedUser.stores && parsedUser.stores.length > 0) {
          setCurrentStore(parsedUser.stores[0]);
          localStorage.setItem('current_store_id', parsedUser.stores[0].id);
        }
      } else {
        // Parse failed - clear corrupted data
        logger.error('❌ [AUTH] Failed to parse saved user data - clearing session');
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user');
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
        const userData = response.data.user;

        localStorage.setItem('auth_token', response.data.token);
        localStorage.setItem('user', JSON.stringify(userData));

        // Save onboarding completion status based on server response
        if (response.data.onboardingCompleted) {
          localStorage.setItem('onboarding_completed', 'true');
          logger.log('✅ [AUTH] User has already completed onboarding');
        } else {
          // Clear onboarding_completed if server says it's not done
          // This handles cases where old localStorage data might be stale
          localStorage.removeItem('onboarding_completed');
          logger.log('⚠️ [AUTH] User needs to complete onboarding');
        }

        if (userData.stores && userData.stores.length > 0) {
          localStorage.setItem('current_store_id', userData.stores[0].id);
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
        const userData = response.data.user;

        localStorage.setItem('auth_token', response.data.token);
        localStorage.setItem('user', JSON.stringify(userData));

        // DON'T set onboarding_completed here - user needs to complete onboarding first!
        // The onboarding will be set after the user completes the onboarding form

        if (userData.stores && userData.stores.length > 0) {
          localStorage.setItem('current_store_id', userData.stores[0].id);
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

  // Inject query client for manual invalidation
  const queryClient = useQueryClient();

  const switchStore = async (storeId: string) => {
    logger.log('🔄 [AUTH] Switching store:', storeId);

    const store = stores.find(s => s.id === storeId);
    if (store) {
      // 1. Update localStorage
      localStorage.setItem('current_store_id', storeId);

      // 2. Clear query cache to prevent data bleeding
      // This ensures we don't show Order #123 from Store A in Store B
      queryClient.cancelQueries();
      queryClient.clear();

      // 3. Update state (triggers re-render)
      setCurrentStore(store);

      // 4. Invalidate all queries to force refetch with new store ID
      // Since API calls usually depend on currentStore or get it from localStorage/context
      await queryClient.invalidateQueries();

      logger.log('✅ [AUTH] Switched to store:', store.name);

      // Navigate to dashboard to ensure fresh state (optional, but good UX)
      // window.location.href = '/'; // Still reload? No, we want soft switch.
      // But we might want to redirect to '/' if they are on a specific resource page
    }
  };

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

      const preferredStoreId = localStorage.getItem('current_store_id') || currentStore?.id || nextStores[0]?.id;
      const updatedCurrentStore = nextStores.find(s => s.id === preferredStoreId) || nextStores[0] || null;
      setCurrentStore(updatedCurrentStore);

      if (updatedCurrentStore) {
        localStorage.setItem('current_store_id', updatedCurrentStore.id);
      } else {
        localStorage.removeItem('current_store_id');
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

  const updateProfile = useCallback(async (data: { userName?: string; userPhone?: string; storeName?: string }) => {
    logger.log('📝 [AUTH] Updating profile:', data);

    const cancelSource = createCancellableRequest();

    try {
      const response = await axios.put(`${API_URL}/profile`, data, {
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
          localStorage.setItem('current_store_id', newStore.id);

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
            localStorage.setItem('current_store_id', updatedStores[0].id);
          } else if (updatedStores.length === 0) {
            // This shouldn't happen due to backend validation, but just in case
            setCurrentStore(null);
            localStorage.removeItem('current_store_id');
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

  const value = useMemo(() => ({
    user,
    currentStore,
    stores,
    loading,
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
  }), [user, currentStore, stores, loading, permissions, refreshStores]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
