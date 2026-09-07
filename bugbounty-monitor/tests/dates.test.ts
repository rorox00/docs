import { describe, expect, it } from 'vitest';
import { daysSince, formatDate, parseLooseDate, plausible, toIsoDate } from '@/lib/dates';

const NOW = new Date('2026-09-07T12:00:00Z');

describe('parseLooseDate', () => {
  it('parses ISO dates', () => {
    expect(toIsoDate(parseLooseDate('2026-09-05', NOW))).toBe('2026-09-05');
    expect(toIsoDate(parseLooseDate('2026-09-05T10:30:00Z', NOW))).toBe('2026-09-05');
  });

  it('parses long-form English dates in both orders', () => {
    expect(toIsoDate(parseLooseDate('September 5, 2026', NOW))).toBe('2026-09-05');
    expect(toIsoDate(parseLooseDate('Sep 5 2026', NOW))).toBe('2026-09-05');
    expect(toIsoDate(parseLooseDate('5 September 2026', NOW))).toBe('2026-09-05');
    expect(toIsoDate(parseLooseDate('1st March 2025', NOW))).toBe('2025-03-01');
  });

  it('parses month-and-year to the first of the month', () => {
    expect(toIsoDate(parseLooseDate('September 2026', NOW))).toBe('2026-09-01');
  });

  it('refuses ambiguous numeric dates rather than guessing', () => {
    // 07/09/2026 could be 7 September or 9 July — an invented launch date is
    // worse than an unknown one.
    expect(parseLooseDate('07/09/2026', NOW)).toBeNull();
  });

  it('rejects implausible and invalid dates', () => {
    expect(parseLooseDate('1970-01-01', NOW)).toBeNull();
    expect(parseLooseDate('2030-01-01', NOW)).toBeNull();
    expect(parseLooseDate('2026-02-30', NOW)).toBeNull();
    expect(parseLooseDate('', NOW)).toBeNull();
    expect(parseLooseDate(null, NOW)).toBeNull();
  });
});

describe('plausible', () => {
  it('allows a small clock skew into the future', () => {
    expect(plausible(new Date('2026-09-08T00:00:00Z'), NOW)).toBe(true);
    expect(plausible(new Date('2026-10-08T00:00:00Z'), NOW)).toBe(false);
  });
});

describe('daysSince', () => {
  it('counts whole UTC days', () => {
    expect(daysSince(new Date('2026-09-07T01:00:00Z'), NOW)).toBe(0);
    expect(daysSince(new Date('2026-09-05T23:00:00Z'), NOW)).toBe(2);
  });
});

describe('formatDate', () => {
  it('renders a stable UTC label and handles null', () => {
    expect(formatDate(new Date('2026-09-07T00:00:00Z'))).toBe('Sep 7, 2026');
    expect(formatDate(null)).toBe('Unknown');
  });
});
