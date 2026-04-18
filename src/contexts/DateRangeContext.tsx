import { createContext, useContext, useState, useMemo, ReactNode, useEffect, useCallback } from 'react';
import { fromZonedTime } from 'date-fns-tz';
import { logger } from '@/utils/logger';
import { formatLocalDate } from '@/utils/timeUtils';

export type DateRangeValue = 'today' | '7d' | '30d' | 'all' | 'custom';

export interface DateRange {
  from: Date;
  to: Date;
}

interface DateRangeContextValue {
  selectedRange: DateRangeValue;
  setSelectedRange: (range: DateRangeValue) => void;
  customRange: DateRange | null;
  setCustomRange: (range: DateRange | null) => void;
  /**
   * Returns the selected date range as UTC Date instants.
   *
   * When `storeTimezone` is provided, the range is anchored to that timezone:
   * `from` is midnight-local-in-tz expressed as a UTC Date, `to` is
   * end-of-day-local-in-tz expressed as a UTC Date. This is what the backend
   * expects for timestamptz filtering.
   *
   * When `storeTimezone` is omitted, we fall back to browser-local boundaries
   * for backwards compatibility. Callers that need store-local boundaries
   * should always pass the store timezone.
   */
  getDateRange: (storeTimezone?: string) => DateRange;
}

const DateRangeContext = createContext<DateRangeContextValue | undefined>(undefined);

const STORAGE_KEY_RANGE = 'ordefy_date_range';
const STORAGE_KEY_CUSTOM = 'ordefy_date_range_custom';
const VALID_RANGES: DateRangeValue[] = ['today', '7d', '30d', 'all', 'custom'];

function loadPersistedRange(): DateRangeValue {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_RANGE);
    if (stored && VALID_RANGES.includes(stored as DateRangeValue)) {
      return stored as DateRangeValue;
    }
  } catch {
    // localStorage unavailable (SSR, private browsing quota exceeded)
  }
  return '7d';
}

function loadPersistedCustomRange(): DateRange | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_CUSTOM);
    if (stored) {
      const parsed = JSON.parse(stored);
      const from = new Date(parsed.from);
      const to = new Date(parsed.to);
      if (!isNaN(from.getTime()) && !isNaN(to.getTime())) {
        return { from, to };
      }
    }
  } catch {
    // Corrupted or missing data
  }
  return null;
}

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [selectedRange, setSelectedRangeState] = useState<DateRangeValue>(loadPersistedRange);
  const [customRange, setCustomRangeState] = useState<DateRange | null>(loadPersistedCustomRange);

  const setSelectedRange = useCallback((range: DateRangeValue) => {
    setSelectedRangeState(range);
    try {
      localStorage.setItem(STORAGE_KEY_RANGE, range);
    } catch {
      // Quota exceeded or private browsing
    }
  }, []);

  const setCustomRange = useCallback((range: DateRange | null) => {
    setCustomRangeState(range);
    try {
      if (range) {
        localStorage.setItem(STORAGE_KEY_CUSTOM, JSON.stringify({
          from: range.from.toISOString(),
          to: range.to.toISOString(),
        }));
      } else {
        localStorage.removeItem(STORAGE_KEY_CUSTOM);
      }
    } catch {
      // Quota exceeded or private browsing
    }
  }, []);

  // Memoized so consumers that depend on the function reference (via useMemo/
  // useCallback) don't re-run every render. Only selectedRange/customRange
  // actually change the output.
  const getDateRange = useCallback(
    (storeTimezone?: string): DateRange => {
      const now = new Date();

      // Resolve "today" anchored to the store's timezone when provided, so a
      // user operating at 22:00 Asuncion sees the range their backend sees,
      // not one that silently rolls into tomorrow UTC.
      const todayIsoDate = storeTimezone
        ? formatLocalDate(now, storeTimezone)
        : formatLocalDate(now);

      const startOfLocalDay = (isoDate: string): Date => {
        if (storeTimezone) {
          return fromZonedTime(`${isoDate} 00:00:00.000`, storeTimezone);
        }
        const [y, m, d] = isoDate.split('-').map(Number);
        return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
      };

      const shiftDays = (isoDate: string, delta: number): string => {
        const [y, m, d] = isoDate.split('-').map(Number);
        const utc = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
        utc.setUTCDate(utc.getUTCDate() + delta);
        const yy = utc.getUTCFullYear();
        const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(utc.getUTCDate()).padStart(2, '0');
        return `${yy}-${mm}-${dd}`;
      };

      const today = startOfLocalDay(todayIsoDate);

      if (selectedRange === 'custom' && customRange) {
        // CRITICAL timezone fix: the DayPicker returns Date instances built
        // from browser-local midnight of the clicked calendar cell
        // (`new Date(year, month, day)`). If the browser timezone differs
        // from the store timezone, reading those Dates in the store TZ can
        // shift the day by ±1. We rebuild the range using the *visual* Y/M/D
        // the user clicked (browser-local components), anchored to midnight
        // and end-of-day in the store timezone. End result:
        // `formatLocalDate(from, storeTimezone)` and
        // `formatLocalDate(to, storeTimezone)` both return exactly the day
        // the user selected, regardless of browser location.
        const anchorLocalDay = (d: Date, endOfDay = false): Date => {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          const iso = `${y}-${m}-${dd}`;
          if (storeTimezone) {
            return endOfDay
              ? fromZonedTime(`${iso} 23:59:59.999`, storeTimezone)
              : fromZonedTime(`${iso} 00:00:00.000`, storeTimezone);
          }
          const [yy, mm, ddd] = iso.split('-').map(Number);
          return endOfDay
            ? new Date(yy, (mm || 1) - 1, ddd || 1, 23, 59, 59, 999)
            : new Date(yy, (mm || 1) - 1, ddd || 1, 0, 0, 0, 0);
        };
        return {
          from: anchorLocalDay(customRange.from, false),
          to: anchorLocalDay(customRange.to, true),
        };
      }

      switch (selectedRange) {
        case 'today':
          return { from: today, to: now };
        case '7d':
          return { from: startOfLocalDay(shiftDays(todayIsoDate, -7)), to: now };
        case '30d':
          return { from: startOfLocalDay(shiftDays(todayIsoDate, -30)), to: now };
        case 'all':
          return {
            from: storeTimezone
              ? fromZonedTime('2020-01-01 00:00:00.000', storeTimezone)
              : new Date(2020, 0, 1),
            to: now,
          };
        default:
          return { from: startOfLocalDay(shiftDays(todayIsoDate, -7)), to: now };
      }
    },
    [selectedRange, customRange],
  );

  // Log when range changes (for debugging)
  useEffect(() => {
    const range = getDateRange();
    logger.log('Date range changed:', {
      selectedRange,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRange, customRange]);

  const value = useMemo(() => ({
    selectedRange,
    setSelectedRange,
    customRange,
    setCustomRange,
    getDateRange,
  }), [selectedRange, setSelectedRange, customRange, setCustomRange, getDateRange]);

  return (
    <DateRangeContext.Provider value={value}>
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange() {
  const context = useContext(DateRangeContext);
  if (context === undefined) {
    throw new Error('useDateRange must be used within a DateRangeProvider');
  }
  return context;
}
