import { createContext, useContext, useState, useCallback, ReactNode, useMemo, useEffect } from 'react';

// Storage key for global view preference
const GLOBAL_VIEW_STORAGE_KEY = 'dashboard_global_view';

interface GlobalViewContextType {
  globalViewEnabled: boolean;
  setGlobalViewEnabled: (enabled: boolean) => void;
  toggleGlobalView: () => void;
}

const GlobalViewContext = createContext<GlobalViewContextType | undefined>(undefined);

// Safe localStorage access (handles SSR, private browsing, quota exceeded)
const safeGetItem = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSetItem = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Silently fail - localStorage might be full or unavailable
  }
};

export function GlobalViewProvider({ children }: { children: ReactNode }) {
  const [globalViewEnabled, setGlobalViewEnabledState] = useState(() => {
    const saved = safeGetItem(GLOBAL_VIEW_STORAGE_KEY);
    return saved === 'true';
  });

  const setGlobalViewEnabled = useCallback((enabled: boolean) => {
    setGlobalViewEnabledState(enabled);
    safeSetItem(GLOBAL_VIEW_STORAGE_KEY, String(enabled));
  }, []);

  const toggleGlobalView = useCallback(() => {
    setGlobalViewEnabledState(prev => {
      const newValue = !prev;
      safeSetItem(GLOBAL_VIEW_STORAGE_KEY, String(newValue));
      return newValue;
    });
  }, []);

  // Auto-disable global view when user switches window/tab to avoid costly reloads
  useEffect(() => {
    const disableGlobalView = () => {
      setGlobalViewEnabledState(prev => {
        if (!prev) return prev;
        safeSetItem(GLOBAL_VIEW_STORAGE_KEY, 'false');
        return false;
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        disableGlobalView();
      }
    };

    window.addEventListener('blur', disableGlobalView);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('blur', disableGlobalView);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo(() => ({
    globalViewEnabled,
    setGlobalViewEnabled,
    toggleGlobalView,
  }), [globalViewEnabled, setGlobalViewEnabled, toggleGlobalView]);

  return (
    <GlobalViewContext.Provider value={value}>
      {children}
    </GlobalViewContext.Provider>
  );
}

export function useGlobalView() {
  const context = useContext(GlobalViewContext);
  if (context === undefined) {
    throw new Error('useGlobalView must be used within a GlobalViewProvider');
  }
  return context;
}
