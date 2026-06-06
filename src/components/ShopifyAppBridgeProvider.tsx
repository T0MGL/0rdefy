// ================================================================
// SHOPIFY APP BRIDGE PROVIDER (Official NPM Implementation)
// ----------------------------------------------------------------
// Responsibilities:
//   1. Initialise App Bridge when the app is mounted inside the
//      Shopify Admin iframe.
//   2. Request a session token from App Bridge.
//   3. If the user has no Ordefy auth_token in localStorage, drive
//      the Token Exchange handshake against our own backend so the
//      reviewer never sees /login inside the iframe (App Store
//      issue 2.1.1).
//   4. Refresh the session token every 45 minutes (tokens expire
//      after 60 minutes per Shopify spec).
// ================================================================
import React, { useEffect, useRef } from 'react';
import * as Sentry from '@sentry/react';
import { logger } from '@/utils/logger';
import { useAuth } from '@/contexts/AuthContext';
import { config } from '@/config';
import { decodeHostShop } from '@/utils/shopifyHost';

// App Bridge ships the app instance type via the createApp return value.
// We import it type-only because createApp is loaded lazily via dynamic
// import() to keep it out of the standalone (non-embedded) bundle.
type AppBridgeApp = ReturnType<typeof import('@shopify/app-bridge').default>;

// API key must come from environment variables (Vite exposes only VITE_* vars)
const API_KEY = import.meta.env.VITE_SHOPIFY_API_KEY;

// Token exchange request configuration. Backend feature-flag controls
// whether the route is enabled, so retrying a disabled route would just
// burn requests. The retry policy guards against transient 5xx /
// network blips during a real install.
const TOKEN_EXCHANGE_MAX_ATTEMPTS = 3;
const TOKEN_EXCHANGE_BACKOFF_MS = [1000, 2000, 4000];

// Extend Window interface for Shopify globals
declare global {
  interface Window {
    __SHOPIFY_EMBEDDED__?: boolean;
    // App Bridge exposes two distinct shapes on window.shopify across the
    // app: the CDN global (with .createApp) used by useShopifyAppBridge /
    // waitForAppBridge, and the created app instance assigned below. They
    // share this single global slot, so it stays `any` here to match the
    // other declaration sites and avoid a merged-declaration type clash.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shopify?: any;
  }
}

interface TokenExchangeResponse {
  ordefyToken: string;
  userId: string;
  storeId: string;
  isNewProvision: boolean;
  isReinstall: boolean;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function performTokenExchange(
  sessionToken: string,
  shopFromHost: string | null,
): Promise<{ ok: true; data: TokenExchangeResponse } | { ok: false; status: number; body: unknown }> {
  const url = new URL(`${config.api.baseUrl}/api/shopify/auth/token-exchange`);
  if (shopFromHost) {
    url.searchParams.set('shop', shopFromHost);
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Session': 'true',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ session_token: sessionToken }),
  });

  if (response.ok) {
    const data = (await response.json()) as TokenExchangeResponse;
    return { ok: true, data };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = await response.text();
  }
  return { ok: false, status: response.status, body };
}

