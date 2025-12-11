// ================================================================
// SHOPIFY APP BRIDGE PROVIDER (FINAL)
// ================================================================
import React, { useEffect, useState, useRef, ReactNode } from 'react';
import { waitForAppBridge, isShopifyEmbedded } from '@/utils/waitForAppBridge';

// Definición de tipos global para window.shopify
declare global {
  interface Window {
    shopify: any;
  }
}

// Definición de las props del componente
interface ShopifyAppBridgeProviderProps {
  children: ReactNode;
}

export function ShopifyAppBridgeProvider({ children }: ShopifyAppBridgeProviderProps) {
  const [isReady, setIsReady] = useState(false);
  const tokenIntervalRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    // 1. Si no estamos en un iframe (modo standalone), no hacemos nada.
    if (!isShopifyEmbedded()) {
      return;
    }

    const initializeAppBridge = async () => {
      try {
        console.log("⏳ [SHOPIFY PROVIDER] Esperando inicialización del script...");
        
        // 2. Esperar a que el script del HTML termine de cargar
        await waitForAppBridge({ timeout: 15000 });

        console.log('✅ [SHOPIFY PROVIDER] Script listo. Solicitando token...');

        // 3. Obtener el token directamente de la instancia global
        // El script del HTML ya hizo el trabajo sucio de configuración.
        if (window.shopify && window.shopify.id) {
            const token = await window.shopify.id.getToken();
            
            if (token) {
              localStorage.setItem('shopify_session_token', token);
              console.log('🎉 [SHOPIFY PROVIDER] Token Generado Exitosamente');
              setIsReady(true);
    
              // 4. Renovar el token automáticamente cada 50 segundos
              tokenIntervalRef.current = setInterval(async () => {
                try {
                  const newToken = await window.shopify.id.getToken();
                  if (newToken) {
                    localStorage.setItem('shopify_session_token', newToken);
                  }
                } catch (err) {
                  console.error('❌ [SHOPIFY] Error renovando token:', err);
                }
              }, 50000);
            }
        }
      } catch (error) {
        console.error('❌ [SHOPIFY] Timeout o error en Provider:', error);
      }
    };

    initializeAppBridge();

    // Limpiar el intervalo cuando el componente se desmonte
    return () => {
      if (tokenIntervalRef.current) {
        clearInterval(tokenIntervalRef.current);
      }
    };
  }, []);

  return <>{children}</>;
}