import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    // Check localStorage first
    const savedTheme = localStorage.getItem('theme') as Theme | null;
    if (savedTheme) {
      return savedTheme;
    }

    // Default to dark theme (user can change in preferences)
    return 'dark';
  });

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const root = window.document.documentElement;

    // Remove both classes first
    root.classList.remove('light', 'dark');

    // Add the current theme
    root.classList.add(theme);

    // Save to localStorage
    localStorage.setItem('theme', theme);

    // Update meta theme-color for mobile browsers
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute(
        'content',
        theme === 'dark' ? 'hsl(240, 10%, 8%)' : 'hsl(0, 0%, 98%)'
      );
    }
  }, [theme, mounted]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
  };

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  // Prevent flash of unstyled content - apply theme immediately on mount
  useEffect(() => {
    const root = window.document.documentElement;
    const initialTheme = localStorage.getItem('theme') as Theme | null;

    root.classList.remove('light', 'dark');
    if (initialTheme) {
      root.classList.add(initialTheme);
    } else {
      // Default to dark theme
      root.classList.add('dark');
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
