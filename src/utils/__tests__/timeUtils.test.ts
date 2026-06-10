/**
 * Tests for timeUtils - Timezone-aware time calculations
 *
 * Uses the Node built-in test runner (node:test) to match the rest of the unit
 * suite. Run with `npm run test:unit` (or `npx tsx --test <file>` for one file).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getNow,
  getHoursDifference,
  getMinutesDifference,
  formatTimeAgo,
  isOlderThan,
  getUserTimezone,
  isTomorrow,
  getTimeInfo,
  getISOWeekKey,
} from '../timeUtils';

describe('timeUtils', () => {
  describe('getUserTimezone', () => {
    it('should return a valid IANA timezone', () => {
      const tz = getUserTimezone();
      assert.ok(tz);
      assert.equal(typeof tz, 'string');
      // Common timezones include slashes
      assert.equal(tz.includes('/'), true);
    });
  });

  describe('getNow', () => {
    it('should return current date', () => {
      const now = getNow();
      const diff = Math.abs(now.getTime() - Date.now());
      assert.ok(diff < 100); // Less than 100ms difference
    });
  });

  describe('getHoursDifference', () => {
    it('should calculate hours between two dates', () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const diff = getHoursDifference(twoHoursAgo, now);
      assert.ok(Math.abs(diff - 2) < 0.05);
    });

    it('should default to now for second parameter', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const diff = getHoursDifference(twoHoursAgo);
      assert.ok(diff >= 1.9);
      assert.ok(diff <= 2.1);
    });

    it('should handle ISO string dates', () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      const diff = getHoursDifference(twoHoursAgo.toISOString(), now.toISOString());
      assert.ok(Math.abs(diff - 2) < 0.05);
    });
  });

  describe('getMinutesDifference', () => {
    it('should calculate minutes between two dates', () => {
      const now = new Date();
      const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000);

      const diff = getMinutesDifference(thirtyMinsAgo, now);
      assert.ok(Math.abs(diff - 30) < 0.05);
    });
  });

  describe('formatTimeAgo', () => {
    it('should format less than 1 minute', () => {
      const now = new Date();
      const result = formatTimeAgo(now.toISOString());
      assert.equal(result, 'hace menos de 1 minuto');
    });

    it('should format minutes (singular)', () => {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
      const result = formatTimeAgo(oneMinuteAgo);
      assert.equal(result, 'hace 1 minuto');
    });

    it('should format minutes (plural)', () => {
      const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
      const result = formatTimeAgo(thirtyMinsAgo);
      assert.equal(result, 'hace 30 minutos');
    });

    it('should format hours (singular)', () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const result = formatTimeAgo(oneHourAgo);
      assert.equal(result, 'hace 1 hora');
    });

    it('should format hours (plural)', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const result = formatTimeAgo(twoHoursAgo);
      assert.equal(result, 'hace 2 horas');
    });

    it('should format days (singular)', () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = formatTimeAgo(oneDayAgo);
      assert.equal(result, 'hace 1 día');
    });

    it('should format days (plural)', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const result = formatTimeAgo(threeDaysAgo);
      assert.equal(result, 'hace 3 días');
    });

    it('should format months', () => {
      const twoMonthsAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      const result = formatTimeAgo(twoMonthsAgo);
      assert.equal(result, 'hace 2 meses');
    });
  });

  describe('isOlderThan', () => {
    it('should return true if date is older than specified hours', () => {
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
      assert.equal(isOlderThan(twentyFiveHoursAgo, 24), true);
    });

    it('should return false if date is not older than specified hours', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      assert.equal(isOlderThan(twoHoursAgo, 24), false);
    });

    it('should handle exact boundary', () => {
      const exactlyTwentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      // Should be false because it's equal, not greater than
      assert.equal(isOlderThan(exactlyTwentyFourHoursAgo, 24), false);
    });
  });

  describe('isTomorrow', () => {
    it('should return true for tomorrow\'s date', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      assert.equal(isTomorrow(tomorrow), true);
    });

    it('should return false for today', () => {
      const today = new Date();
      assert.equal(isTomorrow(today), false);
    });

    it('should return false for day after tomorrow', () => {
      const dayAfterTomorrow = new Date();
      dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);
      assert.equal(isTomorrow(dayAfterTomorrow), false);
    });
  });

  describe('getTimeInfo', () => {
    it('should return comprehensive time information', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const info = getTimeInfo(twoHoursAgo);

      assert.ok(info.timezone);
      assert.ok(info.localTime);
      assert.ok(info.utcTime);
      assert.ok(Math.abs(info.hoursAgo - 2) < 0.05);
      assert.ok(Math.abs(info.minutesAgo - 120) < 5);
      assert.equal(info.formattedAgo, 'hace 2 horas');
    });
  });

  describe('getISOWeekKey', () => {
    // UTC timezone keeps the calendar date identical to the instant, so these
    // assertions are deterministic regardless of where the test host runs.
    const UTC = 'UTC';

    it('returns the ISO week for a mid-week date', () => {
      assert.equal(getISOWeekKey(new Date('2026-06-09T12:00:00Z'), UTC), '2026-W24');
    });

    it('keeps Sunday in the same week as the preceding Monday', () => {
      assert.equal(getISOWeekKey(new Date('2026-01-04T12:00:00Z'), UTC), '2026-W01');
    });

    it('rolls to the next week on Monday', () => {
      assert.equal(getISOWeekKey(new Date('2026-01-05T12:00:00Z'), UTC), '2026-W02');
    });

    it('assigns early-January days to the prior ISO year when needed', () => {
      // 2027-01-01 is a Friday belonging to ISO week 53 of 2026.
      assert.equal(getISOWeekKey(new Date('2027-01-01T12:00:00Z'), UTC), '2026-W53');
    });

    it('assigns late-December days to the next ISO year when needed', () => {
      // 2024-12-30 is a Monday belonging to ISO week 1 of 2025.
      assert.equal(getISOWeekKey(new Date('2024-12-30T12:00:00Z'), UTC), '2025-W01');
    });

    it('produces a stable key for every day within the same week', () => {
      const mon = getISOWeekKey(new Date('2026-06-08T01:00:00Z'), UTC);
      const sun = getISOWeekKey(new Date('2026-06-14T23:00:00Z'), UTC);
      assert.equal(mon, '2026-W24');
      assert.equal(sun, '2026-W24');
    });

    it('resolves the calendar date in the store timezone before bucketing', () => {
      // A Sunday-night instant in Asuncion (UTC-3) has already crossed midnight
      // UTC into Monday. Browser/UTC bucketing would roll it into the next ISO
      // week; resolving in store tz must keep it in the Sunday week.
      const instant = new Date('2026-06-15T02:00:00Z'); // Sun 23:00 in Asuncion
      assert.equal(getISOWeekKey(instant, 'America/Asuncion'), '2026-W24');
      assert.equal(getISOWeekKey(instant, UTC), '2026-W25');
    });

    it('returns a well-formed key shape for the current week', () => {
      assert.match(getISOWeekKey(), /^\d{4}-W\d{2}$/);
    });

    it('never emits the invalid W00 week, even for an unknown timezone', () => {
      // An unparseable timezone must still yield a real ISO week (W01..W53),
      // never the impossible "W00". formatLocalDate degrades to browser-local
      // for a bad tz, and the catch fallback recomputes from UTC if anything
      // upstream throws; both paths are covered by the W-range assertion.
      const key = getISOWeekKey(new Date('2026-06-09T12:00:00Z'), 'Not/AZone');
      assert.match(key, /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/);
    });
  });

  describe('Edge Cases', () => {
    it('should handle future dates', () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const diff = getHoursDifference(tomorrow);
      assert.ok(diff < 0); // Negative for future dates
    });

    it('should handle very old dates', () => {
      const veryOld = new Date('2020-01-01');
      const result = formatTimeAgo(veryOld);
      assert.ok(result.includes('mes'));
    });

    it('should handle dates as both string and Date objects', () => {
      const date = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const diffFromString = getHoursDifference(date.toISOString());
      const diffFromDate = getHoursDifference(date);

      assert.ok(Math.abs(diffFromString - diffFromDate) < 0.01);
    });
  });
});
