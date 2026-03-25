import { createContext, useContext, useState, useMemo, ReactNode, useEffect, useCallback } from 'react';
import { logger } from '@/utils/logger';

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
  getDateRange: () => DateRange;
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

  // CRITICAL FIX (Bug #6): Memoize getDateRange to prevent infinite render loops
  // Without useCallback, this function is recreated on every render, causing
  // any useMemo/useCallback that depends on it to re-run infinitely
  const getDateRange = useCallback((): DateRange => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (selectedRange === 'custom' && customRange) {
      return customRange;
    }

    switch (selectedRange) {
      case 'today':
        return {
          from: today,
          to: now,
        };
      case '7d': {
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        return {
          from: sevenDaysAgo,
          to: now,
        };
      }
      case '30d': {
        const thirtyDaysAgo = new Date(today);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        return {
          from: thirtyDaysAgo,
          to: now,
        };
      }
      case 'all': {
        return {
          from: new Date(2020, 0, 1),
          to: now,
        };
      }
      default: {
        // Default to 7 days
        const defaultSevenDaysAgo = new Date(today);
        defaultSevenDaysAgo.setDate(defaultSevenDaysAgo.getDate() - 7);
        return {
          from: defaultSevenDaysAgo,
          to: now,
        };
      }
    }
  }, [selectedRange, customRange]); // Only recreate when these dependencies change

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
