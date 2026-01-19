import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Safely parse JSON with error handling
 * Returns defaultValue if parsing fails (corrupted data, invalid JSON)
 * Prevents app crashes from malformed localStorage data
 */
export function safeJsonParse<T>(json: string | null, defaultValue: T): T {
  if (!json) return defaultValue;
  try {
    return JSON.parse(json) as T;
  } catch {
    logger.error('[safeJsonParse] Failed to parse JSON, using default value');
    return defaultValue;
  }
}

/**
 * Safely get and parse JSON from localStorage
 * Combines localStorage.getItem with safeJsonParse
 */
export function getStorageJson<T>(key: string, defaultValue: T): T {
  if (typeof window === 'undefined') return defaultValue;
  return safeJsonParse(localStorage.getItem(key), defaultValue);
}
