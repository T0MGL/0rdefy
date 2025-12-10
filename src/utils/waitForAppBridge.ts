// ================================================================
// WAIT FOR APP BRIDGE - Clean Promise Pattern
// ================================================================
// Silently waits for App Bridge to load, no noisy retry logs
// ================================================================

// Extend Window interface for Shopify App Bridge
declare global {
  interface Window {
    __SHOPIFY_EMBEDDED__?: boolean;
    shopify?: {
      createApp?: (config: {
        apiKey: string;
        host?: string;
        shop?: string;
        forceRedirect?: boolean;
      }) => {
        idToken: () => Promise<string>;
        dispatch: (action: any) => void;
        subscribe: (callback: (data: any) => void) => () => void;
      };
    };
  }
}

interface WaitForAppBridgeOptions {
  timeout?: number; // ms, default 15000
  checkInterval?: number; // ms, default 50
}

/**
 * Waits for Shopify App Bridge to load (window.shopify.createApp)
 * Returns a Promise that resolves when ready or rejects on timeout
 *
 * @param options - Configuration options
 * @returns Promise<void>
 */
export function waitForAppBridge(options: WaitForAppBridgeOptions = {}): Promise<void> {
  const { timeout = 15000, checkInterval = 50 } = options;

  return new Promise((resolve, reject) => {
    // Check if already available
    if (window.shopify?.createApp) {
      resolve();
      return;
    }

    const startTime = Date.now();

    const intervalId = setInterval(() => {
      // Check if App Bridge is ready
      if (window.shopify?.createApp) {
        clearInterval(intervalId);
        resolve();
        return;
      }

      // Check timeout
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeout) {
        clearInterval(intervalId);
        reject(new Error(`App Bridge failed to load after ${timeout}ms`));
      }
    }, checkInterval);
  });
}

/**
 * Check if we're running in embedded mode (iframe)
 */
export function isEmbedded(): boolean {
  return window.top !== window.self;
}

/**
 * Check if embedded flag is set
 */
export function isShopifyEmbedded(): boolean {
  return !!(window as any).__SHOPIFY_EMBEDDED__;
}
