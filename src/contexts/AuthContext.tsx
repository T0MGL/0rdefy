import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import axios from 'axios';

const API_URL = `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/auth`;

// Token validation is handled in API interceptor (api.client.ts)
// No need for duplicate validation here - saves resources

interface Store {
  id: string;
  name: string;
  country: string;
  currency: string;
  role: string;
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

  const signOut = () => {
    console.log('👋 [AUTH] Signing out');

    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    localStorage.removeItem('current_store_id');
    localStorage.removeItem('onboarding_completed');

    setUser(null);
    setStores([]);
    setCurrentStore(null);

    console.log('✅ [AUTH] Signed out successfully');
  };

  const switchStore = (storeId: string) => {
    console.log('🔄 [AUTH] Switching store:', storeId);

    const store = stores.find(s => s.id === storeId);
    if (store) {
      setCurrentStore(store);
      localStorage.setItem('current_store_id', storeId);
      console.log('✅ [AUTH] Switched to store:', store.name);
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
