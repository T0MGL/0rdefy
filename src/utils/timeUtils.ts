/**
 * Time utilities with timezone support for accurate time calculations
 * Based on store's configured timezone (from store preferences)
 *
 * All functions include error handling to prevent crashes on invalid input
 */
import { fromZonedTime } from 'date-fns-tz';

/**
 * Get user's timezone from browser
 */
export function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'America/Asuncion'; // Default fallback for Paraguay
  }
}

/**
 * Get current time in user's timezone
 */
export function getNow(): Date {
  return new Date();
}

/**
 * Format a Date as YYYY-MM-DD in a specific IANA timezone.
 * If no timezone is provided, falls back to the browser's local timezone.
 *
 * This avoids the common bug of using .toISOString().split('T')[0] which converts
 * to UTC first and can shift the date backward for negative UTC offset timezones.
 *
 * Uses Intl.DateTimeFormat for correct timezone conversion (DST-safe).
 */
export function formatLocalDate(date: Date, timezone?: string): string {
  try {
    if (timezone) {
      // Use Intl.DateTimeFormat to extract year/month/day in the target timezone
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(date);

      const year = parts.find(p => p.type === 'year')?.value || '';
      const month = parts.find(p => p.type === 'month')?.value || '';
      const day = parts.find(p => p.type === 'day')?.value || '';
      return `${year}-${month}-${day}`;
    }
  } catch {
    // Invalid timezone — fall through to browser local
  }

  // Fallback: browser's local timezone
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get the start of day (00:00:00.000) as a UTC ISO string for a given IANA timezone.
 * Uses date-fns-tz for correct DST handling.
 *
 * Example: startOfDayInTimezone(new Date(), 'America/Asuncion')
 * → if it's Feb 4 in Asuncion (UTC-3), returns "2026-02-04T03:00:00.000Z"
 */
export function startOfDayInTimezone(date: Date, timezone: string): string {
  try {
    const dateStr = formatLocalDate(date, timezone); // "2026-02-04" in store TZ
    // fromZonedTime interprets a local time as being in the given timezone
    // and returns the corresponding UTC instant (DST-safe)
    const utcInstant = fromZonedTime(`${dateStr} 00:00:00`, timezone);
    return utcInstant.toISOString();
  } catch {
    // Fallback: use browser local if timezone is invalid
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
}

/**
 * Get the end of day (23:59:59.999) as a UTC ISO string for a given IANA timezone.
 * Uses date-fns-tz for correct DST handling.
 */
export function endOfDayInTimezone(date: Date, timezone: string): string {
  try {
    const dateStr = formatLocalDate(date, timezone);
    const utcInstant = fromZonedTime(`${dateStr} 23:59:59.999`, timezone);
    return utcInstant.toISOString();
  } catch {
    // Fallback: use browser local if timezone is invalid
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d.toISOString();
  }
}

/**
 * Safely parse a date, returning null if invalid
 */
function safeParseDate(date: string | Date | null | undefined): Date | null {
  if (!date) return null;
  try {
    const parsed = typeof date === 'string' ? new Date(date) : date;
    // Check if date is valid
    if (isNaN(parsed.getTime())) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Calculate difference in hours between two dates
 * @param from - Start date (ISO string or Date)
 * @param to - End date (ISO string or Date), defaults to now
 * @returns Hours difference (can be decimal), 0 if invalid input
 */
export function getHoursDifference(from: string | Date, to?: string | Date): number {
  const fromDate = safeParseDate(from);
  if (!fromDate) return 0;

  const toDate = to ? safeParseDate(to) : getNow();
  if (!toDate) return 0;

  const diffMs = toDate.getTime() - fromDate.getTime();
  return diffMs / (1000 * 60 * 60);
}

/**
 * Calculate difference in minutes between two dates
 * @returns Minutes difference, 0 if invalid input
 */
export function getMinutesDifference(from: string | Date, to?: string | Date): number {
  const fromDate = safeParseDate(from);
  if (!fromDate) return 0;

  const toDate = to ? safeParseDate(to) : getNow();
  if (!toDate) return 0;

  const diffMs = toDate.getTime() - fromDate.getTime();
  return diffMs / (1000 * 60);
}

/**
 * Format time difference as human-readable string (español)
 * Examples: "hace 2 horas", "hace 30 minutos", "hace 1 día"
 * @returns Formatted string, or "fecha inválida" if input is invalid
 */
export function formatTimeAgo(from: string | Date): string {
  const fromDate = safeParseDate(from);
  if (!fromDate) return 'fecha inválida';

  const minutes = getMinutesDifference(from);
  const hours = minutes / 60;
  const days = hours / 24;

  if (minutes < 1) {
    return 'hace menos de 1 minuto';
  } else if (minutes < 60) {
    const roundedMinutes = Math.floor(minutes);
    return `hace ${roundedMinutes} minuto${roundedMinutes !== 1 ? 's' : ''}`;
  } else if (hours < 24) {
    const roundedHours = Math.floor(hours);
    return `hace ${roundedHours} hora${roundedHours !== 1 ? 's' : ''}`;
  } else if (days < 30) {
    const roundedDays = Math.floor(days);
    return `hace ${roundedDays} día${roundedDays !== 1 ? 's' : ''}`;
  } else {
    const roundedMonths = Math.floor(days / 30);
    return `hace ${roundedMonths} mes${roundedMonths !== 1 ? 'es' : ''}`;
  }
}

/**
 * Format a date in user's timezone
 * @returns Formatted date string, or 'fecha inválida' if input is invalid
 */
export function formatDateInUserTz(date: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const dateObj = safeParseDate(date);
  if (!dateObj) return 'fecha inválida';

  try {
    const timezone = getUserTimezone();

    const defaultOptions: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      ...options,
    };

    return new Intl.DateTimeFormat('es-ES', defaultOptions).format(dateObj);
  } catch {
    return 'fecha inválida';
  }
}

/**
 * Check if date is older than X hours
 * @returns true if older than specified hours, false if invalid or not older
 */
export function isOlderThan(date: string | Date, hours: number): boolean {
  const dateObj = safeParseDate(date);
  if (!dateObj) return false;

  const hoursDiff = getHoursDifference(date);
  return hoursDiff > hours;
}

/**
 * Check if date is within next X hours
 * @returns true if within specified hours, false if invalid or outside range
 */
export function isWithinNextHours(date: string | Date, hours: number): boolean {
  const dateObj = safeParseDate(date);
  if (!dateObj) return false;

  const hoursDiff = getHoursDifference(getNow(), date);
  return hoursDiff > 0 && hoursDiff <= hours;
}

/**
 * Get start of day in user's timezone
 */
export function getStartOfDay(date?: Date): Date {
  const d = date || getNow();
  const result = new Date(d);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Get end of day in user's timezone
 */
export function getEndOfDay(date?: Date): Date {
  const d = date || getNow();
  const result = new Date(d);
  result.setHours(23, 59, 59, 999);
  return result;
}

/**
 * Check if two dates are on the same day (in user's timezone)
 * @returns false if either date is invalid
 */
export function isSameDay(date1: string | Date, date2: string | Date): boolean {
  const d1 = safeParseDate(date1);
  const d2 = safeParseDate(date2);

  if (!d1 || !d2) return false;

  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

/**
 * Check if date is tomorrow (in user's timezone)
 * @returns false if date is invalid
 */
export function isTomorrow(date: string | Date): boolean {
  const dateObj = safeParseDate(date);
  if (!dateObj) return false;

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return isSameDay(date, tomorrow);
}

/**
 * Get detailed time info for debugging
 * @returns Time info object, or fallback values if date is invalid
 */
export function getTimeInfo(date: string | Date): {
  timezone: string;
  localTime: string;
  utcTime: string;
  hoursAgo: number;
  minutesAgo: number;
  formattedAgo: string;
} {
  const dateObj = safeParseDate(date);
  if (!dateObj) {
    return {
      timezone: getUserTimezone(),
      localTime: 'fecha inválida',
      utcTime: 'fecha inválida',
      hoursAgo: 0,
      minutesAgo: 0,
      formattedAgo: 'fecha inválida',
    };
  }

  const hoursAgo = getHoursDifference(dateObj);
  const minutesAgo = getMinutesDifference(dateObj);

  return {
    timezone: getUserTimezone(),
    localTime: formatDateInUserTz(dateObj),
    utcTime: dateObj.toISOString(),
    hoursAgo,
    minutesAgo,
    formattedAgo: formatTimeAgo(dateObj),
  };
}
