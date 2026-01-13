import { createContext, useContext, useState, ReactNode, useEffect } from 'react';

export type DateRangeValue = 'today' | '7d' | '30d' | 'custom';

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

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [selectedRange, setSelectedRange] = useState<DateRangeValue>('7d');
  const [customRange, setCustomRange] = useState<DateRange | null>(null);

  // Calculate date range based on selected value
  const getDateRange = (): DateRange => {
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
  };

  // Log when range changes (for debugging)
  useEffect(() => {
    const range = getDateRange();
    console.log('Date range changed:', {
      selectedRange,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRange, customRange]);

  return (
    <DateRangeContext.Provider
      value={{
        selectedRange,
        setSelectedRange,
        customRange,
        setCustomRange,
        getDateRange,
      }}
    >
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
