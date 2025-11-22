import { useEffect } from 'react';
import { useShopifyAppBridge } from '@/hooks/useShopifyAppBridge';

interface ShopifyInitializerProps {
  children: React.ReactNode;
}

/**
 * Componente que inicializa Shopify App Bridge y obtiene el token de sesión
 * Debe envolver toda la aplicación para asegurar que el token esté disponible
 * antes de hacer cualquier llamada a la API.
 *
 * @param {ShopifyInitializerProps} props - Props del componente
 * @returns {JSX.Element} Children envueltos
 */
export const ShopifyInitializer: React.FC<ShopifyInitializerProps> = ({ children }) => {
  const { sessionToken, isLoading, error, app } = useShopifyAppBridge();

  useEffect(() => {
    if (sessionToken) {
      console.log('[ShopifyInitializer] Session token is ready for API calls');
    }
  }, [sessionToken]);

  useEffect(() => {
    if (error) {
      console.error('[ShopifyInitializer] Error initializing App Bridge:', error);
    }
  }, [error]);

  // No mostramos ningún loading state para no interrumpir la experiencia del usuario
  // La aplicación funcionará con o sin Shopify App Bridge (modo standalone vs embedded)
  return <>{children}</>;
};
