// ================================================================
// SHOPIFY APP BRIDGE PROVIDER (V4 NATIVE FIX)
// ================================================================
import React, { useEffect, useState, useRef } from 'react';
import { isShopifyEmbedded } from '@/utils/waitForAppBridge';

declare global {
  interface Window {
    shopify: any;
  }
}

export function ShopifyAppBridgeProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    // 1. Si no es embedded, salir
    if (!isShopifyEmbedded()) return;
    if (initialized.current) return;
    initialized.current = true;

    const setupAppBridge = async () => {
      console.log("🛠 [Provider] Iniciando vigilancia de App Bridge...");

      let attempts = 0;
      const checkInterval = setInterval(async () => {
        attempts++;

        // ============================================================
        // CASO DE ÉXITO: App Bridge ya generó el ID
        // ============================================================
        if (window.shopify && window.shopify.id) {
          clearInterval(checkInterval);
          console.log("✅ [Provider] App Bridge conectado exitosamente.");
          await generateToken();
          return;
        }

        // ============================================================
        // INTENTO DE RESCATE (Si el script existe pero está dormido)
        // ============================================================
        if (window.shopify && !window.shopify.id && attempts % 5 === 0) {
           console.log(`⚠️ [Provider] App Bridge cargado pero sin ID (Intento ${attempts}). Reinyectando configuración...`);
           
           // Recuperar datos
           const urlParams = new URLSearchParams(window.location.search);
           const host = urlParams.get("host") || sessionStorage.getItem("shopify_host");
           const shop = urlParams.get("shop") || sessionStorage.getItem("shopify_shop");
           const apiKey = "e4ac05aaca557fdb387681f0f209335d"; // TU API KEY

           // Inyección directa de configuración (Truco para V4)
           if (host && shop) {
               window.shopify.config = {
                   apiKey: apiKey,
                   host: host,
                   shop: shop,
                   forceRedirect: true
               };
           }
        }

        // ============================================================
        // TIMEOUT (20 segundos)
        // ============================================================
        if (attempts >= 40) { 
          clearInterval(checkInterval);
          console.error("❌ [Provider] Timeout definitivo. App Bridge no respondió.");
          // Aún así renderizamos la app para no dejar pantalla blanca
          setIsReady(true);
        }
      }, 500);
    };

    const generateToken = async () => {
      try {
        const token = await window.shopify.id.getToken();
        console.log("🎉 [Provider] TOKEN OBTENIDO:", token);
        localStorage.setItem('shopify_session_token', token);
        setIsReady(true);
      } catch (e) {
        console.error("❌ [Provider] Error al pedir token:", e);
      }
    };

    setupAppBridge();

  }, []);

  return <>{children}</>;
}