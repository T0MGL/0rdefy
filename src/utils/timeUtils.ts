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
    // Invalid timezone, fall through to browser local
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
 * Detects whether an ISO-ish datetime string already carries timezone info
 * (a trailing "Z" or a "+hh:mm" / "-hh:mm" offset after the time part).
 */
function hasTimezoneDesignator(s: string): boolean {
  // Offset (+hh:mm / -hhmm) or trailing Z, only valid after the time component.
  return /([zZ]|[+-]\d{2}:?\d{2})$/.test(s.trim());
}

/**
 * Normalize a timestamp coming from the API/DB.
 *
 * Postgres `timestamp without time zone` columns are serialized by PostgREST
 * WITHOUT an offset (e.g. "2026-06-24T18:00:00"). Every timestamp we store is
 * UTC wall-clock (the backend writes new Date().toISOString() and SQL NOW()
 * with the session in UTC), so a naive string must be read as UTC. Plain
 * `new Date("2026-06-24T18:00:00")` would instead interpret it in the browser's
 * local timezone and shift the instant — that is the root cause of imprecise
 * status times. We append "Z" to naive datetime strings to anchor them in UTC.
 *
 * Strings that already have an offset/Z, date-only strings ("2026-06-24",
 * parsed as UTC midnight by spec) and Date objects are left untouched.
 */
export function parseDbTimestamp(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  try {
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value;
    }
    const s = String(value).trim();
    if (!s) return null;
    // Only datetime strings (with a time component) need UTC anchoring.
    const needsUtc = s.includes('T') && !hasTimezoneDesignator(s);
    const parsed = new Date(needsUtc ? `${s}Z` : s);
    return isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}

/**
 * Safely parse a date, returning null if invalid.
 * Naive (offset-less) datetime strings from the DB are interpreted as UTC.
 */
function safeParseDate(date: string | Date | null | undefined): Date | null {
  return parseDbTimestamp(date);
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
 * Format a date in an EXPLICIT IANA timezone (e.g. the store timezone).
 * Naive DB timestamps are read as UTC first, then rendered in `timezone`.
 * @returns Formatted date string, or 'fecha inválida' if input is invalid
 */
export function formatDateInTz(date: string | Date, timezone: string, options?: Intl.DateTimeFormatOptions): string {
  const dateObj = safeParseDate(date);
  if (!dateObj) return 'fecha inválida';

  try {
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
 * Format a date in user's timezone
 * @returns Formatted date string, or 'fecha inválida' if input is invalid
 */
export function formatDateInUserTz(date: string | Date, options?: Intl.DateTimeFormatOptions): string {
  return formatDateInTz(date, getUserTimezone(), options);
}

/**
 * Relative time ("Hace 2 horas") with the absolute-date fallback rendered in a
 * specific timezone (the store timezone). The relative delta is computed from
 * the absolute instant, so it is timezone-independent and correct as long as
 * the timestamp is parsed as UTC (see parseDbTimestamp). Only the ">1 week"
 * branch shows a calendar date, which we anchor to `timezone` so it reads as
 * the store's local day rather than the browser's.
 *
 * @param timezone IANA tz; falls back to America/Asuncion only if omitted.
 */
export function formatRelativeTime(date: string | Date, timezone: string = 'America/Asuncion'): string {
  const dateObj = safeParseDate(date);
  if (!dateObj) return 'Sin fecha';

  const diffMs = getNow().getTime() - dateObj.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Hace un momento';
  if (diffMins < 60) return `Hace ${diffMins} min`;
  if (diffHours < 24) return `Hace ${diffHours} hora${diffHours > 1 ? 's' : ''}`;
  if (diffDays === 1) return 'Hace 1 día';
  if (diffDays < 7) return `Hace ${diffDays} días`;

  // More than a week: show the calendar date in the store timezone.
  return formatDateInTz(dateObj, timezone, {
    day: 'numeric',
    month: 'short',
    year: undefined,
    hour: undefined,
    minute: undefined,
  });
}

/**
 * Current wall-clock hour/minute in a given IANA timezone.
 * Used to evaluate store-local windows (e.g. notification quiet hours) without
 * depending on the browser timezone.
 */
export function getNowPartsInTz(timezone: string): { hour: number; minute: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(getNow());
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    let minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    if (isNaN(minute)) minute = 0;
    // en-GB can emit "24" for midnight in some engines; normalize to 0.
    return { hour: hour % 24, minute };
  } catch {
    const now = getNow();
    return { hour: now.getHours(), minute: now.getMinutes() };
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
 * Get the ISO-8601 week key for a date in a given IANA timezone (e.g. "2026-W24").
 *
 * Weeks start on Monday and the first week of the year is the one containing the
 * first Thursday. This is the same scheme used by date pickers and most reporting
 * tools, so "this week" lines up with what the user sees in the Anuncios module.
 *
 * Timezone matters: a Sunday-night entry in Asuncion (UTC-3) must not roll into
 * the next ISO week just because UTC already crossed midnight. We resolve the
 * calendar date in the store timezone first, then compute the week number from
 * that local date.
 *
 * @param date - The instant to bucket (defaults to now)
 * @param timezone - IANA timezone (defaults to the browser timezone)
 * @returns Week key formatted as "YYYY-Www", or a safe fallback on error
 */
export function getISOWeekKey(date?: Date, timezone?: string): string {
  try {
    const tz = timezone || getUserTimezone();
    const localDateStr = formatLocalDate(date || getNow(), tz); // "YYYY-MM-DD" in store TZ
    const [year, month, day] = localDateStr.split('-').map(n => parseInt(n, 10));

    // Build a UTC date from the local calendar parts so week math is offset-free.
    const target = new Date(Date.UTC(year, month - 1, day));

    // ISO weekday: Monday = 1 ... Sunday = 7
    const dayNum = target.getUTCDay() === 0 ? 7 : target.getUTCDay();

    // Shift to the Thursday of the current ISO week (Thursday determines the year).
    target.setUTCDate(target.getUTCDate() + 4 - dayNum);

    const isoYear = target.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 1));
    const weekNumber = Math.ceil(
      ((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
    );

    return `${isoYear}-W${String(weekNumber).padStart(2, '0')}`;
  } catch {
    // Timezone resolution failed. Recompute the ISO week from the instant in
    // pure UTC so the key is still a valid week (never the impossible "W00").
    // This mirrors the main path's math, just without the local-date step.
    const now = date || new Date();
    const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayNum = utc.getUTCDay() === 0 ? 7 : utc.getUTCDay();
    utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
    const isoYear = utc.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 1));
    const weekNumber = Math.ceil(
      ((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
    );
    return `${isoYear}-W${String(weekNumber).padStart(2, '0')}`;
  }
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