export function ShopifyAppBridgeProvider({ children }: { children: React.ReactNode }) {
  const appRef = useRef<AppBridgeApp | null>(null);
  const initialized = useRef(false);
  const tokenExchangeAttempted = useRef(false);
  const { refreshUser, setShopifyAuthInProgress } = useAuth();

  useEffect(() => {
    // Check if we're in an iframe (Shopify embedded context)
    const isInIframe = window.top !== window.self;

    if (!isInIframe) {
      logger.log('🏠 [SHOPIFY] Standalone mode - App Bridge disabled');
      // Ensure the connecting flag is off in standalone, regardless of
      // any earlier guess made in AuthContext during SSR-less init.
      setShopifyAuthInProgress(false);
      return;
    }

    // Prevent multiple initializations
    if (initialized.current) return;
    initialized.current = true;

    const triggerTokenExchangeIfNeeded = async (sessionToken: string) => {
      if (tokenExchangeAttempted.current) return;

      const hasOrdefyToken = !!localStorage.getItem('auth_token');
      if (hasOrdefyToken) {
        // Already authenticated. App Bridge token is still useful for
        // request signing, but we do not need to provision again.
        setShopifyAuthInProgress(false);
        return;
      }

      tokenExchangeAttempted.current = true;
      setShopifyAuthInProgress(true);

      const urlParams = new URLSearchParams(window.location.search);
      const shopFromHost = urlParams.get('shop') || decodeHostShop(urlParams.get('host'));

      Sentry.addBreadcrumb({
        category: 'shopify',
        message: 'token_exchange.start',
        level: 'info',
        data: { shop: shopFromHost, attempts: TOKEN_EXCHANGE_MAX_ATTEMPTS },
      });

      let lastError: unknown = null;
      for (let attempt = 1; attempt <= TOKEN_EXCHANGE_MAX_ATTEMPTS; attempt += 1) {
        try {
          const result = await performTokenExchange(sessionToken, shopFromHost);
          if (result.ok) {
            localStorage.setItem('auth_token', result.data.ordefyToken);
            Sentry.addBreadcrumb({
              category: 'shopify',
              message: 'token_exchange.success',
              level: 'info',
              data: {
                shop: shopFromHost,
                attempt,
                isNewProvision: result.data.isNewProvision,
                isReinstall: result.data.isReinstall,
              },
            });

            const refreshResult = await refreshUser();
            if (refreshResult.error) {
              Sentry.captureMessage('shopify.token_exchange.refresh_user_failed', {
                level: 'error',
                extra: { shop: shopFromHost, error: refreshResult.error },
              });
              logger.error('❌ [SHOPIFY] refreshUser after token exchange failed:', refreshResult.error);
            }

            setShopifyAuthInProgress(false);
            return;
          }

          lastError = result;
          Sentry.addBreadcrumb({
            category: 'shopify',
            message: 'token_exchange.failure',
            level: result.status >= 500 ? 'error' : 'warning',
            data: { shop: shopFromHost, attempt, status: result.status },
          });

          // 4xx is a hard fail (bad shop, audience mismatch, feature
          // flag off). Retrying will not help.
          if (result.status >= 400 && result.status < 500 && result.status !== 408 && result.status !== 429) {
            logger.error('❌ [SHOPIFY] Token exchange returned 4xx, aborting retries:', result);
            break;
          }
        } catch (err) {
          lastError = err;
          Sentry.addBreadcrumb({
            category: 'shopify',
            message: 'token_exchange.network_error',
            level: 'error',
            data: { shop: shopFromHost, attempt, err: String(err) },
          });
          logger.error('❌ [SHOPIFY] Token exchange network error:', err);
        }

        if (attempt < TOKEN_EXCHANGE_MAX_ATTEMPTS) {
          await sleep(TOKEN_EXCHANGE_BACKOFF_MS[attempt - 1] ?? 4000);
        }
      }

      Sentry.captureMessage('shopify.token_exchange.exhausted', {
        level: 'error',
        extra: { shop: shopFromHost, lastError },
      });
      logger.error('❌ [SHOPIFY] Token exchange exhausted retries:', lastError);
      // Leave shopifyAuthInProgress=true so the connecting screen can
      // show the auth_failed fallback (it has its own 10s timeout).
      // The PrivateRoute / Login auth_failed screen lets the user
      // retry or escape to a top-level window.
      setShopifyAuthInProgress(false);
    };

    const generateToken = async (app: AppBridgeApp): Promise<string | null> => {
      try {
        logger.log('🔑 [SHOPIFY] Generating session token...');
        const { getSessionToken } = await import('@shopify/app-bridge/utilities');
        const token = await getSessionToken(app);

        if (token) {
          logger.log('✅ [SHOPIFY] Token generated via NPM Provider');
          localStorage.setItem('shopify_session_token', token);
          return token;
        }
        logger.warn('⚠️ [SHOPIFY] Token is empty');
        return null;
      } catch (error) {
        logger.error('❌ [SHOPIFY] Error generating token:', error);
        return null;
      }
    };

    const initializeAppBridge = async () => {
      try {
        if (!API_KEY) {
          logger.error('❌ [SHOPIFY] Missing VITE_SHOPIFY_API_KEY environment variable');
          setShopifyAuthInProgress(false);
          return;
        }

        logger.log('✅ [SHOPIFY] Initializing App Bridge with official NPM library');

        // Get host from URL params or sessionStorage
        const urlParams = new URLSearchParams(window.location.search);
        const shop = urlParams.get('shop');
        const host = urlParams.get('host');

        // Persist to sessionStorage
        if (shop) {
          sessionStorage.setItem('shopify_shop', shop);
          window.__SHOPIFY_EMBEDDED__ = true;
        }
        if (host) {
          sessionStorage.setItem('shopify_host', host);
        }

        // Get final values
        const savedHost = host || sessionStorage.getItem('shopify_host');

        if (!savedHost) {
          logger.error('❌ [SHOPIFY] No host parameter found');
          setShopifyAuthInProgress(false);
          return;
        }

        // forceRedirect was removed: it triggers top-level redirects when
        // the page detects iframe state, which creates a redirect loop
        // during install (issue 2.1.1) because reviewers come in with no
        // Ordefy session yet. Token Exchange handles auth instead.
        const appConfig = {
          apiKey: API_KEY,
          host: savedHost,
        };

        // Keep the Shopify API key meta tag in sync for App Bridge compatibility
        const shopifyApiKeyMeta = document.querySelector('meta[name="shopify-api-key"]');
        if (shopifyApiKeyMeta) {
          shopifyApiKeyMeta.setAttribute('content', API_KEY);
        }

        logger.log('📦 [SHOPIFY] Config:', {
          apiKey: API_KEY.substring(0, 8) + '...',
          host: savedHost,
        });

        const { default: createApp } = await import('@shopify/app-bridge');

        // Create the app instance
        const app = createApp(appConfig);
        appRef.current = app;

        // Set window.shopify for useAppBridge hook compatibility
        window.shopify = app;

        logger.log('✅ [SHOPIFY] App Bridge initialized successfully');

        // Generate session token, then drive token exchange if needed.
        const sessionToken = await generateToken(app);
        if (sessionToken) {
          await triggerTokenExchangeIfNeeded(sessionToken);
        } else {
          // No session token means we cannot exchange. Surface the
          // connecting screen failure so the user can retry / break out.
          Sentry.captureMessage('shopify.session_token.empty', {
            level: 'error',
            extra: { shop, host: savedHost },
          });
          setShopifyAuthInProgress(false);
        }
      } catch (error) {
        Sentry.captureException(error, { tags: { shopify_phase: 'init' } });
        logger.error('❌ [SHOPIFY] Error initializing App Bridge:', error);
        setShopifyAuthInProgress(false);
      }
    };

    initializeAppBridge();

    // Setup token refresh interval (every 45 minutes, tokens expire after 1 hour)
    const refreshInterval = setInterval(() => {
      if (appRef.current) {
        logger.log('🔄 [SHOPIFY] Refreshing session token...');
        generateToken(appRef.current);
      }
    }, 45 * 60 * 1000);

    return () => {
      clearInterval(refreshInterval);
    };
    // refreshUser and setShopifyAuthInProgress are stable callbacks
    // from AuthContext; the effect only needs to run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Always render children. Route gating happens in PrivateRoute /
  // Login based on shopifyAuthInProgress.
  return <>{children}</>;
}
