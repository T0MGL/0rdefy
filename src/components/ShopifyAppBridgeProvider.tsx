// ================================================================
// SHOPIFY APP BRIDGE PROVIDER (HYBRID & ROBUST)
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
    // 1. Si no es embedded (navegador normal), no hacemos nada
    if (!isShopifyEmbedded()) return;
    if (initialized.current) return;
    initialized.current = true;

    const setupAppBridge = async () => {
      console.log("🛠 [Provider] Iniciando configuración de App Bridge...");

      // ============================================================
      // ESTRATEGIA A: Esperar a la inicialización automática del HTML
      // ============================================================
      let attempts = 0;
      const checkAutoInit = setInterval(async () => {
        attempts++;
        
        // Si ya existe .id, el HTML funcionó perfecto
        if (window.shopify && window.shopify.id) {
          clearInterval(checkAutoInit);
          console.log("✅ [Provider] Detectada inicialización automática (HTML).");
          await generateToken();
          return;
        }

        // ============================================================
        // ESTRATEGIA B: FALLBACK MANUAL (Si el HTML falla tras 2 segundos)
        // ============================================================
        if (attempts >= 4) { // 4 intentos de 500ms = 2 segundos
          console.warn("⚠️ [Provider] HTML Auto-init lento o fallido. Forzando inicialización manual...");
          clearInterval(checkAutoInit);
          forceManualInit();
        }
      }, 500);
    };

    const forceManualInit = async () => {
      try {
        if (!window.shopify || !window.shopify.createApp) {
          console.error("❌ [Provider] El script base de App Bridge no cargó.");
          return;
        }

        // Recuperar datos frescos de la URL o SessionStorage
        const urlParams = new URLSearchParams(window.location.search);
        const host = urlParams.get("host") || sessionStorage.getItem("shopify_host");
        const shop = urlParams.get("shop") || sessionStorage.getItem("shopify_shop");
        const apiKey = "e4ac05aaca557fdb387681f0f209335d"; // TU API KEY CORRECTA

        if (!host || !apiKey) {
          console.error("❌ [Provider] Faltan datos para init manual:", { host, apiKey });
          return;
        }

        console.log("🔧 [Provider] Ejecutando createApp manual...", { shop, host });
        
        // FORZAMOS LA CREACIÓN DE LA APP
        window.shopify.createApp({
          apiKey: apiKey,
          shop: shop,
          host: host,
          forceRedirect: true
        });

        // Damos un momento para que se asiente y pedimos token
        setTimeout(async () => {
            if (window.shopify.id) {
                console.log("✅ [Provider] Inicialización manual exitosa.");
                await generateToken();
            } else {
                console.error("❌ [Provider] Falló incluso la inicialización manual.");
            }
        }, 1000);

      } catch (err) {
        console.error("❌ [Provider] Error fatal en init manual:", err);
      }
    };

    const generateToken = async () => {
      try {
        const token = await window.shopify.id.getToken();
        console.log("🎉 [Provider] TOKEN DE SESIÓN OBTENIDO");
        localStorage.setItem('shopify_session_token', token);
        setIsReady(true);
      } catch (e) {
        console.error("❌ [Provider] Error al pedir el token:", e);
      }
    };

    setupAppBridge();

  }, []);

  return <>{children}</>;
}