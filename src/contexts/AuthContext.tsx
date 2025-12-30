import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

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
}

interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  stores: Store[];
}

interface AuthContextType {
  user: User | null;
  currentStore: Store | null;
  stores: Store[];
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string, name: string) => Promise<{ error?: string }>;
  signOut: () => void;
  switchStore: (storeId: string) => void;
  updateProfile: (data: { userName?: string; userPhone?: string; storeName?: string }) => Promise<{ error?: string }>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ success?: boolean; error?: string }>;
  deleteAccount: (password: string) => Promise<{ success?: boolean; error?: string }>;
  createStore: (data: { name: string; country?: string; currency?: string; taxRate?: number; adminFee?: number }) => Promise<{ success?: boolean; error?: string; storeId?: string }>;
  deleteStore: (storeId: string) => Promise<{ success?: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [currentStore, setCurrentStore] = useState<Store | null>(null);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('🔄 [AUTH] Initializing auth state...');

    const token = localStorage.getItem('auth_token');
    const savedUser = localStorage.getItem('user');
    const savedStoreId = localStorage.getItem('current_store_id');

    if (token && savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        console.log('✅ [AUTH] Found existing session:', parsedUser.email);

        setUser(parsedUser);
        setStores(parsedUser.stores || []);

        if (savedStoreId && parsedUser.stores) {
          const store = parsedUser.stores.find((s: Store) => s.id === savedStoreId);
          setCurrentStore(store || parsedUser.stores[0]);
        } else if (parsedUser.stores && parsedUser.stores.length > 0) {
          setCurrentStore(parsedUser.stores[0]);
          localStorage.setItem('current_store_id', parsedUser.stores[0].id);
        }
      } catch (error) {
        console.error('❌ [AUTH] Failed to parse saved user:', error);
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user');
      }
    } else {
      console.log('⚠️ [AUTH] No existing session found');
    }

    setLoading(false);
  }, []);

  // Listen for session expiration events from api.client.ts
  useEffect(() => {
    const handleSessionExpired = () => {
      console.warn('⚠️ [AUTH] Session expired event received. Logging out...');
      signOut();
    };

    window.addEventListener('auth:session-expired', handleSessionExpired);

    return () => {
      window.removeEventListener('auth:session-expired', handleSessionExpired);
    };
  }, []);

  // NO periodic check - token validation happens ONLY in API interceptor
  // This saves resources and is sufficient for 7-day tokens

  const signIn = async (email: string, password: string) => {
    console.log('🔐 [AUTH] Signing in:', email);

    try {
      const response = await axios.post(`${API_URL}/login`, {
        email,
        password,
      });

      console.log('✅ [AUTH] Login response:', response.data);

      if (response.data.success) {
        const userData = response.data.user;

        localStorage.setItem('auth_token', response.data.token);
        localStorage.setItem('user', JSON.stringify(userData));

        // Save onboarding completion status if user already completed onboarding
        if (response.data.onboardingCompleted) {
          localStorage.setItem('onboarding_completed', 'true');
          console.log('✅ [AUTH] User has already completed onboarding');
        } else {
          console.log('⚠️ [AUTH] User needs to complete onboarding');
        }

        if (userData.stores && userData.stores.length > 0) {
          localStorage.setItem('current_store_id', userData.stores[0].id);
          setCurrentStore(userData.stores[0]);
        }

        setUser(userData);
        setStores(userData.stores || []);

        console.log('🎉 [AUTH] Login successful');
        return { error: undefined };
      } else {
        console.error('❌ [AUTH] Login failed:', response.data.error);
        return { error: response.data.error || 'Error al iniciar sesión' };
      }
    } catch (err: any) {
      console.error('💥 [AUTH] Login error:', err);

      if (err.response) {
        return { error: err.response.data.error || 'Credenciales inválidas' };
      } else if (err.request) {
        return { error: 'No se pudo conectar con el servidor' };
      } else {
        return { error: 'Error inesperado' };
      }
    }
  };

  const signUp = async (email: string, password: string, name: string) => {
    console.log('📝 [AUTH] Signing up:', email);

    try {
      const response = await axios.post(`${API_URL}/register`, {
        email,
        password,
        name,
      });

      console.log('✅ [AUTH] Registration response:', response.data);

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

        console.log('🎉 [AUTH] Registration successful - user needs to complete onboarding');
        return { error: undefined };
      } else {
        console.error('❌ [AUTH] Registration failed:', response.data.error);
        return { error: response.data.error || 'Error al crear la cuenta' };
      }
    } catch (err: any) {
      console.error('💥 [AUTH] Registration error:', err);

      if (err.response) {
        return { error: err.response.data.error || 'Error al crear la cuenta' };
      } else if (err.request) {
        return { error: 'No se pudo conectar con el servidor' };
      } else {
        return { error: 'Error inesperado' };
      }
    }
  };

  const signOut = async () => {
    console.log('👋 [AUTH] Signing out');

    // Call backend to terminate session
    try {
      const token = localStorage.getItem('auth_token');
      if (token) {
        await axios.post(`${API_URL}/logout`, {}, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        console.log('✅ [AUTH] Session terminated on server');
      }
    } catch (err) {
      console.error('⚠️ [AUTH] Failed to terminate session on server:', err);
      // Continue with client-side logout even if server call fails
    }

    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    localStorage.removeItem('current_store_id');
    localStorage.removeItem('onboarding_completed');

    setUser(null);
    setStores([]);
    setCurrentStore(null);

    console.log('✅ [AUTH] Signed out successfully');
  };


  // Inject query client for manual invalidation
  const queryClient = useQueryClient();

  const switchStore = async (storeId: string) => {
    console.log('🔄 [AUTH] Switching store:', storeId);

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

      console.log('✅ [AUTH] Switched to store:', store.name);

      // Navigate to dashboard to ensure fresh state (optional, but good UX)
      // window.location.href = '/'; // Still reload? No, we want soft switch.
      // But we might want to redirect to '/' if they are on a specific resource page
    }
  };

  const updateProfile = async (data: { userName?: string; userPhone?: string; storeName?: string }) => {
    console.log('📝 [AUTH] Updating profile:', data);

    try {
      const response = await axios.put(`${API_URL}/profile`, data, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`
        }
      });

      console.log('✅ [AUTH] Profile update response:', response.data);

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

        console.log('🎉 [AUTH] Profile updated successfully');
        return { error: undefined };
      } else {
        console.error('❌ [AUTH] Profile update failed:', response.data.error);
        return { error: response.data.error || 'Error al actualizar perfil' };
      }
    } catch (err: any) {
      console.error('💥 [AUTH] Profile update error:', err);

      if (err.response) {
        return { error: err.response.data.error || 'Error al actualizar perfil' };
      } else if (err.request) {
        return { error: 'No se pudo conectar con el servidor' };
      } else {
        return { error: 'Error inesperado' };
      }
    }
  };

  const changePassword = async (currentPassword: string, newPassword: string) => {
    console.log('🔐 [AUTH] Changing password');

    try {
      const token = localStorage.getItem('auth_token');
      const response = await axios.post(
        `${API_URL}/change-password`,
        { currentPassword, newPassword },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data.success) {
        console.log('✅ [AUTH] Password changed successfully');
        return { success: true };
      } else {
        console.error('❌ [AUTH] Password change failed:', response.data.error);
        return { error: response.data.error || 'Error al cambiar contraseña' };
      }
    } catch (err: any) {
      console.error('💥 [AUTH] Password change error:', err);

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
  };

  const deleteAccount = async (password: string) => {
    console.log('🗑️ [AUTH] Deleting account');

    try {
      const token = localStorage.getItem('auth_token');
      const response = await axios.post(
        `${API_URL}/delete-account`,
        { password },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data.success) {
        console.log('✅ [AUTH] Account deleted successfully');
        // Clear all local data
        signOut();
        return { success: true };
      } else {
        console.error('❌ [AUTH] Account deletion failed:', response.data.error);
        return { error: response.data.error || 'Error al eliminar cuenta' };
      }
    } catch (err: any) {
      console.error('💥 [AUTH] Account deletion error:', err);

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
  };

  const createStore = async (data: { name: string; country?: string; currency?: string; taxRate?: number; adminFee?: number }) => {
    console.log('🏪 [AUTH] Creating new store:', data.name);

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
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (response.data.data) {
        const newStore = response.data.data;
        console.log('✅ [AUTH] Store created successfully:', newStore.id);

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
        console.error('❌ [AUTH] Store creation failed:', response.data.error);
        return { error: response.data.error || 'Error al crear tienda' };
      }
    } catch (err: any) {
      console.error('💥 [AUTH] Store creation error:', err);

      if (err.response) {
        return { error: err.response.data.error || err.response.data.message || 'Error al crear tienda' };
      } else if (err.request) {
        return { error: 'No se pudo conectar con el servidor' };
      } else {
        return { error: 'Error inesperado' };
      }
    }
  };

  const deleteStore = async (storeId: string) => {
    console.log('🗑️ [AUTH] Deleting store:', storeId);

    try {
      const token = localStorage.getItem('auth_token');
      const apiUrl = `${BASE_API_URL}/stores/${storeId}`;

      const response = await axios.delete(apiUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data) {
        console.log('✅ [AUTH] Store deleted successfully');

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
        console.error('❌ [AUTH] Store deletion failed');
        return { error: 'Error al eliminar tienda' };
      }
    } catch (err: any) {
      console.error('💥 [AUTH] Store deletion error:', err);

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
  };

  const value = {
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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
