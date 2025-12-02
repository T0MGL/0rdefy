/**
 * Tests for timeUtils - Timezone-aware time calculations
 */

import {
  getNow,
  getHoursDifference,
  getMinutesDifference,
  formatTimeAgo,
  isOlderThan,
  getUserTimezone,
  isTomorrow,
  getTimeInfo,
} from '../timeUtils';

describe('timeUtils', () => {
  describe('getUserTimezone', () => {
    it('should return a valid IANA timezone', () => {
      const tz = getUserTimezone();
      expect(tz).toBeTruthy();
      expect(typeof tz).toBe('string');
      // Common timezones include slashes
      expect(tz.includes('/')).toBe(true);
    });
  });

  describe('getNow', () => {
    it('should return current date', () => {
      const now = getNow();
      const diff = Math.abs(now.getTime() - Date.now());
      expect(diff).toBeLessThan(100); // Less than 100ms difference
    });
  });

  describe('getHoursDifference', () => {
    it('should calculate hours between two dates', () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const diff = getHoursDifference(twoHoursAgo, now);
      expect(diff).toBeCloseTo(2, 1);
    });

    it('should default to now for second parameter', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const diff = getHoursDifference(twoHoursAgo);
      expect(diff).toBeGreaterThanOrEqual(1.9);
      expect(diff).toBeLessThanOrEqual(2.1);
    });

    it('should handle ISO string dates', () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const diff = getHoursDifference(twoHoursAgo.toISOString(), now.toISOString());
      expect(diff).toBeCloseTo(2, 1);
    });
  });

  describe('getMinutesDifference', () => {
    it('should calculate minutes between two dates', () => {
      const now = new Date();
      const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);

      const diff = getMinutesDifference(thirtyMinsAgo, now);
      expect(diff).toBeCloseTo(30, 1);
    });
  });

  describe('formatTimeAgo', () => {
    it('should format less than 1 minute', () => {
      const now = new Date();
      const result = formatTimeAgo(now.toISOString());
      expect(result).toBe('hace menos de 1 minuto');
    });

    it('should format minutes (singular)', () => {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
      const result = formatTimeAgo(oneMinuteAgo);
      expect(result).toBe('hace 1 minuto');
    });

    it('should format minutes (plural)', () => {
      const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
      const result = formatTimeAgo(thirtyMinsAgo);
      expect(result).toBe('hace 30 minutos');
    });

    it('should format hours (singular)', () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const result = formatTimeAgo(oneHourAgo);
      expect(result).toBe('hace 1 hora');
    });

    it('should format hours (plural)', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const result = formatTimeAgo(twoHoursAgo);
      expect(result).toBe('hace 2 horas');
    });

    it('should format days (singular)', () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = formatTimeAgo(oneDayAgo);
      expect(result).toBe('hace 1 día');
    });

    it('should format days (plural)', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const result = formatTimeAgo(threeDaysAgo);
      expect(result).toBe('hace 3 días');
    });

    it('should format months', () => {
      const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      const result = formatTimeAgo(twoMonthsAgo);
      expect(result).toBe('hace 2 meses');
    });
  });

  describe('isOlderThan', () => {
    it('should return true if date is older than specified hours', () => {
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
      expect(isOlderThan(twentyFiveHoursAgo, 24)).toBe(true);
    });

    it('should return false if date is not older than specified hours', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      expect(isOlderThan(twoHoursAgo, 24)).toBe(false);
    });

    it('should handle exact boundary', () => {
      const exactlyTwentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      // Should be false because it's equal, not greater than
      expect(isOlderThan(exactlyTwentyFourHoursAgo, 24)).toBe(false);
    });
  });

  describe('isTomorrow', () => {
    it('should return true for tomorrow\'s date', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      expect(isTomorrow(tomorrow)).toBe(true);
    });

    it('should return false for today', () => {
      const today = new Date();
      expect(isTomorrow(today)).toBe(false);
    });

    it('should return false for day after tomorrow', () => {
      const dayAfterTomorrow = new Date();
      dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
      expect(isTomorrow(dayAfterTomorrow)).toBe(false);
    });
  });

  describe('getTimeInfo', () => {
    it('should return comprehensive time information', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const info = getTimeInfo(twoHoursAgo);

      expect(info.timezone).toBeTruthy();
      expect(info.localTime).toBeTruthy();
      expect(info.utcTime).toBeTruthy();
      expect(info.hoursAgo).toBeCloseTo(2, 1);
      expect(info.minutesAgo).toBeCloseTo(120, 5);
      expect(info.formattedAgo).toBe('hace 2 horas');
    });
  });

  describe('Edge Cases', () => {
    it('should handle future dates', () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const diff = getHoursDifference(tomorrow);
      expect(diff).toBeLessThan(0); // Negative for future dates
    });

    it('should handle very old dates', () => {
      const veryOld = new Date('2020-01-01');
      const result = formatTimeAgo(veryOld);
      expect(result).toContain('mes');
    });

    it('should handle dates as both string and Date objects', () => {
      const date = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const diffFromString = getHoursDifference(date.toISOString());
      const diffFromDate = getHoursDifference(date);

      expect(diffFromString).toBeCloseTo(diffFromDate, 2);
    });
  });
});
