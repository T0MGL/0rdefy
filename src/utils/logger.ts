/**
 * Frontend Conditional Logger Utility
 *
 * Production-safe logging that only outputs in development mode.
 * Prevents console.log pollution in production, reducing:
 * - Memory leaks from accumulated logs
 * - Performance overhead from large object logging
 * - Browser console clutter
 *
 * Usage:
 * ```typescript
 * import { logger } from '@/utils/logger';
 *
 * logger.log('User clicked button');      // Only logs in dev
 * logger.debug('Complex state:', state);  // Only logs in dev
 * logger.error('Failed to save:', error); // Always logs (errors are important)
 * logger.warn('Deprecated API used');     // Always logs (warnings are important)
 * ```
 */

const isDevelopment = import.meta.env.DEV;
const isProduction = import.meta.env.PROD;

/**
 * Conditional logger that respects environment
 */
export const logger = {
  /**
   * General logging - only in development
   * Use for debugging, flow tracking, and non-critical info
   */
  log: (...args: any[]) => {
    if (isDevelopment) {
      console.log(...args);
    }
  },

  /**
   * Debug logging - only in development
   * Use for detailed debugging information
   */
  debug: (...args: any[]) => {
    if (isDevelopment) {
      console.debug(...args);
    }
  },

  /**
   * Info logging - only in development
   * Use for informational messages
   */
  info: (...args: any[]) => {
    if (isDevelopment) {
      console.info(...args);
    }
  },

  /**
   * Warning logging - always logs (important)
   * Use for deprecation warnings, non-critical issues
   */
  warn: (...args: any[]) => {
    console.warn(...args);
  },

  /**
   * Error logging - always logs (critical)
   * Use for errors, exceptions, and failures
   */
  error: (...args: any[]) => {
    console.error(...args);
  },

  /**
   * Performance timing - only in development
   * Use for measuring execution time
   */
  time: (label: string) => {
    if (isDevelopment) {
      console.time(label);
    }
  },

  timeEnd: (label: string) => {
    if (isDevelopment) {
      console.timeEnd(label);
    }
  },

  /**
   * Table logging - only in development
   * Use for structured data display
   */
  table: (data: any) => {
    if (isDevelopment) {
      console.table(data);
    }
  },

  /**
   * Group logging - only in development
   * Use for grouping related logs
   */
  group: (label?: string) => {
    if (isDevelopment) {
      console.group(label);
    }
  },

  groupEnd: () => {
    if (isDevelopment) {
      console.groupEnd();
    }
  },
};

/**
 * Utility to create a namespaced logger
 * Useful for module-specific logging
 *
 * @example
 * const log = createNamespacedLogger('SmartPolling');
 * log('Processing data');  // Output: [SmartPolling] Processing data
 */
export const createNamespacedLogger = (namespace: string) => ({
  log: (...args: any[]) => logger.log(`[${namespace}]`, ...args),
  debug: (...args: any[]) => logger.debug(`[${namespace}]`, ...args),
  info: (...args: any[]) => logger.info(`[${namespace}]`, ...args),
  warn: (...args: any[]) => logger.warn(`[${namespace}]`, ...args),
  error: (...args: any[]) => logger.error(`[${namespace}]`, ...args),
});

/**
 * Check if development mode is active
 */
export const isDev = () => isDevelopment;

/**
 * Check if production mode is active
 */
export const isProd = () => isProduction;

export default logger;
