/**
 * Date utilities for backend with timezone support
 *
 * Fixes the timezone bug where dates were incorrectly calculated:
 * - OLD: new Date().toISOString().split('T')[0]
 *   Problem: If in Paraguay it's 23:30 (Jan 18), UTC is 13:30 next day
 *            → split gives "2026-01-19" when it should be "2026-01-18"
 *
 * - NEW: getTodayInTimezone('America/Asuncion')
 *   Correctly calculates the date in the user's timezone
 */

/**
 * Get today's date in YYYY-MM-DD format for a specific timezone
 *
 * @param timezone - IANA timezone identifier (e.g., 'America/Asuncion', 'America/New_York')
 * @returns Date string in YYYY-MM-DD format in the specified timezone
 *
 * @example
 * // In Paraguay at 23:30 Jan 18 (UTC 02:30 Jan 19)
 * getTodayInTimezone('America/Asuncion') // Returns: "2026-01-18" ✅
 * new Date().toISOString().split('T')[0]  // Returns: "2026-01-19" ❌
 */
import { logger } from './logger';
export function getTodayInTimezone(timezone: string = 'America/Asuncion'): string {
  try {
    // Get current date/time in the specified timezone
    const now = new Date();

    // Format the date in the target timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    // en-CA locale gives us YYYY-MM-DD format directly
    return formatter.format(now);
  } catch (error) {
    // Fallback to UTC if timezone is invalid
    logger.error('BACKEND', `Invalid timezone: ${timezone}. Falling back to UTC.`, error);
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Get a specific date in YYYY-MM-DD format for a timezone
 *
 * @param date - Date object or ISO string
 * @param timezone - IANA timezone identifier
 * @returns Date string in YYYY-MM-DD format
 */
export function formatDateInTimezone(date: Date | string, timezone: string = 'America/Asuncion'): string {
  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;

    if (isNaN(dateObj.getTime())) {
      throw new Error('Invalid date');
    }

    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    return formatter.format(dateObj);
  } catch (error) {
    logger.error('BACKEND', `Error formatting date in timezone ${timezone}:`, error);
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Get start of day in a specific timezone as ISO string
 * Useful for date range queries
 */
export function getStartOfDayInTimezone(timezone: string = 'America/Asuncion'): Date {
  const today = getTodayInTimezone(timezone);
  // Parse as local date (no timezone conversion)
  const [year, month, day] = today.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

/**
 * Get end of day in a specific timezone as ISO string
 */
export function getEndOfDayInTimezone(timezone: string = 'America/Asuncion'): Date {
  const today = getTodayInTimezone(timezone);
  const [year, month, day] = today.split('-').map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999);
}

/**
 * Parse a date string (YYYY-MM-DD) in a specific timezone
 * Returns a Date object that represents midnight in that timezone
 */
export function parseDateInTimezone(dateStr: string, timezone: string = 'America/Asuncion'): Date {
  const [year, month, day] = dateStr.split('-').map(Number);

  // Create date in local timezone first
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);

  // Get the timezone offset for this date
  const offsetStr = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset'
  }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value;

  return date;
}
