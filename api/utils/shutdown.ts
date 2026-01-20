/**
 * Graceful Shutdown Manager
 *
 * Centralizes cleanup of all intervals, caches, and resources during SIGTERM/SIGINT.
 * Critical for Railway/Kubernetes deployments where pods receive SIGTERM before restart.
 *
 * Without proper cleanup:
 * - Intervals become orphaned and continue running
 * - Memory leaks accumulate across deploys
 * - Database connections may not close properly
 */

import { logger } from './logger';

type CleanupFunction = () => void | Promise<void>;

interface RegisteredCleanup {
  name: string;
  cleanup: CleanupFunction;
  priority: number; // Lower = runs first
}

const cleanupHandlers: RegisteredCleanup[] = [];
let isShuttingDown = false;
let shutdownTimeout: NodeJS.Timeout | null = null;

/**
 * Register a cleanup function to be called during shutdown.
 *
 * @param name - Descriptive name for logging
 * @param cleanup - Function to call during shutdown
 * @param priority - Lower numbers run first (default: 10)
 *
 * @example
 * ```typescript
 * registerCleanup('webhook-queue', () => webhookQueue.stopProcessing(), 5);
 * registerCleanup('shopify-cache', () => stopCleanupInterval(), 10);
 * ```
 */
export function registerCleanup(
  name: string,
  cleanup: CleanupFunction,
  priority: number = 10
): void {
  cleanupHandlers.push({ name, cleanup, priority });
  logger.debug('BACKEND', `[SHUTDOWN] Registered cleanup handler: ${name} (priority: ${priority})`);
}

/**
 * Unregister a cleanup function by name.
 * Useful for dynamic resources that may be created and destroyed during runtime.
 */
export function unregisterCleanup(name: string): boolean {
  const index = cleanupHandlers.findIndex(h => h.name === name);
  if (index !== -1) {
    cleanupHandlers.splice(index, 1);
    logger.debug('BACKEND', `[SHUTDOWN] Unregistered cleanup handler: ${name}`);
    return true;
  }
  return false;
}

/**
 * Execute all cleanup handlers in priority order.
 * Called automatically on SIGTERM/SIGINT, but can be called manually for testing.
 */
export async function executeCleanup(): Promise<void> {
  if (isShuttingDown) {
    logger.warn('BACKEND', '[SHUTDOWN] Already shutting down, ignoring duplicate signal');
    return;
  }

  isShuttingDown = true;
  logger.info('BACKEND', '================================================================');
  logger.info('BACKEND', '🛑 GRACEFUL SHUTDOWN INITIATED');
  logger.info('BACKEND', '================================================================');
  logger.info('BACKEND', `[SHUTDOWN] Running ${cleanupHandlers.length} cleanup handlers...`);

  // Sort by priority (lower first)
  const sortedHandlers = [...cleanupHandlers].sort((a, b) => a.priority - b.priority);

  for (const handler of sortedHandlers) {
    try {
      logger.info('BACKEND', `[SHUTDOWN] Cleaning up: ${handler.name}...`);
      await Promise.resolve(handler.cleanup());
      logger.info('BACKEND', `[SHUTDOWN] ✅ ${handler.name} cleaned up`);
    } catch (error) {
      logger.error('BACKEND', `[SHUTDOWN] ❌ Error cleaning up ${handler.name}:`, error);
      // Continue with other handlers even if one fails
    }
  }

  logger.info('BACKEND', '================================================================');
  logger.info('BACKEND', '✅ GRACEFUL SHUTDOWN COMPLETE');
  logger.info('BACKEND', '================================================================');
}

/**
 * Setup process signal handlers for graceful shutdown.
 * Should be called once during server initialization.
 *
 * @param server - Optional HTTP server to close before cleanup
 * @param forceExitTimeout - Max time to wait for cleanup before force exit (default: 30s)
 */
export function setupShutdownHandlers(
  server?: { close: (callback?: (err?: Error) => void) => void },
  forceExitTimeout: number = 30000
): void {
  const gracefulShutdown = async (signal: string) => {
    logger.info('BACKEND', `${signal} received, initiating graceful shutdown...`);

    // Set a force exit timeout in case cleanup hangs
    shutdownTimeout = setTimeout(() => {
      logger.error('BACKEND', `[SHUTDOWN] Force exit after ${forceExitTimeout}ms timeout`);
      process.exit(1);
    }, forceExitTimeout);

    // Prevent timeout from keeping process alive if cleanup finishes
    shutdownTimeout.unref();

    try {
      // Close HTTP server first to stop accepting new requests
      if (server) {
        await new Promise<void>((resolve, reject) => {
          logger.info('BACKEND', '[SHUTDOWN] Closing HTTP server...');
          server.close((err) => {
            if (err) {
              logger.error('BACKEND', '[SHUTDOWN] Error closing HTTP server:', err);
              reject(err);
            } else {
              logger.info('BACKEND', '[SHUTDOWN] ✅ HTTP server closed');
              resolve();
            }
          });
        });
      }

      // Run all cleanup handlers
      await executeCleanup();

      // Clear the force exit timeout
      if (shutdownTimeout) {
        clearTimeout(shutdownTimeout);
        shutdownTimeout = null;
      }

      process.exit(0);
    } catch (error) {
      logger.error('BACKEND', '[SHUTDOWN] Error during graceful shutdown:', error);
      process.exit(1);
    }
  };

  // Handle SIGTERM (sent by Docker/Kubernetes/Railway for graceful shutdown)
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  // Handle SIGINT (Ctrl+C in terminal)
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  logger.info('BACKEND', '[SHUTDOWN] Graceful shutdown handlers installed');
}

/**
 * Check if the process is currently shutting down.
 * Useful for long-running operations to check if they should abort.
 */
export function isShutdownInProgress(): boolean {
  return isShuttingDown;
}

/**
 * Get list of registered cleanup handlers (for debugging/monitoring)
 */
export function getRegisteredCleanups(): Array<{ name: string; priority: number }> {
  return cleanupHandlers.map(h => ({ name: h.name, priority: h.priority }));
}
