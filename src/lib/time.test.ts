import { describe, it, expect } from 'vitest';
import { getTimePeriod, formatDate, formatTime, formatDateTime } from './time';

describe('getTimePeriod', () => {
  const makeDate = (hour: number) => {
    const d = new Date(2026, 3, 2, hour, 30, 0);
    return d;
  };

  it('returns Dawn for hours 5-6', () => {
    expect(getTimePeriod(makeDate(5))).toBe('Dawn');
    expect(getTimePeriod(makeDate(6))).toBe('Dawn');
  });

  it('returns Morning for hours 7-10', () => {
    expect(getTimePeriod(makeDate(7))).toBe('Morning');
    expect(getTimePeriod(makeDate(10))).toBe('Morning');
  });

  it('returns Midday for hours 11-13', () => {
    expect(getTimePeriod(makeDate(11))).toBe('Midday');
    expect(getTimePeriod(makeDate(13))).toBe('Midday');
  });

  it('returns Afternoon for hours 14-16', () => {
    expect(getTimePeriod(makeDate(14))).toBe('Afternoon');
    expect(getTimePeriod(makeDate(16))).toBe('Afternoon');
  });

  it('returns Dusk for hours 17-19', () => {
    expect(getTimePeriod(makeDate(17))).toBe('Dusk');
    expect(getTimePeriod(makeDate(19))).toBe('Dusk');
  });

  it('returns Night for hours 20-23 and 0-4', () => {
    expect(getTimePeriod(makeDate(20))).toBe('Night');
    expect(getTimePeriod(makeDate(23))).toBe('Night');
    expect(getTimePeriod(makeDate(0))).toBe('Night');
    expect(getTimePeriod(makeDate(3))).toBe('Night');
    expect(getTimePeriod(makeDate(4))).toBe('Night');
  });

  it('boundary: hour 5 is Dawn not Night', () => {
    expect(getTimePeriod(makeDate(5))).toBe('Dawn');
  });

  it('boundary: hour 7 is Morning not Dawn', () => {
    expect(getTimePeriod(makeDate(7))).toBe('Morning');
  });

  it('boundary: hour 11 is Midday not Morning', () => {
    expect(getTimePeriod(makeDate(11))).toBe('Midday');
  });

  it('boundary: hour 14 is Afternoon not Midday', () => {
    expect(getTimePeriod(makeDate(14))).toBe('Afternoon');
  });

  it('boundary: hour 17 is Dusk not Afternoon', () => {
    expect(getTimePeriod(makeDate(17))).toBe('Dusk');
  });

  it('boundary: hour 20 is Night not Dusk', () => {
    expect(getTimePeriod(makeDate(20))).toBe('Night');
  });
});

describe('formatDate', () => {
  it('formats ISO string to short date', () => {
    const result = formatDate('2026-04-02T10:30:00.000Z');
    // Locale-dependent, but should contain "Apr" and "2026"
    expect(result).toContain('Apr');
    expect(result).toContain('2026');
  });
});

describe('formatTime', () => {
  it('formats ISO string to time', () => {
    // Create a date at a known local hour
    const localDate = new Date(2026, 3, 2, 14, 30, 0);
    const result = formatTime(localDate.toISOString());
    expect(result).toContain('2:30');
    expect(result).toContain('PM');
  });
});

describe('formatDateTime', () => {
  it('combines date and time', () => {
    const localDate = new Date(2026, 3, 2, 14, 30, 0);
    const iso = localDate.toISOString();
    const result = formatDateTime(iso);
    expect(result).toContain('Apr');
    expect(result).toContain('2026');
    expect(result).toContain('2:30');
    expect(result).toContain('PM');
  });
});
