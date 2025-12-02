/**
 * Time utilities with timezone support for accurate time calculations
 * Based on user's browser timezone (from Intl.DateTimeFormat)
 */

/**
 * Get user's timezone from browser
 */
export function getUserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Get current time in user's timezone
 */
export function getNow(): Date {
  return new Date();
}

/**
 * Calculate difference in hours between two dates
 * @param from - Start date (ISO string or Date)
 * @param to - End date (ISO string or Date), defaults to now
 * @returns Hours difference (can be decimal)
 */
export function getHoursDifference(from: string | Date, to?: string | Date): number {
  const fromDate = typeof from === 'string' ? new Date(from) : from;
  const toDate = to ? (typeof to === 'string' ? new Date(to) : to) : getNow();

  const diffMs = toDate.getTime() - fromDate.getTime();
  return diffMs / (1000 * 60 * 60);
}

/**
 * Calculate difference in minutes between two dates
 */
export function getMinutesDifference(from: string | Date, to?: string | Date): number {
  const fromDate = typeof from === 'string' ? new Date(from) : from;
  const toDate = to ? (typeof to === 'string' ? new Date(to) : to) : getNow();

  const diffMs = toDate.getTime() - fromDate.getTime();
  return diffMs / (1000 * 60);
}

/**
 * Format time difference as human-readable string (español)
 * Examples: "hace 2 horas", "hace 30 minutos", "hace 1 día"
 */
export function formatTimeAgo(from: string | Date): string {
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
 */
export function formatDateInUserTz(date: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
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
}

/**
 * Check if date is older than X hours
 */
export function isOlderThan(date: string | Date, hours: number): boolean {
  const hoursDiff = getHoursDifference(date);
  return hoursDiff > hours;
}

/**
 * Check if date is within next X hours
 */
export function isWithinNextHours(date: string | Date, hours: number): boolean {
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
 */
export function isSameDay(date1: string | Date, date2: string | Date): boolean {
  const d1 = typeof date1 === 'string' ? new Date(date1) : date1;
  const d2 = typeof date2 === 'string' ? new Date(date2) : date2;

  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

/**
 * Check if date is tomorrow (in user's timezone)
 */
export function isTomorrow(date: string | Date): boolean {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return isSameDay(date, tomorrow);
}

/**
 * Get detailed time info for debugging
 */
export function getTimeInfo(date: string | Date): {
  timezone: string;
  localTime: string;
  utcTime: string;
  hoursAgo: number;
  minutesAgo: number;
  formattedAgo: string;
} {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
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
