/**
 * Date utilities for backend with timezone support.
 *
 * Single source of truth for any date/time math that crosses the UTC boundary.
 * All day-boundary queries, grouping keys, and externally-visible date strings
 * (SIFEN, courier settlements, analytics ranges) must go through these helpers.
 *
 * The canonical pattern:
 *   1. Load `stores.timezone` once per request (default 'America/Asuncion').
 *   2. Use `endOfDayIso(dateStr, tz)` / `startOfDayIso(dateStr, tz)` for
 *      `gte`/`lte` bounds on `created_at` columns stored in UTC.
 *   3. Use `formatDateInTimezone(timestamp, tz)` for any per-day grouping key.
 *
 * Never use `new Date(str).toISOString().split('T')[0]` on a UTC timestamp to
 * produce a local date. Never use `setHours(23,59,59,999)` on a parsed string
 * and then `toISOString()` the result, that gives browser-local time.
 */

import { fromZonedTime } from 'date-fns-tz';
import { logger } from './logger';

export const DEFAULT_TIMEZONE = 'America/Asuncion';

/**
 * Today's date (YYYY-MM-DD) in the given IANA timezone.
 */
export function getTodayInTimezone(timezone: string = DEFAULT_TIMEZONE): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch (error) {
    logger.error('BACKEND', `Invalid timezone: ${timezone}. Falling back to UTC.`, error);
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Format an instant (Date or ISO string) as YYYY-MM-DD in the given timezone.
 * This is the correct replacement for `new Date(x).toISOString().split('T')[0]`
 * when `x` is a UTC timestamp and you want the calendar date in the store's TZ.
 */
export function formatDateInTimezone(
  date: Date | string,
  timezone: string = DEFAULT_TIMEZONE,
): string {
  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(dateObj.getTime())) {
      throw new Error('Invalid date');
    }
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(dateObj);
  } catch (error) {
    logger.error('BACKEND', `Error formatting date in timezone ${timezone}:`, error);
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Start of "today" in the given timezone, returned as a UTC Date instant.
 * Equivalent to midnight local time in the target timezone.
 */
export function getStartOfDayInTimezone(timezone: string = DEFAULT_TIMEZONE): Date {
  const today = getTodayInTimezone(timezone);
  return fromZonedTime(`${today} 00:00:00.000`, timezone);
}

/**
 * End of "today" in the given timezone, returned as a UTC Date instant.
 */
export function getEndOfDayInTimezone(timezone: string = DEFAULT_TIMEZONE): Date {
  const today = getTodayInTimezone(timezone);
  return fromZonedTime(`${today} 23:59:59.999`, timezone);
}

/**
 * Start-of-day ISO string for a given YYYY-MM-DD in the timezone.
 * Use as `gte` bound when querying UTC timestamp columns by a local date.
 */
export function startOfDayIso(dateStr: string, timezone: string = DEFAULT_TIMEZONE): string {
  try {
    return fromZonedTime(`${dateStr} 00:00:00.000`, timezone).toISOString();
  } catch (error) {
    logger.error('BACKEND', `startOfDayIso failed for ${dateStr} / ${timezone}`, error);
    return new Date(`${dateStr}T00:00:00.000Z`).toISOString();
  }
}

/**
 * End-of-day ISO string for a given YYYY-MM-DD in the timezone.
 * Use as `lte` bound when querying UTC timestamp columns by a local date.
 */
export function endOfDayIso(dateStr: string, timezone: string = DEFAULT_TIMEZONE): string {
  try {
    return fromZonedTime(`${dateStr} 23:59:59.999`, timezone).toISOString();
  } catch (error) {
    logger.error('BACKEND', `endOfDayIso failed for ${dateStr} / ${timezone}`, error);
    return new Date(`${dateStr}T23:59:59.999Z`).toISOString();
  }
}

/**
 * Parse a YYYY-MM-DD string as midnight in the given timezone,
 * returning a UTC Date instant. Mirrors `startOfDayIso` but as a Date.
 */
export function parseDateInTimezone(
  dateStr: string,
  timezone: string = DEFAULT_TIMEZONE,
): Date {
  try {
    return fromZonedTime(`${dateStr} 00:00:00.000`, timezone);
  } catch (error) {
    logger.error('BACKEND', `parseDateInTimezone failed for ${dateStr} / ${timezone}`, error);
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  }
}

/**
 * Shift `offsetDays` from "today" in the given timezone, returned as a YYYY-MM-DD
 * string. Positive offsets go forward, negative go backward. Handy for things
 * like "30 days ago in Asuncion".
 */
export function addDaysInTimezone(
  offsetDays: number,
  timezone: string = DEFAULT_TIMEZONE,
): string {
  const startUtc = getStartOfDayInTimezone(timezone);
  const shifted = new Date(startUtc.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return formatDateInTimezone(shifted, timezone);
}

/**
 * Load `stores.timezone` with a safe default. Used by routes that need the
 * store's local timezone for analytics math. Returns the default timezone if
 * the column is missing, null, or the lookup fails.
 */
export async function getStoreTimezone(
  client: { from: (table: string) => any },
  storeId: string,
): Promise<string> {
  try {
    const { data, error } = await client
      .from('stores')
      .select('timezone')
      .eq('id', storeId)
      .single();
    if (error) {
      logger.warn('BACKEND', `getStoreTimezone lookup failed for ${storeId}, using default`, error);
      return DEFAULT_TIMEZONE;
    }
    return (data?.timezone as string | null) || DEFAULT_TIMEZONE;
  } catch (error) {
    logger.error('BACKEND', `getStoreTimezone threw for ${storeId}`, error);
    return DEFAULT_TIMEZONE;
  }
}
